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
 * `priority` and `agent`. 4 added `external`. An older file still reads:
 * every added field is optional and defaults to what a comment without it
 * meant.
 */
export const OVERLAY_SCHEMA_VERSION = 4;

/**
 * How much a comment is asking for, in the reviewer's own estimation.
 *
 * Three, not five. A reviewer triaging their own notes can tell "this blocks
 * the page" from "this is a nit" and will not reliably tell a 2 from a 3, so
 * a fourth level buys indecision rather than precision. `normal` is what a
 * comment left without a thought about it means, and is therefore the
 * default and the one that shows no pill.
 */
export type OverlayPriority = "high" | "normal" | "low";

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
  /** Drop point in document space, for a pin with no block to hang from. */
  x: number;
  y: number;
  /** The same point as a fraction of the block's box, or null without one. */
  rx: number | null;
  ry: number | null;
  author: string;
  text: string;
  /** ISO 8601. */
  createdAt: string;
  resolved: boolean;
  /** What the reviewer thinks this is worth. `normal` when unstated. */
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
}

/** How much of a block's text is worth keeping for context. */
export const BLOCK_TEXT_LIMIT = 80;
