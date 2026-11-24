/**
 * A local server for the review preview.
 *
 * Until this existed, a comment went into the browser's `localStorage` and
 * stopped there. Getting it into the vault meant downloading a file and
 * moving it by hand, and the page could never read anything back -- so a
 * comment was invisible in another browser, on another machine, or after a
 * rebuild. Two gaps, and closing only the first would not have given anyone
 * what they wanted. The download is gone now, and this is why.
 *
 * A page cannot write to disk, so something local has to hold the pen. This
 * does: it serves the built preview *and* a small JSON API from the same
 * origin -- the comments, and a route that asks the plugin to file one of
 * them in a tracker -- which is the detail that makes the rest simple. Same origin means
 * no CORS, no preflight, no `null`-origin requests from `file://`, and
 * relative URLs that just work. The overlay reads the comments when the page
 * opens and writes them back as they are made; the plugin puts them in the
 * vault.
 *
 * **It is bound to 127.0.0.1 and gated on a token.** It can read and write
 * inside the vault, so it must not be reachable from the network, and it must
 * not be usable by any other process that happens to be running on the
 * machine. The token arrives once as `?t=`, becomes a cookie, and every later
 * request -- navigations and `fetch` alike -- carries it from there.
 *
 * Files are read through the vault adapter rather than straight off the disk.
 * That keeps the server from needing to know where the vault is, and means
 * the only paths it can reach are the ones the store is willing to hand over.
 */

import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import { OVERLAY_SCHEMA_VERSION, OverlayExternalIssue } from "./types";
import { scalarText } from "../text";
import {
  EditRequest,
  INSERT_KINDS,
  InsertKind,
  InsertLike,
  Place,
  StyleProps,
  TextEdit,
  applyEdits,
  cssRuleStart,
  hashText,
  lineAt,
  ruleStart,
  invertEdits,
  linkedStylesheets,
  planCssRule,
  planOp,
  prepareForEditing,
  shiftsOf,
} from "./edit";
import { editInjection } from "./editScript";
import { isPropertyName, isSafeSelector, isSafeValueOrRemoval, isWidthQuery } from "./editCss";

/** Everything the server is allowed to touch, so it can touch nothing else. */
export interface ReviewStore {
  /** The saved comments file, or null when none has been written yet. */
  readComments(): Promise<string | null>;
  /** Replaces the saved comments file. */
  writeComments(body: string): Promise<void>;
  /**
   * A file from the built preview, by its site-relative path, or null.
   *
   * The store resolves the path, so traversal out of the preview folder is
   * not something this server can express, let alone do.
   */
  readPreview(path: string): Promise<ArrayBuffer | string | null>;
  /**
   * Which note produced which published page, as a past publish recorded
   * it, or null when this vault has never published with the overlay on.
   *
   * Read-only, and separate from the comments: the browser needs it to put
   * notes back on a review that came in from the published site, and
   * nothing in the browser should be able to write it.
   */
  readPages(): Promise<string | null>;
}

/**
 * What the edit notch may touch: the vault files behind the preview's as-is
 * pages, and nothing else.
 *
 * Separate from `ReviewStore` because it is a different power. Comments are
 * the reviewer's own file; this writes to the author's work. A server built
 * without one serves every page exactly as before and has no edit route.
 */
export interface EditStore {
  /**
   * The vault path of the as-is page served at this preview path, or null
   * for anything else -- a rendered note, an asset, a page this build did not
   * copy. Only paths this answers for can ever be written.
   */
  sourceFor(previewPath: string): string | null;
  readSource(vaultPath: string): Promise<string | null>;
  writeSource(vaultPath: string, text: string): Promise<void>;
  /** Replaces the preview copy, so a reload shows the edit without a build. */
  writePreview(previewPath: string, text: string): Promise<void>;
  /** Keeps the file as it was before this session's first edit to it. */
  backup(vaultPath: string, text: string): Promise<void>;
  /**
   * The images Insert may put on this page: vault paths of the image files
   * in the page's own folder and below it.
   */
  images?(vaultPath: string): Promise<string[]>;
  /** Copies a vault file into the preview, so a new image shows without a build. */
  copyToPreview?(vaultPath: string, previewPath: string): Promise<void>;
  /** A vault image's bytes, for Insert's picker to show before it is in the preview. */
  readImage?(vaultPath: string): Promise<ArrayBuffer | null>;
  /** A link that opens a vault file at a line in the chosen editor, or null for none. */
  editorLink?(vaultPath: string, line: number, column: number): { url: string; name: string } | null;
}

/** The images Insert can use: the page's folder and below, by path from the page. */
async function imagesFor(edit: EditStore, vaultPath: string): Promise<Array<{ src: string; vault: string }>> {
  if (!edit.images) return [];
  const dir = vaultPath.includes("/") ? vaultPath.slice(0, vaultPath.lastIndexOf("/") + 1) : "";
  const found = await edit.images(vaultPath);
  return found
    .filter((path) => path.startsWith(dir) && /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(path))
    .slice(0, 500)
    .map((path) => ({ src: path.slice(dir.length), vault: path }));
}

