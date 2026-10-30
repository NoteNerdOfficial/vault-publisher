// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from "vitest";
import { installObsidianDom } from "../../test/obsidian-stub";
import { SettingsHost, VaultPublisherSettingsTab } from "./settingsTab";
import type { App } from "obsidian";

/**
 * The settings panel is the only screen this plugin has, and the part of it
 * worth testing is not how a row looks but what the panel decides: which
 * sections exist and in what order, which of the three actions is live, and
 * what a dead one says instead.
 *
 * That last one is the reason this file exists. `previewBlocked` and
 * `publishBlocked` restate the preconditions `main.ts` checks before it runs
 * either command. Two copies of the same rule drift, and when they do the
 * panel offers a button that fails or refuses one that would have worked --
 * neither of which anything else here would notice.
 *
 * Obsidian's `Setting` and its `HTMLElement` extensions live inside the app,
 * so the stub next door stands in for both. It is close enough to read a
 * rendered panel back: one `.setting-item` per row, `.setting-item-heading`
 * on the section headings.
 */

beforeAll(() => {
  installObsidianDom();
});

/** A host whose settings are complete, which any test can then break. */
function host(over: {
  site?: Partial<SettingsHost["settings"]["site"]>;
  github?: Partial<SettingsHost["settings"]["github"]>;
  overlay?: Partial<SettingsHost["settings"]["commentOverlay"]>;
  tokenState?: SettingsHost["tokenState"];
  serving?: boolean;
} = {}): SettingsHost & { app: App } {
  return {
    progress: null,
    legacyFolder: null,
    removeLegacyFolder: async () => true,
    tokenState: over.tokenState ?? "ready",
    setToken: () => {},
    relayTokenState: "none",
    setRelayToken: () => {},
    settings: {
      autoRun: "none",
      site: {
        siteName: "Handbook",
        folder: "",
        requireFrontmatterFlag: null,
        ...over.site,
      },
      commentOverlay: {
        enabled: false,
        reviewer: "",
        reviewFolder: "_vault-publisher/review",
        ...over.overlay,
      },
      relay: {
        provider: "off" as never,
        sync: false,
        labels: "",
        github: { owner: "", repo: "" },
        jira: {
          site: "",
          browseUrl: "",
          project: "",
          issueType: "",
          auth: "cloud",
          email: "",
          username: "",
        },
        asana: { project: "", workspace: "" },
        token: "",
      },
      github: {
        apiBase: "https://api.github.com",
        owner: "acme",
        repo: "handbook",
        branch: "gh-pages",
        token: "github_pat_example",
        private: false,
        ...over.github,
      },
    },
    saveSettings: async () => {},
    verifyToken: async () => "acme",
    publish: async () => {},
    buildToPreview: async () => {},
    importReview: async () => {},
    relayOpenComments: async () => {},
    syncWithTracker: async () => {},
    openPreview: async () => {},
    reviewServerAddress: over.serving
      ? { url: "http://127.0.0.1:7331/?t=abc", port: 7331 }
      : null,
    stopReviewServer: async () => {},
  } as unknown as SettingsHost & { app: App };
}

/**
 * Enough of an app for the one question the panel asks of the vault: which
 * note the front page resolves to. An empty vault answers it honestly.
 */
function app(): App {
  return {
    vault: { getMarkdownFiles: () => [] },
    metadataCache: { getFileCache: () => null },
  } as unknown as App;
}

function render(over: Parameters<typeof host>[0] = {}): HTMLElement {
  const tab = new VaultPublisherSettingsTab(app(), host(over));
  tab.display();
  return tab.containerEl;
}

/** The section headings, in the order they are drawn. */
function sections(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll(".setting-item-heading")).map(
    (node) => node.querySelector(".setting-item-name")?.textContent ?? "",
  );
}

