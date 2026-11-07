import { describe, expect, it } from "vitest";
import {
  type SeenFile,
  type VaultView,
  angularOutputs,
  buildCommand,
  dependsOn,
  folderOf,
  isStale,
  looksBuilt,
  newestSource,
  resolveBuiltOutput,
  scanForApps,
  suggestedDestination,
  underRoot,
  viteOutDir,
} from "./detectApp";

/*
 * The vault this module was written against: an Angular project opened as
 * a vault, which is what somebody does when the notes and the application
 * are the same piece of work. Angular 17 and later put the browser bundle
 * under `browser`, which is the mismatch the whole resolver exists for.
 */
const ANGULAR_JSON = JSON.stringify({
  projects: {
    "web-app": {
      projectType: "application",
      architect: { build: { options: { outputPath: "dist/web-app" } } },
    },
  },
});

describe("looksBuilt", () => {
  /*
   * Both halves are needed. An `index.html` alone is any page at all --
   * including the unbuilt `src/index.html` that started this. A hashed
   * filename beside it is a bundler's signature and nothing else's.
   */
  it("wants an index.html and a hashed asset beside it", () => {
    const built = ["dist/app/browser/index.html", "dist/app/browser/main-GHI789.js"];
    expect(looksBuilt(built, "dist/app/browser")).toBe(true);
  });

  it("says no to a source index.html with no build beside it", () => {
    expect(looksBuilt(["src/index.html", "src/main.ts", "src/styles.scss"], "src")).toBe(false);
  });

  it("says no to a hand-written page", () => {
    const proto = ["prototypes/deck/index.html", "prototypes/deck/slide-two.html"];
    expect(looksBuilt(proto, "prototypes/deck")).toBe(false);
  });

  /*
   * The page must be a direct child; the bundles need not be, and usually
   * are not. Vite writes `assets/`, create-react-app writes `static/js/`,
   * and only Angular puts them beside the page.
   */
  it("finds bundles nested under the folder, as Vite and CRA write them", () => {
    expect(looksBuilt(["d/index.html", "d/assets/index-a1b2c3d4.js"], "d")).toBe(true);
    expect(looksBuilt(["b/index.html", "b/static/js/main.073c9b0a.chunk.js"], "b")).toBe(true);
  });

  it("counts a hashed stylesheet as readily as a script", () => {
    expect(looksBuilt(["d/index.html", "d/styles-ABCD1234.css"], "d")).toBe(true);
  });

  /*
   * The three things that separate a content hash from a name somebody
   * typed: length, a digit, and a letter. Each of these fails one.
   */
  it("does not mistake a hand-written filename for a bundle", () => {
    expect(looksBuilt(["d/index.html", "d/my-component.js"], "d")).toBe(false);
    expect(looksBuilt(["d/index.html", "d/jquery-3.6.0.min.js"], "d")).toBe(false);
    expect(looksBuilt(["d/index.html", "d/app.js"], "d")).toBe(false);
  });
});

describe("resolveBuiltOutput", () => {
  const FILES = [
    "angular.json",
    "src/index.html",
    "src/main.ts",
    "dist/web-app/browser/index.html",
    "dist/web-app/browser/main-GHI789.js",
  ];

  /*
   * The configured path is the parent of the answer, which is the single
   * most common wrong turn: `outputPath` says `dist/web-app` and the
   * files are one folder further down.
   */
  it("follows a configured path into its browser subfolder", () => {
    expect(resolveBuiltOutput(FILES, "", "dist/web-app")).toBe(
      "dist/web-app/browser",
    );
  });

  it("takes the configured path when the build is really there", () => {
    const flat = ["dist/index.html", "dist/main-GHI789.js"];
    expect(resolveBuiltOutput(flat, "", "dist")).toBe("dist");
  });

  /*
   * The fallback that makes a parsed config optional. A Vite config that
   * computes its own `outDir`, a builder nobody here has heard of, a
   * config that is not valid JSON -- the output is still found, because
   * the output is the thing that is unambiguous.
   */
  it("finds a build with no usable config at all", () => {
    expect(resolveBuiltOutput(FILES, "", null)).toBe("dist/web-app/browser");
  });

  it("is null when nothing has been built", () => {
    const unbuilt = ["angular.json", "src/index.html", "src/main.ts"];
    expect(resolveBuiltOutput(unbuilt, "", "dist/web-app")).toBeNull();
  });

  // Deepest first, so `dist/app/browser` beats `dist/app` if both qualify.
  it("prefers the deeper of two candidates", () => {
    const both = [
      "dist/app/index.html",
      "dist/app/main-AAAA1111.js",
      "dist/app/browser/index.html",
      "dist/app/browser/main-BBBB2222.js",
    ];
    expect(resolveBuiltOutput(both, "", null)).toBe("dist/app/browser");
  });
});