/**
 * One edit the notch can take back, and put back again.
 *
 * Kept per page, not per file: an edit to a page's linked stylesheet is
 * undone from that page like any other. `file` is the vault file it
 * changed, `preview` that file's preview path.
 */
interface EditRecord {
  id: string;
  file: string;
  preview: string;
  /** True when the file is the page itself, so its stamps move. */
  html: boolean;
  forward: TextEdit[];
  inverse: TextEdit[];
  relocated?: Array<[number, number]>;
  /** Edits made as one gesture -- one change to many layers -- undo together. */
  group?: string;
  /** The file's hash before and after: each way is refused if it moved. */
  beforeHash: string;
  afterHash: string;
}

interface PageHistory {
  undo: EditRecord[];
  redo: EditRecord[];
}

/** How many edits a file keeps for undo. */
const UNDO_DEPTH = 100;

/**
 * What came of asking for one comment to be filed in a tracker.
 *
 * A refusal is a value rather than a throw, because most of them are not
 * faults: no tracker set up, no repository named, a token without permission
 * to open an issue. The reviewer needs the sentence, not a stack trace.
 */
export type RelayOutcome =
  | { ok: true; external: OverlayExternalIssue }
  | { ok: false; error: string };

export interface ReviewServerOptions {
  store: ReviewStore;
  /**
   * Files one comment in a tracker, by id.
   *
   * Optional, and absent is the normal case: a vault with no tracker
   * configured passes nothing, the route answers that there is none, and the
   * overlay shows no Send action at all. The handler lives in the plugin
   * because it is the only side holding a credential -- this server passes an
   * id across and hands the answer back.
   */
  relay?: (id: string) => Promise<RelayOutcome>;
  /**
   * Called after the overlay has read or written the review.
   *
   * The hook the plugin keeps its trackers in step from: a page being opened
   * or a comment being changed is the moment the two sides are worth putting
   * back in step. It is called and not awaited -- whatever it does must not
   * hold a reviewer's request open -- and anything it throws is swallowed
   * here, because a tracker being unreachable is not a reason for a save to
   * fail.
   */
  touched?: () => void;
  /**
   * Turns on the edit notch for as-is pages. Absent, the server never
   * stamps a page, never injects the edit script and answers no edit route.
   */
  edit?: EditStore;
  /** 0, the default, takes whatever port the OS offers. */
  port?: number;
  /** Injectable so a test is not at the mercy of a random value. */
  token?: string;
}

export interface ReviewServerAddress {
  port: number;
  token: string;
  /** The address to open, token included, for the first request. */
  url: string;
}

const COOKIE = "osp-review";
/** A comment is prose. A megabyte of it is somebody probing, not reviewing. */
const MAX_BODY = 4 * 1024 * 1024;

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
};

export function mimeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

/**
 * The empty document, used when nothing has been saved yet.
 *
 * Shaped like a saved review on purpose: the same `parseExport` reads both,
 * and the import command needs no idea whether a file was written by the
 * server or copied into the folder by hand.
 */
export function emptyDocument(site: string): string {
  return JSON.stringify(
    {
      version: OVERLAY_SCHEMA_VERSION,
      site,
      exportedAt: new Date().toISOString(),
      comments: [],
    },
    null,
    2,
  );
}

/**
 * Puts back the issue records an incoming document does not carry.
 *
 * The browser never sets `external` -- only the plugin does -- so where the
 * two copies disagree the file is right and the page is simply out of date.
 * This can therefore only add information, never undo anything a reviewer
 * did, which is what makes it safe to apply to every save.
 */
/**
 * The deletions still waiting to be acted on, after a save.
 *
 * Two sources: what the browser has just handed over, and what the file
 * already held because the plugin has not closed those issues yet. Keyed by
 * the issue rather than by the comment, since the comment is gone and the
 * same issue arriving twice would be closed twice.
 */
export function carryWithdrawn(incoming: unknown, saved: string | null): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<string>();

  const add = (rows: unknown): void => {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const entry = row as { external?: { provider?: unknown; key?: unknown } };
      if (!entry.external || typeof entry.external !== "object") continue;
      const key = `${scalarText(entry.external.provider)}:${scalarText(entry.external.key)}`;
      if (key === ":" || seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  };

  add(incoming);
  if (saved) {
    try {
      add((JSON.parse(saved) as { withdrawn?: unknown }).withdrawn);
    } catch {
      // An unreadable file is about to be replaced by a good one.
    }
  }

  return out;
}

export function carryExternal(incoming: unknown[], saved: string | null): unknown[] {
  if (!saved) return incoming;

  let known: Record<string, unknown>;
  try {
    const parsed = JSON.parse(saved) as { comments?: unknown };
    if (!Array.isArray(parsed.comments)) return incoming;
    known = Object.create(null) as Record<string, unknown>;
    for (const row of parsed.comments) {
      if (!row || typeof row !== "object") continue;
      const comment = row as { id?: unknown; external?: unknown };
      if (typeof comment.id === "string" && comment.external) {
        known[comment.id] = comment.external;
      }
    }
  } catch {
    // An unreadable file is about to be replaced by a good one. Nothing to
    // carry across, and no reason to refuse the save over it.
    return incoming;
  }

  return incoming.map((row) => {
    if (!row || typeof row !== "object") return row;
    const comment = row as { id?: unknown; external?: unknown };
    if (comment.external || typeof comment.id !== "string") return row;
    const external = known[comment.id];
    return external ? { ...comment, external } : row;
  });
}

