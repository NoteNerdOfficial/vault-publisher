import { afterEach, describe, expect, it } from "vitest";
// By path rather than by the "obsidian" alias: tsc resolves that name to the
// real package, which has no such export. The alias points at this same file,
// so the client under test and this import share one module instance.
import { setRequestUrl } from "../../test/obsidian-stub";
import { JiraClient, jiraLabels } from "./jira";
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

function client() {
  return new JiraClient({
    site: "https://acme.atlassian.net",
    project: "ENG",
    issueType: "Task",
    email: "someone@example.com",
    token: "jira-token",
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
