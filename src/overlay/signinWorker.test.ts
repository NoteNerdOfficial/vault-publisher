import { afterEach, describe, expect, it, vi } from "vitest";
// The Worker ships as plain JavaScript for pasting into Cloudflare as it is,
// so it lives with the examples and is tested from here.
import worker, { decode, encode, safeReturn } from "../../examples/github-signin-worker/worker.js";

/**
 * The bring-your-own sign-in Worker for shared comments.
 *
 * What matters most here is what it refuses: a token must only ever go back
 * to the site it was configured for, or the Worker hands every reviewer's
 * token to whoever asks for it.
 */

const ENV = {
  GITHUB_CLIENT_ID: "Iv1.client",
  GITHUB_CLIENT_SECRET: "fabricated-secret",
  ALLOWED_ORIGINS: "https://reviews.example.test, https://other.example.test/",
};
const BASE = "https://signin.example.test";

function get(path: string): Promise<Response> {
  return worker.fetch(new Request(BASE + path), ENV);
}

/** GitHub's token endpoint, answering with these fields. */
function github(answer: Record<string, unknown>, status = 200): Array<Record<string, unknown>> {
  const sent: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(answer), { status });
    }),
  );
  return sent;
}

afterEach(() => vi.unstubAllGlobals());

describe("safeReturn", () => {
  const allowed = ["https://reviews.example.test"];

  it("allows a page on the configured site, without its fragment", () => {
    expect(safeReturn("https://reviews.example.test/app/#/cart", allowed)).toBe(
      "https://reviews.example.test/app/",
    );
  });

  it("refuses any other site, and anything that is not https", () => {
    expect(safeReturn("https://evil.example.test/", allowed)).toBeNull();
    expect(safeReturn("https://reviews.example.test.evil.test/", allowed)).toBeNull();
    expect(safeReturn("http://reviews.example.test/", allowed)).toBeNull();
    expect(safeReturn("javascript:alert(1)", allowed)).toBeNull();
    expect(safeReturn("", allowed)).toBeNull();
  });
});

describe("/login", () => {
  it("sends the reader to GitHub with the app's client id and a state to come back with", async () => {
    const response = await get(
      "/login?return=" + encodeURIComponent("https://reviews.example.test/plan.html") + "&nonce=abcdefgh12",
    );
    expect(response.status).toBe(302);
    const go = new URL(response.headers.get("Location") ?? "");
    expect(go.origin + go.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(go.searchParams.get("client_id")).toBe("Iv1.client");
    expect(go.searchParams.get("redirect_uri")).toBe(BASE + "/callback");
    expect(decode(go.searchParams.get("state") ?? "")).toEqual({
      r: "https://reviews.example.test/plan.html",
      n: "abcdefgh12",
    });
  });

  it("refuses to start a sign-in for a site it does not serve", async () => {
    const response = await get(
      "/login?return=" + encodeURIComponent("https://evil.example.test/") + "&nonce=abcdefgh12",
    );
    expect(response.status).toBe(400);
  });

  it("uses an Enterprise Server when one is named", async () => {
    const response = await worker.fetch(
      new Request(
        BASE + "/login?return=" + encodeURIComponent("https://reviews.example.test/") + "&nonce=abcdefgh12",
      ),
      { ...ENV, GITHUB_URL: "https://github.example.test/" },
    );
    expect(response.headers.get("Location")).toMatch(
      /^https:\/\/github\.example\.test\/login\/oauth\/authorize\?/,
    );
  });
});

describe("/callback", () => {
  const state = encode({ r: "https://reviews.example.test/plan.html", n: "abcdefgh12" });

  it("exchanges the code with the secret and returns the tokens in the fragment", async () => {
    const sent = github({
      access_token: "ghu_fabricated",
      expires_in: 28800,
      refresh_token: "ghr_fabricated",
      refresh_token_expires_in: 15897600,
      scope: "",
    });
    const response = await get(`/callback?code=c0de&state=${state}`);

    expect(sent[0]).toMatchObject({
      client_id: "Iv1.client",
      client_secret: "fabricated-secret",
      code: "c0de",
    });
    expect(response.status).toBe(302);
    const back = response.headers.get("Location") ?? "";
    expect(back.startsWith("https://reviews.example.test/plan.html#osp-auth=")).toBe(true);
    const tokens = decode(back.split("#osp-auth=")[1]);
    expect(tokens).toEqual({
      access_token: "ghu_fabricated",
      expires_in: 28800,
      refresh_token: "ghr_fabricated",
      refresh_token_expires_in: 15897600,
      nonce: "abcdefgh12",
    });
    // The query never carries a token: only the fragment, which no server sees.
    expect(back.split("#")[0]).not.toContain("ghu_");
  });

  it("will not send a token to a site it does not serve, whatever the state says", async () => {
    github({ access_token: "ghu_fabricated" });
    const forged = encode({ r: "https://evil.example.test/", n: "abcdefgh12" });
    const response = await get(`/callback?code=c0de&state=${forged}`);
    expect(response.status).toBe(400);
    expect(response.headers.get("Location")).toBeNull();
  });

  it("returns the reader to the page, signed out, when they cancel on GitHub", async () => {
    const response = await get(`/callback?error=access_denied&state=${state}`);
    const back = response.headers.get("Location") ?? "";
    expect(decode(back.split("#osp-auth=")[1])).toEqual({ error: "cancelled", nonce: "abcdefgh12" });
  });
});

describe("/refresh", () => {
  function refresh(origin: string, body: unknown): Promise<Response> {
    return worker.fetch(
      new Request(BASE + "/refresh", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      ENV,
    );
  }

  it("trades a refresh token for new tokens, for the site it serves", async () => {
    const sent = github({ access_token: "ghu_new", expires_in: 28800, refresh_token: "ghr_new" });
    const response = await refresh("https://other.example.test", { refresh_token: "ghr_old" });

    expect(sent[0]).toMatchObject({ grant_type: "refresh_token", refresh_token: "ghr_old" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://other.example.test");
    expect(await response.json()).toMatchObject({ access_token: "ghu_new" });
  });

  it("refuses a request from any other site", async () => {
    github({ access_token: "ghu_new" });
    const response = await refresh("https://evil.example.test", { refresh_token: "ghr_old" });
    expect(response.status).toBe(403);
  });

  it("says so when GitHub will not refresh", async () => {
    github({ error: "bad_refresh_token" });
    const response = await refresh("https://reviews.example.test", { refresh_token: "ghr_old" });
    expect(response.status).toBe(401);
  });
});
