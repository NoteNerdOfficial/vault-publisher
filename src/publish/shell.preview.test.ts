/**
 * Not a test of behaviour: a way to look at the real shell.
 *
 * It renders a page through the same `buildPage`, `shell.ts` and `siteCss`
 * the publisher uses, with fixture data, and writes it where a browser can
 * open it. Guarded by an environment variable so an ordinary `npm test` does
 * not write files.
 *
 *   OSP_PREVIEW=/tmp/preview npx vitest run shell.preview
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLocalGraph } from "./graph";
import {
  LandingInput,
  LandingNote,
  browseContent,
  exploreContent,
  overviewContent,
  sitePaths,
  tagPageContent,
  tagUrls,
  tagsIndexContent,
} from "./landing";
import { NavNote, buildNavTree, collectTags, recencyBuckets } from "./nav";
import { buildPage, prepareCodeBlocks, prepareTables } from "./page";
import { folderSlug } from "./shell";
import { siteCss } from "./theme";

const TODAY = new Date("2026-10-25T12:00:00Z");

function note(url: string, title: string, updated: string | null, pinned = false): NavNote {
  const slash = url.lastIndexOf("/");
  return { url, title, folder: slash === -1 ? "" : url.slice(0, slash), updated, pinned };
}

const BATCH = "2026-10-25T09:41";

const NOTES: NavNote[] = [
  note("index-home.html", "Home", "2026-10-20T09:15", true),
  note("notes/atomic-notes-in-practice.html", "Atomic notes in practice", "2026-10-24T18:40", true),
  note("notes/linking-your-thinking.html", "Linking your thinking", "2026-10-18T11:02"),
  note("notes/evergreen-notes-grow.html", "Evergreen notes grow", "2026-10-22T08:30"),
  note("notes/why-notes-decay.html", "Why notes decay", "2026-09-30T16:25"),
  note("projects/reading-queue.html", "Reading queue", "2026-10-21T20:00"),
  note("projects/vault-site/design-notes.html", "Design notes", "2026-10-23T14:05"),
  note("projects/vault-site/open-questions.html", "Open questions", "2026-10-19T10:11"),
  note("reference/glossary.html", "Glossary", "2026-10-09T17:20", true),
  note("reference/markdown-syntax.html", "Markdown syntax", "2026-08-14T12:00"),
  ...Array.from({ length: 14 }, (_, i) =>
    note(`archive/note-${i + 1}.html`, `Archived idea ${i + 1}`, BATCH),
  ),
  note("clippings/rewriting-is-thinking.html", "Rewriting is thinking", "2026-10-25T08:12"),
];

const CONTENT = `
<p>A note is worth keeping when it says one thing, and says it well enough
that you can use it without rereading the thing it came from.</p>
<h2 id="why-notes-decay">Why notes decay</h2>
<p>A note decays when its title stops predicting its contents. <em>Chapter 4
thoughts</em> predicts nothing, so it is never opened, so it is never revised.</p>
<div class="callout"><div class="callout-title"><span>The title test</span></div>
<p>If the title is not a claim, a question, or a name you would use out loud,
the note is not finished.</p></div>
<h2 id="atomic-by-default">Atomic by default</h2>
<p>Atomic does not mean short. It means the note has one job, so that linking
to it means something specific.</p>
<h3 id="one-idea-per-note">One idea per note</h3>
<p>The practical test is whether two different notes would link here for two
different reasons.</p>
<h3 id="titles-are-the-interface">Titles are the interface</h3>
<table><thead><tr><th>Weak title</th><th>Stronger title</th></tr></thead>
<tbody><tr><td>Caching</td><td>A cache without an eviction policy is a leak</td></tr></tbody></table>
<h2 id="links-are-the-structure">Links are the structure</h2>
<p>Folders describe where a note lives. Links describe what it has to do with
anything.</p>
<pre><code>![[Evergreen notes grow]]   # the title carries it</code></pre>
<h2 id="what-it-looks-like">What it looks like in practice</h2>
<p>Three habits, in the order they pay off.</p>
<h2 id="what-a-note-carries">Everything else a note carries</h2>
<p>Marks the markdown has but prose rarely shows at once: a <mark>highlight</mark>,
a <kbd>⌘K</kbd>, a <del>retraction</del>, and a footnote.<sup class="footnote-ref">
<a href="#fn-1" id="fnref-1">[1]</a></sup></p>
<blockquote><p>A note that cannot be found is a note that was not written.</p></blockquote>
<ul class="contains-task-list">
<li class="task-list-item"><input type="checkbox"> Rewrite the titles that predict nothing</li>
<li class="task-list-item is-checked"><input type="checkbox" checked> Link the four notes that were orphaned</li>
</ul>
<hr>
<h3 id="a-table-of-numbers">A table of numbers</h3>
<table><thead><tr><th>Folder</th><th>Notes</th><th>Words</th><th>Links out</th></tr></thead>
<tbody>
<tr><td>notes</td><td>124</td><td>41,208</td><td>302</td></tr>
<tr><td>projects</td><td>38</td><td>9,540</td><td>96</td></tr>
<tr><td>archive</td><td>1,017</td><td>212,744</td><td>8</td></tr>
</tbody></table>
<h2 id="code-as-rendered">Code, as the page renders it</h2>
<p>Inline <code>siteCss(theme)</code> sits inside a sentence, so its background
and padding have to agree with the line around it rather than push it apart.</p>
<pre><code class="language-ts">export function siteCss(theme: string): string {
  const palette = themes[theme] ?? themes.press;
  return [reset(palette), typography(), rendered()].join("\\n");
}
</code></pre>
<p>A line wider than the column scrolls inside its own block, and must not
widen the page or the rail beside it.</p>
<pre><code class="language-sh">OSP_PREVIEW=/tmp/preview npx vitest run shell.preview &amp;&amp; open /tmp/preview/notes/atomic-notes-in-practice.html  # deliberately too long for the column
</code></pre>
<p>Two things reach the HTML that no reader should see: the copy control
Obsidian puts in every code block, and the note's own frontmatter. The
stylesheet hides both, so nothing should appear between here and the end.</p>
<pre><code class="language-txt">A block carrying Obsidian's copy control.</code><button class="copy-code-button">Copy</button></pre>
<pre class="frontmatter language-yaml">status: draft
client: Fabricated Holdings
rate: 000</pre>
<section class="footnotes"><ol>
<li id="fn-1"><p>Which is the argument for the jump panel, not against
folders.</p><a class="footnote-backref" href="#fnref-1">↩</a></li>
</ol></section>
`;

/**
 * The build runs these over the rendered DOM before the page is assembled;
 * the preview is handed a string, so it runs them here. Without this the
 * preview would show code blocks and tables the publisher never ships.
 */
