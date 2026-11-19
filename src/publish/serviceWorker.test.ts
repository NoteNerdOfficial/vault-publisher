/**
 * The worker, run.
 *
 * Over a site encrypted by the real `lockSite`, with Node's own WebCrypto,
 * so a passing test means a real `.enc` was really decrypted. Only the
 * browser's worker plumbing is stubbed: `self`, its clients, and `fetch` as
 * a static host answers it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublishFile } from "../github/client";
import { lockSite } from "./lockSite";
import {
  RETIRED_SERVICE_WORKER,
  SERVICE_WORKER_PATH,
  serviceWorkerScript,
} from "./serviceWorker";
import { reservedPathReason } from "./htmlFiles";

const PASSWORD = "a shared secret";
const ITERATIONS = 1000;
const SCOPE = "https://example.test/site/";
const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

const SITE: PublishFile[] = [
  { path: "proto/index.html", content: "<!doctype html><title>p</title>" },
  { path: "proto/img/advisor.jpg", content: PHOTO.buffer.slice(0) as ArrayBuffer },
  { path: "proto/img/two words.png", content: "png" },
  { path: "proto/data.json", content: '{"ok":true}' },
  { path: "assets/site.css", content: ":root{}" },
];

let locked: Awaited<ReturnType<typeof lockSite>>;
let bits: string;

/** What the page answers from `sessionStorage`, as the reader would. */
async function deriveBits(password: string, salt: string, iterations: number) {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const raw = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: Uint8Array.from(atob(salt), (c) => c.charCodeAt(0)),
      iterations,
      hash: "SHA-256",
    },
    base,
    256,
  );
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

beforeEach(async () => {
  locked = await lockSite(SITE, PASSWORD, ITERATIONS);
  const enc = locked.files.find((file) => file.path.endsWith(".enc"));
  const payload = JSON.parse(String(enc?.content));
  bits = await deriveBits(PASSWORD, payload.salt, payload.iterations);
});

interface Worker {
  /** The response the worker gave, or null when it let the request through. */
  request: (url: string, init?: { clientId?: string; method?: string }) => Promise<Response | null>;
  asked: () => number;
  fetched: string[];
  listeners: Record<string, (event: unknown) => unknown>;
}

/** The worker, booted over the locked site with one page as its client. */
function boot(reply: () => unknown = () => ({ bits, assets: assetsOf() })): Worker {
  const served = new Map(locked.files.map((file) => [file.path, file.content]));
  const listeners: Record<string, (event: unknown) => unknown> = {};
  const fetched: string[] = [];
  let asked = 0;

  const self = {
    addEventListener: (type: string, handler: (event: unknown) => unknown) => {
      listeners[type] = handler;
    },
    registration: { scope: SCOPE, unregister: vi.fn(async () => true) },
    location: new URL(SCOPE),
    skipWaiting: async () => {},
    clients: {
      claim: async () => {},
      get: async (id: string) =>
        id === "page"
          ? {
              postMessage: (_message: unknown, transfer: MessagePort[]) => {
                asked++;
                transfer[0].postMessage(reply());
                transfer[0].close();
              },
            }
          : null,
    },
  };

  const fetchStub = async (input: string | Request) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    fetched.push(url.pathname);
    const path = decodeURIComponent(url.pathname.slice(new URL(SCOPE).pathname.length));
    const body = served.get(path);
    return body === undefined
      ? new Response(null, { status: 404 })
      : new Response(body as BodyInit, { status: 200 });
  };

  new Function("self", "fetch", serviceWorkerScript(["assets/site.css", "assets/unlock.js"]))(
    self,
    fetchStub,
  );

  return {
    listeners,
    fetched,
    asked: () => asked,
    request: async (url, init = {}) => {
      let response: Promise<Response> | null = null;
      listeners.fetch({
        request: new Request(url, { method: init.method ?? "GET" }),
        clientId: init.clientId ?? "page",
        respondWith: (value: Promise<Response>) => {
          response = Promise.resolve(value);
        },
      });
      return response ? await response : null;
    },
  };
}

/** The page's list, as every locked page carries it. */
function assetsOf(): string[] {
  return SITE.map((file) => file.path).filter(
    (path) => !path.endsWith(".html") && path !== "assets/site.css",
  );
}

