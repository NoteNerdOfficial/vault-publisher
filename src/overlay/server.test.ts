import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RelayOutcome,
  ReviewServer,
  ReviewStore,
  carryExternal,
  carryWithdrawn,
  emptyDocument,
  mimeFor,
  previewPathFor,
} from "./server";
import { OVERLAY_SCHEMA_VERSION } from "./types";

/**
 * Every request in this file closes its connection when it is answered.
 *
 * Node's `fetch` keeps sockets in a pool to reuse them, and a pooled socket
 * to a server that has since been stopped is an open handle nothing here can
 * reach: the worker process stays alive after its last test, and the run
 * fails at teardown with every test having passed. Asking for the connection
 * to be closed costs a handshake per request in one test file, and buys a
 * test run that means what it says.
 */
const fetch = (url: string | URL, init: RequestInit = {}): Promise<Response> =>
  globalThis.fetch(url, {
    ...init,
    headers: { connection: "close", ...(init.headers as Record<string, string>) },
  });

/**
 * The server reads and writes inside the vault, so most of what is tested
 * here is what it refuses: an unauthorized caller, a path that climbs out of
 * the preview folder, a body that would replace good comments with rubbish.
 */

function store(seed: Record<string, string> = {}): ReviewStore & {
  comments: string | null;
  writes: number;
} {
  const files = { ...seed };
  return {
    comments: null,
    writes: 0,
    async readComments() {
      return this.comments;
    },
    async writeComments(body: string) {
      this.comments = body;
      this.writes++;
    },
    async readPreview(path: string) {
      return path in files ? files[path] : null;
    },
  };
}

describe("previewPathFor", () => {
  it("maps the root to the index", () => {
    expect(previewPathFor("/")).toBe("index.html");
    expect(previewPathFor("/?t=abc")).toBe("index.html");
  });

  it("keeps a nested page", () => {
    expect(previewPathFor("/notes/plan.html")).toBe("notes/plan.html");
  });

  it("serves an index for something that looks like a folder", () => {
    expect(previewPathFor("/notes/")).toBe("notes/index.html");
  });

  it("decodes an escaped name", () => {
    expect(previewPathFor("/notes/q3%20planning.html")).toBe(
      "notes/q3 planning.html",
    );
  });

  // Each of these is an attempt to read something outside the preview folder.
  // The vault is the folder above it, so none of them may come back a path.
  it.each([
    ["climbing with ..", "/../data.json"],
    ["climbing from inside", "/notes/../../.obsidian/plugins/x/data.json"],
    ["an escaped climb", "/%2e%2e/%2e%2e/data.json"],
    ["a backslash separator", "/notes\\..\\data.json"],
    ["a null byte", "/notes/plan.html%00.png"],
    ["a broken escape", "/notes/%zz.html"],
  ])("refuses %s", (_why, url) => {
    expect(previewPathFor(url)).toBeNull();
  });
});

describe("mimeFor", () => {
  it("knows the types a built site is made of", () => {
    expect(mimeFor("a/b.html")).toContain("text/html");
    expect(mimeFor("a/b.css")).toContain("text/css");
    expect(mimeFor("a/b.woff2")).toBe("font/woff2");
  });

  it("falls back rather than guessing", () => {
    expect(mimeFor("a/b.unknown")).toBe("application/octet-stream");
    expect(mimeFor("noextension")).toBe("application/octet-stream");
  });
});

