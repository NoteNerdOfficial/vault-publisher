/**
 * The one HTTP call the trackers make, and what to say when it fails.
 *
 * Through Obsidian's `requestUrl` rather than `fetch`, for the same reasons
 * the GitHub client uses it: it bypasses the renderer's CORS rules, which is
 * what makes a hosted relay unnecessary, and it honours system proxy
 * settings, which is what makes this work on a corporate machine.
 *
 * Shared by Jira and Asana rather than written twice. GitHub keeps its own
 * client: it carries rate-limit accounting and the Git Data API, and folding
 * those in here would make this the thing it is deliberately not -- a layer
 * everything has to be explained to.
 */

import { requestUrl, RequestUrlResponse } from "obsidian";
import { bodyText, describeNotJson, hostOf, jsonBody } from "../platform/response";
import { scalarText } from "../text";

/** An issue or task that now exists in a tracker. */
export interface FiledIssue {
  /** How a person refers to it. */
  key: string;
  url: string;
}

/** A tracker refused, or could not be reached. */
export class TrackerError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 when the request never arrived. */
    readonly status: number,
  ) {
    super(message);
    this.name = "TrackerError";
  }
}

export async function trackerRequest<T>(options: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}): Promise<T> {
  let response: RequestUrlResponse;
  try {
    response = await requestUrl({
      url: options.url,
      method: options.method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        // Named rather than left as Electron's. A company gateway in front of
        // a tracker logs this, and some of them refuse what they cannot
        // identify; a request that arrives as a browser is also the kind a
        // cross-site check is built to stop.
        "User-Agent": USER_AGENT,
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      // Handled here so the error carries the tracker's own words, which are
      // far more use than a generic status failure.
      throw: false,
    });
  } catch (e) {
    // Offline, DNS, TLS interception, a proxy refusing the connection: worth
    // telling apart from a refusal by the API itself.
    throw new TrackerError(
      `Could not reach ${hostOf(options.url)}: ${e instanceof Error ? e.message : String(e)}`,
      0,
    );
  }

  // Read before the status is judged, because what came back decides which
  // failure this is: a tracker's own refusal reads nothing like a gateway
  // answering for it.
  const body = jsonBody(response);
  const text = bodyText(response);

  if (body === undefined) {
    // Something that is not JSON and not empty: whatever answered, it was
    // not the API. An empty body on a success is a different thing entirely
    // -- a 204, which is what Jira answers a transition with -- and the
    // caller is expected to know it asked for something with no answer.
    if (text.trim() || response.status >= 400) {
      throw new TrackerError(
        describeNotJson(text, options.url, response.status, JIRA_PATH_HINT),
        response.status,
      );
    }
    return undefined as T;
  }

  if (response.status >= 400) {
    throw new TrackerError(describeFailure(body, response.status), response.status);
  }

  return body as T;
}

const USER_AGENT = "obsidian-vault-publisher";

/**
 * The hint to give when the answer was a web page.
 *
 * For a tracker it is nearly always this one: a Jira a company runs is served
 * under a path more often than not, and the front page of the proxy in front
 * of it is exactly what comes back when that path is missing.
 */
const JIRA_PATH_HINT =
  "Check the address: a Jira a company runs is often served under a path, " +
  "such as /jira.";

/**
 * The failure in the API's own words.
 *
 * Each tracker spells an error differently, and all three spellings are
 * tried rather than guessed at from the URL: a proxy or a login page can
 * answer in a shape that has nothing to do with the service behind it.
 */
export function describeFailure(json: unknown, status: number): string {
  const fallback = `HTTP ${status}`;
  if (!json || typeof json !== "object") return fallback;
  const body = json as Record<string, unknown>;

  // GitHub, and Jira's own permission failures.
  if (typeof body.message === "string" && body.message) return body.message;

  // Jira: a list of sentences, plus a map of field to what is wrong with it.
  const messages = Array.isArray(body.errorMessages)
    ? body.errorMessages.filter((line): line is string => typeof line === "string")
    : [];
  const fields =
    body.errors && typeof body.errors === "object" && !Array.isArray(body.errors)
      ? Object.entries(body.errors as Record<string, unknown>).map(
          ([field, why]) => `${field}: ${String(why)}`,
        )
      : [];
  if (messages.length || fields.length) return [...messages, ...fields].join("; ");

  // Asana: a list of objects, each with its own message.
  if (Array.isArray(body.errors)) {
    const said = body.errors
      .map((row) =>
        row && typeof row === "object"
          ? scalarText((row as { message?: unknown }).message)
          : "",
      )
      .filter(Boolean);
    if (said.length) return said.join("; ");
  }

  return fallback;
}
