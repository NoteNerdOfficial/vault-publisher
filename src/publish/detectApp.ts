/**
 * Finding a built application in the vault, and saying what is wrong with it.
 *
 * Everything here reads. Nothing in this module writes a file, changes a
 * setting or runs a command -- the caller decides what to do with what it
 * is told, and the one thing it will never be told to do is run the build.
 *
 * ## Why the plugin does not build it
 *
 * `child_process` is reachable from a desktop-only plugin, and this still
 * does not use it. Three reasons, in the order they would actually bite:
 *
 * **PATH.** An application launched from Finder does not read a login
 * shell's profile. With nvm, fnm, asdf, volta or a centrally managed
 * toolchain -- which is to say, most machines that have Node at all -- the
 * `node` this process can see is not the one the user's terminal sees, if
 * there is one. Building from in here would turn a failure the user can
 * read into "it works in my terminal", which is worse than not trying.
 *
 * **It would be running the vault's code.** `npm install` runs
 * `postinstall`; `npm run build` runs whatever `package.json` says. A
 * publishing plugin that executes scripts it found in the vault is a
 * different and much larger thing than this one.
 *
 * **A build fails in prose.** Minutes of output, and the useful line is
 * rarely the last. A terminal is the right place to read it.
 *
 * So the command is composed, reported, and handed over. What this module
 * does instead is every part of the job that is deterministic: which
 * project, where its output goes, whether that output exists, whether it is
 * older than the source it came from, whether its `<base href>` will
 * resolve, and whether the site is pointed at it.
 *
 * ## Why the filesystem is the authority, not the config
 *
 * A config is read where it can be, and then checked. `angular.json` names
 * an `outputPath`, and Angular 17 and later write the browser bundle to a
 * `browser` subfolder of it, so the configured path is frequently the
 * parent of the answer. A Vite config is executable TypeScript and cannot
 * be parsed as data at all.
 *
 * What is unambiguous is the output itself: an `index.html` beside files
 * with content hashes in their names is a built application, whatever
 * produced it and whatever any config claims. So `looksBuilt` is the final
 * word, the config is a hint about where to look, and a project whose
 * config cannot be read is still found.
 */

import { baseHref, baseHrefHazard } from "./htmlFiles";

/**
 * Whether a filename carries a bundler's content hash.
 *
 * Written out rather than as one regex because the shapes genuinely
 * differ: Angular writes `main-7PPMPHZI.js`, Vite `index-a1b2c3d4.js`,
 * create-react-app `main.073c9b0a.chunk.js` -- dash or dot, and not always
 * the last segment before the extension.
 *
 * The test is a segment that is long, mixed, and has a digit in it. All
 * three are needed to keep hand-written names out: `my-component.js` has
 * the length and the letters and no digit, `jquery-3.6.0.min.js` has
 * digits in segments too short to be a hash. A content hash has all three
 * because it is base16 or base32 of something nobody chose.
 */
function isHashedAsset(name: string): boolean {
  if (!/\.(?:js|mjs|css)$/i.test(name)) return false;
  const parts = name.replace(/\.(?:js|mjs|css)$/i, "").split(/[-.]/);
  return parts.some(
    (part) =>
      part.length >= 6 &&
      /^[A-Za-z0-9_]+$/.test(part) &&
      /\d/.test(part) &&
      /[A-Za-z]/.test(part),
  );
}

/** The frameworks worth naming, because each one's remedy differs. */
export type Framework = "angular" | "vite" | "next" | "cra" | "unknown";

export interface DetectedApp {
  /** Folder holding the project's config. `""` is the vault root. */
  root: string;
  framework: Framework;
  /** The project's name where its config names one, for a workspace. */
  name: string | null;
  /** What the config says the output is, vault-relative, or null. */
  configuredOutput: string | null;
  /** The folder that actually holds `index.html`, or null when unbuilt. */
  builtOutput: string | null;
  /** What to run in a terminal. Reported, never executed. */
  command: string;
}

/** A file as this module needs it: a path, and when it last changed. */
export interface SeenFile {
  path: string;
  mtime: number;
}

/**
 * Joins a project root to a path inside it, without a leading slash.
 *
 * `""` is the vault root, which is the common case when somebody opens a
 * project folder as a vault -- so the join has to not produce `/dist`.
 */