/** A random token. Not a secret worth protecting for long, but unguessable. */
export function makeToken(): string {
  let out = "";
  for (let i = 0; i < 4; i++) out += Math.random().toString(36).slice(2, 10);
  return out;
}

/**
 * Site-relative path for a request, or null when it is not one we will serve.
 *
 * Everything about this function is refusal. A path that climbs with `..`, an
 * absolute one, a backslash that Windows would read as a separator, a null
 * byte that a C library would read as a terminator -- none of them get a path
 * back. The store resolves only what survives.
 */
export function previewPathFor(url: string): string | null {
  const raw = url.split("?")[0].split("#")[0];

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }

  if (decoded.includes("\0") || decoded.includes("\\")) return null;

  const parts = decoded.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => part === "..")) return null;

  if (!parts.length) return "index.html";
  // A directory, by the look of it: serve its index like any static host.
  if (!parts[parts.length - 1].includes(".")) parts.push("index.html");
  return parts.join("/");
}

export class ReviewServer {
  private server: Server | null = null;
  private address: ReviewServerAddress | null = null;
  /** Undo and redo per page, newest last. Lives as long as the server. */
  private readonly history = new Map<string, PageHistory>();
  /** Files already backed up this session. */
  private readonly backedUp = new Set<string>();
  /** Edits run one at a time, so two quick ones cannot both read the old file. */
  private editQueue: Promise<unknown> = Promise.resolve();
  private editCount = 0;

  constructor(private readonly options: ReviewServerOptions) {}

  /** Where it is listening, or null when it is not. */
  get listening(): ReviewServerAddress | null {
    return this.address;
  }