describe("angularOutputs", () => {
  it("reads outputPath as a string", () => {
    expect(angularOutputs(ANGULAR_JSON)).toEqual([
      { name: "web-app", output: "dist/web-app" },
    ]);
  });

  // The newer builder writes an object with a `base`.
  it("reads outputPath as an object", () => {
    const text = JSON.stringify({
      projects: { web: { architect: { build: { options: { outputPath: { base: "dist/web" } } } } } },
    });
    expect(angularOutputs(text)).toEqual([{ name: "web", output: "dist/web" }]);
  });

  // Nx calls the same block `targets`.
  it("reads an Nx workspace's targets block", () => {
    const text = JSON.stringify({
      projects: { web: { targets: { build: { options: { outputPath: "dist/web" } } } } },
    });
    expect(angularOutputs(text)).toEqual([{ name: "web", output: "dist/web" }]);
  });

  /*
   * A config that cannot be read is not a missing project: the caller
   * still makes an entry and the folder scan still finds the output.
   */
  it("gives nothing back for a config it cannot parse", () => {
    expect(angularOutputs("{ not json")).toEqual([]);
  });

  it("keeps a project whose build declares no output", () => {
    const text = JSON.stringify({ projects: { lib: { projectType: "library" } } });
    expect(angularOutputs(text)).toEqual([{ name: "lib", output: null }]);
  });
});

describe("viteOutDir", () => {
  it("reads a literal outDir", () => {
    expect(viteOutDir(`export default defineConfig({ build: { outDir: "docs/demo" } })`)).toBe(
      "docs/demo",
    );
  });

  it("tidies a leading ./ and a trailing slash", () => {
    expect(viteOutDir(`build: { outDir: './out/' }`)).toBe("out");
  });

  /*
   * A computed value is not readable without running the config, and
   * guessing would be worse than the folder scan that follows.
   */
  it("gives up on a computed one", () => {
    expect(viteOutDir(`build: { outDir: resolve(__dirname, "dist") }`)).toBeNull();
  });
});

describe("buildCommand", () => {
  /*
   * Never the bare `ng`. The CLI is a local devDependency, so `ng build`
   * answers `command not found` on a machine with no global install --
   * which is the wrong turn the session behind this module took.
   */
  it("reaches a framework CLI through npx, never bare", () => {
    expect(buildCommand("angular", {})).toBe("npx ng build");
    expect(buildCommand("vite", {})).toBe("npx vite build");
    expect(buildCommand("angular", {})).not.toContain("ng build --");
    for (const framework of ["angular", "vite", "next", "cra"] as const) {
      expect(buildCommand(framework, {})).toMatch(/^npx /);
    }
  });

  // The project's own script wins: it may do more than call the bundler.
  it("prefers the project's own build script", () => {
    expect(buildCommand("angular", { build: "ng build --configuration demo" })).toBe(
      "npm run build",
    );
  });
});

describe("isStale", () => {
  /*
   * The check worth the whole module. A stale build publishes, renders,
   * and renders something the author changed an hour ago -- which is
   * indistinguishable from a bug in the application.
   */
  it("reports a build older than its source", () => {
    expect(isStale(1_000_000, 2_000_000)).toBe(true);
  });

  it("says nothing about a build newer than its source", () => {
    expect(isStale(2_000_000, 1_000_000)).toBe(false);
  });

  // A build writes its output in the same second it read the sources.
  it("allows a second of slack", () => {
    expect(isStale(1_000_000, 1_000_500)).toBe(false);
  });

  it("says nothing when either side is unknown", () => {
    expect(isStale(null, 2_000_000)).toBe(false);
    expect(isStale(1_000_000, null)).toBe(false);
  });
});

