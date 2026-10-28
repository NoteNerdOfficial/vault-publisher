/**
 * A local server for the review preview.
 *
 * Until this existed, a comment went into the browser's `localStorage` and
 * stopped there. Getting it into the vault meant exporting a file and moving
 * it by hand, and the page could never read anything back -- so a comment was
 * invisible in another browser, on another machine, or after a rebuild. Two
 * gaps, and closing only the first would not have given anyone what they
 * wanted.
 *
 * A page cannot write to disk, so something local has to hold the pen. This
 * does: it serves the built preview *and* a small JSON API from the same
 * origin, which is the detail that makes the rest simple. Same origin means
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
import { OVERLAY_SCHEMA_VERSION } from "./types";

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
}

export interface ReviewServerOptions {
  store: ReviewStore;
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
 * Shaped like an export file on purpose: the same `parseExport` reads both,
 * and the import command needs no idea whether a file was written by the
 * server or downloaded from the overlay by hand.
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
    await new Promise<void>((resolve) => server.close(() => resolve()));
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

      if (path === "/api/comments") {
        if (request.method === "GET") return await this.getComments(response);
        if (request.method === "POST" || request.method === "PUT") {
          return await this.putComments(request, response);
        }
        return send(response, 405, "text/plain; charset=utf-8", "Method not allowed.");
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

    await this.options.store.writeComments(JSON.stringify(parsed, null, 2));
    send(response, 200, MIME.json, `{"saved":true}`);
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
