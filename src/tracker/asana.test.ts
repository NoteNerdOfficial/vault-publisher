import { afterEach, describe, expect, it } from "vitest";
import { setRequestUrl } from "../../test/obsidian-stub";
import { AsanaClient } from "./asana";
import { TrackerError } from "./request";

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: { data?: Record<string, unknown> } | undefined;
}

function fakeHttp(reply: (call: Call) => { status?: number; json?: unknown }) {
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

function client(workspace = "") {
  return new AsanaClient({ token: "asana-token", project: "1201", workspace });
}

const MADE = {
  data: { gid: "1209", permalink_url: "https://app.asana.com/0/1201/1209" },
};

describe("createTask", () => {
  it("posts the task into the project it was built for", async () => {
    const http = fakeHttp(() => ({ json: MADE }));
    restore = http.restore;

    const task = await client().createTask({ name: "Needs a citation", notes: "Body." });

    expect(http.calls[0].method).toBe("POST");
    expect(http.calls[0].url).toBe("https://app.asana.com/api/1.0/tasks");
    expect(http.calls[0].headers.Authorization).toBe("Bearer asana-token");
    expect(http.calls[0].body).toEqual({
      data: { name: "Needs a citation", notes: "Body.", projects: ["1201"] },
    });

    // A task has no short name of its own, so what is written down is the
    // identifier Asana itself uses, and the link is Asana's own.
    expect(task).toEqual({
      key: "Asana task 1209",
      url: "https://app.asana.com/0/1201/1209",
    });
  });

  // The project already says which workspace it is in, and a wrong one is a
  // refusal rather than a hint.
  it("sends a workspace only when it was given one", async () => {
    const http = fakeHttp(() => ({ json: MADE }));
    restore = http.restore;

    await client("55").createTask({ name: "t", notes: "b" });

    expect(http.calls[0].body?.data?.workspace).toBe("55");
  });

  it("falls back to a link it can build when Asana sends none", async () => {
    const http = fakeHttp(() => ({ json: { data: { gid: "1209" } } }));
    restore = http.restore;

    const task = await client().createTask({ name: "t", notes: "b" });

    expect(task.url).toContain("1209");
    expect(task.url.startsWith("https://app.asana.com/")).toBe(true);
  });

  it("says what Asana said when it refused", async () => {
    const http = fakeHttp(() => ({
      status: 403,
      json: { errors: [{ message: "project: Not a recognized ID" }] },
    }));
    restore = http.restore;

    await expect(
      client().createTask({ name: "t", notes: "b" }),
    ).rejects.toThrow(/Not a recognized ID/);
  });

  // Nothing downstream can write a record for a task it cannot name, and a
  // silent success would be a task created twice the next time.
  it("refuses a success that named no task", async () => {
    const http = fakeHttp(() => ({ json: { data: {} } }));
    restore = http.restore;

    await expect(client().createTask({ name: "t", notes: "b" })).rejects.toBeInstanceOf(
      TrackerError,
    );
  });
});
