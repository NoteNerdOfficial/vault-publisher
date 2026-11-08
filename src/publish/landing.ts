/**
 * The pages no note wrote: the homepage, the directory, and a page per tag.
 *
 * Three decisions are worth stating, because each replaced something that
 * worked badly.
 *
 * The homepage is the vault's own README when it has one, and when it does
 * not, it is a front door rather than a file dump: what the author marked as
 * a starting point, what the vault links to most, what changed lately, and
 * the tags. A flat list of every note tells a reader the vault is large and
 * nothing about what is in it, and the list gets *less* useful as the vault
 * grows -- which is backwards.
 *
 * The full folder-by-folder listing still exists, on `browse.html`, because
 * "show me everything" is a real question. It is just no longer the answer to
 * "what is this?".
 *
 * A tag is a page. It used to be an anchor two thirds of the way down the
 * index, so following one meant arriving mid-page in a list of hundreds with
 * no title, no count, nothing to go back to, and no URL to send anyone. A
 * destination with its own address is what a tag was always pretending to be.
 */

import { NavBucket, NavNote, formatDay, relativeDay, sortPinned } from "./nav";
import { SitePaths, escapeHtml, icon } from "./shell";
import { encodeUrlPath } from "./urls";

/** A published page, as the site's own pages see it. */
export interface LandingNote {
  url: string;
  title: string;
  folder: string;
  updated: string | null;
  pinned: boolean;
  /** The author's place for this one in "Start here". See `readPin`. */
  pinOrder?: number;
  tags: string[];
  /** The note's opening prose, so a list can be read rather than scanned. */
  excerpt: string;
  /** Published pages linking here. The vault's own measure of importance. */
  incoming: number;
}

/** A tag and where it now lives. */
export interface TagLink {
  name: string;
  count: number;
  /** Site-root-relative path, e.g. "tags/writing.html". */
  url: string;
}

export interface LandingInput {
  siteName: string;
  /** Every published page. */
  notes: LandingNote[];
  tags: TagLink[];
  recency: NavBucket[];
  paths: SitePaths;
  today: Date;
  /** Prefix back to the site root for the page being built, e.g. "../". */
  root: string;
}

/* --- where the site's own pages go ----------------------------------- */

/**
 * Names for the pages the build invents, chosen around the notes.
 *
 * A vault may already publish a note called `browse.md`, or a whole folder
 * called `tags`, and the note has the better claim: the author named it. So
 * each of these is the first candidate that nothing published is using, and
 * the alternatives are deliberately dull rather than clever -- a reader
 * should not have to wonder whether `tag/` and `tags/` are different places.
 */
export function sitePaths(taken: Iterable<string>): SitePaths {
  const used = new Set(Array.from(taken, (url) => url.toLowerCase()));
  const free = (candidates: string[], test: (candidate: string) => boolean) =>
    candidates.find(test) ?? candidates[candidates.length - 1];

  return {
    browse: free(["browse.html", "all-notes.html", "osp-browse.html"], (c) => !used.has(c)),
    tags: free(["tags.html", "all-tags.html", "osp-tags.html"], (c) => !used.has(c)),
    tagPrefix: free(["tags", "tag", "osp-tags"], (prefix) => {
      for (const url of used) if (url.startsWith(`${prefix.toLowerCase()}/`)) return false;
      return true;
    }),
  };
}

/**
 * A tag's filename.
 *
 * Nested tags flatten (`projects/active` to `projects-active`), which can
 * collide with a tag literally called `projects-active`, so the caller
 * disambiguates rather than this -- see `tagUrls`.
 */
export function tagSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "tag";
}

/**
 * Every tag's page, by tag name.
 *
 * Slugs are assigned in alphabetical order rather than the display order,
 * because the display order is by count: one note gaining a tag would
 * otherwise renumber two colliding tags and silently move both their pages.
 */
export function tagUrls(
  tags: Array<{ name: string; count: number }>,
  paths: SitePaths,
): Map<string, string> {
  const urls = new Map<string, string>();
  const used = new Set<string>();

  for (const tag of [...tags].sort((a, b) => a.name.localeCompare(b.name))) {
    const base = tagSlug(tag.name);
    let slug = base;
    let n = 2;
    while (used.has(slug)) slug = `${base}-${n++}`;
    used.add(slug);
    urls.set(tag.name, `${paths.tagPrefix}/${slug}.html`);
  }

  return urls;
}

/**
 * A note's opening prose, in plain text.
 *
 * Taken from the rendered page rather than the markdown source, which means
 * it is whatever the reader would actually see first -- frontmatter already
 * stripped, a Dataview table reduced to its words.
 */