/** One row by its name, whatever section it is in. */
function row(root: HTMLElement, name: string): HTMLElement | null {
  return (
    Array.from(root.querySelectorAll(".setting-item")).find(
      (node) => node.querySelector(".setting-item-name")?.textContent === name,
    ) as HTMLElement | undefined
  ) ?? null;
}

function desc(root: HTMLElement, name: string): string {
  return row(root, name)?.querySelector(".setting-item-description")?.textContent ?? "";
}

function button(root: HTMLElement, name: string): HTMLButtonElement | null {
  return row(root, name)?.querySelector("button") ?? null;
}

describe("how the panel is ordered", () => {
  // The actions are what a returning reader came for, and the setup under
  // them is in the order that reaches something real fastest: a preview
  // needs no GitHub, so GitHub is the step before publishing and nothing
  // earlier.
  it("leads with the actions, then setup, then the optional parts", () => {
    expect(sections(render())).toEqual([
      "Preview and publish",
      "What to publish",
      "Appearance",
      "GitHub",
      "Review",
      "On startup",
    ]);
  });

  // Not reordered by state: a panel that rearranges itself costs a returning
  // reader more than it saves a new one, and the state can go backwards.
  it("keeps every section in the same place before setup is finished", () => {
    const fresh = sections(render({ site: { siteName: "", folder: null }, github: { token: "", owner: "", repo: "" } }));
    expect(fresh).toEqual([
      "Get started",
      "What to publish",
      "Appearance",
      "GitHub",
      "Review",
      "On startup",
    ]);
  });

  it("names the top section for what it is doing", () => {
    expect(sections(render())[0]).toBe("Preview and publish");
    expect(sections(render({ site: { siteName: "" } }))[0]).toBe("Get started");
  });

  // Issue tracker used to be drawn from inside the review section, which put
  // a dozen Jira fields in the middle of it.
  it("shows the issue tracker after review, and only with review on", () => {
    expect(sections(render())).not.toContain("Issue tracker");
    const on = sections(render({ overlay: { enabled: true } }));
    expect(on.indexOf("Issue tracker")).toBe(on.indexOf("Review") + 1);
  });
});

describe("the checklist", () => {
  it("is gone once nothing is missing", () => {
    expect(render().querySelector("ol")).toBeNull();
  });

  it("asks for a name and a scope before it asks for a token", () => {
    const root = render({ site: { siteName: "", folder: null }, github: { token: "", owner: "", repo: "" } });
    expect(Array.from(root.querySelectorAll("ol li")).map((node) => node.textContent)).toEqual([
      "Give the site a name",
      "Choose what to publish",
      "Add a GitHub token",
      "Name the repository to publish to",
    ]);
  });

  // A finished step stays on the list struck through, so the list says how
  // far along you are and not only how much is left.
  it("keeps the steps already done, marked", () => {
    const root = render({ github: { token: "", owner: "", repo: "" } });
    const items = Array.from(root.querySelectorAll("ol li")) as HTMLElement[];
    expect(items[0].textContent).toBe("Give the site a name — done");
    expect(items[0].style.textDecoration).toBe("line-through");
    expect(items[2].textContent).toBe("Add a GitHub token");
    expect(items[2].style.textDecoration).toBe("");
  });
});

