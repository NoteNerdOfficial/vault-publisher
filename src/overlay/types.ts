/**
 * The review overlay's data model.
 *
 * A comment is a note about a block of a built page, written by whoever is
 * reviewing the site, held in that person's own browser until they export it.
 * Nothing here is ever published: the overlay ships in preview builds only,
 * and `sourcePath` is the reason why -- a published page carrying the vault
 * path it was built from would hand the world the vault's folder structure.
 *
 * `blockText` is carried alongside `block` deliberately. When a comment's
 * anchor is lost -- which happens when the block it was about is rewritten,
 * by design -- the review note can still say what the comment *was* about.
 * That is the difference between an orphan worth reading and one worth
 * deleting.
 */

/** Current shape of an export file. Bumped only on a breaking change. */
export const OVERLAY_SCHEMA_VERSION = 1;

export interface OverlayComment {
  id: string;
  /** Built URL of the page the comment was left on, e.g. `notes/plan.html`. */
  page: string;
  /** Vault path of the note that produced the page, e.g. `notes/Plan.md`. */
  sourcePath: string;
  /**
   * `data-osp-block` of the block commented on, or null for a comment about
   * the page as a whole.
   */
  block: string | null;
  /** Opening of the block's text, for context once the anchor is gone. */
  blockText: string;
  author: string;
  text: string;
  /** ISO 8601. */
  createdAt: string;
  resolved: boolean;
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
