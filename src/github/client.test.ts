import { afterEach, describe, expect, it } from "vitest";
// By path, not by the "obsidian" alias: tsc resolves that name to the real
// package, which has no such export. The alias points at this same file, so
// the client under test and this import share one module instance.
import { setRequestUrl } from "../../test/obsidian-stub";
import { GitHubClient, GitHubError } from "./client";

interface Call {
  method: string;
  url: string;
  /** The JSON the client sent, parsed, for the calls that send one. */
  body?: unknown;
}

/**
 * Installs a fake HTTP layer. `reply` receives each call and returns the
 * response; `calls` records what the client asked for.
 */
function fakeHttp(
  reply: (call: Call) => {
    status?: number;
    json?: unknown;
    text?: string;
    headers?: Record<string, string>;
  },
) {
  const calls: Call[] = [];
  const restore = setRequestUrl(
    async (options: { method: string; url: string; body?: string }) => {
      const call = {
        method: options.method,
        url: options.url,
        body: options.body === undefined ? undefined : JSON.parse(options.body),
      };
      calls.push(call);
      const r = reply(call);
      return {
        status: r.status ?? 200,
        json: r.json,
        text: r.text ?? "",
        headers: r.headers ?? {},
        arrayBuffer: new ArrayBuffer(0),
      };
    },
  );
  return { calls, restore };
}

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

function client() {
  return new GitHubClient({
    apiBase: "https://api.github.com",
    token: "t",
    owner: "o",
    repo: "r",
  });
}

describe("rate limit", () => {
  it("remembers what a successful response reported", async () => {
    const http = fakeHttp(() => ({
      json: { login: "someone" },
      headers: { "X-RateLimit-Remaining": "4321" },
    }));
    restore = http.restore;

    const c = client();
    expect(c.rateRemaining).toBeNull();
    await c.getViewer();
    expect(c.rateRemaining).toBe(4321);
  });

  it("reads the header whatever its casing", async () => {
    const http = fakeHttp(() => ({
      json: { login: "someone" },
      headers: { "x-ratelimit-remaining": "7" },
    }));
    restore = http.restore;

    const c = client();
    await c.getViewer();
    expect(c.rateRemaining).toBe(7);
  });

  // A 403 with an empty quota is a rate limit, not a permissions problem.
  it("names the rate limit and when it refills", async () => {
    const reset = Math.floor(new Date("2026-10-25T12:00:00Z").getTime() / 1000);
    const http = fakeHttp(() => ({
      status: 403,
      json: { message: "Forbidden" },
      headers: {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(reset),
      },
    }));
    restore = http.restore;

    await expect(client().getViewer()).rejects.toThrow(
      /rate limit reached, refills at .+\. Nothing was committed\./,
    );
  });

  it("keeps GitHub's own message for a 403 that is not a rate limit", async () => {
    const http = fakeHttp(() => ({
      status: 403,
      json: { message: "Resource not accessible by personal access token" },
      headers: { "x-ratelimit-remaining": "4000" },
    }));
    restore = http.restore;

    await expect(client().getViewer()).rejects.toThrow(
      /Resource not accessible by personal access token/,
    );
  });

  it("carries the remaining count on the error", async () => {
    const http = fakeHttp(() => ({
      status: 404,
      json: { message: "Not Found" },
      headers: { "x-ratelimit-remaining": "11" },
    }));
    restore = http.restore;

    const error = await client()
      .getViewer()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).rateRemaining).toBe(11);
  });
});

