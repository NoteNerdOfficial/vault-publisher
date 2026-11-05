/**
 * Checking what actually came out.
 *
 * "It rendered" is not one question. A Dataview block can produce a correct
 * table, an explicit error, or an empty result that looks like success, and
 * only the first is publishable. Each probe therefore names the markup it
 * expects *and* what counts as hollow output, so the render report can tell
 * "worked", "failed" and "silently produced nothing" apart.
 */

export type ProbeVerdict = "ok" | "partial" | "empty" | "error" | "blocked" | "missing";

export interface Probe {
  /** Feature this probe is evidence for, e.g. "dataview-table". */
  id: string;
  /** Markup that must be present for the feature to have rendered at all. */
  present: string;
  /** Within a present match, markup that means a real result. */
  nonEmpty?: string;
  /**
   * Markup that means a failure, looked for *inside* each `present` match.
   * Scoped rather than document-wide on purpose: one deliberately broken
   * Dataview query used to mark every other block in the same note as failed,
   * which hid the fact that the good queries rendered correctly.
   */
  errored?: string;
  /**
   * Markup meaning the feature was blocked by Obsidian rather than broken,
   * e.g. the Mermaid vault-trust guard. Reported apart from an error because
   * the fix is consent, not code.
   */
  blocked?: string;
}

export const PROBES: Probe[] = [
  // Every Dataview block, whatever shape its result takes. The shape-specific
  // probes below miss a query that failed to parse, since a block with a
  // syntax error renders neither a table nor a list.
  {
    id: "dataview-block",
    present: ".block-language-dataview",
    nonEmpty: "table, ul, li, p, span",
    errored: ".dataview-error, .dataview-error-box",
  },
  // Each Dataview block renders inside .block-language-dataview, so scoping
  // to that container is what keeps one broken query from being blamed on
  // its neighbours. :has() picks the table-shaped results out of the rest.
  {
    id: "dataview-table",
    present: ".block-language-dataview:has(table)",
    nonEmpty: "tbody tr, tr",
    errored: ".dataview-error, .dataview-error-box",
  },
  {
    id: "dataview-list",
    present: ".block-language-dataview:has(ul):not(:has(table))",
    nonEmpty: "li",
    errored: ".dataview-error, .dataview-error-box",
  },
  // Inline queries are substituted in place, so the evidence is the span
  // Dataview leaves behind rather than a block wrapper.
  {
    id: "dataview-inline",
    present: ".dataview-inline-query, span.dataview.dataview-inline-query",
    errored: ".dataview-error",
  },
  // dataviewjs output has no fixed shape -- the script decides -- so the
  // probe only asserts the block container exists and holds something.
  {
    id: "dataviewjs",
    present: ".block-language-dataviewjs",
    nonEmpty: "*",
    errored: ".dataview-error, .dataview-error-box",
  },
  // Obsidian hands mermaid code blocks to Mermaid, which replaces them with
  // an inline <svg> inside .mermaid-wrapper. Since 1.14 that wrapper can
  // instead carry .is-guarded: diagrams are gated per vault behind a consent
  // prompt, so an unrendered diagram is usually permission, not breakage.
  {
    id: "mermaid",
    present: ".mermaid-wrapper, .mermaid, svg[aria-roledescription]",
    nonEmpty: "svg g, svg path, svg rect, svg text",
    blocked: ".mermaid-guard-header, .mermaid-guard-title",
  },
  // Bases renders a toolbar plus a view into .bases-* containers, reached
  // either from a .base file embed or from a ```base code block.
  {
    id: "bases",
    present: ".bases-embed, .bases-view, .block-language-base, .bases-header",
    nonEmpty: "tr, .bases-cards-item, .bases-tbody, [class*='row']",
  },
  { id: "callout", present: ".callout", nonEmpty: ".callout-content, .callout-title" },
  { id: "math", present: "mjx-container, .math", nonEmpty: "*" },
  { id: "internal-link", present: "a.internal-link" },
  // Transclusion is lazy: an embed that never became .is-loaded rendered its
  // wrapper and nothing else, which is a publish-time failure.
  {
    id: "embed",
    present: ".internal-embed, .markdown-embed",
    nonEmpty: ".markdown-embed-content, .markdown-preview-view, p, table, div, span",
  },
  { id: "image", present: "img, .image-embed" },
  { id: "task", present: ".task-list-item, input[type='checkbox']" },
  { id: "code", present: "pre > code" },
  { id: "table", present: "table:not(.dataview)", nonEmpty: "tbody tr" },
  // A mermaid code block left as a <pre> is the signature of a diagram that
  // never got handed off, whatever the reason.
  { id: "unrendered-mermaid-src", present: "pre > code.language-mermaid" },
];