function prepared(html: string): string {
  const root = document.createElement("div");
  root.innerHTML = html;
  prepareCodeBlocks(root);
  prepareTables(root);
  return root.innerHTML;
}

const HEADINGS = [
  { level: 2, text: "Why notes decay", id: "why-notes-decay" },
  { level: 2, text: "Atomic by default", id: "atomic-by-default" },
  { level: 3, text: "One idea per note", id: "one-idea-per-note" },
  { level: 3, text: "Titles are the interface", id: "titles-are-the-interface" },
  { level: 2, text: "Links are the structure", id: "links-are-the-structure" },
  { level: 2, text: "What it looks like in practice", id: "what-it-looks-like" },
  { level: 2, text: "Everything else a note carries", id: "what-a-note-carries" },
  { level: 3, text: "A table of numbers", id: "a-table-of-numbers" },
  { level: 2, text: "Code, as the page renders it", id: "code-as-rendered" },
];

const URL = "notes/atomic-notes-in-practice.html";

const TAGGED = [
  { url: URL, tags: ["method", "note-taking", "evergreen"] },
  { url: "notes/why-notes-decay.html", tags: ["method", "writing"] },
  { url: "reference/glossary.html", tags: ["method"] },
];

const PATHS = sitePaths(NOTES.map((n) => n.url));
const TAG_URLS = tagUrls(collectTags(TAGGED), PATHS);
const TAGS = collectTags(TAGGED).map((tag) => ({
  ...tag,
  url: TAG_URLS.get(tag.name) as string,
}));