export function noteExcerpt(html: string, width = 160): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#3[49];/g, "'")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= width) return text;
  const cut = text.slice(0, width);
  const space = cut.lastIndexOf(" ");
  // Cut at a word unless doing so would throw most of the excerpt away,
  // which happens when the opening "word" is a URL or a long identifier.
  return `${(space > width / 2 ? cut.slice(0, space) : cut).trim()}…`;
}

/* --- shared pieces ---------------------------------------------------- */

/**
 * A note in a list that is meant to be read.
 *
 * Title, one fact, and the note's first line. The fact is whichever one the
 * section is about -- when it changed, where it lives, how many notes point
 * at it -- because a row carrying all three is a row nobody reads.
 */
function noteRow(note: LandingNote, root: string, trail: string): string {
  return (
    `<li class="osp-home-item"><a href="${escapeHtml(root + encodeUrlPath(note.url))}">` +
    `<span class="osp-home-title">${escapeHtml(note.title)}` +
    (trail ? `<span class="osp-home-trail">${escapeHtml(trail)}</span>` : "") +
    `</span>` +
    (note.excerpt ? `<span class="osp-home-excerpt">${escapeHtml(note.excerpt)}</span>` : "") +
    `</a></li>`
  );
}

function section(id: string, title: string, body: string, count?: number): string {
  if (!body) return "";
  return (
    `<section class="osp-home-section">` +
    `<h2 class="osp-index-group" id="${escapeHtml(id)}">${escapeHtml(title)}` +
    (count === undefined ? "" : `<span class="osp-num">${count}</span>`) +
    `</h2>${body}</section>`
  );
}

function list(items: string[]): string {
  return items.length ? `<ul class="osp-home-list">${items.join("")}</ul>` : "";
}

function more(href: string, label: string): string {
  return (
    `<p class="osp-home-more"><a href="${escapeHtml(href)}">${escapeHtml(label)}` +
    icon("arrowRight", "osp-icon-sm") +
    `</a></p>`
  );
}

function tagCloud(tags: TagLink[], root: string): string {
  return (
    `<div class="osp-tagcloud">` +
    tags
      .map(
        (tag) =>
          `<a class="osp-tag" href="${escapeHtml(root + encodeUrlPath(tag.url))}">` +
          `#${escapeHtml(tag.name)}<span class="osp-num">${tag.count}</span></a>`,
      )
      .join("") +
    `</div>`
  );
}

/**
 * The newest notes, with a mass edit counted as the one edit it was.
 *
 * Straight recency is wrong here for the same reason it is wrong in the
 * panel: a tag rename that touched forty notes fills every row with the same
 * minute, and a front page reading "Archived idea 1 … Archived idea 8, today"
 * tells a reader nothing that happened. The buckets have already collapsed
 * those runs, so this walks them and keeps a run as a single line.
 *
 * Falls back to plain recency when nothing is inside the recency window: a
 * vault that has not been touched this month still has a newest note, and
 * an empty section would read as a fault.
 */
function recentList(
  input: LandingInput,
  limit: number,
): { html: string; shown: number } {
  const byUrl = new Map(input.notes.map((note) => [note.url, note]));
  const rows: string[] = [];
  let shown = 0;

  for (const bucket of input.recency) {
    for (const row of bucket.rows) {
      if (rows.length >= limit) return { html: list(rows), shown };
      if (row.kind === "batch") {
        const when = relativeDay(row.updated, input.today);
        rows.push(
          `<li class="osp-home-item">` +
            `<a href="${escapeHtml(input.root + encodeUrlPath(input.paths.browse))}#recent">` +
            `<span class="osp-home-title">${row.notes.length} notes changed together` +
            (when ? `<span class="osp-home-trail">${escapeHtml(when)}</span>` : "") +
            `</span></a></li>`,
        );
        shown += row.notes.length;
        continue;
      }
      const note = byUrl.get(row.note.url);
      if (!note) continue;
      rows.push(
        noteRow(note, input.root, note.updated ? relativeDay(note.updated, input.today) : ""),
      );
      shown += 1;
    }
  }

  if (rows.length) return { html: list(rows), shown };

  const newest = byRecency(input.notes).slice(0, limit);
  return {
    html: list(
      newest.map((note) =>
        noteRow(note, input.root, note.updated ? relativeDay(note.updated, input.today) : ""),
      ),
    ),
    shown: newest.length,
  };
}

/** Newest first. Notes the vault could not date come last, in title order. */
function byRecency(notes: LandingNote[]): LandingNote[] {
  return [...notes].sort((a, b) => {
    if (a.updated && b.updated) return b.updated.localeCompare(a.updated);
    if (a.updated) return -1;
    if (b.updated) return 1;
    return a.title.localeCompare(b.title);
  });
}