describe("the service worker", () => {
  it("is valid JavaScript, as is the one that retires it", () => {
    expect(() => new Function(serviceWorkerScript([]))).not.toThrow();
    expect(() => new Function(RETIRED_SERVICE_WORKER)).not.toThrow();
  });

  it("answers a locked file with the plain bytes and its type", async () => {
    const worker = boot();
    const response = await worker.request(`${SCOPE}proto/img/advisor.jpg`);
    expect(response?.status).toBe(200);
    expect(response?.headers.get("Content-Type")).toBe("image/jpeg");
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(PHOTO);
    expect(worker.fetched).toContain("/site/proto/img/advisor.jpg.enc");
  });

  it("serves data a script fetches, as JSON", async () => {
    const response = await boot().request(`${SCOPE}proto/data.json?v=2`);
    expect(response?.headers.get("Content-Type")).toBe("application/json");
    expect(await response!.json()).toEqual({ ok: true });
  });

  it("finds a file whose name has to be encoded in a URL", async () => {
    const response = await boot().request(`${SCOPE}proto/img/two%20words.png`);
    expect(await response!.text()).toBe("png");
  });

  it("asks the page once, however many files it wants", async () => {
    const worker = boot();
    await worker.request(`${SCOPE}proto/img/advisor.jpg`);
    await worker.request(`${SCOPE}proto/data.json`);
    expect(worker.asked()).toBe(1);
  });

  it("asks again when the page was still locked, rather than giving up on it", async () => {
    let unlocked = false;
    const worker = boot(() => (unlocked ? { bits, assets: assetsOf() } : null));
    const before = await worker.request(`${SCOPE}proto/img/advisor.jpg`);
    // Let through to the network, which has only the ciphertext: a 404.
    expect(before?.status).toBe(404);
    unlocked = true;
    const after = await worker.request(`${SCOPE}proto/img/advisor.jpg`);
    expect(after?.status).toBe(200);
    expect(worker.asked()).toBe(2);
  });

  it("lets through a file that is not on the page's list", async () => {
    const worker = boot();
    const response = await worker.request(`${SCOPE}proto/nothing.png`);
    expect(response?.status).toBe(404);
    expect(worker.fetched).toEqual(["/site/proto/nothing.png"]);
  });

  it("never asks about pages, the shell's own files, fonts or ciphertext", async () => {
    const worker = boot();
    for (const path of [
      "proto/index.html",
      "assets/unlock.js",
      "assets/site.css",
      "assets/fonts/a.woff2",
      "proto/img/advisor.jpg.enc",
      SERVICE_WORKER_PATH,
    ]) {
      expect(await worker.request(`${SCOPE}${path}`)).toBeNull();
    }
    expect(worker.asked()).toBe(0);
  });

  it("leaves navigations, other sites, other folders and writes alone", async () => {
    const worker = boot();
    expect(await worker.request(`${SCOPE}proto/img/advisor.jpg`, { clientId: "" })).toBeNull();
    expect(await worker.request("https://elsewhere.test/site/proto/img/advisor.jpg")).toBeNull();
    expect(await worker.request("https://example.test/other/img/advisor.jpg")).toBeNull();
    expect(await worker.request(`${SCOPE}proto/data.json`, { method: "POST" })).toBeNull();
    expect(worker.asked()).toBe(0);
  });

  it("fails a file that will not decrypt, rather than serving ciphertext", async () => {
    const wrong = await deriveBits("not the password", JSON.parse(
      String(locked.files.find((file) => file.path.endsWith(".enc"))?.content),
    ).salt, ITERATIONS);
    const worker = boot(() => ({ bits: wrong, assets: assetsOf() }));
    const response = await worker.request(`${SCOPE}proto/img/advisor.jpg`);
    expect(response?.status).toBe(500);
    expect(await response!.text()).toBe("");
  });

  it("reports a locked file missing from the server as missing", async () => {
    const worker = boot(() => ({ bits, assets: [...assetsOf(), "proto/gone.png"] }));
    expect((await worker.request(`${SCOPE}proto/gone.png`))?.status).toBe(404);
  });
});

describe("publishing the worker", () => {
  it("goes out in the clear, at the root, with a locked site", () => {
    const worker = locked.files.find((file) => file.path === SERVICE_WORKER_PATH);
    expect(worker).toBeDefined();
    expect(String(worker?.content)).toContain('addEventListener("fetch"');
  });

  it("stays out of a locked site with nothing to serve", async () => {
    const pagesOnly = await lockSite(
      [{ path: "index.html", content: "<p>hi</p>" }],
      PASSWORD,
      ITERATIONS,
    );
    expect(pagesOnly.files.some((file) => file.path === SERVICE_WORKER_PATH)).toBe(false);
  });

  it("cannot be claimed by a vault file", () => {
    expect(reservedPathReason(SERVICE_WORKER_PATH)).not.toBeNull();
  });
});
