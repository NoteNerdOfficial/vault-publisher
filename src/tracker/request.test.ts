import { afterEach, describe, expect, it } from "vitest";
import { setRequestUrl } from "../../test/obsidian-stub";
import { TrackerError, trackerRequest } from "./request";

/**
 * What comes back when the thing that answered was not the tracker.
 *
 * This is the failure a company network produces, and nothing else looks
 * like it: a sign-on portal in front of Jira answers a POST with its own
 * login page, often with a 200 on it. Before this was handled, reading that
 * response as JSON threw a parse error from inside the plugin -- or, worse,
 * succeeded with nothing in it and reported an issue that was never filed.
 */

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

/**
 * A reply with no JSON in it at all.
 *
 * `json` is a getter here because that is what it is in Obsidian: it parses
 * the body on first read and throws when the body is not JSON, which is the
 * behaviour the code under test has to survive.
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

function call(): Promise<unknown> {
  return trackerRequest({
    url: "https://jira.example.com/jira/rest/api/2/issue",
    method: "POST",
    headers: {},
    body: { fields: {} },
  });
}

const LOGIN = `<!DOCTYPE html><html><head><title>Log in to continue</title></head>
<body><form><input type="password" name="os_password"></form></body></html>`;

describe("a reply that is not the API's", () => {
  it("names a sign-in page as what it is, rather than failing to parse it", async () => {
    replying(LOGIN);

    await expect(call()).rejects.toThrow(/sign-in page/);
  });

  // The status is no help here: the portal answered successfully, about
  // itself. What must not happen is a success.
  it("refuses it even when it arrived as a success", async () => {
    replying(LOGIN);

    await expect(call()).rejects.toBeInstanceOf(TrackerError);
  });

  it("points at the address when the answer is some other web page", async () => {
    replying("<html><body><h1>It works!</h1></body></html>", 404);

    await expect(call()).rejects.toThrow(/web page rather than JSON/);
    // The hint worth giving, because it is the setting that is usually wrong.
    await expect(call()).rejects.toThrow(/\/jira/);
  });

  it("says plainly that a body with nothing in it was not JSON", async () => {
    replying("", 502);

    await expect(call()).rejects.toThrow(
      "jira.example.com answered HTTP 502, but not with JSON.",
    );
  });

  /**
   * The other half of the same problem: a body that is perfectly good JSON,
   * served with no content type or one in an unexpected casing, which is what
   * happens on mobile. Obsidian's `json` comes back empty for it, and the
   * text is the only place the answer is.
   */
  it("reads JSON that only the text held", async () => {
    restore = setRequestUrl(async () => ({
      status: 200,
      json: undefined,
      text: '{"key":"ENG-9"}',
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
    }));

    await expect(call()).resolves.toEqual({ key: "ENG-9" });
  });

  it("identifies itself, so a gateway has something to log", async () => {
    const seen: Record<string, string>[] = [];
    restore = setRequestUrl(async (options: { headers: Record<string, string> }) => {
      seen.push(options.headers);
      return {
        status: 200,
        json: { key: "ENG-10" },
        text: "",
        headers: {},
        arrayBuffer: new ArrayBuffer(0),
      };
    });

    await call();

    expect(seen[0]["User-Agent"]).toContain("vault-publisher");
  });
});

/**
 * The one success with nothing in it.
 *
 * Jira answers a transition -- which is how an issue gets closed -- with 204
 * and no body at all. Treating that as "not JSON" would make every
 * successful close look like a failure.
 */
describe("a success with no body", () => {
  it("is handed back as nothing, not refused", async () => {
    restore = setRequestUrl(async () => ({
      status: 204,
      get json(): unknown {
        throw new SyntaxError("Unexpected end of JSON input");
      },
      text: "",
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
    }));

    await expect(call()).resolves.toBeUndefined();
  });
});