/* --- the homepage ----------------------------------------------------- */

const RECENT_ON_HOME = 8;
const LINKED_ON_HOME = 6;
const TAGS_ON_HOME = 24;

/**
 * The generated homepage, for a vault with no README and no page chosen.
 *
 * Every section here is fact the build already has, and every one of them is
 * an answer to a question a first-time reader actually has. "Most linked" is
 * the one worth defending: it is not a popularity guess, it is the vault's
 * own structure read back -- the notes the author kept needing to point at
 * are, by construction, the ones the vault is about.
 */
export function overviewContent(input: LandingInput): string {
  const { notes, tags, paths, root } = input;
  const newest = byRecency(notes);
  const lastUpdated = newest.find((note) => note.updated)?.updated ?? null;

  const facts = [
    `${notes.length} ${notes.length === 1 ? "note" : "notes"}`,
    tags.length ? `${tags.length} ${tags.length === 1 ? "tag" : "tags"}` : "",
    lastUpdated ? `updated ${formatDay(lastUpdated)}` : "",
  ].filter(Boolean);

  // The same order the panel shows, from the same function, so the front
  // page and the furniture beside it cannot disagree.
  const pinned = sortPinned(notes.filter((note) => note.pinned));
  const linked = notes
    .filter((note) => note.incoming > 0 && !note.pinned)
    .sort((a, b) => b.incoming - a.incoming || a.title.localeCompare(b.title))
    .slice(0, LINKED_ON_HOME);

  const recent = recentList(input, RECENT_ON_HOME);

  return (
    `<p class="osp-index-lead">${escapeHtml(facts.join(" · "))}</p>` +
    section(
      "start",
      "Start here",
      list(pinned.map((note) => noteRow(note, root, note.folder))),
    ) +
    section(
      "linked",
      "Most linked",
      list(
        linked.map((note) =>
          noteRow(note, root, `${note.incoming} ${note.incoming === 1 ? "link" : "links"} in`),
        ),
      ),
    ) +
    section(
      "recent",
      "Recently updated",
      recent.html +
        (notes.length > recent.shown
          ? more(
              `${root}${encodeUrlPath(paths.browse)}#recent`,
              `Browse all ${notes.length} notes`,
            )
          : ""),
    ) +
    section(
      "tags",
      "Tags",
      tags.length
        ? tagCloud(tags.slice(0, TAGS_ON_HOME), root) +
            (tags.length > TAGS_ON_HOME
              ? more(`${root}${encodeUrlPath(paths.tags)}`, `All ${tags.length} tags`)
              : "")
        : "",
      tags.length || undefined,
    ) +
    (notes.length <= recent.shown
      ? more(`${root}${encodeUrlPath(paths.browse)}`, "Browse by folder")
      : "")
  );
}

/**
 * The way out of a homepage the author wrote.
 *
 * A README is a welcome, not a table of contents, and on a narrow screen the
 * vault panel is gone -- so a reader arriving on a short README would have
 * the search field and nothing else. This is the smallest strip that fixes
 * that: what changed, the tags, and the way to everything.
 */
export function exploreContent(input: LandingInput): string {
  const { notes, tags, paths, root } = input;

  return (
    `<section class="osp-home-explore">` +
    section("recent", "Recently updated", recentList(input, 5).html) +
    (tags.length ? section("tags", "Tags", tagCloud(tags.slice(0, TAGS_ON_HOME), root)) : "") +
    more(`${root}${encodeUrlPath(paths.browse)}`, `Browse all ${notes.length} notes`) +
    `</section>`
  );
}

/* --- browse ----------------------------------------------------------- */

/**
 * Everything, by the structure the author already made.
 *
 * This is the old homepage, and it is a good page -- it was only ever a bad
 * front door. Pages at the top level lead, because a vault's loose notes are
 * usually its entry points, and folders follow in alphabetical order.
 *
 * The anchors are load-bearing: a folder in the breadcrumb links to
 * `#folder-<slug>` here, and the panel's "show all" to `#recent`.
 */
