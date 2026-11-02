/**
 * The parts of the shell that only a narrow screen ever shows.
 *
 * All three ship in every page: the stylesheet decides at which width they
 * appear, so there is one set of markup rather than a mobile copy of the
 * navigation that could drift from the desktop one. What these tests hold is
 * the half of that contract the stylesheet cannot enforce -- that the markup
 * is there, that it is reachable without a script where it can be, and that
 * the outline is not emitted twice under two different names.
 */

import { describe, expect, it } from "vitest";
import { Heading } from "./page";
import { siteCss } from "./theme";
import {
  ShellInput,
  commandBar,
  contextRail,
  inPageMenu,
  statsHeader,
  themeButton,
  vaultPanel,
} from "./shell";

const HEADINGS: Heading[] = [
  { level: 1, id: "title", text: "Atomic notes in practice" },
  { level: 2, id: "why-notes-decay", text: "Why notes decay" },
  { level: 3, id: "one-idea", text: "One idea per note" },
  { level: 4, id: "an-aside", text: "An aside" },
];

function shell(overrides: Partial<ShellInput> = {}): ShellInput {
  return {
    siteName: "A Vault, Published",
    url: "notes/atomic-notes-in-practice.html",
    title: "Atomic notes in practice",
    root: "../",
    nav: [],
    pinned: [],
    recency: [],
    tags: [],
    paths: { browse: "browse.html", tags: "tags.html", tagPrefix: "tags" },
    headings: HEADINGS,
    backlinks: [],
    related: [],
    graph: {
      nodes: [],
      edges: [],
      centre: { title: "Atomic notes in practice", x: 0, y: 0 },
      width: 0,
      height: 0,
    },
    stats: { words: 648, readingMinutes: 3, sections: 4 },
    today: new Date("2026-10-25T12:00:00Z"),
    noteCount: 25,
    hasSource: true,
    ...overrides,
  };
}

describe("the menu button", () => {
  it("is a hamburger, which is what it is on the screens it appears on", () => {
    const bar = commandBar(shell());
    // Three lines. The glyph is the one piece of this button a reader reads.
    expect(bar).toContain('d="M4 7h16M4 12h16M4 17h16"');
    expect(bar).toContain('aria-label="Menu"');
  });

  it("names itself on the attribute, because it never carries a word", () => {
    expect(commandBar(shell())).toContain('aria-controls="osp-panel"');
  });

  it("is last in the bar, which is where it is drawn", () => {
    const bar = commandBar(shell());
    expect(bar.indexOf("osp-brand")).toBeLessThan(bar.indexOf("osp-panel-toggle"));
  });

  it("is enclosed, since it is the only control the narrow bar keeps", () => {
    expect(commandBar(shell())).toContain("osp-btn osp-btn-sq osp-panel-toggle");
  });
});

describe("the bar", () => {
  it("has no search of its own, because the drawer has the field", () => {
    const bar = commandBar(shell());
    expect(bar).not.toContain("data-osp-search-open");
    expect(bar).not.toContain("osp-searchbtn");
  });

  it("keeps the field itself, which full-width mode on a desktop shows", () => {
    expect(commandBar(shell())).toContain("osp-bar-search");
  });
});

/**
 * The way out to the repository, which is one control in two places: the bar
 * at desktop width, the drawer below 56rem, and nowhere at all unless an
 * address has been set.
 */
