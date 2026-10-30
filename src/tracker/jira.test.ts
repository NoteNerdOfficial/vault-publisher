import { afterEach, describe, expect, it } from "vitest";
// By path rather than by the "obsidian" alias: tsc resolves that name to the
// real package, which has no such export. The alias points at this same file,
// so the client under test and this import share one module instance.
import { setRequestUrl } from "../../test/obsidian-stub";
import { JiraClient, JiraConfig, jiraLabels, pickTransition } from "./jira";
import { TrackerError } from "./request";

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Record<string, never> | undefined;
}

function fakeHttp(
  reply: (call: Call) => { status?: number; json?: unknown },
): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  const restore = setRequestUrl(
    async (options: {
      method: string;
      url: string;
      headers: Record<string, string>;
      body?: string;
    }) => {
      const call = {
        method: options.method,
        url: options.url,
        headers: options.headers,
        body: options.body === undefined ? undefined : JSON.parse(options.body),
      };
      calls.push(call);
      const r = reply(call);
      return {
        status: r.status ?? 200,
        json: r.json,
        text: "",
        headers: {},
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

function client(over: Partial<JiraConfig> = {}) {
  return new JiraClient({
    site: "https://acme.atlassian.net",
    project: "ENG",
    issueType: "Task",
    auth: "cloud",
    user: "someone@example.com",
    token: "jira-token",
    ...over,
  });
}

const DESCRIPTION = { type: "doc", version: 1, content: [] };

describe("createIssue", () => {
  it("posts the issue to the project it was built for", async () => {
    const http = fakeHttp(() => ({ json: { key: "ENG-14" } }));
    restore = http.restore;

    const issue = await client().createIssue({
      summary: "Needs a citation",
      description: DESCRIPTION,
      labels: ["review"],
    });

    expect(http.calls[0].method).toBe("POST");
    expect(http.calls[0].url).toBe("https://acme.atlassian.net/rest/api/3/issue");
    expect(http.calls[0].body).toEqual({
      fields: {
        project: { key: "ENG" },
        issuetype: { name: "Task" },
        summary: "Needs a citation",
        description: DESCRIPTION,
        labels: ["review"],
      },
    });

    // The key is what a person says out loud, and the browse URL is where
    // they go. Jira hands back neither of the two together.
    expect(issue).toEqual({
      key: "ENG-14",
      url: "https://acme.atlassian.net/browse/ENG-14",
    });
  });

  // Server and Data Center refuse anything that changes data unless the
  // request says it is not a browser being made to act for somebody.
  it("opts out of the cross-site check", async () => {
    const http = fakeHttp(() => ({ json: { key: "ENG-1" } }));
    restore = http.restore;

    await client().createIssue({ summary: "t", description: DESCRIPTION });

    expect(http.calls[0].headers["X-Atlassian-Token"]).toBe("no-check");
  });

  it("authenticates with the email and the token, not with a bearer", () => {
    const http = fakeHttp(() => ({ json: { key: "ENG-1" } }));
    restore = http.restore;

    return client()
      .createIssue({ summary: "t", description: DESCRIPTION })
      .then(() => {
        const auth = http.calls[0].headers.Authorization;
        expect(auth.startsWith("Basic ")).toBe(true);
        expect(atob(auth.slice(6))).toBe("someone@example.com:jira-token");
      });
  });

  // Jira projects leave `labels` off a create screen more often than anyone
  // expects, and the whole request is refused over it.
  it("files it without labels rather than not at all, if labels are refused", async () => {
    const http = fakeHttp((call) =>
      (call.body as { fields?: { labels?: string[] } }).fields?.labels
        ? { status: 400, json: { errors: { labels: "Field 'labels' cannot be set." } } }
        : { json: { key: "ENG-15" } },
    );
    restore = http.restore;

    const issue = await client().createIssue({
      summary: "t",
      description: DESCRIPTION,
      labels: ["review"],
    });

    expect(issue.key).toBe("ENG-15");
    expect(http.calls).toHaveLength(2);
    expect(http.calls[1].body).toEqual({
      fields: {
        project: { key: "ENG" },
        issuetype: { name: "Task" },
        summary: "t",
        description: DESCRIPTION,
      },
    });
  });

  it("does not retry a refusal that was never about labels", async () => {
    const http = fakeHttp(() => ({
      status: 401,
      json: { errorMessages: ["Client must be authenticated."] },
    }));
    restore = http.restore;

    await expect(
      client().createIssue({ summary: "t", description: DESCRIPTION, labels: ["review"] }),
    ).rejects.toMatchObject({ status: 401 });
    expect(http.calls).toHaveLength(1);
  });

  it("says what Jira said about the field it refused", async () => {
    const http = fakeHttp(() => ({
      status: 400,
      json: { errors: { issuetype: "valid issue type is required" } },
    }));
    restore = http.restore;

    await expect(
      client().createIssue({ summary: "t", description: DESCRIPTION }),
    ).rejects.toThrow(/issuetype: valid issue type is required/);
  });

  // Nothing downstream can write a record for an issue it cannot name, and a
  // silent success would be an issue filed twice the next time.
  it("refuses a success that named no issue", async () => {
    const http = fakeHttp(() => ({ json: {} }));
    restore = http.restore;

    await expect(
      client().createIssue({ summary: "t", description: DESCRIPTION }),
    ).rejects.toBeInstanceOf(TrackerError);
  });
});

/**
 * The Jira a company runs itself, which is a different API behind the same
 * name: a bearer token instead of a pair, v2 instead of v3, and very often a
 * context path in front of all of it.
 */
describe("a Jira somebody runs themselves", () => {
  it("sends a personal access token as a bearer token, to the older API", async () => {
    const http = fakeHttp(() => ({ json: { key: "ENG-2" } }));
    restore = http.restore;

    const issue = await client({
      site: "https://jira.example.com/jira",
      auth: "pat",
      // A token is the whole credential there: no account goes with it.
      user: "",
      token: "pat-token",
    }).createIssue({ summary: "t", description: "h3. Replies" });

    expect(http.calls[0].headers.Authorization).toBe("Bearer pat-token");
    expect(http.calls[0].url).toBe("https://jira.example.com/jira/rest/api/2/issue");
    // The description is a string there, and goes across as one.
    expect(http.calls[0].body).toMatchObject({
      fields: { description: "h3. Replies" },
    });
    expect(issue.url).toBe("https://jira.example.com/jira/browse/ENG-2");
  });

  it("signs in with a username when that is all the version has", async () => {
    const http = fakeHttp(() => ({ json: { key: "ENG-3" } }));
    restore = http.restore;

    await client({
      site: "https://jira.example.com",
      auth: "basic",
      user: "someone",
      token: "a password",
    }).createIssue({ summary: "t", description: "" });

    const auth = http.calls[0].headers.Authorization;
    expect(atob(auth.slice(6))).toBe("someone:a password");
    expect(http.calls[0].url).toBe("https://jira.example.com/rest/api/2/issue");
  });

  // The API can be behind a gateway nobody browses to, and a link to it is a
  // link to a page that does not load.
  it("links to the address a person opens Jira at", async () => {
    const http = fakeHttp(() => ({ json: { key: "ENG-4" } }));
    restore = http.restore;

    const issue = await client({
      site: "https://jira-api.internal/jira",
      browseUrl: "https://jira.example.com/jira/",
      auth: "pat",
      user: "",
    }).createIssue({ summary: "t", description: "" });

    expect(http.calls[0].url).toBe("https://jira-api.internal/jira/rest/api/2/issue");
    expect(issue.url).toBe("https://jira.example.com/jira/browse/ENG-4");
  });
});

/** Reading a status back, which is what catching up on a comment does. */
describe("issueStatus", () => {
  it("asks only for the two fields it reads", async () => {
    const http = fakeHttp(() => ({
      json: {
        fields: {
          status: { statusCategory: { key: "done" } },
          resolution: { name: "Won't Do" },
        },
      },
    }));
    restore = http.restore;

    const status = await client().issueStatus("ENG-14");

    expect(http.calls[0].method).toBe("GET");
    expect(http.calls[0].url).toBe(
      "https://acme.atlassian.net/rest/api/3/issue/ENG-14?fields=status,resolution",
    );
    expect(status).toEqual({ category: "done", resolution: "Won't Do" });
  });

  it("reads the older API on a Jira a company runs", async () => {
    const http = fakeHttp(() => ({
      json: { fields: { status: { statusCategory: { key: "indeterminate" } } } },
    }));
    restore = http.restore;

    const status = await client({
      site: "https://jira.example.com/jira",
      auth: "pat",
      user: "",
    }).issueStatus("ENG-9");

    expect(http.calls[0].url).toBe(
      "https://jira.example.com/jira/rest/api/2/issue/ENG-9?fields=status,resolution",
    );
    // An unresolved issue has no resolution at all, and that is not an error.
    expect(status).toEqual({ category: "indeterminate", resolution: "" });
  });
});

/**
 * Closing, which in Jira is not a field but a move through the project's own
 * workflow: the transitions have to be asked for before one can be used.
 */
describe("closeIssue", () => {
  const TRANSITIONS = {
    transitions: [
      { id: "11", name: "Start progress", to: { statusCategory: { key: "indeterminate" } } },
      { id: "21", name: "Done", to: { statusCategory: { key: "done" }, name: "Done" } },
      { id: "31", name: "Won't Do", to: { statusCategory: { key: "done" }, name: "Won't Do" } },
    ],
  };

  it("asks what the workflow offers, then posts the one that finishes it", async () => {
    const http = fakeHttp((call) => (call.method === "GET" ? { json: TRANSITIONS } : {}));
    restore = http.restore;

    await client().closeIssue("ENG-14", "done");

    expect(http.calls[0].method).toBe("GET");
    expect(http.calls[0].url).toContain("/rest/api/3/issue/ENG-14/transitions");
    expect(http.calls[1].method).toBe("POST");
    expect(http.calls[1].url).toBe(
      "https://acme.atlassian.net/rest/api/3/issue/ENG-14/transitions",
    );
    expect(http.calls[1].body).toEqual({ transition: { id: "21" } });
  });

  it("prefers the transition that says the work will not be done", async () => {
    const http = fakeHttp((call) => (call.method === "GET" ? { json: TRANSITIONS } : {}));
    restore = http.restore;

    await client().closeIssue("ENG-14", "declined");

    expect(http.calls[1].body).toEqual({ transition: { id: "31" } });
  });

  // A workflow can genuinely refuse to let this account finish an issue, and
  // that is worth saying rather than moving the issue sideways instead.
  it("says so when no transition would close it, and posts nothing", async () => {
    const http = fakeHttp(() => ({
      json: { transitions: [{ id: "11", name: "Start progress", to: { statusCategory: { key: "indeterminate" } } }] },
    }));
    restore = http.restore;

    await expect(client().closeIssue("ENG-14", "done")).rejects.toThrow(/no transition/);
    expect(http.calls).toHaveLength(1);
  });

  it("uses the older API on a Jira a company runs", async () => {
    const http = fakeHttp((call) => (call.method === "GET" ? { json: TRANSITIONS } : {}));
    restore = http.restore;

    await client({
      site: "https://jira.example.com/jira",
      auth: "pat",
      user: "",
    }).closeIssue("ENG-14", "done");

    expect(http.calls[1].url).toBe(
      "https://jira.example.com/jira/rest/api/2/issue/ENG-14/transitions",
    );
  });
});

describe("pickTransition", () => {
  const done = { id: "2", name: "Done", to: { statusCategory: { key: "done" } } };
  const wont = { id: "3", name: "Won't Do", to: { statusCategory: { key: "done" } } };
  const start = { id: "1", name: "Start", to: { statusCategory: { key: "indeterminate" } } };

  it("will only ever pick a transition that finishes the issue", () => {
    expect(pickTransition([start], "done")).toBeNull();
    expect(pickTransition([], "declined")).toBeNull();
    expect(pickTransition([start, done], "done")?.id).toBe("2");
  });

  it("falls back to the other kind rather than leaving the issue open", () => {
    // Only a refusal available, but the comment was resolved: closed is
    // closer to the truth than open.
    expect(pickTransition([start, wont], "done")?.id).toBe("3");
    expect(pickTransition([start, done], "declined")?.id).toBe("2");
  });

  it("reads the status name as well as the transition's own", () => {
    const named = { id: "4", name: "Close", to: { statusCategory: { key: "done" }, name: "Duplicate" } };
    expect(pickTransition([named, done], "declined")?.id).toBe("4");
  });
});

describe("jiraLabels", () => {
  // A Jira label cannot hold a space: the request is refused over one. So
  // "priority: high" has to become something, and "priority:-high" is not it.
  it("turns a label with a space into one Jira will take", () => {
    expect(jiraLabels(["review", "priority: high"])).toEqual([
      "review",
      "priority-high",
    ]);
    expect(jiraLabels(["two words"])).toEqual(["two-words"]);
  });

  it("drops the empties and the repeats the rewriting creates", () => {
    expect(jiraLabels(["  ", "a b", "a  b"])).toEqual(["a-b"]);
  });
});
