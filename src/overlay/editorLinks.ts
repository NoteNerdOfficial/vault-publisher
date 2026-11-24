/**
 * Links that open a file at a line in the reader's own editor, for Edit
 * mode's Code section.
 *
 * Each editor is a URL template. The placeholders are filled in on the
 * server, which is the only side that knows where the vault is on disk:
 *
 * - `{path}`: the file's absolute path on this machine
 * - `{file}`: its path inside the vault
 * - `{vault}`: the vault's name
 * - `{line}`, `{column}`: where the layer or rule starts, from 1
 */
export interface EditorChoice {
  id: string;
  name: string;
  template: string;
}

export const EDITORS: EditorChoice[] = [
  { id: "vscode", name: "VS Code", template: "vscode://file{path}:{line}:{column}" },
  { id: "cursor", name: "Cursor", template: "cursor://file{path}:{line}:{column}" },
  { id: "windsurf", name: "Windsurf", template: "windsurf://file{path}:{line}:{column}" },
  { id: "zed", name: "Zed", template: "zed://file{path}:{line}:{column}" },
  { id: "vscode-insiders", name: "VS Code Insiders", template: "vscode-insiders://file{path}:{line}:{column}" },
  // No line: Obsidian's own links open a file, not a place in it.
  { id: "obsidian", name: "Obsidian", template: "obsidian://open?vault={vault}&file={file}" },
];

export const DEFAULT_EDITOR = "vscode";

/** The editor a setting names, or the custom one built from its template. */
export function editorChoice(id: string | undefined, custom: string | undefined): EditorChoice | null {
  if (id === "none") return null;
  if (id === "custom") {
    const template = (custom ?? "").trim();
    return template ? { id: "custom", name: "your editor", template } : null;
  }
  return EDITORS.find((e) => e.id === id) ?? EDITORS.find((e) => e.id === DEFAULT_EDITOR)!;
}

/** Schemes that would run something in the page rather than open an app. */
const REFUSED = /^(javascript|data|vbscript|file|blob):/i;

/**
 * The link for one place, or null when the template cannot make a safe one:
 * no scheme, a scheme that runs code, or a placeholder it needs that has no
 * value here (an absolute path on a vault that has none).
 */
export function editorLink(
  template: string,
  place: { path: string | null; file: string; vault: string; line: number; column: number },
): string | null {
  if (template.includes("{path}") && !place.path) return null;
  const absolute = place.path ? (place.path.startsWith("/") ? place.path : `/${place.path}`) : "";
  const url = template
    .replace(/\{path\}/g, encodeURI(absolute))
    .replace(/\{file\}/g, encodeURIComponent(place.file))
    .replace(/\{vault\}/g, encodeURIComponent(place.vault))
    .replace(/\{line\}/g, String(place.line))
    .replace(/\{column\}/g, String(place.column));
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url) || REFUSED.test(url)) return null;
  return url;
}