describe("the source link", () => {
  const SOURCE = "https://github.com/someone/vault";

  it("is absent from both places when no address is set", () => {
    expect(commandBar(shell())).not.toContain("osp-bar-source");
    expect(vaultPanel(shell())).not.toContain("osp-panel-source");
  });

  it("sits beside light and dark in the bar, before it", () => {
    const bar = commandBar(shell({ sourceUrl: SOURCE }));
    expect(bar).toContain(`href="${SOURCE}"`);
    expect(bar.indexOf("osp-bar-actions")).toBeLessThan(bar.indexOf("osp-bar-source"));
    expect(bar.indexOf("osp-bar-source")).toBeLessThan(bar.indexOf("osp-switch"));
  });

  // It leaves the site, and a reader who clicks it is going to come back to
  // the page they were reading.
  it("opens in a tab of its own, and hands nothing on", () => {
    const bar = commandBar(shell({ sourceUrl: SOURCE }));
    expect(bar).toContain('target="_blank"');
    expect(bar).toContain('rel="noreferrer noopener"');
  });

  // The word says what it is; the title says where it goes. Both, because
  // where a link off the site leads is the thing a reader checks before
  // following it, and the word cannot carry an address.
  it("is named by its word and says the address it leads to", () => {
    const bar = commandBar(shell({ sourceUrl: SOURCE }));
    expect(bar).toContain("<span>GitHub repo</span>");
    expect(bar).toContain(`title="${SOURCE}"`);
  });

  // GitHub's own mark, which is the point of having one: a reader should
  // know where this goes without reading the word beside it.
  it("wears the GitHub mark, and says so, for an address GitHub serves", () => {
    const bar = commandBar(shell({ sourceUrl: SOURCE }));
    expect(bar).toContain('viewBox="0 0 16 16"');
    expect(bar).toContain('fill="currentColor"');
    expect(bar).toContain("<span>GitHub repo</span>");
  });

  // And does not wear it anywhere else. A logo on the wrong service is worse
  // than no logo, and the address is a setting that takes any host.
  it("falls back to a branch and a neutral word off GitHub", () => {
    const bar = commandBar(shell({ sourceUrl: "https://gitlab.com/team/vault" }));
    expect(bar).toContain('d="M6 3v12"');
    expect(bar).not.toContain("GitHub repo");
    expect(bar).toContain("<span>Source repo</span>");
  });

  // The word is the bar's. The drawer's copy is a square beside the close,
  // where a label would be taking width off the search field.
  it("carries no word in the drawer", () => {
    const panel = vaultPanel(shell({ sourceUrl: SOURCE }));
    expect(panel).toContain("osp-panel-source-btn");
    expect(panel).not.toContain("<span>GitHub repo</span>");
    expect(panel).toContain('aria-label="GitHub repo"');
  });

  /*
   * The height is the one thing about this control that is not its own.
   * It sits a row above the read/markdown toggle and has to match it, and
   * that height is nowhere written down -- it is the toggle's padding, the
   * padding of the button inside it, and the rule around the pair. So the
   * link is built from the same three, and this is the test that notices
   * when one side of that moves and the other does not.
   */
  it("is built to the view toggle's height rather than to a number of its own", () => {
    const css = siteCss();
    const block = (selector: string) =>
      new RegExp(`\\${selector} \\{[^}]*\\}`).exec(css)?.[0] ?? "";

    const seg = block(".osp-seg");
    const segBtn = block(".osp-seg-btn");
    const source = block(".osp-bar-source");

    expect(seg).toContain("padding: 0.13rem;");
    expect(segBtn).toContain("padding: 0.2rem 0.45rem;");
    expect(source).toContain("padding: calc(0.13rem + 0.2rem) calc(0.13rem + 0.45rem);");
    // The rest of the sum: the same rule around it, the same text inside it.
    for (const rule of [seg, source]) {
      expect(rule).toContain("border: var(--osp-rule) solid var(--osp-border);");
    }
    for (const rule of [segBtn, source]) {
      expect(rule).toContain("font-size: var(--osp-ui-xs);");
      expect(rule).toContain("line-height: 1.4;");
    }
  });

  it("comes back in the drawer, where the bar's controls are gone", () => {
    const panel = vaultPanel(shell({ sourceUrl: SOURCE }));
    expect(panel).toContain("osp-panel-source");
    expect(panel.indexOf("data-osp-search-input")).toBeLessThan(
      panel.indexOf("osp-panel-source"),
    );
    expect(panel.indexOf("osp-panel-source")).toBeLessThan(
      panel.indexOf("osp-panel-theme"),
    );
    expect(panel.indexOf("osp-panel-theme")).toBeLessThan(
      panel.indexOf("data-osp-panel-close"),
    );
  });

  it("escapes the address, which is a value somebody typed", () => {
    const bar = commandBar(shell({ sourceUrl: 'https://example.com/a?b=1&c="x"' }));
    expect(bar).toContain('href="https://example.com/a?b=1&amp;c=&quot;x&quot;"');
  });
});

describe("the drawer's head", () => {
  it("puts the search field above the tree", () => {
    const panel = vaultPanel(shell());
    expect(panel.indexOf("data-osp-search-input")).toBeLessThan(
      panel.indexOf("osp-panel-body"),
    );
  });

  it("carries light and dark beside the way out", () => {
    const panel = vaultPanel(shell());
    expect(panel).toContain("osp-panel-theme");
    expect(panel.indexOf("osp-panel-theme")).toBeLessThan(
      panel.indexOf("data-osp-panel-close"),
    );
  });

  it("draws the pair as two of the same square", () => {
    const panel = vaultPanel(shell());
    expect(panel).toContain("osp-btn osp-btn-sq osp-theme-btn");
    expect(panel).toContain("osp-btn osp-btn-sq osp-panel-close");
  });

  it("ships both theme glyphs, so the swap is a rule and not a rewrite", () => {
    const markup = themeButton();
    expect(markup).toContain("osp-theme-sun");
    expect(markup).toContain("osp-theme-moon");
    // The script paints this attribute on every control carrying the
    // toggle, and the stylesheet picks the glyph off it.
    expect(markup).toContain("data-osp-theme-toggle");
    expect(markup).toContain('aria-checked="false"');
  });
});

