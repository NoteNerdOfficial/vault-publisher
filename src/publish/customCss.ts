/**
 * A stylesheet of the author's own, added to the end of the site's.
 *
 * Every rule in `theme.ts` is written against the `--osp-*` custom properties
 * that `themes.ts` emits, which means the site already has a styling
 * interface -- it just had no way for anyone outside this repo to reach it.
 * This is that way: a CSS file in the vault, whose usual content is one
 * `:root` block redeclaring the handful of tokens somebody wants different.
 *
 * Three decisions worth knowing.
 *
 * **Appended to `assets/site.css` rather than linked as a fourth stylesheet.**
 * A separate file would have to be taught to `page.ts` (the `<link>`),
 * `lockSite.ts` (the list of files that stay readable when a site is
 * encrypted), the preview server and the pruner, for exactly the cascade
 * position the end of `site.css` already has. One join beats five.
 *
 * **The vault path never reaches the output.** `assets/site.css` is
 * published, so a banner naming `work/clients/Acme/brand.css` would hand
 * every reader of the site a piece of the vault's folder structure -- the
 * same leak the review overlay's `published` flag exists to prevent. The
 * banner says where the block came from in general terms and nothing more.
 *
 * **A file in the vault, not a textarea in settings.** CSS wants an editor,
 * a diff and a history, and a vault has all three. Plugin data has none of
 * them.
 *
 * Being last in the file is not quite enough on its own, which is why
 * `siteCss` declares the theme's tokens inside a cascade layer: the dark
 * values are emitted under selectors that outrank a bare `:root`, so without
 * the layer an override written the obvious way would hold in light mode and
 * quietly stop holding when a reader's system went dark. Unlayered beats
 * layered whatever the specificity, so `:root { --osp-link: ... }` here is
 * enough for both. See `THEME_LAYER` in `theme.ts`.
 */

/**
 * What separates the generated stylesheet from the author's.
 *
 * Loud on purpose. Somebody reading `assets/site.css` to work out why their
 * colour did not take needs to see instantly where the generated part stops,
 * and the first question about a token that will not budge is always whether
 * the override is in the file at all.
 */
export const CUSTOM_CSS_BANNER = [
  "/* ----------------------------------------------------------------",
  "   Everything below this line came from the custom stylesheet named",
  "   in the plugin's settings, and is not generated. Edit it there --",
  "   this file is rewritten on every build.",
  "   ---------------------------------------------------------------- */",
].join("\n");

/**
 * The configured path, tidied, or null for "no custom stylesheet".
 *
 * Null rather than an empty string so the caller cannot accidentally read
 * the vault root. A leading slash is dropped because a vault path has no
 * leading slash and typing one is the obvious mistake: Obsidian shows paths
 * without it, every other path setting here is stored without it, and a
 * reader who adds one should get their stylesheet rather than silence.
 */
export function normalizeCustomCssPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const tidied = raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
  return tidied.length ? tidied : null;
}

/**
 * The generated stylesheet with the author's appended.
 *
 * Returns the input untouched for a file that is empty or only whitespace,
 * so an author who has created the file but not written it yet gets the site
 * they had rather than a banner announcing nothing.
 */
export function withCustomCss(generated: string, custom: string): string {
  if (!custom.trim()) return generated;
  return `${generated}\n${CUSTOM_CSS_BANNER}\n\n${custom.trim()}\n`;
}

/** Just enough of the vault adapter to fetch one file. */
export interface CssReader {
  read(path: string): Promise<string>;
}

/** What the build learned about the configured stylesheet. */
export interface CustomCssLookup {
  /** The normalized path, or null when none is configured. */
  path: string | null;
  /** The file's contents, or null when there are none to use. */
  css: string | null;
  /** Why a configured stylesheet was not used, for the skipped list. */
  problem: string | null;
}

/**
 * Finds the configured stylesheet, or says why it is not being used.
 *
 * A seam rather than four lines inline in `buildSite`, because this is the
 * one link in the chain that can fail quietly: every outcome here except the
 * first produces a site that looks exactly like the site before it, and the
 * difference between "no stylesheet configured" and "configured, misspelled,
 * silently ignored" is the whole value of the feature working.
 */
export async function readCustomCss(
  reader: CssReader,
  configured: string | null | undefined,
  outputFolders: readonly string[],
  isOutput: (path: string, folders: readonly string[]) => boolean,
): Promise<CustomCssLookup> {
  const path = normalizeCustomCssPath(configured);
  if (!path) return { path: null, css: null, problem: null };

  /*
   * `_site-preview/assets/site.css` is the obvious thing to point at after
   * reading one to find the token names, and it is this build's own output:
   * appended to itself it would double the stylesheet on every build,
   * forever. Refused before it is read rather than after.
   */
  if (isOutput(path, outputFolders)) {
    return {
      path,
      css: null,
      problem:
        "custom stylesheet is inside a folder this plugin writes rather than " +
        "reads, so the site was built without it",
    };
  }

  try {
    return { path, css: await reader.read(path), problem: null };
  } catch (error) {
    // Reported rather than thrown. A missing stylesheet is a typo in a
    // setting, and failing a whole publish over the site's paint would be
    // out of proportion to it -- but saying nothing would leave somebody
    // editing a file the build never opened.
    return {
      path,
      css: null,
      problem:
        "custom stylesheet could not be read, so the site was built without " +
        `it: ${error instanceof Error ? error.message : error}`,
    };
  }
}