  async start(): Promise<ReviewServerAddress> {
    if (this.address) return this.address;

    const token = this.options.token ?? makeToken();
    const server = createServer((request, response) => {
      void this.handle(request, response, token);
    });

    const port = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      // 127.0.0.1 rather than the default: on any other interface this is a
      // writable window into the vault for the whole network.
      server.listen(this.options.port ?? 0, "127.0.0.1", () => {
        const info = server.address();
        if (info && typeof info === "object") resolve(info.port);
        else reject(new Error("the review server reported no port"));
      });
    });

    this.server = server;
    this.address = {
      port,
      token,
      url: `http://127.0.0.1:${port}/?t=${encodeURIComponent(token)}`,
    };
    return this.address;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.address = null;
    if (!server) return;

    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    // `close` stops it accepting and then waits for the connections it
    // already has, and a browser holds one open between requests. So a stop
    // with a preview tab open waited on a socket that was not going to end
    // by itself -- the plugin's unload hung, and in the tests the process
    // would not exit. Stopping has to mean stopping.
    server.closeAllConnections?.();
    await closed;
  }

  private authorized(request: IncomingMessage, token: string): boolean {
    const url = request.url ?? "";
    const query = url.indexOf("?");
    if (query !== -1) {
      const offered = new URLSearchParams(url.slice(query + 1)).get("t");
      if (offered === token) return true;
    }

    const cookies = request.headers.cookie ?? "";
    for (const pair of cookies.split(";")) {
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      if (pair.slice(0, eq).trim() !== COOKIE) continue;
      if (pair.slice(eq + 1).trim() === token) return true;
    }
    return false;
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
    token: string,
  ): Promise<void> {
    try {
      if (!this.authorized(request, token)) {
        return send(response, 403, "text/plain; charset=utf-8", "Not authorized.");
      }

      // Handed over once in the query, kept in a cookie from then on, so that
      // links between pages and the overlay's own fetches do not each have to
      // carry it.
      if ((request.url ?? "").includes("t=" + token)) {
        response.setHeader(
          "Set-Cookie",
          `${COOKIE}=${token}; Path=/; SameSite=Strict`,
        );
        /*
         * And then out of the address bar. A page that routes on the address
         * -- every as-is prototype, which records `location` as the screen a
         * comment is on -- would otherwise record the token as part of the
         * screen. The token is new every time the server starts, so those
         * pins vanished in the next session and never matched on the
         * published site at all. The cookie is set on this response, so the
         * redirect is already authorized.
         */
        const raw = request.url ?? "/";
        const cut = raw.indexOf("?");
        // Pages only: the API is called by scripts, which may present the
        // token per request and have no address bar to keep clean.
        const isApi = raw.startsWith("/api/");
        if ((request.method ?? "GET") === "GET" && cut !== -1 && !isApi) {
          const params = new URLSearchParams(raw.slice(cut + 1));
          if (params.get("t") === token) {
            params.delete("t");
            const rest = params.toString();
            response.statusCode = 302;
            response.setHeader("Location", raw.slice(0, cut) + (rest ? `?${rest}` : ""));
            response.end();
            return;
          }
        }
      }

      const path = (request.url ?? "/").split("?")[0];

      /*
       * The page-to-note mapping, for an import.
       *
       * A review exported from the published site keys its comments on
       * page URLs, because a published page must not carry vault paths.
       * This is how the overlay puts the notes back when that file is
       * imported into a preview: without it the comments arrive looking
       * like they belong to pages this build does not have, with no pins
       * and no way to open them.
       *
       * GET only, and asked for only when an import happens, so it costs
       * nothing on an ordinary page load.
       */
      if (path === "/api/pages") {
        if (request.method !== "GET") {
          return send(response, 405, "text/plain; charset=utf-8", "Method not allowed.");
        }
        const pages = await this.options.store.readPages();
        return send(response, 200, MIME.json, pages ?? `{"pages":{}}`, {
          "Cache-Control": "no-store",
        });
      }

      if (path === "/api/comments") {
        if (request.method === "GET") return await this.getComments(response);
        if (request.method === "POST" || request.method === "PUT") {
          return await this.putComments(request, response);
        }
        return send(response, 405, "text/plain; charset=utf-8", "Method not allowed.");
      }

      if (path === "/api/images" && this.options.edit) {
        if (request.method !== "GET") {
          return send(response, 405, "text/plain; charset=utf-8", "Method not allowed.");
        }
        const page = new URLSearchParams((request.url ?? "").split("?")[1] ?? "").get("page") ?? "";
        const vaultPath = /\.html?$/i.test(page) ? this.options.edit.sourceFor(page) : null;
        if (!vaultPath) return send(response, 404, MIME.json, `{"images":[]}`);
        const images = await imagesFor(this.options.edit, vaultPath);
        return send(response, 200, MIME.json, JSON.stringify({ images: images.map((i) => i.src) }), {
          "Cache-Control": "no-store",
        });
      }

      /*
       * One of the page's images, for the picker's thumbnails: straight from
       * the vault, since an image is only copied into the preview once it is
       * inserted. Only the files /api/images lists, and an SVG opened on its
       * own runs nothing.
       */
      if (path === "/api/image" && this.options.edit) {
        if (request.method !== "GET") {
          return send(response, 405, "text/plain; charset=utf-8", "Method not allowed.");
        }
        const query = new URLSearchParams((request.url ?? "").split("?")[1] ?? "");
        const page = query.get("page") ?? "";
        const vaultPath = /\.html?$/i.test(page) ? this.options.edit.sourceFor(page) : null;
        const image = vaultPath && this.options.edit.readImage
          ? (await imagesFor(this.options.edit, vaultPath)).find((i) => i.src === query.get("src"))
          : undefined;
        const bytes = image ? await this.options.edit.readImage!(image.vault) : null;
        if (!image || !bytes) return send(response, 404, "text/plain; charset=utf-8", "Not found.");
        return send(response, 200, mimeFor(image.src), Buffer.from(bytes), {
          "Cache-Control": "no-store",
          "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
          "X-Content-Type-Options": "nosniff",
        });
      }

      if (path === "/api/where" && this.options.edit) {
        if (request.method !== "POST") {
          return send(response, 405, "text/plain; charset=utf-8", "Method not allowed.");
        }
        return await this.postWhere(request, response, this.options.edit);
      }

      if (path === "/api/edit" && this.options.edit) {
        if (request.method !== "POST") {
          return send(response, 405, "text/plain; charset=utf-8", "Method not allowed.");
        }
        return await this.postEdit(request, response, this.options.edit);
      }

      if (path === "/api/relay") {
        if (request.method !== "POST") {
          return send(response, 405, "text/plain; charset=utf-8", "Method not allowed.");
        }
        return await this.postRelay(request, response);
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        return send(response, 405, "text/plain; charset=utf-8", "Method not allowed.");
      }

      return await this.getFile(request.url ?? "/", response);
    } catch (error) {
      // A failed request must not take the server down with it: the reviewer
      // is mid-sentence in a browser somewhere.
      send(
        response,
        500,
        "text/plain; charset=utf-8",
        error instanceof Error ? error.message : "Something went wrong.",
      );
    }
  }

  /**
   * Tells the plugin the review was touched, and never fails over it.
   *
   * Deliberately not awaited: the reviewer's request is already answered,
   * and whatever the plugin does with this -- a round of HTTP to a tracker,
   * in practice -- is not something to hold a browser open for.
   */
  private touched(): void {
    try {
      this.options.touched?.();
    } catch {
      // A hook that throws is the plugin's problem, not this request's.
    }
  }

  private async getComments(response: ServerResponse): Promise<void> {
    const saved = await this.options.store.readComments();
    send(
      response,
      200,
      MIME.json,
      saved ?? emptyDocument(""),
      // The live store changes under the page; a cached copy of it is a page
      // showing comments that are no longer there.
      { "Cache-Control": "no-store" },
    );
    // A page being opened is the other half of keeping the two sides in
    // step: this answer is what the overlay shows, so it is worth having
    // the next one be current.
    this.touched();
  }

  private async putComments(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const body = await readBody(request);
    if (body === null) {
      return send(response, 413, MIME.json, `{"error":"too large"}`);
    }

    // Parsed before it is written, so a malformed body cannot replace a good
    // file with something nothing can read back.
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return send(response, 400, MIME.json, `{"error":"not valid JSON"}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return send(response, 400, MIME.json, `{"error":"expected an object"}`);
    }
    if (!Array.isArray((parsed as { comments?: unknown }).comments)) {
      return send(response, 400, MIME.json, `{"error":"expected a comments array"}`);
    }

    // The browser is writing the whole document, and it has no idea about
    // anything the plugin wrote into the file since the page loaded. One
    // field is in that position -- the issue a comment was filed as -- and
    // losing it would mean the next Send filed a second issue for the same
    // comment. So it is read off the file and put back before the write.
    const document = parsed as { comments: unknown[]; withdrawn?: unknown };
    const saved = await this.options.store.readComments();
    document.comments = carryExternal(document.comments, saved);
    // The browser hands over the deletions it has just made; the file holds
    // the ones the plugin has not dealt with yet. Both have to survive this
    // write, or an issue is left open with nothing pointing at it.
    document.withdrawn = carryWithdrawn(document.withdrawn, saved);

    await this.options.store.writeComments(JSON.stringify(document, null, 2));
    send(response, 200, MIME.json, `{"saved":true}`);
    this.touched();
  }

  private async postRelay(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const relay = this.options.relay;
    // 501 rather than 404: the route exists, this vault just has no tracker
    // behind it, and the overlay says so in those words.
    if (!relay) {
      return send(response, 501, MIME.json, `{"error":"No tracker is set up."}`);
    }

    const body = await readBody(request);
    if (body === null) return send(response, 413, MIME.json, `{"error":"too large"}`);

    let id: unknown;
    try {
      id = (JSON.parse(body) as { id?: unknown }).id;
    } catch {
      return send(response, 400, MIME.json, `{"error":"not valid JSON"}`);
    }
    if (typeof id !== "string" || !id) {
      return send(response, 400, MIME.json, `{"error":"expected a comment id"}`);
    }

    let outcome: RelayOutcome;
    try {
      outcome = await relay(id);
    } catch (error) {
      outcome = {
        ok: false,
        error: error instanceof Error ? error.message : "Filing it failed.",
      };
    }

    // 200 either way, with the refusal in the body: every failure here is
    // one the reviewer is meant to read, and a status code is not a sentence.
    send(response, 200, MIME.json, JSON.stringify(outcome));
  }

  /**
   * One edit to an as-is page's file, or the undo of the last one.
   *
   * The body names the page by its preview path, the element by its stamp,
   * and the file by the hash it was served with. Everything else -- which
   * file, which characters -- is worked out here.
   */
  private async postEdit(
    request: IncomingMessage,
    response: ServerResponse,
    edit: EditStore,
  ): Promise<void> {
    const raw = await readBody(request);
    if (raw === null) return send(response, 413, MIME.json, `{"error":"too large"}`);

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      return send(response, 400, MIME.json, `{"error":"not valid JSON"}`);
    }
    if (!body || typeof body !== "object") {
      return send(response, 400, MIME.json, `{"error":"expected an object"}`);
    }

    const page = typeof body.page === "string" ? body.page : "";
    const vaultPath = page && /\.html?$/i.test(page) ? edit.sourceFor(page) : null;
    if (!vaultPath) {
      return send(response, 404, MIME.json, JSON.stringify({ error: "This page cannot be edited." }));
    }

    const run = async (): Promise<[number, unknown]> => {
      const source = await edit.readSource(vaultPath);
      if (source === null) {
        return [404, { error: "The file behind this page is not in the vault any more." }];
      }
      if (body.hash !== hashText(source)) {
        return [409, { conflict: true, error: "The file has changed since this page loaded. Reload to keep editing." }];
      }

      const history = this.history.get(page) ?? { undo: [], redo: [] };
      this.history.set(page, history);

      if (body.op === "undo" || body.op === "redo") {
        const undoing = body.op === "undo";
        const from = undoing ? history.undo : history.redo;
        const last = from[from.length - 1];
        // No id is a page that reloaded since the edit and no longer knows
        // it: the server steps back on its own, and the page reloads.
        const blind = body.id === undefined || body.id === null;
        if (!last || (!blind && last.id !== body.id)) {
          return [409, { conflict: true, error: `${undoing ? "Undo" : "Redo"} is out of step with the file. Reload to keep editing.` }];
        }
        // Blind, a gesture that changed many layers comes back as a whole.
        let steps = 1;
        if (blind && last.group) {
          while (steps < from.length && from[from.length - 1 - steps].group === last.group) steps++;
        }
        let edits: TextEdit[] = [];
        let pageHash = body.hash;
        for (let i = 0; i < steps; i++) {
          const record = from[from.length - 1];
          const text = await edit.readSource(record.file);
          if (text === null || hashText(text) !== (undoing ? record.afterHash : record.beforeHash)) {
            return [409, { conflict: true, error: `The file changed since that edit, so it can't be ${undoing ? "undone" : "redone"} from here.` }];
          }
          from.pop();
          edits = undoing ? record.inverse : record.forward;
          const next = applyEdits(text, edits);
          await this.writeEdited(edit, record.preview, record.file, text, next);
          (undoing ? history.redo : history.undo).push(record);
          if (record.html) pageHash = hashText(next);
        }
        return [
          200,
          {
            id: last.id,
            hash: pageHash,
            edits: last.html && steps === 1 ? shiftsOf(edits) : [],
            relocated: last.relocated,
            reload: blind,
            ...this.counts(history),
          },
        ];
      }

      const request = editRequest(body);
      if (typeof request === "string") return [400, { error: request }];

      // A rule in a linked stylesheet: the edit lands in that file instead.
      let file = vaultPath;
      let preview = page;
      let text = source;
      let planned;
      if (request.op === "rule-style" && typeof request.sheet === "string") {
        const sheetPath = request.sheet;
        const sheetFile = sheetPath.endsWith(".css") ? edit.sourceFor(sheetPath) : null;
        if (!sheetFile || !linkedStylesheets(source, page).includes(sheetPath)) {
          return [404, { error: "That stylesheet can't be edited from this page." }];
        }
        const css = await edit.readSource(sheetFile);
        if (css === null) return [404, { error: "That stylesheet is not in the vault any more." }];
        file = sheetFile;
        preview = sheetPath;
        text = css;
        planned = planCssRule(css, request.path, request.selector, request.props);
      } else {
        if (request.op === "insert" && request.kind === "image") {
          const image = (await imagesFor(edit, vaultPath)).find((i) => i.src === request.src);
          if (!image) return [404, { error: "That image isn't in this page's folder." }];
          if (edit.copyToPreview) {
            const dir = page.includes("/") ? page.slice(0, page.lastIndexOf("/") + 1) : "";
            await edit.copyToPreview(image.vault, dir + image.src);
          }
        }
        planned = planOp(source, request);
      }
      if (!planned.ok) return [422, { error: planned.error }];
      // A removal of something that was never there changes nothing.
      planned.edits = planned.edits.filter((e) => e.start !== e.end || e.text);
      if (!planned.edits.length) return [200, { id: null, hash: body.hash, edits: [], ...this.counts(history) }];

      const next = applyEdits(text, planned.edits);
      if (!this.backedUp.has(file)) {
        await edit.backup(file, text);
        this.backedUp.add(file);
      }
      await this.writeEdited(edit, preview, file, text, next);

      const html = file === vaultPath;
      const record: EditRecord = {
        id: `e${++this.editCount}`,
        file,
        preview,
        html,
        forward: planned.edits,
        inverse: invertEdits(text, planned.edits),
        relocated: planned.relocated,
        group: typeof body.group === "string" && /^[\w-]{1,40}$/.test(body.group) ? body.group : undefined,
        beforeHash: hashText(text),
        afterHash: hashText(next),
      };
      history.undo.push(record);
      if (history.undo.length > UNDO_DEPTH) history.undo.shift();
      // A new edit starts a new branch: what was undone is not coming back.
      history.redo = [];
      return [
        200,
        {
          id: record.id,
          hash: html ? record.afterHash : body.hash,
          edits: html ? shiftsOf(planned.edits) : [],
          relocated: planned.relocated,
          created: planned.created,
          ...this.counts(history),
        },
      ];
    };

    const result = this.editQueue.then(run, run);
    this.editQueue = result.catch(() => undefined);
    const [status, answer] = await result;
    send(response, status, MIME.json, JSON.stringify(answer));
  }

  /**
   * Where a layer and its rules are in the files: path, line and column,
   * for the panel's Code section and its "open in editor" link. Read-only.
   */
  private async postWhere(request: IncomingMessage, response: ServerResponse, edit: EditStore): Promise<void> {
    const raw = await readBody(request);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw ?? "") as typeof body;
    } catch {
      return send(response, 400, MIME.json, `{"error":"not valid JSON"}`);
    }
    const page = typeof body?.page === "string" ? body.page : "";
    const vaultPath = page && /\.html?$/i.test(page) ? edit.sourceFor(page) : null;
    if (!vaultPath) return send(response, 404, MIME.json, `{"error":"This page cannot be edited."}`);
    const source = await edit.readSource(vaultPath);
    if (source === null) return send(response, 404, MIME.json, `{"error":"gone"}`);
    if (body.hash !== hashText(source)) return send(response, 409, MIME.json, `{"conflict":true}`);

    const place = (file: string, text: string, offset: number) => {
      const at = lineAt(text, offset);
      const link = edit.editorLink?.(file, at.line, at.column) ?? null;
      return { file, line: at.line, column: at.column, editor: link?.url ?? null, editorName: link?.name ?? null };
    };

    const answer: { layer: unknown; rules: unknown[] } = { layer: null, rules: [] };
    if (isOffset(body.at) && body.at < source.length) answer.layer = place(vaultPath, source, body.at);
    const rules = Array.isArray(body.rules) ? body.rules.slice(0, 40) : [];
    const sheets = new Map<string, string | null>();
    for (const item of rules as Array<Record<string, unknown>>) {
      const path = item?.path;
      const selector = item?.selector;
      if (!Array.isArray(path) || !path.every(isOffset) || typeof selector !== "string" || selector.length > 1000) {
        answer.rules.push(null);
        continue;
      }
      if (isOffset(item.sheet)) {
        const at = ruleStart(source, item.sheet, path, selector);
        answer.rules.push(at === null ? null : place(vaultPath, source, at));
        continue;
      }
      const sheet = typeof item.sheet === "string" ? item.sheet : "";
      const file = sheet.endsWith(".css") && linkedStylesheets(source, page).includes(sheet) ? edit.sourceFor(sheet) : null;
      if (!file) {
        answer.rules.push(null);
        continue;
      }
      if (!sheets.has(file)) sheets.set(file, await edit.readSource(file));
      const css = sheets.get(file);
      const at = css ? cssRuleStart(css, path, selector) : null;
      answer.rules.push(css && at !== null ? place(file, css, at) : null);
    }
    send(response, 200, MIME.json, JSON.stringify(answer), { "Cache-Control": "no-store" });
  }

  private counts(history: PageHistory): { undo: number; redo: number } {
    return { undo: history.undo.length, redo: history.redo.length };
  }

  /** How much a page could undo and redo, for a page that has just loaded. */
  historyOf(page: string): { undo: number; redo: number } {
    const history = this.history.get(page);
    return history ? this.counts(history) : { undo: 0, redo: 0 };
  }

  /** Writes the vault file, then the preview copy with its appendix kept. */
  private async writeEdited(
    edit: EditStore,
    page: string,
    vaultPath: string,
    before: string,
    after: string,
  ): Promise<void> {
    await edit.writeSource(vaultPath, after);
    const preview = await this.options.store.readPreview(page);
    const text =
      preview === null ? "" : typeof preview === "string" ? preview : new TextDecoder().decode(preview);
    const appendix = text.startsWith(before) ? text.slice(before.length) : "";
    await edit.writePreview(page, after + appendix);
  }

  private async getFile(url: string, response: ServerResponse): Promise<void> {
    const path = previewPathFor(url);
    if (!path) {
      return send(response, 400, "text/plain; charset=utf-8", "Bad path.");
    }

    const file = await this.options.store.readPreview(path);
    if (file === null) {
      return send(response, 404, "text/plain; charset=utf-8", "Not found.");
    }

    const edit = this.options.edit;
    const vaultPath = edit && /\.html?$/i.test(path) ? edit.sourceFor(path) : null;
    if (edit && vaultPath) {
      const preview = typeof file === "string" ? file : new TextDecoder().decode(file);
      const html = await editablePage(edit, path, vaultPath, preview, this.historyOf(path));
      return send(response, 200, MIME.html, html, { "Cache-Control": "no-store" });
    }

    const body = typeof file === "string" ? file : Buffer.from(file);
    send(response, 200, mimeFor(path), body, { "Cache-Control": "no-store" });
  }
}

