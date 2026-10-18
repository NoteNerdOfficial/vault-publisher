/**
 * Finding out where the published page's CSS would come from.
 *
 * Rendering correct markup is only half the job: Obsidian's output is styled
 * by app.css, the active theme, snippets and each plugin's own stylesheet,
 * and a published page gets none of that for free. The options are to ship
 * our own CSS written against Obsidian's class names, or to harvest the rules
 * already loaded in the app. Harvesting only works if the rules are readable
 * from script, which depends on how each sheet was injected -- so measure it
 * rather than assume.
 */

export interface SheetInfo {
  /** href, or a description of the injected <style> node. */
  source: string;
  /** Which part of the app the sheet most likely belongs to. */
  origin: "app" | "theme" | "plugin" | "snippet" | "inline" | "unknown";
  /** Rules counted, or null when the sheet could not be read. */
  rules: number | null;
  /** Why the sheet could not be read, when it could not. */
  error: string | null;
}

export interface CssProbeResult {
  sheets: SheetInfo[];
  totalSheets: number;
  readableSheets: number;
  totalRules: number;
}

function classify(sheet: CSSStyleSheet): SheetInfo["origin"] {
  const href = sheet.href ?? "";
  const node = sheet.ownerNode as HTMLElement | null;

  if (href.includes("app.css")) return "app";
  if (href.includes("/themes/") || node?.classList.contains("theme")) return "theme";
  if (href.includes("/plugins/")) return "plugin";
  if (href.includes("/snippets/")) return "snippet";
  // Plugins that ship styles.css get it injected as a <style> tagged with
  // their id; that attribute is the only thing tying the rules to a plugin.
  if (node?.tagName === "STYLE") {
    const id = node.getAttribute("data-plugin-id") ?? node.id;
    if (id) return "plugin";
    return "inline";
  }
  return "unknown";
}

export function probeStylesheets(): CssProbeResult {
  const sheets: SheetInfo[] = [];
  let readableSheets = 0;
  let totalRules = 0;

  for (const sheet of Array.from(document.styleSheets)) {
    const node = sheet.ownerNode as HTMLElement | null;
    const source =
      sheet.href ??
      (node
        ? `<${node.tagName.toLowerCase()}${node.id ? ` id="${node.id}"` : ""}>`
        : "(unknown)");

    let rules: number | null = null;
    let error: string | null = null;
    try {
      // Throws a SecurityError for cross-origin sheets. Obsidian's own sheets
      // are local, so a throw here is the interesting case, not the norm.
      rules = sheet.cssRules.length;
      readableSheets++;
      totalRules += rules;
    } catch (e) {
      error = e instanceof Error ? e.name : String(e);
    }

    sheets.push({ source, origin: classify(sheet), rules, error });
  }

  return {
    sheets,
    totalSheets: document.styleSheets.length,
    readableSheets,
    totalRules,
  };
}
