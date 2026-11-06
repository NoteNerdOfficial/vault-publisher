/**
 * The review overlay's data model.
 *
 * A comment is a note about a point on a built page, written by whoever is
 * reviewing the site, held in that person's own browser and in the vault.
 * Nothing here is ever published: the overlay ships in preview builds only,
 * and `sourcePath` is the reason why -- a published page carrying the vault
 * path it was built from would hand the world the vault's folder structure.
 *
 * `blockText` is carried alongside `block` deliberately. When a comment's
 * anchor is lost -- which happens when the block it was about is rewritten,
 * by design -- the review note can still say what the comment *was* about.
 * That is the difference between an orphan worth reading and one worth
 * deleting.
 *
 * **A pin remembers the exact point it was dropped on, twice.** `x` and `y`
 * are where it landed in document space, which is all a pin needs to come
 * back to the same place on the same build. `rx` and `ry` are the same point
 * expressed as a fraction across and down the block it was dropped on, which
 * is what survives a rebuild, a reflow or a different window width: the block
 * moves, the pin moves with it, and it still marks the same few words. The
 * fractions win when the block is still there; the absolute pair is the
 * fallback for a pin dropped somewhere no block covers.
 */

/**
 * Current shape of a stored review. Bumped only on a change readers must
 * know about.
 *
 * 2 added the drop point (`x`, `y`, `rx`, `ry`) and `replies`. 3 added
 * `priority` and `agent`. 4 added `external`. 5 added `closedAt` on
 * `external` and the document's `withdrawn` list. 6 renamed the middle
 * priority from `normal` to `medium`. 7 added `route`. 8 added `imported`. 9 added `view`.
 * 10 added `context` and the point within it, `cx` and `cy`.
 * An older file still reads: every added field is optional and defaults to
 * what a comment without it meant, and a `normal` priority is read as
 * `medium` by every reader of one.
 */
export const OVERLAY_SCHEMA_VERSION = 10;

/**
 * How much a comment is asking for, in the reviewer's own estimation.
 *
 * Three, not five. A reviewer triaging their own notes can tell "this blocks
 * the page" from "this is a nit" and will not reliably tell a 2 from a 3, so
 * a fourth level buys indecision rather than precision. `medium` is what a
 * comment left without a thought about it means, and is therefore the
 * default.
 *
 * `medium` rather than `normal`, which is what it was called until schema 6.
 * Three levels read as a scale, and the middle of a scale is named for where
 * it sits on it: high, medium, low. "Normal" named it for being unremarkable
 * instead, which made the other two deviations from a baseline rather than
 * two of three steps -- and left "high and normal" to be read as a pair of
 * different kinds of thing. A review file written before the rename still
 * says `normal`, and every reader here maps it across.
 */
export type OverlayPriority = "high" | "medium" | "low";

/**
 * An issue filed from a comment, in whatever tracker the work is tracked in.
 *
 * Written onto the comment so that filing is visibly done once. Without it
 * the only record of the issue would be in the tracker, where the overlay
 * cannot see it, and the second person to press Send -- or the same person
 * after a rebuild -- would file a duplicate. So the key is the thing that
 * replaces the Send action, not a detail shown beside it.
 *
 * Only the plugin ever sets this. The browser carries it, shows it and
 * writes it back unchanged; it has no credentials and no way to invent one.
 */
export interface OverlayExternalIssue {
  /** Which tracker it went to. */
  provider: "github" | "jira" | "asana";
  /**
   * How a person refers to it: `owner/repo#41`, `ENG-14`, or, for a tracker
   * whose things have no short name, whatever it does call them.
   */
  key: string;
  url: string;
  /** ISO 8601. */
  filedAt: string;
  /**
   * When this plugin closed the issue, because the comment was resolved or
   * deleted here. Absent while the issue is still open as far as we know.
   *
   * It exists to make closing happen once. Without it, every sync would
   * close every resolved comment's issue again -- which is harmless on two
   * of the three trackers and a refused transition on Jira, but it is also a
   * request per comment per sync, forever.
   */
  closedAt?: string | null;
}

/**
 * A comment that was deleted after its issue had been filed.
 *
 * The issue outlives the comment, and once the comment is gone so is the
 * only pointer to it -- so a tombstone is left behind instead. The plugin
 * closes the issue, then drops the tombstone; one that is still here is one
 * whose tracker could not be reached yet.
 *
 * Written by the browser, because only the browser knows the difference
 * between a comment somebody deleted and a comment this copy of the document
 * never had.
 */
export interface OverlayWithdrawn {
  /** The comment that was deleted. Kept so a repeat is recognisable. */
  id: string;
  external: OverlayExternalIssue;
  /** ISO 8601. */
  at: string;
}

/** A follow-up on a comment, in the thread its pin opens. */
export interface OverlayReply {
  id: string;
  author: string;
  text: string;
  /** ISO 8601. */
  createdAt: string;
}