/** Largest text the notch will write in one go: a paragraph, not a book. */
const MAX_EDIT_TEXT = 100_000;

function isOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Declarations from a body, each checked, or why they cannot be written. */
function styleProps(raw: unknown): StyleProps | string {
  if (!Array.isArray(raw) || !raw.length || raw.length > 32) return "Expected declarations to set.";
  const out: StyleProps = [];
  for (const pair of raw) {
    if (!Array.isArray(pair) || pair.length !== 2) return "Expected declarations to set.";
    const [prop, value] = pair as unknown[];
    if (typeof prop !== "string" || !isPropertyName(prop)) return "Expected a CSS property.";
    if (typeof value !== "string" || !isSafeValueOrRemoval(value)) return "That value can't be written.";
    out.push([prop, value]);
  }
  return out;
}

/** The request in a body, or why it is not one. */
export function editRequest(body: Record<string, unknown>): EditRequest | string {
  const op = body.op;
  if (op === "add-rule") {
    const props = styleProps(body.props);
    if (typeof props === "string") return props;
    if (body.sheet !== null && !isOffset(body.sheet)) return "Expected a stylesheet.";
    if (typeof body.selector !== "string" || !isSafeSelector(body.selector)) return "That selector can't be written.";
    if (body.media !== undefined && (typeof body.media !== "string" || !isWidthQuery(body.media))) {
      return "Expected a width condition.";
    }
    return {
      op,
      sheet: body.sheet,
      selector: body.selector,
      props,
      ...(body.media ? { media: body.media } : {}),
    };
  }
  if (op === "rule-style" || op === "inline-style") {
    const props = styleProps(body.props);
    if (typeof props === "string") return props;
    if (op === "inline-style") {
      if (!isOffset(body.at)) return "Expected an element.";
      return { op, at: body.at, props };
    }
    const sheet = body.sheet;
    if (!isOffset(sheet) && !(typeof sheet === "string" && sheet.length < 512 && sheet.endsWith(".css"))) {
      return "Expected a stylesheet.";
    }
    const path = body.path;
    if (!Array.isArray(path) || !path.length || path.length > 4 || !path.every(isOffset)) {
      return "Expected a rule.";
    }
    if (typeof body.selector !== "string" || body.selector.length > 1000) return "Expected a selector.";
    return { op, sheet, path, selector: body.selector, props };
  }
  if (op === "texts") {
    if (!isOffset(body.at)) return "Expected an element.";
    const texts = body.texts;
    if (
      !Array.isArray(texts) ||
      texts.length > 500 ||
      !texts.every((t) => typeof t === "string") ||
      texts.join("").length > MAX_EDIT_TEXT
    ) {
      return "Expected the new text.";
    }
    return { op, at: body.at, texts };
  }
  const isPlace = (value: unknown): value is Place => value === "before" || value === "after" || value === "inside";
  if (op === "insert") {
    if (body.at !== null && !isOffset(body.at)) return "Expected where to put it.";
    if (!isPlace(body.place)) return "Expected before, after or inside.";
    const kind = body.kind;
    if (!INSERT_KINDS.includes(kind as InsertKind)) return "Unknown thing to insert.";
    const request: EditRequest & { op: "insert" } = { op, at: body.at, place: body.place, kind: kind as InsertKind };
    if (body.like !== undefined) {
      // Class names and a heading level, nothing that could carry markup.
      const like = body.like as Record<string, unknown> | null;
      if (!like || typeof like !== "object") return "Expected the layer to look like.";
      const out: InsertLike = {};
      if (like.cls !== undefined) {
        if (typeof like.cls !== "string" || like.cls.length > 200 || !/^-?[A-Za-z_][\w-]*( -?[A-Za-z_][\w-]*)*$/.test(like.cls)) {
          return "Expected class names.";
        }
        out.cls = like.cls;
      }
      if (like.tag !== undefined) {
        if (typeof like.tag !== "string" || !/^h[1-6]$/.test(like.tag)) return "Expected a heading level.";
        out.tag = like.tag;
      }
      request.like = out;
    }
    if (body.props !== undefined) {
      const props = styleProps(body.props);
      if (typeof props === "string") return props;
      request.props = props;
    }
    if (kind === "image") {
      // Checked against the page's own images later; here only its shape.
      if (typeof body.src !== "string" || !/^[\w\-./ ]{1,300}$/.test(body.src) || body.src.includes("..")) {
        return "Expected an image.";
      }
      request.src = body.src;
    }
    return request;
  }
  if (op === "wrap") {
    if (!isOffset(body.at) || !isOffset(body.last)) return "Expected the layers to frame.";
    const props = body.props === undefined ? [] : styleProps(body.props);
    if (typeof props === "string") return props;
    return { op, at: body.at, last: body.last, props };
  }
  if (op === "unwrap") {
    if (!isOffset(body.at)) return "Expected an element.";
    return { op, at: body.at };
  }
  if (op === "copy") {
    if (!isOffset(body.at) || !isOffset(body.target)) return "Expected what to paste and where.";
    if (!isPlace(body.place)) return "Expected before, after or inside.";
    return { op, at: body.at, target: body.target, place: body.place };
  }
  if (op !== "delete" && op !== "hide" && op !== "duplicate" && op !== "move" && op !== "text") {
    return "Unknown edit.";
  }
  if (!isOffset(body.at)) return "Expected an element.";
  if (op === "move") {
    if (!isOffset(body.target)) return "Expected where to move it.";
    if (body.place !== "before" && body.place !== "after" && body.place !== "inside") {
      return "Expected before, after or inside.";
    }
    return { op, at: body.at, target: body.target, place: body.place };
  }
  if (op === "text") {
    if (typeof body.text !== "string" || body.text.length > MAX_EDIT_TEXT) return "Expected the new text.";
    return { op, at: body.at, text: body.text };
  }
  return { op, at: body.at };
}