export interface ProbeResult {
  id: string;
  /** Worst verdict across the blocks found, so a note's row cannot look clean
   * while one of its blocks failed. */
  verdict: ProbeVerdict;
  /** How many `present` matches were found. */
  count: number;
  /** Per-block tally, e.g. { ok: 2, empty: 1 }. */
  breakdown: Partial<Record<ProbeVerdict, number>>;
  note: string;
}

/** Dataview reports "no results" through the same element as a real failure,
 * so the text is what separates an empty query from a broken one. */
const EMPTY_RESULT_TEXT = /no results to show/i;

/** Worst-first, so a note's single verdict is its most serious block. */
const SEVERITY: ProbeVerdict[] = [
  "error",
  "blocked",
  "empty",
  "partial",
  "ok",
  "missing",
];

function classifyMatch(el: Element, probe: Probe): { verdict: ProbeVerdict; note: string } {
  if (probe.blocked && el.querySelector(probe.blocked)) {
    return { verdict: "blocked", note: el.querySelector(probe.blocked)?.textContent?.trim().slice(0, 160) ?? "" };
  }

  if (probe.errored) {
    const errorEl = el.querySelector(probe.errored);
    if (errorEl) {
      const text = errorEl.textContent?.trim() ?? "";
      const verdict: ProbeVerdict = EMPTY_RESULT_TEXT.test(text) ? "empty" : "error";
      return { verdict, note: text.slice(0, 300) };
    }
  }

  if (probe.nonEmpty && !el.querySelector(probe.nonEmpty)) {
    return { verdict: "empty", note: `no ${probe.nonEmpty}` };
  }

  return { verdict: "ok", note: "" };
}

/**
 * Runs the probes against rendered HTML. Parsed with DOMParser rather than
 * queried on the live container so this can also be run later against
 * serialized output, which is what the publish pipeline will hold -- and so
 * that nesting the parser would rearrange shows up here rather than only in
 * a browser.
 */
export function probeHtml(html: string, only?: string[]): ProbeResult[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const probes = only ? PROBES.filter((p) => only.includes(p.id)) : PROBES;

  return probes.map((probe) => {
    const matches = Array.from(doc.body.querySelectorAll(probe.present));

    if (!matches.length) {
      return {
        id: probe.id,
        verdict: "missing",
        count: 0,
        breakdown: {},
        note: "no match",
      };
    }

    const breakdown: Partial<Record<ProbeVerdict, number>> = {};
    const notes: string[] = [];
    for (const el of matches) {
      const { verdict, note } = classifyMatch(el, probe);
      breakdown[verdict] = (breakdown[verdict] ?? 0) + 1;
      if (note) notes.push(note);
    }

    const worst =
      SEVERITY.find((v) => breakdown[v]) ?? ("ok" as ProbeVerdict);
    // A mix of good and bad blocks is its own result: "partial" says the
    // feature works and something in this note still needs looking at.
    const verdict: ProbeVerdict =
      worst !== "ok" && breakdown.ok ? "partial" : worst;

    return {
      id: probe.id,
      verdict,
      count: matches.length,
      breakdown,
      note: notes.slice(0, 2).join(" | "),
    };
  });
}

/**
 * Markup that survives serialization but cannot work in a static page. Each
 * of these is a decision the design has to make, so the report counts them
 * rather than stripping them silently.
 */
export interface StaticHazards {
  /** Inline handlers, dead once the page leaves Obsidian. */
  inlineHandlers: number;
  /** Elements whose styling comes from a CSS variable we must also ship. */
  cssVarReferences: number;
  /** app:// URLs, which only resolve inside Obsidian. */
  appUrls: number;
  /** Buttons and inputs that had JS listeners attached, now inert. */
  interactiveControls: number;
  /** data-* attributes plugins use to rehydrate, evidence of lost behaviour. */
  rehydrationHooks: number;
}

export function findStaticHazards(html: string): StaticHazards {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const all = Array.from(doc.body.querySelectorAll("*"));

  let inlineHandlers = 0;
  let cssVarReferences = 0;
  let rehydrationHooks = 0;

  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith("on")) inlineHandlers++;
      if (attr.name === "style" && attr.value.includes("var(--")) cssVarReferences++;
      if (attr.name.startsWith("data-")) rehydrationHooks++;
    }
  }

  return {
    inlineHandlers,
    cssVarReferences,
    appUrls: (html.match(/app:\/\//g) ?? []).length,
    interactiveControls: doc.body.querySelectorAll("button, input, select, textarea")
      .length,
    rehydrationHooks,
  };
}
