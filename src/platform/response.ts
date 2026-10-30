/**
 * Reading an HTTP response that might not have come from the API at all.
 *
 * Shared by the GitHub client and the tracker clients, which otherwise have
 * nothing in common and deliberately keep their own request code: this is not
 * a layer either of them has to be explained to, it is the two or three facts
 * about `requestUrl` that both of them get wrong on their own.
 *
 * The first fact is that `response.json` is a getter. It parses the body on
 * first read and throws when the body is not JSON, so reading it is something
 * to be guarded rather than a value to be checked. It can also come back
 * empty for a body that is perfectly good JSON but arrived with no content
 * type, or one in a casing nothing expected, which happens on mobile -- hence
 * the second attempt at the text.
 *
 * The second fact is why that matters, which is company networks. A sign-on
 * portal in front of a self-hosted GitHub or Jira answers a POST with its own
 * login page, and often answers it *successfully*: HTTP 200, an HTML body,
 * and -- unguarded -- either a parse error thrown from deep inside the plugin
 * or something reported as filed that does not exist. Both are worse than a
 * sentence naming what happened.
 */

import { RequestUrlResponse } from "obsidian";

/**
 * The body as JSON, or `undefined` when it was not JSON.
 *
 * `undefined` means "not JSON", not "JSON with nothing in it": a caller that
 * needs to tell an empty success apart from a login page has the text.
 */
export function jsonBody(response: RequestUrlResponse): unknown {
  try {
    if (response.json !== undefined && response.json !== null) return response.json;
  } catch {
    // Not JSON by that route. The text is never parsed for us, so try it.
  }
  const text = bodyText(response).trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The body as a string, which is also a getter worth not trusting. */
export function bodyText(response: RequestUrlResponse): string {
  try {
    return typeof response.text === "string" ? response.text : "";
  } catch {
    return "";
  }
}

/**
 * What to say when an API answered with something that is not its API.
 *
 * `what` names the thing that was being talked to, in the words the panel
 * uses for it, so the sentence can carry a hint worth acting on rather than
 * one that is only true for one of the two callers.
 */
export function describeNotJson(
  text: string,
  url: string,
  status: number,
  hint = "",
): string {
  const host = hostOf(url);
  const head = text.slice(0, 2000).toLowerCase();

  if (looksLikeSignIn(head)) {
    return (
      `${host} answered with a sign-in page, so the request never reached ` +
      `the API. Sign in to ${host} in a browser, or ask whoever runs it ` +
      `which credential its gateway accepts.`
    );
  }

  if (head.includes("<html") || head.includes("<!doctype html")) {
    return (
      `${host} answered with a web page rather than JSON (HTTP ${status}).` +
      (hint ? ` ${hint}` : "")
    );
  }

  return `${host} answered HTTP ${status}, but not with JSON.`;
}

/**
 * Whether this is a login page.
 *
 * Several shapes of the same thing: a product's own login form, the one a
 * SAML or OIDC portal shows instead, and the generic case of an HTML page
 * with a password field on it.
 */
function looksLikeSignIn(head: string): boolean {
  if (/<title>[^<]*(log ?in|sign ?in|sign ?on|authenticat)/.test(head)) return true;
  if (head.includes('type="password"') || head.includes("type='password'")) return true;
  return head.includes("os_password") || head.includes("samlrequest");
}

/** The host, for a sentence. Whatever was given, if it is not a URL. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