/**
 * An as-is page with the edit notch in it.
 *
 * The preview copy is the vault file with the review appendix after it, so
 * the file is served from the vault -- stamped -- and the appendix is taken
 * off the end of the preview. If the preview does not start with the file,
 * the file has changed since the build, and offsets into it would name the
 * wrong elements: the page is served as built, with the edit script there
 * only to say why it cannot edit.
 */
async function editablePage(
  edit: EditStore,
  previewPath: string,
  vaultPath: string,
  preview: string,
  history: { undo: number; redo: number },
): Promise<string> {
  const source = await edit.readSource(vaultPath);
  if (source === null || !preview.startsWith(source)) {
    const reason =
      source === null
        ? "The file behind this page is not in the vault any more."
        : "The file has changed since this preview was built. Rebuild the preview to edit it.";
    return prepareForEditing(
      preview,
      editInjection({ page: previewPath, hash: "", ok: false, reason }),
      { stamp: false },
    );
  }
  return (
    prepareForEditing(
      source,
      editInjection({
        page: previewPath,
        hash: hashText(source),
        ok: true,
        history,
        // The linked stylesheets this page may edit: in the vault, and named
        // by the page itself.
        sheets: linkedStylesheets(source, previewPath).filter(
          (sheet) => sheet.endsWith(".css") && edit.sourceFor(sheet) !== null,
        ),
      }),
    ) + preview.slice(source.length)
  );
}

function send(
  response: ServerResponse,
  status: number,
  type: string,
  body: string | Buffer,
  extra: Record<string, string> = {},
): void {
  response.writeHead(status, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(body as string),
    ...extra,
  });
  response.end(body);
}

/** The request body, or null once it has gone past what we will hold. */
function readBody(request: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        resolve(null);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}
