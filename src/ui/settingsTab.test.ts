// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from "vitest";
import { installObsidianDom } from "../../test/obsidian-stub";
import { RELATED_PLUGINS, SettingsHost, VaultPublisherSettingsTab } from "./settingsTab";
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
  sourceLink?: Partial<SettingsHost["settings"]["sourceLink"]>;
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
      sourceLink: { enabled: false, url: "", ...over.sourceLink },
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
      "Password",
      "On startup",
      "Related plugins",
    ]);
    // Review appears below GitHub once there is an overlay to configure.
    expect(sections(render({ overlay: { enabled: true } }))).toEqual([
      "Preview and publish",
      "What to publish",
      "Appearance",
      "GitHub",
      "Password",
      "Review",
      "Issue tracker",
      "On startup",
      "Related plugins",
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
      // Always shown, like every other section: the panel does not
      // rearrange itself as setup progresses.
      "Password",
      "On startup",
      "Related plugins",
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

/**
 * The overlay switch is an argument to the build, not a feature of its own:
 * `buildToPreview` reads it on the way past and hands the build a review
 * layer or nothing. These are the three things that has to mean.
 */
describe("the review overlay, as a build option", () => {
  /** Every row in the panel, by name, in the order it is drawn. */
  function rows(root: HTMLElement): string[] {
    return Array.from(root.querySelectorAll(".setting-item")).map(
      (node) => node.querySelector(".setting-item-name")?.textContent ?? "",
    );
  }

  it("sits with the build button, not in a section of its own", () => {
    const names = rows(render());
    expect(names.indexOf("Include a review overlay")).toBe(
      names.indexOf("Build a preview") + 1,
    );
    // And is no longer anywhere near the review settings.
    expect(names).not.toContain("Add a review overlay to previews");
  });

  // A button whose row describes a build it is not about to make is the
  // thing that put the switch three sections away in the first place.
  it("changes what the build row says it will build", () => {
    expect(desc(render(), "Build a preview")).toBe(
      "Renders the site into a folder in this vault. Nothing is sent to GitHub.",
    );
    expect(desc(render({ overlay: { enabled: true } }), "Build a preview")).toContain(
      "with the review overlay on it",
    );
  });

  // Turning it on is what brings the review settings into existence; off,
  // there is no section standing empty behind one switch.
  it("is the only trace of reviewing until it is on", () => {
    const off = render();
    expect(row(off, "Review folder")).toBeNull();
    expect(row(off, "Import review comments")).toBeNull();

    const on = render({ overlay: { enabled: true } });
    expect(row(on, "Review folder")).not.toBeNull();
    expect(row(on, "Import review comments")).not.toBeNull();
  });
});

/**
 * The link out to the source repository.
 *
 * Two settings for what reads as one feature, because the address is a guess
 * the user has to be able to correct: the repository a site is pushed to is
 * often not the one its source is in.
 */
/**
 * The folders left out of whatever the scope took in. The second half of the
 * Scope sentence, and the first setting that lets a vault be published whole
 * without publishing all of it.
 */
describe("excluded folders", () => {
  function field(root: HTMLElement): HTMLTextAreaElement | null {
    return row(root, "Exclude folders")?.querySelector("textarea") ?? null;
  }

  it("is offered at every scope, not only for a vault published whole", () => {
    expect(field(render({ site: { folder: "" } }))).not.toBeNull();
    expect(field(render({ site: { folder: "notes" } }))).not.toBeNull();
  });

  it("shows the stored list one path per line", () => {
    const panel = render({ site: { folder: "", excludeFolders: ["Journal", "People"] } });
    expect(field(panel)?.value).toBe("Journal\nPeople");
  });

  // A list of paths is written one per line, and a folder is allowed a
  // comma in its name -- so what is typed is split on lines and tidied.
  it("stores what was typed as a clean list", async () => {
    const target = host({ site: { folder: "" } });
    const tab = new VaultPublisherSettingsTab(app(), target);
    tab.display();

    const input = field(tab.containerEl);
    if (!input) throw new Error("no field");
    input.value = " Journal/ \n\n/People\n";
    input.dispatchEvent(new Event("input"));

    expect(target.settings.site.excludeFolders).toEqual(["Journal", "People"]);
  });

  // "Publish notes, except notes." The build's honest answer is an empty
  // site, and this is the only place where saying so is free.
  it("warns when an entry takes out the whole scope", () => {
    const panel = render({ site: { folder: "notes", excludeFolders: ["notes"] } });
    expect(panel.querySelector(".osp-settings-warning")?.textContent).toContain(
      "contains everything you are publishing",
    );
  });

  it("says nothing about a subtraction inside the scope", () => {
    const panel = render({
      site: { folder: "notes", excludeFolders: ["notes/private"] },
    });
    // Named, rather than "no warnings at all": the panel warns about other
    // things, and a test that forbade all of them would fail for reasons
    // that have nothing to do with this row.
    expect(panel.textContent).not.toContain("contains everything you are publishing");
  });

  // The honest half of the feature: this is a list of what to leave out, so
  // a folder added tomorrow is published unless somebody remembers.
  it("says which of the two settings fails safe", () => {
    expect(desc(render(), "Exclude folders")).toContain("fails safe");
  });
});

describe("the source repository link", () => {
  /** The panel's notes and warnings, which is where the answer is printed. */
  function notes(root: HTMLElement): string {
    return Array.from(root.querySelectorAll(".osp-settings-note"))
      .map((node) => node.textContent ?? "")
      .join("\n");
  }

  it("is one row until it is switched on", () => {
    const off = render();
    expect(row(off, "Link to the source repository")).not.toBeNull();
    expect(row(off, "Repository address")).toBeNull();

    expect(row(render({ sourceLink: { enabled: true } }), "Repository address")).not.toBeNull();
  });

  // The common case: a vault published to the repository its source is in,
  // where the address is already known and should not have to be typed.
  it("says it will use the repository the site publishes to", () => {
    expect(notes(render({ sourceLink: { enabled: true } }))).toContain(
      "https://github.com/acme/handbook, the repository you publish to",
    );
  });

  it("says where a typed address leads instead", () => {
    const panel = render({
      sourceLink: { enabled: true, url: "https://gitlab.com/team/vault" },
    });
    expect(notes(panel)).toContain("https://gitlab.com/team/vault");
    expect(notes(panel)).not.toContain("the repository you publish to");
  });

  /*
   * The value is written into an href on every page of the site, so this is
   * the row where a scheme a browser would *run* has to be refused -- and
   * refused out loud, since the build's answer is to leave the button out
   * and say nothing.
   */
  it("warns about an address no browser should follow", () => {
    const panel = render({
      sourceLink: { enabled: true, url: "javascript:alert(1)" },
    });
    expect(panel.querySelector(".osp-settings-warning")).not.toBeNull();
    expect(notes(panel)).toContain("http");
  });

  it("warns about a full address that is not one", () => {
    expect(notes(render({ sourceLink: { enabled: true, url: "github.com/a/b" } }))).toContain(
      "https://",
    );
  });

  // Switched on with nothing to point at. No address means no button, so the
  // panel is the only place that can say why.
  it("says no button will be built when there is no address at all", () => {
    const panel = render({
      sourceLink: { enabled: true },
      github: { owner: "", repo: "" },
    });
    expect(notes(panel)).toContain("no button is built");
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

  // The state belongs to the row, so it is said in the row's own
  // description rather than in a bare line underneath it: a paragraph
  // outside a settings row sits outside the inset every other piece of text
  // in the panel lines up with, and under a card-drawing theme it collides
  // with the card above.
  it("says where it is serving, and offers to stop, only while it is", () => {
    const quiet = render();
    expect(desc(quiet, "Open the preview")).toContain("Nothing outside this machine");
    expect(row(quiet, "Stop serving")).toBeNull();

    const live = render({ serving: true });
    expect(desc(live, "Open the preview")).toContain("Serving on http://127.0.0.1:7331/");
    expect(row(live, "Stop serving")).not.toBeNull();
  });

  // The token the server hands out on the first request is not a thing to
  // print back at the reader.
  it("keeps the server's token out of what it prints", () => {
    expect(render({ serving: true }).textContent).not.toContain("t=abc");
  });
});

/**
 * The panel is drawn with Obsidian's own `Setting` rows and some prose
 * between them, and the prose is the part that can be got wrong: it is
 * hand-styled, and what it has to sit against is the theme's business.
 *
 * Default Obsidian separates rows with a rule. Plenty of themes draw each
 * row as a card instead. A negative top margin closes the gap under a rule
 * and drives the paragraph into the bottom edge of a card, so there is no
 * value that works for both -- only zero or more does.
 */
describe("the spacing between rows", () => {
  /** Everything in the panel carrying a hand-written style. */
  function styled(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll("[style]")) as HTMLElement[];
  }

  it("never pulls a block up into whatever is above it", () => {
    // Drawn with everything turned on, so every optional block is present.
    const root = render({
      overlay: { enabled: true },
      site: { siteName: "", folder: null },
      github: { token: "", owner: "", repo: "" },
      tokenState: "locked",
      serving: true,
    });

    const pulled = styled(root)
      .map((node) => node.style.marginTop)
      .filter((value) => value.startsWith("-"));

    expect(pulled).toEqual([]);
  });

  /*
   * The alignment guarantee, and the reason it is structural rather than a
   * number. A div dropped into the container sits at the outer edge of a
   * settings row, while a row insets its own text by whatever padding the
   * theme gives it -- so prose written as a bare div lines up with the
   * row's edge and with none of the words in it. Assembling it out of the
   * elements the theme already styles is what makes the inset the theme's
   * to decide.
   */
  it("builds its prose out of the parts the theme indents", () => {
    const root = render({ overlay: { enabled: true } });
    const notes = Array.from(root.querySelectorAll(".osp-settings-note"));

    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(note.classList.contains("setting-item")).toBe(true);
      expect(note.querySelector(".setting-item-info > .setting-item-description"))
        .not.toBeNull();
    }

    // And nothing is left putting prose straight into the container. The
    // theme specimen is exempt and says so by name: it is a card of its
    // own, so it lines up with the edges of the rows and not with the text
    // inside them.
    const bare = Array.from(root.children).filter(
      (node) =>
        !node.classList.contains("setting-item") &&
        !node.classList.contains("osp-theme-specimen") &&
        (node.textContent ?? "").length > 40,
    );
    expect(bare).toEqual([]);
  });

  // A 2px coloured rule reads as a decorated card of its own; the colour is
  // already saying this one is different.
  it("marks a warning with a hairline, not a bar", () => {
    const root = render({ github: { token: "" }, tokenState: "locked" });
    const warning = root.querySelector(
      ".osp-settings-warning .setting-item-description",
    ) as HTMLElement;

    expect(warning).not.toBeNull();
    expect(warning.style.borderLeft).toBe("1px solid var(--text-warning)");
  });

  // An empty progress line and an empty 4px track, drawn under the heading
  // before anything has been built, read as a stray section divider over a
  // band of dead space.
  it("shows nothing of the progress readout until there is progress", () => {
    const fake = host();
    const tab = new VaultPublisherSettingsTab(app(), fake);
    tab.display();

    const bar = tab.containerEl.querySelector(
      "[style*='background: var(--interactive-accent)']",
    ) as HTMLElement;
    expect(bar).not.toBeNull();
    const readout = bar.parentElement?.parentElement as HTMLElement;
    expect(readout.style.display).toBe("none");

    fake.progress?.("Rendering 3 of 40", 3, 40);
    expect(readout.style.display).toBe("block");
    expect(readout.textContent).toContain("Rendering 3 of 40");
    expect(bar.style.width).toBe("8%");
  });
});

/**
 * The only section that is not about this plugin. It is last on purpose,
 * and it is a list of links rather than anything that acts: nothing here
 * reaches the network, reads which plugins are installed, or reports that
 * it was shown.
 */
describe("related plugins", () => {
  it("comes last, after even the startup behaviour", () => {
    const order = sections(render());
    expect(order[order.length - 1]).toBe("Related plugins");
  });

  it("offers each one as a link out to its community listing", () => {
    const root = render();
    const rows = Array.from(root.querySelectorAll(".osp-related-plugin"));

    expect(rows.map((node) => node.querySelector(".setting-item-name")?.textContent)).toEqual([
      "Convert to Markdown",
      "Terminus",
      "AI Skills Manager",
      "Browser Bookmark",
      "Working tabs",
      "Unhidden",
    ]);
    for (const node of rows) {
      expect(node.querySelector("button")?.textContent).toBe("View plugin");
    }
  });

  // The mark a plugin carries on its own ribbon, ahead of its name, where a
  // reader looks for what a row is about. The name is already there for
  // anything that cannot see it, so the tile is hidden from assistive tech.
  it("leads each row with an icon tile that is not read aloud", () => {
    const tiles = Array.from(
      render().querySelectorAll(".osp-related-plugin-icon"),
    ) as HTMLElement[];

    expect(tiles.map((node) => node.getAttribute("data-icon"))).toEqual([
      "file-text",
      "square-terminal",
      "shapes",
      "bookmark",
      "layout-panel-left",
      "eye",
    ]);
    for (const tile of tiles) {
      expect(tile.getAttribute("aria-hidden")).toBe("true");
      // First child of the row, before the name.
      expect(tile.parentElement?.firstElementChild).toBe(tile);
    }
  });

  // Every URL is a community listing, so a typo cannot send someone
  // somewhere else entirely.
  it("points only at community.obsidian.md", () => {
    for (const plugin of RELATED_PLUGINS) {
      expect(plugin.url).toMatch(/^https:\/\/community\.obsidian\.md\/plugins\/[a-z0-9-]+$/);
    }
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