describe("the search field's clear", () => {
  it("ships hidden, because an empty field has nothing to clear", () => {
    const panel = vaultPanel(shell());
    const at = panel.indexOf("data-osp-search-clear");
    expect(at).toBeGreaterThan(-1);
    expect(panel.slice(at, at + 60)).toContain("hidden");
  });

  it("comes after the field, which is the end it is drawn at", () => {
    const panel = vaultPanel(shell());
    expect(panel.indexOf("data-osp-search-input")).toBeLessThan(
      panel.indexOf("data-osp-search-clear"),
    );
  });

  it("is named, since it never carries a word", () => {
    expect(vaultPanel(shell())).toContain('aria-label="Clear search"');
  });
});

describe("the note's stats", () => {
  it("say the same thing in the rail and at the head of the note", () => {
    const input = shell();
    const top = statsHeader(input);
    const rail = contextRail(input);
    for (const fact of ["3 min", "648 words", "4 sections"]) {
      expect(top).toContain(fact);
      expect(rail).toContain(fact);
    }
  });

  it("say nothing on a page the build wrote itself", () => {
    const made = shell({ stats: { words: 0, readingMinutes: 1, sections: 0 } });
    expect(statsHeader(made)).toBe("");
    expect(contextRail(made)).not.toContain("osp-stats");
  });

  it("are two copies the stylesheet can tell apart", () => {
    expect(statsHeader(shell())).toContain("osp-stats-top");
    expect(contextRail(shell())).toContain("osp-stats-rail");
  });
});

describe("the local graph", () => {
  const WITH_LINKS = {
    nodes: [
      { url: "notes/why-notes-decay.html", title: "Why notes decay", x: 10, y: 10, direction: "in" as const },
    ],
    edges: [],
    centre: { title: "Atomic notes in practice", x: 50, y: 50 },
    width: 100,
    height: 100,
  };

  it("is a section of the rail, with no control anywhere to reach it", () => {
    const rail = contextRail(shell({ graph: WITH_LINKS }));
    expect(rail).toContain("Local graph");
    expect(rail).toContain("osp-rail-section osp-rail-graph");
    expect(commandBar(shell({ graph: WITH_LINKS }))).not.toContain("data-osp-graph");
  });

  it("draws the picture and names every node under it", () => {
    const rail = contextRail(shell({ graph: WITH_LINKS }));
    expect(rail).toContain("<svg class=\"osp-graph\"");
    expect(rail).toContain("osp-graph-key");
    expect(rail).toContain("Why notes decay");
    // A concatenation that drops a term renders the term rather than
    // failing, which is how a stray `+` became the word NaN on the page.
    expect(rail).not.toContain("NaN");
    expect(rail).not.toContain("undefined");
  });

  it("is the last thing in the rail, under what links here", () => {
    const rail = contextRail(
      shell({
        graph: WITH_LINKS,
        backlinks: [{ url: "notes/why-notes-decay.html", title: "Why notes decay", excerpt: "" }],
      }),
    );
    expect(rail.indexOf("Linked from")).toBeLessThan(rail.indexOf("Local graph"));
  });

  it("is absent, rather than empty, on a note nothing links to", () => {
    expect(contextRail(shell())).not.toContain("Local graph");
  });
});

describe("the in-page menu", () => {
  it("is the outline, as a control that opens with no script", () => {
    const markup = inPageMenu(shell());
    expect(markup).toContain("<details");
    expect(markup).toContain("<summary");
    expect(markup).toContain('href="#why-notes-decay"');
    expect(markup).toContain('href="#one-idea"');
  });

  it("takes the same two levels the rail does, and no others", () => {
    const markup = inPageMenu(shell());
    expect(markup).not.toContain('href="#title"');
    expect(markup).not.toContain('href="#an-aside"');
  });

  it("names the first section before any script has read the scroll", () => {
    // Shut and unscripted the row still says something true: a reader who
    // has not scrolled is at the top, which is where the first heading is.
    expect(inPageMenu(shell())).toContain(
      '<span class="osp-inpage-now" data-osp-inpage-now>Why notes decay</span>',
    );
  });

  it("marks its anchors for the same scrollspy the rail uses", () => {
    expect(inPageMenu(shell())).toContain('data-osp-spy="why-notes-decay"');
  });

  it("is absent from a page with nothing to list", () => {
    const flat = shell({ headings: [{ level: 1, id: "t", text: "Browse" }] });
    expect(inPageMenu(flat)).toBe("");
  });

  it("escapes a heading that is text rather than markup", () => {
    const risky = shell({
      headings: [{ level: 2, id: "x", text: '<img src=x onerror="alert(1)">' }],
    });
    const markup = inPageMenu(risky);
    expect(markup).not.toContain("<img");
    expect(markup).toContain("&lt;img");
  });
});