export function underRoot(root: string, rest: string): string {
  const tidy = rest.replace(/^\.\//, "").replace(/^\/+|\/+$/g, "");
  if (!root) return tidy;
  return tidy ? `${root}/${tidy}` : root;
}

/** The folder a path is in, or `""` when it is at the vault root. */
export function folderOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

/**
 * Whether a folder holds a built application.
 *
 * Both halves are required and the second is what makes this worth
 * trusting. An `index.html` on its own is any page at all -- a saved
 * article, a hand-written prototype, the unbuilt `src/index.html` that
 * started this whole line of work. A hashed filename beside it is a
 * bundler's signature: nobody types `main-GHI789.js`.
 */
export function looksBuilt(files: readonly string[], folder: string): boolean {
  const prefix = folder ? `${folder}/` : "";
  let index = false;
  let hashed = false;
  for (const path of files) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    // The page itself must be a direct child -- that is what makes this
    // folder the site root rather than somewhere above it.
    if (rest === "index.html") index = true;
    /*
     * The bundles may be at any depth, and usually are not direct
     * children: Vite writes `assets/index-a1b2c3d4.js` and
     * create-react-app `static/js/main.073c9b0a.chunk.js`. Only Angular
     * puts them beside the page. Requiring a direct child here found
     * Angular and missed the other two.
     */
    if (!hashed && isHashedAsset(rest.slice(rest.lastIndexOf("/") + 1))) hashed = true;
    if (index && hashed) return true;
  }
  return false;
}

/**
 * The built folder for a project, preferring what is on disk.
 *
 * Tries the configured path, then that path's `browser` subfolder, then
 * every folder under the root that looks built. The second is Angular 17
 * and later, where `outputPath: "dist/app"` produces `dist/app/browser` --
 * a mismatch nobody expects and the source of the wrong answer in the
 * session this came from.
 *
 * The third is the fallback that makes a parsed config optional: it finds
 * an output whose config could not be read, could not be understood, or
 * does not exist. Deepest-first, so `dist/app/browser` is preferred over
 * `dist/app` when both somehow qualify.
 */
export function resolveBuiltOutput(
  files: readonly string[],
  root: string,
  configured: string | null,
): string | null {
  if (configured) {
    for (const candidate of [configured, `${configured}/browser`]) {
      if (looksBuilt(files, candidate)) return candidate;
    }
    /*
     * A configured path that holds no build means not built, and the scan
     * below must not run. In a workspace it would find a *sibling*
     * project's output and report this project as built from it -- two
     * applications, one `dist`, and the wrong one published.
     */
    return null;
  }

  const prefix = root ? `${root}/` : "";
  const folders = new Set<string>();
  for (const path of files) {
    if (!path.endsWith("/index.html")) continue;
    if (!path.startsWith(prefix)) continue;
    folders.add(folderOf(path));
  }
  const found = Array.from(folders)
    .filter((folder) => looksBuilt(files, folder))
    .sort((a, b) => b.split("/").length - a.split("/").length || a.localeCompare(b));
  return found[0] ?? null;
}

/**
 * `outputPath` for each project in an `angular.json`.
 *
 * Angular has written this two ways. It was a string; it is now also an
 * object with a `base`, which is the form the newer builder emits. Both are
 * read, because a vault may hold a project of either age.
 */
export function angularOutputs(text: string): { name: string; output: string | null }[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A config that is not JSON tells us nothing, and the folder scan below
    // does not need it. The project is still found.
    return [];
  }
  const projects = (parsed as { projects?: Record<string, unknown> }).projects;
  if (!projects || typeof projects !== "object") return [];

  const out: { name: string; output: string | null }[] = [];
  for (const [name, value] of Object.entries(projects)) {
    const options = (
      value as {
        architect?: { build?: { options?: Record<string, unknown> } };
        targets?: { build?: { options?: Record<string, unknown> } };
      }
    );
    // `architect` is the Angular name, `targets` the Nx one for the same thing.
    const build = options?.architect?.build?.options ?? options?.targets?.build?.options;
    const raw = build?.outputPath;
    const output =
      typeof raw === "string"
        ? raw
        : raw && typeof raw === "object" && typeof (raw as { base?: unknown }).base === "string"
          ? (raw as { base: string }).base
          : null;
    out.push({ name, output });
  }
  return out;
}