/** Every note as the site's own pages see it, with a line to read. */
const LANDING: LandingNote[] = NOTES.map((note, index) => ({
  url: note.url,
  title: note.title,
  folder: note.folder,
  updated: note.updated,
  pinned: note.pinned,
  tags: TAGGED.find((t) => t.url === note.url)?.tags ?? [],
  excerpt:
    index % 3 === 0
      ? "A note is worth keeping when it says one thing, and says it well enough that you can use it without rereading the thing it came from."
      : "",
  incoming: Math.max(0, 7 - index),
}));

function landing(url: string): LandingInput {
  return {
    siteName: "A Vault, Published",
    notes: LANDING,
    tags: TAGS,
    recency: recencyBuckets(NOTES, TODAY),
    paths: PATHS,
    today: TODAY,
    root: url.includes("/") ? "../" : "./",
  };
}

const BACKLINKS = [
  {
    url: "notes/linking-your-thinking.html",
    title: "Linking your thinking",
    excerpt: "…the unit of reuse is the note, which is the argument made in atomic notes…",
  },
  {
    url: "projects/vault-site/design-notes.html",
    title: "Design notes",
    excerpt: "…keep the folder structure, following atomic notes rather than inventing one…",
  },
];

const RELATED = [
  {
    url: "notes/evergreen-notes-grow.html",
    title: "Evergreen notes grow",
    excerpt: "Three tests for whether a note has stopped being a draft.",
  },
];

function page(themeName: string): string {
  const titles = new Map(NOTES.map((n) => [n.url, n.title]));
  return buildPage({
    meta: {
      title: "Atomic notes in practice",
      url: URL,
      siteName: "A Vault, Published",
      // What `noteHeader` in buildSite.ts puts there, and only that.
      properties: [
        { label: "Updated", value: "24 Oct 2026" },
        { label: "Links", value: "2 in \u00b7 3 out" },
        {
          label: "",
          value: "",
          tags: ["method", "note-taking", "evergreen"].map((name) => ({
            name,
            url: TAG_URLS.get(name) as string,
          })),
        },
      ],
    },
    content: prepared(CONTENT),
    headings: HEADINGS,
    shell: {
      nav: buildNavTree(NOTES),
      pinned: NOTES.filter((n) => n.pinned),
      recency: recencyBuckets(NOTES, TODAY),
      tags: TAGS,
      paths: PATHS,
      backlinks: BACKLINKS,
      related: RELATED,
      graph: buildLocalGraph({
        url: URL,
        title: "Atomic notes in practice",
        out: RELATED.map((r) => r.url).concat("reference/glossary.html"),
        in: BACKLINKS.map((b) => b.url),
        titles,
      }),
      stats: { words: 648, readingMinutes: 3, sections: 4 },
      today: TODAY,
      noteCount: NOTES.length,
    },
  });
}

/** A page the build writes rather than renders: no note, so no note context. */
function sitePage(
  title: string,
  url: string,
  content: string,
  crumbs?: Array<{ label: string; url?: string }>,
): string {
  return buildPage({
    meta: { title, url, siteName: "A Vault, Published" },
    content,
    headings: [],
    shell: {
      nav: buildNavTree(NOTES),
      pinned: NOTES.filter((n) => n.pinned),
      recency: recencyBuckets(NOTES, TODAY),
      tags: TAGS,
      paths: PATHS,
      crumbs,
      backlinks: [],
      related: [],
      graph: {
        nodes: [],
        edges: [],
        centre: { title: "A Vault, Published", x: 0, y: 0 },
        width: 0,
        height: 0,
      },
      stats: { words: 0, readingMinutes: 1, sections: 0 },
      today: TODAY,
      noteCount: NOTES.length,
    },
  });
}