describe("what each action is allowed to do", () => {
  // The whole reason the panel no longer leads with a live Publish button.
  it("offers a preview with no GitHub at all, and says so", () => {
    const root = render({ github: { token: "", owner: "", repo: "" } });

    expect(button(root, "Build a preview")?.disabled).toBe(false);
    expect(desc(root, "Build a preview")).toContain("Nothing is sent to GitHub");
    expect(button(root, "Publish to GitHub")?.disabled).toBe(true);
    expect(desc(root, "Publish to GitHub")).toBe(
      "Add a GitHub token, below, and this will publish.",
    );
  });

  it("refuses a preview with no scope, and names the fix", () => {
    const root = render({ site: { folder: null } });

    expect(button(root, "Build a preview")?.disabled).toBe(true);
    expect(desc(root, "Build a preview")).toBe(
      "Choose what to publish, below, and this will build.",
    );
  });

  // The same conditions `publish` itself checks, in the same order, so the
  // row and the Notice can never disagree about what is wrong.
  it("names the first thing stopping a publish", () => {
    expect(desc(render({ github: { owner: "" } }), "Publish to GitHub")).toBe(
      "Name the repository to publish to, below, and this will publish.",
    );
    expect(desc(render({ site: { folder: null } }), "Publish to GitHub")).toBe(
      "Choose what to publish, below, and this will publish.",
    );
  });

  // A token that is there but unreadable calls for restarting Obsidian, not
  // for pasting a new one, and must not be reported as a missing token.
  it("reports an unreadable token as itself", () => {
    const root = render({ github: { token: "" }, tokenState: "locked" });

    expect(button(root, "Publish to GitHub")?.disabled).toBe(true);
    expect(desc(root, "Publish to GitHub")).toContain("could not be read");
  });

  it("lets everything run once setup is finished", () => {
    const root = render();

    expect(button(root, "Build a preview")?.disabled).toBe(false);
    expect(button(root, "Publish to GitHub")?.disabled).toBe(false);
    expect(desc(root, "Publish to GitHub")).toContain("commits the result");
  });
});

describe("opening the preview", () => {
  // It never needed the overlay -- it serves the preview folder and opens it
  // -- but it was only drawn when the overlay was on, so anyone who had not
  // turned on commenting could not open their own preview from here.
  it("is offered whether or not the review overlay is on", () => {
    expect(button(render(), "Open the preview")).not.toBeNull();
    expect(button(render({ overlay: { enabled: true } }), "Open the preview")).not.toBeNull();
  });

  it("says where it is serving, and offers to stop, only while it is", () => {
    const quiet = render();
    expect(quiet.textContent).toContain("Nothing is being served");
    expect(row(quiet, "Stop serving")).toBeNull();

    const live = render({ serving: true });
    expect(live.textContent).toContain("Serving on http://127.0.0.1:7331/");
    // The token the server hands out on the first request is not a thing to
    // print back at the reader.
    expect(live.textContent).not.toContain("t=abc");
    expect(row(live, "Stop serving")).not.toBeNull();
  });
});

describe("redrawing the panel", () => {
  // Every toggle in here calls `display`, which empties the container. That
  // collapses its height, and the scroll position goes with it unless it is
  // taken first and put back.
  /**
   * jsdom lays nothing out: it has no scroll box to collapse, so it never
   * drops the offset and a test against it would pass with the fix taken
   * out. The browser's behaviour is the part that matters, so it is the part
   * standing in here -- emptying the container zeroes its offset, exactly as
   * it does when the content it was scrolled through stops existing.
   */
  function scrollable(root: HTMLElement): { at: () => number; to: (value: number) => void } {
    let at = 0;
    Object.defineProperty(root, "scrollTop", {
      get: () => at,
      set: (value: number) => {
        at = value;
      },
      configurable: true,
    });
    const empty = root.empty.bind(root);
    root.empty = () => {
      empty();
      at = 0;
    };
    return { at: () => at, to: (value) => (at = value) };
  }

  it("keeps the scroll position", () => {
    const tab = new VaultPublisherSettingsTab(app(), host());
    tab.display();
    const box = scrollable(tab.containerEl);
    box.to(900);

    tab.display();

    expect(box.at()).toBe(900);
  });

  // The guard on the guard: with the offset not put back, the redraw leaves
  // the reader at the top, which is the bug this is here about.
  it("would land back at the top without it", () => {
    const tab = new VaultPublisherSettingsTab(app(), host());
    tab.display();
    const box = scrollable(tab.containerEl);
    box.to(900);

    tab.containerEl.empty();

    expect(box.at()).toBe(0);
  });
});