describe("newestSource", () => {
  const FILES: SeenFile[] = [
    { path: "src/main.ts", mtime: 500 },
    { path: "src/app/app.ts", mtime: 900 },
    { path: "dist/app/main-GHI789.js", mtime: 2_000 },
    { path: "README.md", mtime: 3_000 },
  ];

  /*
   * The output is excluded or every build would be newer than its own
   * source by definition, and the check would never fire.
   */
  it("ignores the output folder it is being compared against", () => {
    expect(newestSource(FILES, "", "dist/app")).toBe(900);
  });

  // Markdown is a note, not a source file; a note edited now is not a
  // reason to rebuild an application.
  it("ignores files a build does not read", () => {
    expect(newestSource(FILES, "", "dist/app")).not.toBe(3_000);
  });
});

describe("suggestedDestination", () => {
  const base = {
    root: "",
    framework: "angular" as const,
    configuredOutput: null,
    builtOutput: null,
    command: "npm run build",
  };

  /*
   * `dist/some-long-project-name/browser` is a correct answer
   * and not one anybody wants in a URL.
   */
  it("takes the project's own name over its path", () => {
    expect(suggestedDestination({ ...base, name: "web-app" })).toBe("web-app");
  });

  it("falls back to the folder the project is in", () => {
    expect(suggestedDestination({ ...base, root: "apps/Web Client", name: null })).toBe(
      "web-client",
    );
  });

  // The vault root has no name to take.
  it("answers app for a project at the vault root", () => {
    expect(suggestedDestination({ ...base, root: "", name: null })).toBe("app");
  });
});

describe("underRoot and folderOf", () => {
  it("does not grow a leading slash at the vault root", () => {
    expect(underRoot("", "dist/app")).toBe("dist/app");
    expect(underRoot("apps/web", "dist")).toBe("apps/web/dist");
    expect(underRoot("apps/web", "./dist/")).toBe("apps/web/dist");
  });

  it("calls the vault root an empty string", () => {
    expect(folderOf("angular.json")).toBe("");
    expect(folderOf("apps/web/angular.json")).toBe("apps/web");
  });
});

describe("dependsOn", () => {
  it("finds a dependency at any tier", () => {
    const pkg = JSON.stringify({ devDependencies: { "react-scripts": "5.0.1" } });
    expect(dependsOn(pkg, "react-scripts")).toBe(true);
    expect(dependsOn(pkg, "vite")).toBe(false);
  });
});

/* --- the scan, end to end -------------------------------------------- */

function view(files: Record<string, { mtime?: number; text?: string }>): VaultView {
  return {
    files: Object.entries(files).map(([path, meta]) => ({ path, mtime: meta.mtime ?? 1_000 })),
    read: async (path: string) => files[path]?.text ?? null,
  };
}

const nothingSkipped = () => false;