describe("the shell", () => {
  it("renders every part a reader needs, and nothing a bot should index twice", () => {
    const html = page("press");
    expect(html).toContain('class="osp-shell"');
    expect(html).toContain("On this page");
    expect(html).toContain("Start here");
    expect(html).toContain("Recently updated");
    expect(html).toContain("14 notes changed together");
    expect(html).toContain('role="switch"');
    expect(html).toContain("data-osp-graph");
    // The rail's graph carries a way back, or the control in the bar strands
    // the reader in it.
    expect(html).toContain("data-osp-graph-back");
    // One <h1> per page.
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("puts the tags in the search palette, not in a list down the panel", () => {
    const html = page("press");
    const panel = html.slice(
      html.indexOf('class="osp-panel-body'),
      html.indexOf("data-osp-jump"),
    );
    expect(panel).not.toContain("osp-tag");
    expect(html).toContain("data-osp-tag-index");
    // And the chips go somewhere a reader can arrive at, with a title, a
    // count and a way back: the tag's own page.
    expect(html).toContain('href="../tags/method.html"');
  });

  it("carries the trail and the way back above the note", () => {
    const html = page("press");
    expect(html).toContain('aria-label="Breadcrumb"');
    // Both arrows, and disabled until the script knows this tab can move.
    expect(html).toContain("data-osp-back disabled");
    expect(html).toContain("data-osp-forward disabled");
    // Site, folder, note -- the folder links to its group on the browse page.
    expect(html).toContain("browse.html#folder-notes");
    expect(html).toContain('<span aria-current="page">Atomic notes in practice</span>');
  });

  it("gives the outline no instrument to watch", () => {
    const html = page("press");
    expect(html).toContain("data-osp-outline");
    expect(html).not.toContain("osp-spine");
  });

  it("writes a preview when asked", () => {
    const out = process.env.OSP_PREVIEW;
    if (!out) return;
    mkdirSync(join(out, "assets"), { recursive: true });
    mkdirSync(join(out, "notes"), { recursive: true });
    mkdirSync(join(out, PATHS.tagPrefix), { recursive: true });
    for (const theme of ["press", "grove", "ink"]) {
      writeFileSync(join(out, `site-${theme}.css`), siteCss(theme));
    }
    writeFileSync(join(out, "assets/obsidian.css"), "/* stand-in for the harvested stylesheet */");
    writeFileSync(join(out, "assets/site.css"), siteCss("press"));
    writeFileSync(join(out, "notes/atomic-notes-in-practice.html"), page("press"));
    writeFileSync(join(out, "index.html"), sitePage("A Vault, Published", "index.html", overviewContent(landing("index.html"))));
    writeFileSync(join(out, PATHS.browse), sitePage("Browse", PATHS.browse, browseContent(landing(PATHS.browse), folderSlug)));
    writeFileSync(join(out, PATHS.tags), sitePage("Tags", PATHS.tags, tagsIndexContent(landing(PATHS.tags))));
    // The other homepage: a note the author wrote, with the strip that gives
    // a reader somewhere to go after it.
    writeFileSync(
      join(out, "home-note.html"),
      sitePage(
        "Reading this vault",
        "index.html",
        `${prepared(CONTENT)}\n${exploreContent(landing("index.html"))}`,
      ),
    );
    const method = TAGS.find((tag) => tag.name === "method") as (typeof TAGS)[number];
    writeFileSync(
      join(out, method.url),
      sitePage(`#${method.name}`, method.url, tagPageContent(method, landing(method.url)), [
        { label: "Tags", url: PATHS.tags },
        { label: `#${method.name}` },
      ]),
    );
    expect(true).toBe(true);
  });
});
