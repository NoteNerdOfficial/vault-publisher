/**
 * Sign-in for a published Vault Publisher site's shared comments.
 *
 * A Cloudflare Worker you deploy yourself, under a GitHub App you register
 * yourself. With it, a reviewer signs in with GitHub once and then posts
 * comments straight from the page. Without it, the site still works: each
 * comment goes through GitHub's own prefilled "new issue" form instead.
 *
 * It exists for one reason. Turning GitHub's sign-in code into a token needs
 * the app's client secret, and a published page cannot hold a secret. So this
 * holds it, and does that one exchange -- and the refresh that follows it
 * every eight hours. Posting and reading go from the reader's browser to
 * GitHub directly and never come through here.
 *
 * Configuration, in the Worker's settings:
 *
 *   GITHUB_CLIENT_ID      the GitHub App's client ID            (variable)
 *   GITHUB_CLIENT_SECRET  one of the GitHub App's client secrets (secret)
 *   ALLOWED_ORIGINS       the site's origin, e.g.               (variable)
 *                         https://you.github.io -- several may be given,
 *                         separated by commas
 *   GITHUB_URL            only for GitHub Enterprise Server: its (variable)
 *                         address, e.g. https://github.example.com.
 *                         Leave it out for github.com.
 *
 * Routes:
 *
 *   GET  /login?return=<page URL>&nonce=<random>   off to GitHub to sign in
 *   GET  /callback?code=...&state=...              back from GitHub; returns
 *                                                  the reader to the page
 *   POST /refresh   {"refresh_token": "..."}       a fresh token, as JSON
 *
 * The tokens travel back to the page in the URL fragment, which a browser
 * never sends to any server, and only to an origin in ALLOWED_ORIGINS: a
 * Worker that would hand a token to any address it was given would hand
 * every reviewer's token to whoever asked.
 *
 * See README.md beside this file for setting it up.
 */

/** github.com, or the Enterprise Server named in GITHUB_URL. */
export function githubWeb(env) {
  return String(env.GITHUB_URL || "https://github.com").replace(/\/+$/, "");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowed = allowedOrigins(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(request, allowed) });
    }

    try {
      if (url.pathname === "/login" && request.method === "GET") {
        return login(url, env, allowed);
      }
      if (url.pathname === "/callback" && request.method === "GET") {
        return await callback(url, env, allowed);
      }
      if (url.pathname === "/refresh" && request.method === "POST") {
        return await refresh(request, env, allowed);
      }
      return text(404, "Not found.");
    } catch (error) {
      return text(500, "Sign-in failed: " + (error && error.message ? error.message : "unknown error"));
    }
  },
};

/** The origins this Worker may send a reader, and a token, back to. */
export function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/** The page to go back to, or null when it is not on an allowed origin. */
export function safeReturn(value, allowed) {
  if (!value) return null;
  let target;
  try {
    target = new URL(value);
  } catch {
    return null;
  }
  if (target.protocol !== "https:" && target.hostname !== "localhost") return null;
  if (!allowed.includes(target.origin)) return null;
  // Whatever fragment it had is replaced on the way back.
  target.hash = "";
  return target.toString();
}

function login(url, env, allowed) {
  const back = safeReturn(url.searchParams.get("return"), allowed);
  if (!back) return text(400, "That page is not one this sign-in serves.");
  const nonce = url.searchParams.get("nonce") || "";
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(nonce)) return text(400, "Missing or malformed nonce.");

  // Carried through GitHub and back in `state`, and checked again on return.
  const state = encode({ r: back, n: nonce });
  const go = new URL(githubWeb(env) + "/login/oauth/authorize");
  go.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  go.searchParams.set("redirect_uri", new URL("/callback", url).toString());
  go.searchParams.set("state", state);
  return Response.redirect(go.toString(), 302);
}

async function callback(url, env, allowed) {
  const state = decode(url.searchParams.get("state") || "");
  const back = state && safeReturn(state.r, allowed);
  if (!back) return text(400, "That sign-in did not start from a page this serves.");

  const code = url.searchParams.get("code");
  if (!code) {
    // Cancelled on GitHub: back to the page, signed out, saying so.
    return Response.redirect(back + "#" + fragment({ error: "cancelled", nonce: state.n }), 302);
  }

  const tokens = await exchange(env, { code });
  if (tokens.error) {
    return Response.redirect(back + "#" + fragment({ error: tokens.error, nonce: state.n }), 302);
  }
  return Response.redirect(back + "#" + fragment({ ...pick(tokens), nonce: state.n }), 302);
}

async function refresh(request, env, allowed) {
  const headers = cors(request, allowed);
  if (!headers["Access-Control-Allow-Origin"]) {
    return text(403, "Not from a page this serves.");
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "bad_request" }, headers);
  }
  if (!body || typeof body.refresh_token !== "string") {
    return json(400, { error: "bad_request" }, headers);
  }
  const tokens = await exchange(env, {
    grant_type: "refresh_token",
    refresh_token: body.refresh_token,
  });
  if (tokens.error) return json(401, { error: tokens.error }, headers);
  return json(200, pick(tokens), headers);
}

/** GitHub's token endpoint, with the secret only this Worker holds. */
async function exchange(env, fields) {
  const response = await fetch(githubWeb(env) + "/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      ...fields,
    }),
  });
  const data = await response.json().catch(() => ({ error: "bad_response" }));
  if (!response.ok && !data.error) return { error: "github_" + response.status };
  return data;
}

/** Only what the page needs, and nothing GitHub might add later. */
function pick(tokens) {
  return {
    access_token: tokens.access_token,
    expires_in: tokens.expires_in,
    refresh_token: tokens.refresh_token,
    refresh_token_expires_in: tokens.refresh_token_expires_in,
  };
}

/** CORS for a request from an allowed origin, and nothing for any other. */
export function cors(request, allowed) {
  const origin = (request.headers.get("Origin") || "").replace(/\/+$/, "");
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function fragment(values) {
  return "osp-auth=" + encode(values);
}

export function encode(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decode(value) {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "===".slice((padded.length + 3) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function text(status, body) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function json(status, body, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}