/**
 * `build.outDir` from a Vite config, by reading the text.
 *
 * A Vite config is a TypeScript module that exports the result of calling a
 * function, so there is nothing to parse as data and nothing short of
 * running it that is correct in general. A regex over the source is the
 * honest approximation: it finds the value when it is written as a literal,
 * which is how it is written, and finds nothing when it is computed -- in
 * which case `resolveBuiltOutput` falls back to looking for the folder.
 */
export function viteOutDir(text: string): string | null {
  const match = /\boutDir\s*:\s*["'`]([^"'`]+)["'`]/.exec(text);
  return match ? match[1].replace(/^\.\//, "").replace(/\/+$/, "") : null;
}

/** Whether a `package.json` declares a script, and what the build one is. */
export function packageScripts(text: string): Record<string, string> {
  try {
    const parsed = JSON.parse(text) as { scripts?: Record<string, string> };
    return parsed.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {};
  } catch {
    return {};
  }
}

/** Whether a `package.json` depends on something, at any tier. */
export function dependsOn(text: string, name: string): boolean {
  try {
    const parsed = JSON.parse(text) as Record<string, Record<string, string> | undefined>;
    for (const tier of ["dependencies", "devDependencies", "peerDependencies"]) {
      const block = parsed[tier];
      if (block && typeof block === "object" && name in block) return true;
    }
  } catch {
    // Unreadable, so nothing is known about it. The marker files decide.
  }
  return false;
}

/**
 * What to tell the user to run.
 *
 * `npm run build` whenever a build script exists, because that is the
 * project's own answer and may do more than call the bundler. Otherwise the
 * framework's command through `npx`.
 *
 * **Never the bare `ng`.** The CLI is a local devDependency of the project
 * and is usually not on PATH; `ng build` answering `command not found` is
 * the exact wrong turn the session behind this module took. `npx` runs the
 * copy in `node_modules`, which is the one that is certainly there.
 */
export function buildCommand(framework: Framework, scripts: Record<string, string>): string {
  if (scripts.build) return "npm run build";
  switch (framework) {
    case "angular":
      return "npx ng build";
    case "vite":
      return "npx vite build";
    case "next":
      return "npx next build";
    case "cra":
      return "npx react-scripts build";
    default:
      return "npm run build";
  }
}

/** The newest mtime among a project's sources, or null when it has none. */
export function newestSource(files: readonly SeenFile[], root: string, output: string | null): number | null {
  const prefix = root ? `${root}/` : "";
  const skip = output ? (output.endsWith("/") ? output : `${output}/`) : null;
  let newest: number | null = null;
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    if (skip && (file.path === output || file.path.startsWith(skip))) continue;
    if (!/\.(?:ts|tsx|js|jsx|mjs|html|css|scss|sass|less|json|svg)$/i.test(file.path)) continue;
    if (newest === null || file.mtime > newest) newest = file.mtime;
  }
  return newest;
}

/**
 * Whether the build is older than what it was built from.
 *
 * The check worth the whole module. A stale `dist` is the one failure that
 * looks exactly like a bug in the application: it publishes, it renders,
 * and it renders something the author changed an hour ago. Nothing else
 * reports it, because nothing else is wrong.
 *
 * A second of slack, since a build writes its own output while the source
 * files it just read still carry the same second on a filesystem that keeps
 * whole seconds.
 */
export function isStale(builtAt: number | null, sourceAt: number | null): boolean {
  if (builtAt === null || sourceAt === null) return false;
  return sourceAt > builtAt + 1000;
}

/**
 * A destination for the site, from the project's own name.
 *
 * `dist/some-long-project-name/browser` is a correct answer and
 * nobody wants it in a URL, which is what `at` on a whole-folder entry is
 * for. The name of the folder the project lives in is what its author
 * already calls it; the vault root falls back to `app`, since the root has
 * no name to take.
 */
export function suggestedDestination(app: DetectedApp): string {
  const source = app.name ?? (app.root ? app.root.slice(app.root.lastIndexOf("/") + 1) : "");
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "app";
}

/* --- the scan, against a vault -------------------------------------- */

/** Everything the scan needs from Obsidian, so a test can stand in for it. */
export interface VaultView {
  files: readonly SeenFile[];
  read(path: string): Promise<string | null>;
}

/** One project's findings, as the panel shows them. */
export interface AppReport {
  app: DetectedApp;
  /** The output folder exists and holds a build. */
  built: boolean;
  /** When the build was written, from its `index.html`. */
  builtAt: number | null;
  /** The newest source file, for the staleness line. */
  sourceAt: number | null;
  stale: boolean;
  /** The built page's `<base href>`, and why it will not work. */
  baseHref: string | null;
  baseHrefHazard: string | null;
}

/** The marker files that say "a project lives here", and what they mean. */
const MARKERS: { file: string; framework: Framework }[] = [
  { file: "angular.json", framework: "angular" },
  { file: "vite.config.ts", framework: "vite" },
  { file: "vite.config.js", framework: "vite" },
  { file: "vite.config.mjs", framework: "vite" },
  { file: "next.config.js", framework: "next" },
  { file: "next.config.mjs", framework: "next" },
];

/**
 * Every project in the vault, with its output resolved and checked.
 *
 * `skip` is the caller's filter -- the same one selection uses, so
 * `node_modules`, hidden folders, the build's own output and anything the
 * author excluded are all out. Without it the first `angular.json` found
 * would be one inside a dependency's test fixtures.
 */
export async function scanForApps(
  vault: VaultView,
  skip: (path: string) => boolean,
): Promise<AppReport[]> {
  const paths = vault.files.map((file) => file.path).filter((path) => !skip(path));
  const mtimes = new Map(vault.files.map((file) => [file.path, file.mtime]));
  const present = new Set(paths);
  const found: DetectedApp[] = [];
  const claimed = new Set<string>();

  for (const path of paths) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const marker = MARKERS.find((entry) => entry.file === name);
    if (!marker) continue;
    const root = folderOf(path);
    if (claimed.has(root)) continue;
    claimed.add(root);

    const text = (await vault.read(path)) ?? "";
    const pkgPath = underRoot(root, "package.json");
    const pkg = present.has(pkgPath) ? ((await vault.read(pkgPath)) ?? "") : "";
    const scripts = packageScripts(pkg);

    if (marker.framework === "angular") {
      const projects = angularOutputs(text);
      // A workspace with several projects is several entries, each with its
      // own output. One with none still gets an entry, found by the folder
      // scan, because a config this could not read is not a missing project.
      const rows = projects.length ? projects : [{ name: null as string | null, output: null }];
      for (const project of rows) {
        const configured = project.output ? underRoot(root, project.output) : null;
        found.push({
          root,
          framework: "angular",
          name: project.name,
          configuredOutput: configured,
          builtOutput: resolveBuiltOutput(paths, root, configured),
          command: buildCommand("angular", scripts),
        });
      }
      continue;
    }

    const configured =
      marker.framework === "vite"
        ? (() => {
            const dir = viteOutDir(text);
            return underRoot(root, dir ?? "dist");
          })()
        : null;
    found.push({
      root,
      framework: marker.framework,
      name: null,
      configuredOutput: configured,
      builtOutput: resolveBuiltOutput(paths, root, configured),
      command: buildCommand(marker.framework, scripts),
    });
  }

  // Create React App has no config file of its own, so it is found by its
  // dependency instead -- and only where no marker already claimed the root.
  for (const path of paths) {
    if (!path.endsWith("package.json")) continue;
    const root = folderOf(path);
    if (claimed.has(root)) continue;
    const text = (await vault.read(path)) ?? "";
    if (!dependsOn(text, "react-scripts")) continue;
    claimed.add(root);
    const configured = underRoot(root, "build");
    found.push({
      root,
      framework: "cra",
      name: null,
      configuredOutput: configured,
      builtOutput: resolveBuiltOutput(paths, root, configured),
      command: buildCommand("cra", packageScripts(text)),
    });
  }

  const reports: AppReport[] = [];
  for (const app of found) {
    const index = app.builtOutput ? underRoot(app.builtOutput, "index.html") : null;
    const builtAt = index ? (mtimes.get(index) ?? null) : null;
    const sourceAt = newestSource(vault.files, app.root, app.builtOutput);
    const html = index ? await vault.read(index) : null;
    const base = html ? baseHref(html) : null;
    reports.push({
      app,
      built: !!app.builtOutput,
      builtAt,
      sourceAt,
      stale: isStale(builtAt, sourceAt),
      baseHref: base,
      baseHrefHazard: html ? baseHrefHazard(base) : null,
    });
  }
  return reports;
}
