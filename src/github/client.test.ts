import { afterEach, describe, expect, it } from "vitest";
// By path, not by the "obsidian" alias: tsc resolves that name to the real
// package, which has no such export. The alias points at this same file, so
// the client under test and this import share one module instance.
import { setRequestUrl } from "../../test/obsidian-stub";
import { GitHubClient, GitHubError } from "./client";

interface Call {
  method: string;
  url: string;
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
  const restore = setRequestUrl(async (options: { method: string; url: string }) => {
    const call = { method: options.method, url: options.url };
    calls.push(call);
    const r = reply(call);
    return {
      status: r.status ?? 200,
      json: r.json,
      text: r.text ?? "",
      headers: r.headers ?? {},
      arrayBuffer: new ArrayBuffer(0),
    };
  });
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