export function browseContent(input: LandingInput, folderSlug: (path: string) => string): string {
  const { notes, root } = input;

  const groups = new Map<string, LandingNote[]>();
  for (const note of notes) {
    const bucket = groups.get(note.folder);
    if (bucket) bucket.push(note);
    else groups.set(note.folder, [note]);
  }

  const ordered = Array.from(groups.entries()).sort(([a], [b]) => {
    if (a === "") return -1;
    if (b === "") return 1;
    return a.localeCompare(b);
  });

  const folders = ordered
    .map(([group, items]) => {
      const list = items
        .map(
          (note) =>
            `<li class="osp-index-item"><a href="${escapeHtml(root + encodeUrlPath(note.url))}">` +
            `${escapeHtml(note.title)}</a></li>`,
        )
        .join("");
      return (
        (group
          ? `<h2 class="osp-index-group" id="folder-${escapeHtml(folderSlug(group))}">` +
            `${escapeHtml(group.replace(/\//g, " / "))}<span class="osp-num">${items.length}</span></h2>`
          : "") +
        `<ul class="osp-index">${list}</ul>`
      );
    })
    .join("");

  // Folders first: someone who asked for everything is looking for the
  // structure. What changed lately is the question the front page already
  // answers, so here it is the tail rather than the lead -- and the panel's
  // "show all" lands on it by anchor either way.
  return (
    `<p class="osp-index-lead">${notes.length} ${notes.length === 1 ? "note" : "notes"}</p>` +
    folders +
    recentSection(input)
  );
}

/**
 * Every recently-edited note, in full.
 *
 * The panel's recency list is capped and collapsed, which is right for a
 * sidebar and wrong as the only answer: its "show all" has to land somewhere
 * that actually shows them all, and this is it.
 */
function recentSection(input: LandingInput): string {
  if (!input.recency.length) return "";
  const { root } = input;
  const row = (note: NavNote) =>
    `<li class="osp-index-item"><a href="${escapeHtml(root + encodeUrlPath(note.url))}">` +
    `${escapeHtml(note.title)}</a></li>`;

  return (
    `<h2 class="osp-index-group" id="recent">Recently updated</h2>` +
    input.recency
      .map(
        (bucket) =>
          `<h3 class="osp-index-bucket">${escapeHtml(bucket.label)}` +
          `<span class="osp-num">${bucket.count}</span></h3>` +
          `<ul class="osp-index">` +
          bucket.rows
            .flatMap((entry) => (entry.kind === "batch" ? entry.notes : [entry.note]))
            .map(row)
            .join("") +
          `</ul>`,
      )
      .join("")
  );
}

/* --- tags ------------------------------------------------------------- */

/**
 * One tag, as a place.
 *
 * The notes carrying it, with where each lives and what it opens with, and
 * then the tags those same notes also carry -- which is the question a tag
 * page raises by existing: what else is this near?
 */
export function tagPageContent(tag: TagLink, input: LandingInput): string {
  const { notes, tags, paths, root } = input;
  const carrying = notes.filter((note) => note.tags.includes(tag.name));

  const alongside = new Map<string, number>();
  for (const note of carrying) {
    for (const other of note.tags) {
      if (other === tag.name) continue;
      alongside.set(other, (alongside.get(other) ?? 0) + 1);
    }
  }
  const near = Array.from(alongside.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([name, count]) => {
      const link = tags.find((candidate) => candidate.name === name);
      return link ? { name, count, url: link.url } : null;
    })
    .filter((link): link is TagLink => link !== null);

  return (
    `<p class="osp-index-lead">` +
    `${carrying.length} ${carrying.length === 1 ? "note" : "notes"} tagged ` +
    `#${escapeHtml(tag.name)}</p>` +
    list(byRecency(carrying).map((note) => noteRow(note, root, note.folder))) +
    (near.length ? section("alongside", "Often alongside", tagCloud(near, root)) : "") +
    more(`${root}${encodeUrlPath(paths.tags)}`, "All tags")
  );
}

/**
 * Every tag, twice.
 *
 * By use first, because that is the shape of the vault, and then
 * alphabetically, because that is how someone looks for one they already
 * know the name of.
 */
export function tagsIndexContent(input: LandingInput): string {
  const { notes, tags, root } = input;
  if (!tags.length) {
    return (
      `<p class="osp-empty"><b>No tags yet</b>` +
      `None of the published notes carries a tag.</p>`
    );
  }

  const alphabetical = [...tags].sort((a, b) => a.name.localeCompare(b.name));

  return (
    `<p class="osp-index-lead">${tags.length} ${tags.length === 1 ? "tag" : "tags"} ` +
    `across ${notes.length} ${notes.length === 1 ? "note" : "notes"}</p>` +
    section("most-used", "Most used", tagCloud(tags, root)) +
    section(
      "a-z",
      "A to Z",
      `<ul class="osp-index">` +
        alphabetical
          .map(
            (tag) =>
              `<li class="osp-index-item">` +
              `<a href="${escapeHtml(root + encodeUrlPath(tag.url))}">#${escapeHtml(tag.name)}` +
              `<span class="osp-num">${tag.count}</span></a></li>`,
          )
          .join("") +
        `</ul>`,
    )
  );
}
