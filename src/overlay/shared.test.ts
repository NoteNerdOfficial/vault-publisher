import { describe, expect, it } from "vitest";
import {
  applyShared,
  commentFromIssue,
  readSharedMarker,
  sharedText,
  type SharedIssue,
} from "./shared";

const MARKER = `<!-- osp-review {"v":1,"id":"cm1","page":"notes/plan.html","block":"abc","rx":0.5,"ry":0.25,"priority":"high"} -->`;

function issue(over: Partial<SharedIssue> = {}): SharedIssue {
  return {
    number: 7,
    title: "The table is too wide",
    body:
      "The table is too wide on a phone.\n\n> Quarterly numbers\n\n---\n" +
      "Left on [Plan](https://example.test/notes/plan.html).\n\n" +
      MARKER,
    state: "open",
    state_reason: null,
    html_url: "https://github.com/acme/site/issues/7",
    created_at: "2026-11-22T10:00:00Z",
    comments: 2,
    user: { login: "reviewer" },
    ...over,
  };
}

describe("readSharedMarker", () => {
  it("reads the pin out of an issue body", () => {
    const pin = readSharedMarker(issue().body);
    expect(pin?.id).toBe("cm1");
    expect(pin?.page).toBe("notes/plan.html");
    expect(pin?.block).toBe("abc");
  });

  it("finds nothing in an ordinary issue", () => {
    expect(readSharedMarker("Just a bug report.")).toBeNull();
    expect(readSharedMarker(null)).toBeNull();
  });

  it("refuses a marker without the fields a pin needs", () => {
    expect(readSharedMarker(`<!-- osp-review {"v":1,"page":"a.html"} -->`)).toBeNull();
    expect(readSharedMarker(`<!-- osp-review {not json} -->`)).toBeNull();
  });
});

describe("sharedText", () => {
  it("keeps what the reader wrote and drops the quote and the footer", () => {
    expect(sharedText(issue().body)).toBe("The table is too wide on a phone.");
  });

  it("falls back to the title when the body says nothing else", () => {
    expect(sharedText(`---\n${MARKER}`, "Title")).toBe("Title");
  });
});

describe("commentFromIssue", () => {
  it("turns a review issue into a filed comment against the note behind its page", () => {
    const comment = commentFromIssue(issue(), "acme", "site", {
      "notes/plan.html": "Projects/Plan.md",
    });
    expect(comment).toMatchObject({
      id: "gh-acme-site-7",
      page: "notes/plan.html",
      sourcePath: "Projects/Plan.md",
      block: "abc",
      rx: 0.5,
      author: "reviewer",
      text: "The table is too wide on a phone.",
      priority: "high",
      resolved: false,
      imported: "github",
      external: { provider: "github", key: "acme/site#7" },
    });
  });

  it("keys a page the last publish did not record by its URL", () => {
    expect(commentFromIssue(issue(), "acme", "site", {})?.sourcePath).toBe("notes/plan.html");
  });

  it("resolves a comment whose issue was closed as done, and not one closed as not planned", () => {
    expect(
      commentFromIssue(issue({ state: "closed", state_reason: "completed" }), "a", "b", {})
        ?.resolved,
    ).toBe(true);
    expect(
      commentFromIssue(issue({ state: "closed", state_reason: "not_planned" }), "a", "b", {})
        ?.resolved,
    ).toBe(false);
  });

  it("ignores pull requests and issues without a marker", () => {
    expect(commentFromIssue(issue({ pull_request: {} }), "a", "b", {})).toBeNull();
    expect(commentFromIssue(issue({ body: "A bug." }), "a", "b", {})).toBeNull();
  });
});

describe("applyShared", () => {
  const doc = (comments: unknown[]) =>
    JSON.stringify({ version: 11, site: "S", comments, withdrawn: [] });

  it("adds the issues the review does not have yet", () => {
    const incoming = [commentFromIssue(issue(), "acme", "site", {})!];
    const next = applyShared(doc([]), incoming);
    expect(JSON.parse(next!).comments).toHaveLength(1);
  });

  it("leaves alone an issue already in the review, by id or by its key", () => {
    const incoming = [commentFromIssue(issue(), "acme", "site", {})!];
    expect(applyShared(doc([{ id: "gh-acme-site-7" }]), incoming)).toBeNull();
    // Filed from the preview with Send to GitHub, under its own id.
    expect(
      applyShared(doc([{ id: "local", external: { key: "acme/site#7" } }]), incoming),
    ).toBeNull();
  });

  it("keeps every other field of the document as it was", () => {
    const raw = JSON.stringify({ version: 11, site: "S", comments: [], withdrawn: [], extra: 1 });
    const next = JSON.parse(applyShared(raw, [commentFromIssue(issue(), "a", "b", {})!])!);
    expect(next.extra).toBe(1);
  });
});