describe("the review server", () => {
  let server: ReviewServer;
  let files: ReturnType<typeof store>;
  let base: string;
  const TOKEN = "test-token";

  beforeEach(async () => {
    files = store({
      "index.html": "<h1>Home</h1>",
      "notes/plan.html": "<h1>Plan</h1>",
    });
    server = new ReviewServer({ store: files, token: TOKEN });
    const address = await server.start();
    base = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await server.stop();
  });

  const withToken = (path: string) =>
    `${base}${path}${path.includes("?") ? "&" : "?"}t=${TOKEN}`;

  it("listens only on the loopback address", async () => {
    const address = server.listening;

    expect(address).not.toBeNull();
    expect(address?.url).toContain("127.0.0.1");
    expect(address?.url).toContain(TOKEN);
  });

  // The thing standing between any other process on this machine and the
  // vault. Without it, a listening port that writes files is an open door.
  it("refuses a request with no token", async () => {
    const response = await fetch(`${base}/index.html`);

    expect(response.status).toBe(403);
  });

  it("refuses a request with the wrong token", async () => {
    const response = await fetch(`${base}/index.html?t=not-it`);

    expect(response.status).toBe(403);
  });

  it("refuses to write without a token", async () => {
    const response = await fetch(`${base}/api/comments`, {
      method: "POST",
      body: `{"comments":[]}`,
    });

    expect(response.status).toBe(403);
    expect(files.writes).toBe(0);
  });

  it("serves a page to a caller holding the token", async () => {
    const response = await fetch(withToken("/index.html"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toBe("<h1>Home</h1>");
  });

  // So a link from one page to the next does not have to carry the token,
  // and neither does the overlay's own fetch.
  it("hands out a cookie so later requests need no token in the URL", async () => {
    const first = await fetch(withToken("/"));
    const cookie = first.headers.get("set-cookie") ?? "";

    expect(cookie).toContain(TOKEN);

    const second = await fetch(`${base}/notes/plan.html`, {
      headers: { cookie: cookie.split(";")[0] },
    });

    expect(second.status).toBe(200);
    expect(await second.text()).toBe("<h1>Plan</h1>");
  });

  it("serves the index at the root", async () => {
    expect(await (await fetch(withToken("/"))).text()).toBe("<h1>Home</h1>");
  });

  it("answers 404 for a page the build did not produce", async () => {
    expect((await fetch(withToken("/missing.html"))).status).toBe(404);
  });

  it("answers an empty document before anything has been saved", async () => {
    const response = await fetch(withToken("/api/comments"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.comments).toEqual([]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("saves comments and reads them back", async () => {
    const payload = {
      version: 1,
      site: "Handbook",
      exportedAt: new Date().toISOString(),
      comments: [{ id: "a", sourcePath: "notes/Plan.md", text: "Fix this." }],
    };

    const put = await fetch(withToken("/api/comments"), {
      method: "POST",
      body: JSON.stringify(payload),
    });
    expect(put.status).toBe(200);
    expect(files.writes).toBe(1);

    const got = await (await fetch(withToken("/api/comments"))).json();
    expect(got.comments).toHaveLength(1);
    expect(got.comments[0].text).toBe("Fix this.");
  });

  // Writing whatever arrives would let one bad request replace a review with
  // something the import command cannot read.
  it.each([
    ["a body that is not JSON", "{ oh dear"],
    ["an array at the top level", "[]"],
    ["an object with no comments", `{"version":1}`],
  ])("refuses to save %s", async (_why, body) => {
    const response = await fetch(withToken("/api/comments"), {
      method: "POST",
      body,
    });

    expect(response.status).toBe(400);
    expect(files.writes).toBe(0);
  });

  it("refuses a path that climbs out of the preview folder", async () => {
    const response = await fetch(withToken("/../data.json"), {
      redirect: "manual",
    });

    expect([400, 404]).toContain(response.status);
  });

  it("refuses a method it does not implement", async () => {
    const response = await fetch(withToken("/api/comments"), { method: "DELETE" });

    expect(response.status).toBe(405);
  });

  it("stops listening when it is stopped", async () => {
    const address = server.listening;
    await server.stop();

    expect(server.listening).toBeNull();
    await expect(fetch(`http://127.0.0.1:${address?.port}/`)).rejects.toThrow();
  });

  it("starting twice is the same server, not a second one", async () => {
    const first = server.listening;
    const again = await server.start();

    expect(again.port).toBe(first?.port);
  });

  // This server was built with no relay handler, which is the normal case:
  // a vault with no tracker configured. The route exists and says so, which
  // is what lets the overlay show the reason rather than a dead action.
  it("says there is no tracker when nothing was wired up to file into", async () => {
    const response = await fetch(withToken("/api/relay"), {
      method: "POST",
      body: `{"id":"c1"}`,
    });

    expect(response.status).toBe(501);
    expect((await response.json()).error).toContain("No tracker");
  });

  it("refuses to file anything without a token", async () => {
    const response = await fetch(`${base}/api/relay`, {
      method: "POST",
      body: `{"id":"c1"}`,
    });

    expect(response.status).toBe(403);
  });

  /*
   * The browser saves the whole document, and it knows nothing about what
   * the plugin wrote into the file since the page loaded. Losing the issue
   * record that way would mean the next Send filed a second issue for a
   * comment that already had one.
   */
  it("does not drop an issue the plugin recorded while the page was open", async () => {
    files.comments = JSON.stringify({
      version: 4,
      comments: [
        {
          id: "a",
          text: "Filed already.",
          external: { provider: "github", key: "o/r#7", url: "https://x/7" },
        },
      ],
    });

    await fetch(withToken("/api/comments"), {
      method: "POST",
      body: JSON.stringify({
        version: 4,
        comments: [{ id: "a", text: "Filed already." }],
      }),
    });

    const written = JSON.parse(files.comments ?? "");
    expect(written.comments[0].external.key).toBe("o/r#7");
  });
});

/**
 * Filing a comment is the plugin's job -- it holds the credential -- so all
 * the server does is carry an id across and hand the answer back. What is
 * tested here is that carrying, including the refusals, since every one of
 * them is a sentence somebody is meant to read.
 */
describe("the review server with a tracker behind it", () => {
  let server: ReviewServer;
  let base: string;
  let asked: string[];
  let answer: (id: string) => Promise<RelayOutcome>;
  const TOKEN = "test-token";

  const FILED: RelayOutcome = {
    ok: true,
    external: {
      provider: "github",
      key: "owner/repo#41",
      url: "https://github.com/owner/repo/issues/41",
      filedAt: "2026-10-29T10:00:00.000Z",
    },
  };

  beforeEach(async () => {
    asked = [];
    answer = async () => FILED;
    server = new ReviewServer({
      store: store(),
      token: TOKEN,
      relay: (id) => {
        asked.push(id);
        return answer(id);
      },
    });
    const address = await server.start();
    base = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await server.stop();
  });

  const relay = (body: string) =>
    fetch(`${base}/api/relay?t=${TOKEN}`, { method: "POST", body });

  it("files the comment it was asked about and hands back the issue", async () => {
    const response = await relay(`{"id":"c1"}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(FILED);
    expect(asked).toEqual(["c1"]);
  });

  // A refusal is not a fault: no repository named, a token that cannot open
  // an issue. The reviewer needs the sentence, so it travels in the body with
  // a 200 rather than as a status code with nothing to read.
  it("passes a refusal through as something to read", async () => {
    answer = async () => ({ ok: false, error: "the token cannot open issues there" });
    const response = await relay(`{"id":"c1"}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false,
      error: "the token cannot open issues there",
    });
  });

  it("turns a handler that throws into the same kind of answer", async () => {
    answer = async () => {
      throw new Error("GitHub is unreachable");
    };
    const body = await (await relay(`{"id":"c1"}`)).json();

    expect(body.ok).toBe(false);
    expect(body.error).toBe("GitHub is unreachable");
  });

  it.each([
    ["a body that is not JSON", "{ oh dear"],
    ["a body naming no comment", `{}`],
    ["a body whose id is not a string", `{"id":7}`],
  ])("refuses %s", async (_why, body) => {
    const response = await relay(body);

    expect(response.status).toBe(400);
    expect(asked).toEqual([]);
  });

  it("refuses to file over GET, which is not a thing to do by navigating", async () => {
    const response = await fetch(`${base}/api/relay?t=${TOKEN}`);

    expect(response.status).toBe(405);
    expect(asked).toEqual([]);
  });
});

describe("carryExternal", () => {
  const FILED = { provider: "github", key: "o/r#7", url: "https://x/7" };

  it("puts back a record the incoming copy does not carry", () => {
    const out = carryExternal(
      [{ id: "a", text: "One." }],
      JSON.stringify({ comments: [{ id: "a", external: FILED }] }),
    );

    expect(out).toEqual([{ id: "a", text: "One.", external: FILED }]);
  });

  it("leaves a row that carries its own alone", () => {
    const own = { provider: "github", key: "o/r#9", url: "https://x/9" };
    const out = carryExternal(
      [{ id: "a", external: own }],
      JSON.stringify({ comments: [{ id: "a", external: FILED }] }),
    );

    expect(out).toEqual([{ id: "a", external: own }]);
  });

  it("has nothing to carry for a comment the file does not hold", () => {
    const out = carryExternal(
      [{ id: "new", text: "Just written." }],
      JSON.stringify({ comments: [{ id: "a", external: FILED }] }),
    );

    expect(out).toEqual([{ id: "new", text: "Just written." }]);
  });

  // A file about to be replaced by a good one is no reason to refuse a save.
  it.each([["nothing saved yet", null], ["an unreadable file", "{ oh dear"]])(
    "passes the incoming comments through given %s",
    (_why, saved) => {
      const rows = [{ id: "a" }];

      expect(carryExternal(rows, saved as string | null)).toBe(rows);
    },
  );
});

/**
 * The hook the plugin keeps its trackers in step from.
 *
 * It fires on the overlay's own reads and writes, because those are the
 * moments the two sides are worth putting back in step, and it must never
 * be able to break one of them: a reviewer mid-sentence does not care that
 * a tracker is unreachable.
 */
describe("the review server telling the plugin the review was touched", () => {
  let server: ReviewServer;
  let base: string;
  let touches: number;
  const TOKEN = "test-token";

  beforeEach(async () => {
    touches = 0;
    server = new ReviewServer({
      store: store(),
      token: TOKEN,
      touched: () => {
        touches += 1;
      },
    });
    const address = await server.start();
    base = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await server.stop();
  });

  it("says so when a page reads the review", async () => {
    await fetch(`${base}/api/comments?t=${TOKEN}`);

    expect(touches).toBe(1);
  });

  it("says so after a save, once the save is done", async () => {
    const response = await fetch(`${base}/api/comments?t=${TOKEN}`, {
      method: "POST",
      body: JSON.stringify({ comments: [] }),
    });

    expect(response.status).toBe(200);
    expect(touches).toBe(1);
  });

  it("does not say so for a save it refused", async () => {
    await fetch(`${base}/api/comments?t=${TOKEN}`, { method: "POST", body: "{ oh dear" });

    expect(touches).toBe(0);
  });

  // The hook belongs to the plugin, and a plugin that throws is not a
  // reason for somebody's comment to fail to save.
  it("answers the request anyway when the hook throws", async () => {
    const angry = new ReviewServer({
      store: store(),
      token: TOKEN,
      touched: () => {
        throw new Error("the tracker is on fire");
      },
    });
    const address = await angry.start();
    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/comments?t=${TOKEN}`,
        { method: "POST", body: JSON.stringify({ comments: [] }) },
      );

      expect(response.status).toBe(200);
    } finally {
      await angry.stop();
    }
  });
});

/**
 * The deletions waiting to be acted on.
 *
 * The browser hands over what it has just deleted; the file holds what the
 * plugin has not managed to close yet. Both have to survive a save, or an
 * issue is left open with nothing pointing at it.
 */
describe("carryWithdrawn", () => {
  const gone = { id: "a", external: { provider: "github", key: "o/r#7" }, at: "t" };
  const stuck = { id: "b", external: { provider: "github", key: "o/r#8" }, at: "t" };

  it("keeps what the browser sent and what the file still held", () => {
    const out = carryWithdrawn([gone], JSON.stringify({ withdrawn: [stuck] }));

    expect(out).toEqual([gone, stuck]);
  });

  it("keeps one entry per issue, not per time it was handed over", () => {
    const out = carryWithdrawn([gone], JSON.stringify({ withdrawn: [gone] }));

    expect(out).toEqual([gone]);
  });

  it("drops a row with no issue on it, which is nothing anyone can close", () => {
    const out = carryWithdrawn([{ id: "c", at: "t" }, "nonsense", null], null);

    expect(out).toEqual([]);
  });

  it("has nothing to carry when neither side has any", () => {
    expect(carryWithdrawn(undefined, null)).toEqual([]);
    expect(carryWithdrawn(undefined, "{ oh dear")).toEqual([]);
  });
});

describe("emptyDocument", () => {
  it("is shaped like a saved review, so one reader handles both", () => {
    const parsed = JSON.parse(emptyDocument("Handbook"));

    expect(parsed.version).toBe(OVERLAY_SCHEMA_VERSION);
    expect(parsed.site).toBe("Handbook");
    expect(parsed.comments).toEqual([]);
  });
});