describe("scanForApps", () => {
  /*
   * The vault from the session this was written for: an Angular project
   * opened as a vault, built, with its output one folder deeper than the
   * config says.
   */
  it("finds a built Angular project at the vault root", async () => {
    const reports = await scanForApps(
      view({
        "angular.json": { text: ANGULAR_JSON },
        "package.json": { text: JSON.stringify({ scripts: { build: "ng build" } }) },
        "src/index.html": { text: `<base href="/"><app-root></app-root>` },
        "dist/web-app/browser/index.html": {
          mtime: 9_000,
          text: `<base href="./"><app-root></app-root><script src="main-GHI789.js"></script>`,
        },
        "dist/web-app/browser/main-GHI789.js": { mtime: 9_000 },
      }),
      nothingSkipped,
    );

    expect(reports).toHaveLength(1);
    const [report] = reports;
    expect(report.app.framework).toBe("angular");
    expect(report.app.name).toBe("web-app");
    expect(report.app.builtOutput).toBe("dist/web-app/browser");
    expect(report.app.command).toBe("npm run build");
    expect(report.built).toBe(true);
    expect(report.baseHref).toBe("./");
    expect(report.baseHrefHazard).toBeNull();
    expect(report.stale).toBe(false);
  });

  /*
   * The state the user was actually in: source only, nothing built. The
   * project is found and reported as unbuilt, which is the whole point --
   * "there is no build" is the answer, not "there is no project".
   */
  it("finds an unbuilt project and says so", async () => {
    const reports = await scanForApps(
      view({
        "angular.json": { text: ANGULAR_JSON },
        "src/index.html": { text: `<app-root></app-root>` },
        "src/main.ts": {},
      }),
      nothingSkipped,
    );

    expect(reports).toHaveLength(1);
    expect(reports[0].built).toBe(false);
    expect(reports[0].app.builtOutput).toBeNull();
    // No package.json, so the framework's own command, through npx.
    expect(reports[0].app.command).toBe("npx ng build");
  });

  // The default `ng build`, which publishes and renders nothing.
  it("reports a root-absolute base href on a build that is otherwise fine", async () => {
    const reports = await scanForApps(
      view({
        "angular.json": { text: ANGULAR_JSON },
        "dist/web-app/browser/index.html": {
          text: `<base href="/"><app-root></app-root>`,
        },
        "dist/web-app/browser/main-GHI789.js": {},
      }),
      nothingSkipped,
    );

    expect(reports[0].built).toBe(true);
    expect(reports[0].baseHref).toBe("/");
    expect(reports[0].baseHrefHazard).toContain("root of the server");
  });

  it("reports a build older than its source", async () => {
    const reports = await scanForApps(
      view({
        "angular.json": { text: ANGULAR_JSON },
        "src/app/app.ts": { mtime: 9_000 },
        "dist/web-app/browser/index.html": { mtime: 1_000, text: `<base href="./">` },
        "dist/web-app/browser/main-GHI789.js": { mtime: 1_000 },
      }),
      nothingSkipped,
    );

    expect(reports[0].stale).toBe(true);
  });

  /*
   * Without the caller's filter, the first `angular.json` found is one in
   * a dependency's test fixtures. This is the same filter selection uses.
   */
  it("honours the caller's skip, so node_modules is not a project", async () => {
    const reports = await scanForApps(
      view({
        "node_modules/@angular/cli/fixtures/angular.json": { text: ANGULAR_JSON },
        "angular.json": { text: ANGULAR_JSON },
      }),
      (path) => path.startsWith("node_modules/"),
    );

    expect(reports).toHaveLength(1);
    expect(reports[0].app.root).toBe("");
  });

  it("finds a Vite project and its configured outDir", async () => {
    const reports = await scanForApps(
      view({
        "proto/deck/vite.config.ts": { text: `export default { build: { outDir: "out" } }` },
        "proto/deck/out/index.html": { text: `<div id="app"></div>` },
        "proto/deck/out/index-ABCD1234.js": {},
      }),
      nothingSkipped,
    );

    expect(reports[0].app.framework).toBe("vite");
    expect(reports[0].app.builtOutput).toBe("proto/deck/out");
  });

  // CRA has no config of its own, so it is found by its dependency.
  it("finds a create-react-app by react-scripts", async () => {
    const reports = await scanForApps(
      view({
        "apps/crm/package.json": {
          text: JSON.stringify({ dependencies: { "react-scripts": "5.0.1" } }),
        },
        "apps/crm/build/index.html": { text: `<div id="root"></div>` },
        "apps/crm/build/main-ABCD1234.js": {},
      }),
      nothingSkipped,
    );

    expect(reports[0].app.framework).toBe("cra");
    expect(reports[0].app.builtOutput).toBe("apps/crm/build");
  });

  // A workspace is several applications, each with its own output.
  it("reports each project in a workspace separately", async () => {
    const workspace = JSON.stringify({
      projects: {
        web: { architect: { build: { options: { outputPath: "dist/web" } } } },
        admin: { architect: { build: { options: { outputPath: "dist/admin" } } } },
      },
    });
    const reports = await scanForApps(
      view({
        "angular.json": { text: workspace },
        "dist/web/index.html": { text: "<app-root></app-root>" },
        "dist/web/main-ABCD1234.js": {},
      }),
      nothingSkipped,
    );

    expect(reports.map((r) => r.app.name)).toEqual(["web", "admin"]);
    expect(reports[0].built).toBe(true);
    expect(reports[1].built).toBe(false);
  });

  it("finds nothing in a vault of notes", async () => {
    const reports = await scanForApps(
      view({ "Notes/Plan.md": {}, "Notes/Scope.md": {} }),
      nothingSkipped,
    );
    expect(reports).toEqual([]);
  });
});
