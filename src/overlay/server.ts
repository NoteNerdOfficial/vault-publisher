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
      const key = `${String(entry.external.provider ?? "")}:${String(entry.external.key ?? "")}`;
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

  private async getFile(url: string, response: ServerResponse): Promise<void> {
    const path = previewPathFor(url);
    if (!path) {
      return send(response, 400, "text/plain; charset=utf-8", "Bad path.");
    }

    const file = await this.options.store.readPreview(path);
    if (file === null) {
      return send(response, 404, "text/plain; charset=utf-8", "Not found.");
    }

    const body = typeof file === "string" ? file : Buffer.from(file);
    send(response, 200, mimeFor(path), body, { "Cache-Control": "no-store" });
  }
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
