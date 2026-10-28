import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ReviewServer,
  ReviewStore,
  emptyDocument,
  mimeFor,
  previewPathFor,
} from "./server";

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
});

describe("emptyDocument", () => {
  it("is shaped like an export, so one reader handles both", () => {
    const parsed = JSON.parse(emptyDocument("Handbook"));

    expect(parsed.version).toBe(1);
    expect(parsed.site).toBe("Handbook");
    expect(parsed.comments).toEqual([]);
  });
});
