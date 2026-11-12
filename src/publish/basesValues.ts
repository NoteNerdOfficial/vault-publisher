/**
 * Turning Bases values into page markup, for the capture view.
 *
 * Most values render themselves through Obsidian's `Value.renderTo`. Links
 * do not: a link value needs internal rendering state that a plugin's view
 * cannot supply, and throws. So any value whose text holds `[[links]]` is
 * written here instead, as the `internal-link` spans Bases' own list view
 * writes, which the link rewriter already turns into links to published
 * pages. Everything in this file is plain DOM and strings, so it is tested
 * without Obsidian.
 */

/** What a link resolves to: the vault path to point at, and a display name. */
export interface ResolvedLink {
  path: string;
  title: string;
}

const WIKILINK = /!?\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;

/** True when a value's text holds at least one `[[link]]`. */
export function hasWikilink(text: string): boolean {
  WIKILINK.lastIndex = 0;
  return WIKILINK.test(text);
}

/**
 * Writes `text` into `cell`, each `[[link]]` in it as a link span and the
 * rest as text. A link that does not resolve keeps its target in `data-href`
 * anyway, so the rewriter reports it as unresolved rather than it vanishing.
 */
export function writeLinkedText(
  cell: HTMLElement,
  text: string,
  resolve: (linkpath: string) => ResolvedLink | null,
): void {
  const doc = cell.ownerDocument;
  let last = 0;
  WIKILINK.lastIndex = 0;
  for (let match = WIKILINK.exec(text); match; match = WIKILINK.exec(text)) {
    if (match.index > last) cell.append(doc.createTextNode(text.slice(last, match.index)));
    const target = match[1].trim();
    const fragment = match[2] ?? "";
    const alias = match[3]?.trim();
    const resolved = resolve(target);
    const link = doc.createElement("span");
    link.className = "internal-link";
    link.setAttribute("data-href", (resolved?.path ?? target) + fragment);
    link.textContent = alias || resolved?.title || target.split("/").pop() || target;
    cell.append(link);
    last = match.index + match[0].length;
  }
  if (last < text.length) cell.append(doc.createTextNode(text.slice(last)));
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"]);

/** What a vault file resolves to, for an image. */
export interface ResolvedFile {
  extension: string;
  /** The address the page can load it from while it is being built. */
  url: string;
}

/**
 * The image a card's cover property points at, as an address, or null.
 *
 * Bases accepts a link to an image in the vault, a plain vault path, or a
 * web address. Anything else -- a link to a note, an empty value -- is no
 * cover, rather than a broken image.
 */
export function coverSource(
  text: string,
  resolve: (linkpath: string) => ResolvedFile | null,
): string | null {
  const value = text.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  WIKILINK.lastIndex = 0;
  const link = WIKILINK.exec(value);
  const linkpath = link ? link[1].trim() : value;
  const file = resolve(linkpath);
  if (!file || !IMAGE_EXTENSIONS.has(file.extension.toLowerCase())) return null;
  return file.url;
}

/**
 * A summary's property as Bases names it in a `.base` file, as the property
 * id the API takes. A bare name is a note property; `formula.` and `file.`
 * are already ids.
 */
export function summaryPropertyId(name: string): string {
  return /^(note|formula|file)\./.test(name) ? name : `note.${name}`;
}

/** A cards view's options, with Bases' own defaults and limits. */
export function cardOptions(get: (key: string) => unknown): {
  size: number;
  aspect: number;
  fit: "cover" | "contain";
} {
  const number = (key: string, fallback: number, min: number, max: number) => {
    const value = Number(get(key));
    return Number.isFinite(value) && value > 0 ? Math.min(max, Math.max(min, value)) : fallback;
  };
  return {
    size: number("cardSize", 200, 50, 800),
    aspect: number("imageAspectRatio", 1, 0.25, 2.5),
    fit: get("imageFit") === "contain" ? "contain" : "cover",
  };
}

/** A list view's options, with Bases' own defaults. */
export function listOptions(get: (key: string) => unknown): {
  markers: "bullet" | "number" | "none";
  separator: string;
  indent: boolean;
} {
  const markers = get("markers");
  const separator = get("separator");
  return {
    markers: markers === "number" || markers === "none" ? markers : "bullet",
    separator: typeof separator === "string" ? separator : ", ",
    indent: get("indentProperties") === true,
  };
}
