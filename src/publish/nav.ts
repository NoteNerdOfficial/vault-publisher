/**
 * The site's navigation model.
 *
 * Every published page carries the whole vault listing, which is a deliberate
 * cost: the alternative is fetching a `nav.json`, and a site that makes no
 * external requests and works with JavaScript off is worth more here than the
 * bytes. The tree is built once per publish and the same markup is inlined
 * into every page.
 *
 * The part that needed thought is recency. "The ten newest notes" is useless
 * on a vault where a tag rename touched forty files in one second: ten rows
 * all saying today, none of them a decision anyone made. A large recent count
 * is almost always *one action*, so runs of notes sharing a timestamp are
 * collapsed into a single entry, and the counts rather than the rows carry
 * how much changed.
 */

/** A published note, as navigation sees it. */
export interface NavNote {
  /** Published URL path, e.g. "notes/atomic-notes.html". */
  url: string;
  title: string;
  /** Folder part of the URL, "" for a note at the root. */
  folder: string;
  /**
   * When the note was last edited, as `YYYY-MM-DDTHH:MM`, or null when the
   * vault could not say.
   *
   * Minute resolution is load-bearing rather than decorative: a date alone
   * cannot tell forty decisions from one rename, which is the whole basis of
   * batch collapsing below.
   */
  updated: string | null;
  pinned: boolean;
  /**
   * True for one of the vault's own HTML files, published as it was written.
   *
   * The tree is the one place these pages appear, and it is why this flag
   * exists rather than a second kind of node: a reader looking for a file
   * wants the whole vault in one list, in folder order, and an HTML page
   * sitting beside the notes is exactly what the file tree is *for*.
   *
   * What it changes is the row's icon and nothing else. Everything the rest
   * of the navigation does is a claim about a note -- a date the author
   * wrote, tags, an outline, what links here -- and an as-is page has none
   * of them, so it is kept out of the recency list, the pinned list, the
   * tag pages, the graph and the note count. `updated` is null and `pinned`
   * is false here for the same reason: the fields are not knowable, rather
   * than knowable and empty.
   */
  asIs?: boolean;
}

export type NavNode =
  | { kind: "note"; note: NavNote }
  | { kind: "folder"; name: string; path: string; children: NavNode[]; notes: number };

/**
 * Groups notes into the folder tree their URLs describe.
 *
 * Notes at a level come after the folders at that level, which is how
 * Obsidian's own explorer orders them, and both are sorted by name so the
 * tree is stable between publishes.
 */
export function buildNavTree(notes: NavNote[]): NavNode[] {
  const root: NavNode[] = [];

  for (const note of notes) {
    const segments = note.folder ? note.folder.split("/") : [];
    let level = root;
    let path = "";

    for (const segment of segments) {
      path = path ? `${path}/${segment}` : segment;
      let folder = level.find(
        (node): node is Extract<NavNode, { kind: "folder" }> =>
          node.kind === "folder" && node.name === segment,
      );
      if (!folder) {
        folder = { kind: "folder", name: segment, path, children: [], notes: 0 };
        level.push(folder);
      }
      folder.notes++;
      level = folder.children;
    }

    level.push({ kind: "note", note });
  }

  sortLevel(root);
  return root;
}

function sortLevel(level: NavNode[]): void {
  level.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    const an = a.kind === "folder" ? a.name : a.note.title;
    const bn = b.kind === "folder" ? b.name : b.note.title;
    return an.localeCompare(bn);
  });
  for (const node of level) if (node.kind === "folder") sortLevel(node.children);
}

/** A run of notes that were all written in the same minute. */
export interface NavBatch {
  kind: "batch";
  updated: string;
  notes: NavNote[];
}

export interface NavBucket {
  /** "today" | "week" | "older" */
  id: string;
  label: string;
  /** How many notes the bucket holds, batches counted as their members. */
  count: number;
  rows: Array<{ kind: "note"; note: NavNote } | NavBatch>;
}

export interface RecencyOptions {
  /** Identical timestamps at or above this count are treated as one edit. */
  batchMin?: number;
  /** Nothing older than this many days is "recent" by any reading. */
  windowDays?: number;
}

/**
 * Buckets the recently-edited notes by calendar day, collapsing batches.
 *
 * Calendar days rather than elapsed hours: a note saved at 22:10 last night
 * is yesterday's work, and an "updated 4 hours ago" that files it under today
 * reads as a bug to everyone except the clock.
 */
export function recencyBuckets(
  notes: NavNote[],
  today: Date,
  options: RecencyOptions = {},
): NavBucket[] {
  const batchMin = options.batchMin ?? 4;
  const windowDays = options.windowDays ?? 30;

  const dated = notes
    .filter((note): note is NavNote & { updated: string } => Boolean(note.updated))
    .map((note) => ({ note, age: calendarDaysBetween(note.updated, today) }))
    .filter((entry) => entry.age <= windowDays && entry.age >= 0)
    .sort((a, b) => b.note.updated.localeCompare(a.note.updated));

  const buckets: NavBucket[] = [
    { id: "today", label: "Today", count: 0, rows: [] },
    { id: "week", label: "Earlier this week", count: 0, rows: [] },
    { id: "older", label: "Earlier", count: 0, rows: [] },
  ];

  const members: NavNote[][] = [[], [], []];
  for (const entry of dated) {
    const index = entry.age <= 0 ? 0 : entry.age < 7 ? 1 : 2;
    members[index].push(entry.note);
    buckets[index].count++;
  }

  buckets.forEach((bucket, index) => {
    const items = members[index];
    let i = 0;
    while (i < items.length) {
      let j = i;
      while (j < items.length && items[j].updated === items[i].updated) j++;
      const run = items.slice(i, j);
      if (run.length >= batchMin) {
        bucket.rows.push({ kind: "batch", updated: run[0].updated as string, notes: run });
      } else {
        for (const note of run) bucket.rows.push({ kind: "note", note });
      }
      i = j;
    }
  });

  return buckets.filter((bucket) => bucket.count > 0);
}

/** Whole days between a note's stamp and now, by the calendar, not the clock. */
export function calendarDaysBetween(updated: string, today: Date): number {
  const then = parseStamp(updated);
  if (!then) return Number.POSITIVE_INFINITY;
  const a = Date.UTC(then.getUTCFullYear(), then.getUTCMonth(), then.getUTCDate());
  const b = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

/**
 * The shape is checked before the date is parsed.
 *
 * `new Date` is lenient enough to make a date out of most strings, and a
 * frontmatter key holding the word "recently" would otherwise be sorted and
 * printed as a real day.
 */
function parseStamp(updated: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(updated.trim());
  if (!match) return null;
  const date = new Date(`${match[1]}T${match[2] ?? "00:00"}:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "today", "yesterday", "3 days ago" -- the form a reader checks at a glance. */
export function relativeDay(updated: string, today: Date): string {
  const days = calendarDaysBetween(updated, today);
  if (!Number.isFinite(days)) return "";
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * "24 Oct 2026" -- the date on the note itself.
 *
 * A note's header says when it was last worked on, and a relative day is the
 * wrong form for that: "3 days ago" is read as news, while a date is read as
 * provenance, which is what a reader of a published note is after.
 */
export function formatDay(updated: string): string {
  const date = parseStamp(updated);
  if (!date) return "";
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Tags across the published set, commonest first, then alphabetical. */
export function collectTags(tagged: Array<{ url: string; tags: string[] }>): Array<{
  name: string;
  count: number;
}> {
  const counts = new Map<string, number>();
  for (const entry of tagged) {
    for (const tag of Array.from(new Set(entry.tags))) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
