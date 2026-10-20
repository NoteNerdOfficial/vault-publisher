/**
 * Sending only what changed.
 *
 * The obvious design is to hash each note's Markdown and skip the ones that
 * have not been edited. That is wrong here, and quietly so: a page's content
 * does not depend only on its own source. A Dataview query renders whatever
 * the vault contains, so editing note B changes the published HTML of note A
 * while A's own bytes are untouched. Hashing sources would leave A stale on
 * the site forever, with nothing to indicate it.
 *
 * So the hash is taken over the *rendered* output. Every note is still
 * rendered on every publish -- that cost is unavoidable while query results
 * depend on the whole vault -- and what incremental publishing saves is the
 * upload, which is the slow and rate-limited half for a large site.
 *
 * Two kinds of page re-upload every time regardless, and both are correct:
 *
 *   - A note whose content genuinely changes. The test vault has a dataviewjs
 *     block printing `new Date()`, so its output really is different.
 *   - Mermaid diagrams. Renaming the random ids Obsidian and Mermaid mint per
 *     render made seven of nine test pages byte-identical, but Mermaid's
 *     layout also computes slightly different curve geometry each time
 *     (`C-26.357…` against `C-33.670…` for the same diagram), which no amount
 *     of id rewriting settles. Rounding the coordinates would change what is
 *     drawn, so a diagram page is simply re-sent.
 *
 * The manifest lives in the published branch rather than in the vault. Two
 * people publishing the same team site from different machines then agree
 * about what is already there, and a vault copied to a new laptop does not
 * re-upload the entire site on its first publish.
 */

export const MANIFEST_PATH = ".vault-publisher-manifest.json";

export interface Manifest {
  version: 1;
  /** Published path to a hash of the bytes last published there. */
  files: Record<string, string>;
}

export function emptyManifest(): Manifest {
  return { version: 1, files: {} };
}

export function parseManifest(raw: string | null): Manifest {
  if (!raw) return emptyManifest();
  try {
    const parsed = JSON.parse(raw) as Manifest;
    if (parsed?.version !== 1 || typeof parsed.files !== "object") {
      return emptyManifest();
    }
    return { version: 1, files: parsed.files ?? {} };
  } catch {
    // A corrupt manifest must cost a full upload, never a wrong diff.
    return emptyManifest();
  }
}

/**
 * FNV-1a over the content.
 *
 * Not a cryptographic hash and does not need to be: it compares our own
 * output against our own previous output, where the adversary is an accident
 * rather than a forger. It is a few lines, has no dependency, and runs over a
 * few megabytes of HTML without being noticeable.
 */
export function hashContent(content: string | ArrayBuffer): string {
  const bytes =
    typeof content === "string"
      ? new TextEncoder().encode(content)
      : new Uint8Array(content);

  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    // Multiply by the FNV prime with 32-bit wraparound.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0") + ":" + bytes.length.toString(16);
}

export interface Diff<T> {
  /** Files whose content differs from the manifest, or that are new. */
  changed: T[];
  /** Published paths present last time and absent now. */
  removed: string[];
  /** Count of files skipped because they were identical. */
  unchanged: number;
  /** The manifest to store after this publish succeeds. */
  next: Manifest;
}

/**
 * Compares the built site against what the branch is believed to hold.
 *
 * Deletions are reported but do not need separate handling by the caller:
 * the publish sends a complete tree, so a file simply absent from it is gone.
 * They are returned so a publish can say what it removed.
 */
export function diffAgainstManifest<
  T extends { path: string; content: string | ArrayBuffer; existingSha?: string },
>(
  files: T[],
  previous: Manifest,
  /**
   * What the branch actually holds right now, path to blob sha.
   *
   * Read live rather than remembered, because a manifest that recorded blob
   * ids could disagree with the branch after anyone edited it by other
   * means, and a tree entry pointing at a blob that is not there fails the
   * whole publish. The manifest answers "did this change"; the branch
   * answers "where is it".
   */
  existingBlobs: Map<string, string>,
): Diff<T> {
  const next = emptyManifest();
  const changed: T[] = [];
  let unchanged = 0;

  for (const file of files) {
    const hash = hashContent(file.content);
    next.files[file.path] = hash;

    const blob = existingBlobs.get(file.path);
    if (previous.files[file.path] === hash && blob) {
      file.existingSha = blob;
      unchanged++;
    } else {
      changed.push(file);
    }
  }

  const removed = Object.keys(previous.files).filter(
    (path) => !(path in next.files),
  );

  return { changed, removed, unchanged, next };
}