export interface OverlayComment {
  id: string;
  /** Built URL of the page the comment was left on, e.g. `notes/plan.html`. */
  page: string;
  /** Vault path of the note that produced the page, e.g. `notes/Plan.md`. */
  sourcePath: string;
  /**
   * `data-osp-block` of the block the pin was dropped on, or null for a pin
   * dropped where no block covers the point.
   */
  block: string | null;
  /** Opening of the block's text, for context once the anchor is gone. */
  blockText: string;
  /**
   * Which screen of an application the pin was dropped on, or null.
   *
   * The browser's own URL at the time -- path, query and fragment -- and not
   * anything a framework was asked for. A single-page application is one
   * published file, so `page` is the same for every screen in it and cannot
   * tell them apart; the address bar can, whatever the application is built
   * on.
   *
   * Null for a page the build rendered, which is one document at one URL,
   * and null in a review written before this field existed. Both mean "show
   * this wherever its page is shown", which is what they meant at the time.
   */
  route: string | null;
  /**
   * Which page of a single-file deck the pin was dropped on, or null.
   *
   * The other half of `route`, for the pages one URL cannot tell apart. A
   * deck or a prototype in one file holds every slide in the document at
   * once and shows one of them, so the address bar never moves and `route`
   * is the same string for the whole deck. This is derived from the document
   * instead: the name of the page that was showing, which the overlay reads
   * off the structure every deck already has -- one of a run of siblings
   * laid out and the rest not. See the view section of `overlayScript.ts`.
   *
   * An opaque key, built to be compared rather than read; the overlay has a
   * readable form of it for the panel. Null for a document that was not a
   * deck when the pin was dropped, and null in a review written before this
   * field existed. Both mean "show this wherever its page is shown".
   */
  view: string | null;
  /**
   * What the pin was dropped *inside*, or null for a point inside nothing
   * that can be named.
   *
   * The third of this group, and the one for a prototype rather than a deck.
   * A dialog, a side panel, a menu or a sheet is shown *over* a screen
   * instead of instead of it, so `view` cannot see it -- two things are laid
   * out at once, which is not the one-of-many a deck turns on -- and when it
   * closes, a pin left in it has to close with it. Before this, one did not:
   * a comment on a dismissed dialog stayed on the page, over whatever the
   * dialog had been covering.
   *
   * The key names the nearest ancestor that can be identified without
   * counting siblings: `#settings`, or `aria-label=Filters`. Named rather
   * than positional because it is looked up again in a document that has
   * been re-rendered since, where an index is a different element and a name
   * is the same one. The rule it carries is simple -- a pin draws only while
   * its context is in the document and on screen -- and it covers a context
   * hidden in place, one hidden by something above it, and one unmounted
   * entirely, because all three are "not showing" to the same question.
   *
   * Null for a page the build rendered, which is one document with nothing
   * in it that opens and closes, and null in a review written before this
   * field existed. Both mean "show this wherever its page is shown".
   */
  context: string | null;
  /** Drop point in document space, for a pin with no block to hang from. */
  x: number;
  y: number;
  /** The same point as a fraction of the block's box, or null without one. */
  rx: number | null;
  ry: number | null;
  /**
   * And as a fraction of the context's box, or null without one.
   *
   * What `rx`/`ry` are to a block, one level out. It matters most for
   * exactly the pins `context` exists for: a dialog is placed against the
   * viewport rather than on the page, so the document coordinates of a pin
   * inside one describe where the window happened to be scrolled to when it
   * was dropped. The fraction across the dialog survives a scroll, a resize
   * and the panel's contents being re-rendered under it.
   */
  cx: number | null;
  cy: number | null;
  author: string;
  text: string;
  /** ISO 8601. */
  createdAt: string;
  resolved: boolean;
  /** What the reviewer thinks this is worth. `medium` when unstated. */
  priority: OverlayPriority;
  /**
   * The tool that filed this comment, or null for one a person typed in the
   * browser.
   *
   * It exists so the panel can say "an agent wrote this", which is a
   * different thing to read than a note from a colleague: the author field
   * carries a name either way, and a name alone does not say whether anyone
   * actually looked at the page. Nothing in the overlay sets it -- an agent
   * writing into the review file does, and the overlay reads it back.
   */
  agent: string | null;
  /**
   * Where this comment came in from, or null for one made in this browser.
   *
   * Set by the overlay's own import, which is how a review crosses from one
   * browser to another: a published build keeps nothing, so a reviewer who
   * clears their site data, moves to another machine, or hands their notes
   * to someone else has the file and nothing else. The value is the site
   * the export named, so a row can say where it came from rather than only
   * that it came from somewhere.
   *
   * Worth a pill for the same reason `agent` is. The author field carries a
   * name either way, and a name does not say whether that person was
   * looking at this build: an imported comment may have been written
   * against an older one, which is the difference between "this is wrong"
   * and "this was wrong when they read it".
   */
  imported: string | null;
  /** The issue filed from this comment, or null while none has been. */
  external: OverlayExternalIssue | null;
  replies: OverlayReply[];
}

export interface OverlayExport {
  version: number;
  /** Site name at export time, so an import can say which site it came from. */
  site: string;
  /** ISO 8601. */
  exportedAt: string;
  comments: OverlayComment[];
  /** Issues whose comment was deleted, until the issue has been closed. */
  withdrawn?: OverlayWithdrawn[];
}

/** How much of a block's text is worth keeping for context. */
export const BLOCK_TEXT_LIMIT = 80;
