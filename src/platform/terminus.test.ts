import { describe, expect, it } from "vitest";
import { notePathForPreview, previewPathOf, registerWithTerminus, terminusBrowserAvailable } from "./terminus";
import type { App } from "obsidian";

describe("previewPathOf", () => {
  it("keys a page the way the preview's page list does", () => {
    expect(previewPathOf("http://127.0.0.1:4000/notes/a%20b.html")).toBe("notes/a b.html");
    expect(previewPathOf("http://127.0.0.1:4000/")).toBe("index.html");
    expect(previewPathOf("http://127.0.0.1:4000/docs/")).toBe("docs/index.html");
    expect(previewPathOf("not a url")).toBeNull();
  });
});

describe("notePathForPreview", () => {
  it("reverses urlForNote", () => {
    expect(notePathForPreview("accounts.html", "Guide")).toBe("Guide/accounts.md");
    expect(notePathForPreview("a/b.html", null)).toBe("a/b.md");
    expect(notePathForPreview("style.css", "Guide")).toBeNull();
  });
});

describe("without Terminus", () => {
  const app = { plugins: { getPlugin: () => null } } as unknown as App;

  it("reports it missing and registers nothing", () => {
    expect(terminusBrowserAvailable(app)).toBe(false);
    expect(
      registerWithTerminus(app, {
        id: "x",
        name: "x",
        description: "",
        open: async () => "",
        sourceFor: () => null,
        refresh: async () => {},
      }),
    ).toBeNull();
  });
});

describe("with Terminus", () => {
  it("registers through its API and hands back the unregister", () => {
    let registered: unknown = null;
    let removed = false;
    const api = {
      version: 1,
      browserAvailable: () => true,
      registerSite: (site: unknown) => {
        registered = site;
        return () => (removed = true);
      },
    };
    const app = { plugins: { getPlugin: (id: string) => (id === "terminus" ? { api } : null) } } as unknown as App;
    expect(terminusBrowserAvailable(app)).toBe(true);
    const off = registerWithTerminus(app, { id: "x", name: "x", description: "", open: async () => "", sourceFor: () => null, refresh: async () => {} });
    expect(registered).not.toBeNull();
    off?.();
    expect(removed).toBe(true);
  });
});