describe("commitFiles head check", () => {
  it("refuses when the branch moved under it", async () => {
    const http = fakeHttp(() => ({ json: { object: { sha: "newer" } } }));
    restore = http.restore;

    const error = await client()
      .commitFiles({
        branch: "gh-pages",
        message: "m",
        files: [{ path: "a.html", content: "<p>a</p>" }],
        expectedHeadSha: "older",
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).status).toBe(409);
    expect((error as GitHubError).message).toContain("moved since this publish");
    // The guard has to fire before anything is written.
    expect(http.calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("accepts a branch that has not moved", async () => {
    const http = fakeHttp((call) => {
      if (call.method === "GET") return { json: { object: { sha: "same" } } };
      if (call.url.includes("/git/trees")) return { json: { sha: "tree1" } };
      if (call.url.includes("/git/commits")) return { json: { sha: "commit1" } };
      return { json: {} };
    });
    restore = http.restore;

    const result = await client().commitFiles({
      branch: "gh-pages",
      message: "m",
      files: [{ path: "a.html", content: "<p>a</p>" }],
      expectedHeadSha: "same",
    });

    expect(result.commitSha).toBe("commit1");
    expect(http.calls.some((c) => c.method !== "GET")).toBe(true);
  });

  it("does not check at all when no expectation is given", async () => {
    const http = fakeHttp((call) => {
      if (call.method === "GET") return { json: { object: { sha: "anything" } } };
      if (call.url.includes("/git/trees")) return { json: { sha: "tree1" } };
      if (call.url.includes("/git/commits")) return { json: { sha: "commit1" } };
      return { json: {} };
    });
    restore = http.restore;

    await expect(
      client().commitFiles({
        branch: "gh-pages",
        message: "m",
        files: [{ path: "a.html", content: "<p>a</p>" }],
      }),
    ).resolves.toMatchObject({ commitSha: "commit1" });
  });
});

/**
 * How a file's content reaches the repository.
 *
 * This was one inline tree request until a whole-vault publish failed on it:
 * a page carries the client script inlined, so it weighs around 150 KB
 * whatever the note says, and 231 of them made a 36 MB POST that GitHub
 * answered with `400 Problems parsing JSON`. An error about size that never
 * mentions size is the worst kind to be handed, so the shape that cannot
 * produce it is the one to keep.
 */
describe("commitFiles uploads", () => {
  /** Records every blob posted and answers with a predictable sha. */
  function blobHttp() {
    return fakeHttp((call) => {
      if (call.method === "GET") return { json: { object: { sha: "head" } } };
      if (call.url.includes("/git/blobs")) {
        const body = call.body as { content: string; encoding: string };
        return { json: { sha: `blob-${body.encoding}-${body.content.length}` } };
      }
      if (call.url.includes("/git/trees")) return { json: { sha: "tree1" } };
      if (call.url.includes("/git/commits")) return { json: { sha: "commit1" } };
      return { json: {} };
    });
  }

  it("sends text as its own blob, not inline in the tree", async () => {
    const http = blobHttp();
    restore = http.restore;

    await client().commitFiles({
      branch: "gh-pages",
      message: "m",
      files: [
        { path: "a.html", content: "<p>a</p>" },
        { path: "b.css", content: "body{}" },
      ],
    });

    const blobs = http.calls.filter((c) => c.url.includes("/git/blobs"));
    expect(blobs).toHaveLength(2);
    // utf-8 rather than base64: the content goes up as the string it is.
    expect(blobs.map((c) => (c.body as { encoding: string }).encoding)).toEqual([
      "utf-8",
      "utf-8",
    ]);
    expect((blobs[0].body as { content: string }).content).toBe("<p>a</p>");

    // The tree is the thing that must stay small, so nothing may carry
    // content into it.
    const tree = http.calls.find((c) => c.url.includes("/git/trees"));
    const entries = (tree?.body as { tree: Record<string, unknown>[] }).tree;
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.content).toBeUndefined();
      expect(entry.sha).toBeTruthy();
    }
  });

  it("still sends binary as base64", async () => {
    const http = blobHttp();
    restore = http.restore;

    await client().commitFiles({
      branch: "gh-pages",
      message: "m",
      files: [{ path: "a.png", content: new ArrayBuffer(4) }],
    });

    const blob = http.calls.find((c) => c.url.includes("/git/blobs"));
    expect((blob?.body as { encoding: string }).encoding).toBe("base64");
  });

  /**
   * The reason one request per file is affordable. `diffAgainstManifest`
   * points an unchanged file at the blob the branch already holds, so a
   * publish after a one-note edit sends one blob, not the whole site.
   */
  it("uploads nothing for a file the branch already holds", async () => {
    const http = blobHttp();
    restore = http.restore;

    await client().commitFiles({
      branch: "gh-pages",
      message: "m",
      files: [
        { path: "a.html", content: "<p>a</p>", existingSha: "kept" },
        { path: "b.html", content: "<p>b</p>" },
      ],
    });

    const blobs = http.calls.filter((c) => c.url.includes("/git/blobs"));
    expect(blobs).toHaveLength(1);
    const tree = http.calls.find((c) => c.url.includes("/git/trees"));
    const entries = (tree?.body as { tree: { path: string; sha: string }[] }).tree;
    expect(entries.find((e) => e.path === "a.html")?.sha).toBe("kept");
    // The tree stays complete either way: a file absent from it is deleted.
    expect(entries).toHaveLength(2);
  });

  it("counts progress over what it actually uploads", async () => {
    const http = blobHttp();
    restore = http.restore;
    const seen: Array<[number, number, string]> = [];

    await client().commitFiles({
      branch: "gh-pages",
      message: "m",
      files: [
        { path: "kept.html", content: "<p>a</p>", existingSha: "kept" },
        { path: "one.html", content: "<p>b</p>" },
        { path: "two.html", content: "<p>c</p>" },
      ],
      onProgress: (done, total, path) => seen.push([done, total, path]),
    });

    // Two uploads, so two reports, and the file the branch already holds is
    // in neither the count nor the total.
    expect(seen).toEqual([
      [0, 2, "one.html"],
      [1, 2, "two.html"],
    ]);
  });
});

describe("readFile", () => {
  it("encodes a path per segment", async () => {
    const http = fakeHttp(() => ({ json: {} }));
    restore = http.restore;

    await client().readFile("gh-pages", "notes/Q&A 50% done.html");

    // encodeURI would have left "&" and "%" alone, making the URL malformed.
    expect(http.calls[0].url).toContain(
      "/contents/notes/Q%26A%2050%25%20done.html?ref=gh-pages",
    );
  });

  it("returns null rather than throwing when the file is absent", async () => {
    const http = fakeHttp(() => ({ status: 404, json: { message: "Not Found" } }));
    restore = http.restore;

    await expect(client().readFile("gh-pages", "missing.json")).resolves.toBeNull();
  });
});

describe("createIssue", () => {
  it("posts the issue to the repository it was built for", async () => {
    const http = fakeHttp(() => ({
      json: { number: 41, html_url: "https://github.com/o/r/issues/41", title: "t" },
    }));
    restore = http.restore;

    const issue = await client().createIssue({
      title: "Needs a citation",
      body: "The paragraph about performance.",
      labels: ["review", "priority: high"],
    });

    expect(http.calls[0].method).toBe("POST");
    expect(http.calls[0].url).toBe("https://api.github.com/repos/o/r/issues");
    expect(http.calls[0].body).toEqual({
      title: "Needs a citation",
      body: "The paragraph about performance.",
      labels: ["review", "priority: high"],
    });
    expect(issue.number).toBe(41);
  });

  // GitHub creates a label a repository does not have as part of the call,
  // so this is not the usual path -- but an issue with no labels is worth a
  // great deal more than no issue, and somebody is waiting on it.
  it("files it without labels rather than not at all, if labels are refused", async () => {
    const http = fakeHttp((call) =>
      (call.body as { labels?: string[] }).labels
        ? { status: 422, json: { message: "Validation Failed" } }
        : { json: { number: 7, html_url: "https://github.com/o/r/issues/7", title: "t" } },
    );
    restore = http.restore;

    const issue = await client().createIssue({
      title: "t",
      body: "b",
      labels: ["nope"],
    });

    expect(issue.number).toBe(7);
    expect(http.calls).toHaveLength(2);
    expect(http.calls[1].body).toEqual({ title: "t", body: "b" });
  });

  it("sends no labels field at all when there are none", async () => {
    const http = fakeHttp(() => ({
      json: { number: 1, html_url: "https://github.com/o/r/issues/1", title: "t" },
    }));
    restore = http.restore;

    await client().createIssue({ title: "t", body: "b", labels: [] });

    expect(http.calls[0].body).toEqual({ title: "t", body: "b" });
  });

  // Everything else is the caller's to explain: a 403 here is a token that
  // cannot open issues, which is a sentence about settings.
  it("lets a refusal through, with its status on it", async () => {
    const http = fakeHttp(() => ({ status: 403, json: { message: "Forbidden" } }));
    restore = http.restore;

    await expect(
      client().createIssue({ title: "t", body: "b" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("retries only for a refusal about the request, not for a 403", async () => {
    const http = fakeHttp(() => ({ status: 403, json: { message: "Forbidden" } }));
    restore = http.restore;

    await expect(
      client().createIssue({ title: "t", body: "b", labels: ["review"] }),
    ).rejects.toBeInstanceOf(GitHubError);
    expect(http.calls).toHaveLength(1);
  });
});

describe("closeIssue", () => {
  it("closes it as done for a comment that was resolved", async () => {
    const http = fakeHttp(() => ({ json: {} }));
    restore = http.restore;

    await client().closeIssue(41, "completed");

    expect(http.calls[0].method).toBe("PATCH");
    expect(http.calls[0].url).toBe("https://api.github.com/repos/o/r/issues/41");
    expect(http.calls[0].body).toEqual({ state: "closed", state_reason: "completed" });
  });

  // A deleted comment is not a claim that the work was done, and the reason
  // is also what stops a later sync reading it back as finished work.
  it("closes it as not planned for a comment that was deleted", async () => {
    const http = fakeHttp(() => ({ json: {} }));
    restore = http.restore;

    await client().closeIssue(41, "not_planned");

    expect(http.calls[0].body).toMatchObject({ state_reason: "not_planned" });
  });
});

/**
 * Reading an issue back, which is what catching up on filed comments does.
 */
describe("getIssue", () => {
  it("asks for the one issue, and reports why it was closed", async () => {
    const http = fakeHttp(() => ({
      json: { state: "closed", state_reason: "not_planned" },
    }));
    restore = http.restore;

    const issue = await client().getIssue(41);

    expect(http.calls[0].method).toBe("GET");
    expect(http.calls[0].url).toBe("https://api.github.com/repos/o/r/issues/41");
    expect(issue).toEqual({ state: "closed", state_reason: "not_planned" });
  });

  it("does not invent a reason that was not sent", async () => {
    const http = fakeHttp(() => ({ json: { state: "open" } }));
    restore = http.restore;

    expect(await client().getIssue(1)).toEqual({ state: "open", state_reason: null });
  });
});

/**
 * What answers on a corporate network is not always GitHub.
 *
 * An Enterprise Server behind a sign-on portal answers with the portal's
 * login page, and often answers successfully: HTTP 200 and an HTML body.
 * Reading that as JSON threw a parse error from inside the plugin, with
 * nothing in it about what had actually happened.
 */
describe("an answer that did not come from the API", () => {
  /**
   * `json` is a getter here because that is what it is in Obsidian: it parses
   * the body on first read and throws when the body is not JSON.
   */
  function replying(body: string, status = 200): void {
    restore = setRequestUrl(async () => ({
      status,
      get json(): unknown {
        throw new SyntaxError("Unexpected token < in JSON at position 0");
      },
      text: body,
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
    }));
  }

  it("names a sign-in page as what it is", async () => {
    replying(
      "<!DOCTYPE html><html><head><title>Sign in</title></head>" +
        '<body><input type="password" name="password"></body></html>',
    );

    await expect(client().getViewer()).rejects.toThrow(/sign-in page/);
  });

  it("refuses it even though it arrived as a success", async () => {
    replying("<html><head><title>Log in</title></head><body></body></html>");

    await expect(client().getViewer()).rejects.toBeInstanceOf(GitHubError);
  });

  // The other way to get a web page out of this: an Enterprise Server whose
  // web address was entered where its API root belongs.
  it("says what an Enterprise API root looks like", async () => {
    replying("<html><body><h1>GitHub Enterprise</h1></body></html>", 200);

    await expect(client().getViewer()).rejects.toThrow(/\/api\/v3/);
  });

  // An empty body is not that failure: it is a 204, or a status that speaks
  // for itself, and the statuses were already handled.
  it("leaves an empty answer to the status it came with", async () => {
    restore = setRequestUrl(async () => ({
      status: 404,
      json: undefined,
      text: "",
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
    }));

    await expect(client().getRef("gh-pages")).resolves.toBeNull();
  });
});

/**
 * The last call of a publish, and the one that used to report a finished
 * publish as a failed one.
 *
 * Everything is committed by the time `enablePages` runs, so an exception
 * here is a lie about the whole operation, and the remedy it sends a reader
 * to -- publish again -- is the thing that already worked. Observed live:
 * enabling Pages on a branch created seconds earlier in the same publish
 * answered HTTP 500 on a repository that was serving from that branch a
 * moment later.
 */
describe("turning Pages on", () => {
  const PAGES = {
    url: "https://api.github.com/repos/o/r/pages",
    status: "built",
    source: { branch: "gh-pages", path: "/" },
  };

  it("takes the POST at its word when it succeeds", async () => {
    const { calls, restore } = fakeHttp(() => ({ status: 201, json: PAGES }));
    try {
      await expect(client().enablePages("gh-pages")).resolves.toMatchObject({
        status: "built",
      });
      // One call: nothing to double-check when nothing went wrong.
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe("POST");
    } finally {
      restore();
    }
  });

  it("believes the state over a 500 that did the work anyway", async () => {
    const { calls, restore } = fakeHttp((call) =>
      call.method === "POST"
        ? { status: 500, json: { message: "Internal Server Error" } }
        : { status: 200, json: PAGES },
    );
    try {
      await expect(client().enablePages("gh-pages")).resolves.toMatchObject({
        status: "built",
      });
      expect(calls.map((c) => c.method)).toEqual(["POST", "GET"]);
    } finally {
      restore();
    }
  });

  it("still treats 409 as already on", async () => {
    const { restore } = fakeHttp((call) =>
      call.method === "POST" ? { status: 409, json: {} } : { status: 200, json: PAGES },
    );
    try {
      await expect(client().enablePages("gh-pages")).resolves.toMatchObject({
        status: "built",
      });
    } finally {
      restore();
    }
  });

  it("raises the original error when Pages really is not on", async () => {
    // The read fails too, so there is nothing to contradict the POST. The
    // error raised is the POST's, not the read's: the first one is what
    // went wrong.
    const { restore } = fakeHttp(() => ({ status: 403, json: { message: "Forbidden" } }));
    try {
      await expect(client().enablePages("gh-pages")).rejects.toMatchObject({ status: 403 });
    } finally {
      restore();
    }
  });

  it("does not accept Pages that is serving some other branch", async () => {
    // A repository already publishing from `main` is not this publish
    // having succeeded, and saying so would hide a branch misconfiguration
    // behind a green result.
    const { restore } = fakeHttp((call) =>
      call.method === "POST"
        ? { status: 500, json: {} }
        : { status: 200, json: { ...PAGES, source: { branch: "main", path: "/" } } },
    );
    try {
      await expect(client().enablePages("gh-pages")).rejects.toMatchObject({ status: 500 });
    } finally {
      restore();
    }
  });
});
