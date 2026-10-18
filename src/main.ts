import { App, Notice, Plugin, TFile, apiVersion, normalizePath } from "obsidian";
import { diagnoseRender } from "./render/diagnose";
import { createRenderHost, renderFile, RenderedNote } from "./render/renderNote";
import { findStaticHazards, probeHtml, ProbeResult } from "./render/probe";
import { probeStylesheets } from "./render/cssProbe";
import { waitForDataviewIndex } from "./render/settle";
import { countInvalidNesting } from "./publish/normalize";
import { buildSite, BuildResult, SiteConfig } from "./publish/buildSite";
import { formatBytes } from "./publish/drift";
import { DEFAULT_THEME } from "./publish/themes";
import {
  probeBackgroundThrottling,
  suspendBackgroundThrottling,
} from "./platform/backgroundThrottling";
import { GITHUB_COM_API, GitHubClient, GitHubError } from "./github/client";

/**
 * Spike plugin: renders a vault through Obsidian, builds a static site from
 * the result, and commits it to GitHub.
 *
 * `autoRun` exists so the whole loop can be driven from a shell during
 * development, by writing data.json and touching the build. Obsidian offers
 * no way to invoke a command from outside, and clicking through the UI for
 * every iteration would make the measurements no one can reproduce.
 */

const INPUT_FOLDER = "spike-notes";
const OUTPUT_FOLDER = "_spike-output";
const PREVIEW_FOLDER = "_site-preview";

interface Settings {
  autoRun: "none" | "spike" | "build" | "publish" | "diagnose" | "electron";
  /** Note the diagnose run samples, as a vault path. */
  diagnosePath?: string;
  site: SiteConfig;
  github: {
    apiBase: string;
    owner: string;
    repo: string;
    branch: string;
    token: string;
    /** Pages cannot serve a private repository on a free plan. */
    private: boolean;
  };
}

const DEFAULT_SETTINGS: Settings = {
  autoRun: "none",
  site: {
    siteName: "Spike Site",
    folder: "spike-notes",
    requireFrontmatterFlag: null,
    theme: DEFAULT_THEME,
  },
  github: {
    apiBase: GITHUB_COM_API,
    owner: "",
    repo: "",
    branch: "gh-pages",
    token: "",
    private: false,
  },
};

interface NoteReport {
  render: RenderedNote;
  probes: ProbeResult[];
}

export default class SitePublisherSpike extends Plugin {
  settings: Settings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addCommand({
      id: "run-render-spike",
      name: "Run render spike",
      callback: () => void this.runSpike(),
    });
    this.addCommand({
      id: "build-site",
      name: "Build site to preview folder",
      callback: () => void this.buildToPreview(),
    });
    this.addCommand({
      id: "publish-site",
      name: "Publish site to GitHub",
      callback: () => void this.publish(),
    });

    // Rendering before the workspace is ready gives Dataview no index to
    // query and Bases no file list, which looks like a rendering failure but
    // is really a timing one.
    this.app.workspace.onLayoutReady(() => {
      void this.runAuto();
    });
  }

  /**
   * Runs the configured autoRun mode and leaves a trace on disk either way.
   *
   * `void this.buildToPreview()` discarded the rejection, so a build that
   * threw produced exactly the same evidence as a build that never started:
   * no output folder, no report, nothing. An hour went into telling those two
   * apart in a vault whose devtools console was not readable from here. The
   * run log exists so the next failure says what it was.
   */
  private async runAuto(): Promise<void> {
    const mode = this.settings.autoRun;
    if (mode === "none") return;

    await this.appendRunLog(`start ${mode} (Obsidian ${apiVersion})`);
    const started = performance.now();
    try {
      if (mode === "spike") await this.runSpike();
      if (mode === "build") await this.buildToPreview();
      if (mode === "publish") await this.publish();
      if (mode === "diagnose") await this.diagnose();
      if (mode === "electron") await this.probeElectron();
      await this.appendRunLog(
        `done ${mode} in ${Math.round(performance.now() - started)}ms`,
      );
    } catch (error) {
      const detail =
        error instanceof Error
          ? `${error.message}\n\n${error.stack ?? "(no stack)"}`
          : String(error);
      await this.appendRunLog(
        `FAILED ${mode} after ${Math.round(performance.now() - started)}ms\n\n${detail}`,
      );
      new Notice(`Site Publisher: ${mode} failed, see ${OUTPUT_FOLDER}/run-log.md`);
    }
  }

  /** Appends to the run log, creating the output folder if it is missing. */
  private async appendRunLog(entry: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    const path = normalizePath(`${OUTPUT_FOLDER}/run-log.md`);
    try {
      if (!(await adapter.exists(OUTPUT_FOLDER))) await adapter.mkdir(OUTPUT_FOLDER);
      const previous = (await adapter.exists(path)) ? await adapter.read(path) : "";
      await adapter.write(
        path,
        `${previous}\n- ${new Date().toISOString()} ${entry}\n`,
      );
    } catch {
      // The log is diagnostics. Failing to write it must not replace the
      // error it was trying to record.
    }
  }

  private async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<Settings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...stored,
      site: { ...DEFAULT_SETTINGS.site, ...stored?.site },
      github: { ...DEFAULT_SETTINGS.github, ...stored?.github },
    };
  }

  // -- build ---------------------------------------------------------------

  private async build(): Promise<BuildResult> {
    // Chromium defers work in a window nobody is looking at, and publishing
    // is exactly when someone goes to do something else. Measured
    // backgrounded: a 50ms wait took 3,485ms. It is not only our waits that
    // suffer -- Dataview fills its cells from its own timers, so its work
    // lands late too, and no amount of care in our completion detection can
    // make another plugin's scheduler run sooner.
    //
    // So the window stops being throttled for the length of the build, and
    // is restored afterwards even if it throws.
    const restoreThrottling = suspendBackgroundThrottling();
    try {
      const result = await buildSite(this.app, this.settings.site, (done, total, path) => {
        if (done % 10 === 0) new Notice(`Rendering ${done + 1}/${total}: ${path}`, 1000);
      });
      await this.writeBuildReport(result);
      return result;
    } finally {
      restoreThrottling();
    }
  }

  private async buildToPreview(): Promise<void> {
    new Notice("Building site...");
    const result = await this.build();

    const adapter = this.app.vault.adapter;
    for (const file of result.files) {
      const target = normalizePath(`${PREVIEW_FOLDER}/${file.path}`);
      const dir = target.slice(0, target.lastIndexOf("/"));
      if (dir && !(await adapter.exists(dir))) await adapter.mkdir(dir);
      if (typeof file.content === "string") {
        await adapter.write(target, file.content);
      } else {
        await adapter.writeBinary(target, file.content);
      }
    }

    new Notice(
      `Built ${result.pages.length} pages in ${Math.round(result.totalMs)}ms -> ${PREVIEW_FOLDER}/`,
    );
  }

  /** Reports which Electron paths exist. Reads only; changes nothing. */
  private async probeElectron(): Promise<void> {
    const probe = probeBackgroundThrottling();
    const lines = [
      "# Background throttling probe",
      "",
      `Run: ${new Date().toISOString()}`,
      `Obsidian ${apiVersion}, Electron ${probe.electronVersion ?? "unknown"}`,
      "",
      `**setBackgroundThrottling reachable: ${probe.reachable ? "YES" : "NO"}**`,
      "",
      "| path | available | detail |",
      "|---|---|---|",
      ...probe.findings.map(
        (f) => `| \`${f.path}\` | ${f.available ? "yes" : "no"} | ${f.detail.replace(/\|/g, "\\|")} |`,
      ),
    ];
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(OUTPUT_FOLDER))) await adapter.mkdir(OUTPUT_FOLDER);
    await adapter.write(
      normalizePath(`${OUTPUT_FOLDER}/electron-probe.md`),
      lines.join("\n"),
    );
    new Notice(`Electron probe: throttling API ${probe.reachable ? "reachable" : "not reachable"}`);
  }

  // -- diagnose ------------------------------------------------------------

  private async diagnose(): Promise<void> {
    const path = this.settings.diagnosePath ?? "spike-notes/02-dataview-table.md";
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`Site Publisher: no note at ${path}`);
      return;
    }

    await waitForDataviewIndex(this.app as never);
    new Notice(`Diagnosing ${path}...`);
    const result = await diagnoseRender(this.app, file);

    const lines = [
      "# Render timeline",
      "",
      `Note: ${result.path}`,
      `Run: ${new Date().toISOString()}`,
      `Attempts: ${result.runs.length}`,
      "",
      "## Summary",
      "",
      "| attempt | render ms | complete at | never completed |",
      "|---|---|---|---|",
      ...result.runs.map(
        (r) =>
          `| ${r.attempt} | ${Math.round(r.renderMs)} | ${r.completeAtMs === null ? "-" : r.completeAtMs + "ms"} | ${r.completeAtMs === null ? "**yes**" : "no"} |`,
      ),
      "",
    ];

    for (const run of result.runs) {
      lines.push(`## Attempt ${run.attempt}`, "");
      lines.push(
        "| at ms | complete | blocked by | pending | empty spans | text | mutations |",
      );
      lines.push("|---|---|---|---|---|---|---|");
      for (const s of run.samples) {
        lines.push(
          `| ${s.atMs} | ${s.complete ? "yes" : "no"} | ${s.reason ?? "-"} | ${s.pending} | ${s.emptySpans} | ${s.textLength} | ${s.mutationsSoFar} |`,
        );
      }
      lines.push("");
    }

    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(OUTPUT_FOLDER))) await adapter.mkdir(OUTPUT_FOLDER);
    await adapter.write(
      normalizePath(`${OUTPUT_FOLDER}/diagnose.md`),
      lines.join("\n"),
    );
    await adapter.write(
      normalizePath(`${OUTPUT_FOLDER}/diagnose-final.html`),
      result.finalHtml,
    );
    new Notice(`Diagnose written to ${OUTPUT_FOLDER}/diagnose.md`);
  }

  // -- publish -------------------------------------------------------------

  private async publish(): Promise<void> {
    const { github } = this.settings;
    if (!github.token || !github.owner || !github.repo) {
      new Notice("Site Publisher: set github.owner, github.repo and github.token first");
      return;
    }

    const client = new GitHubClient({
      apiBase: github.apiBase,
      token: github.token,
      owner: github.owner,
      repo: github.repo,
    });

    const log: string[] = [];
    const say = (line: string) => {
      log.push(line);
      new Notice(`Site Publisher: ${line}`, 3000);
    };

    try {
      const viewer = await client.getViewer();
      say(`authenticated as ${viewer.login}`);

      let repo = await client.getRepo();
      if (!repo) {
        repo = await client.createRepo({
          private: github.private,
          description: "Published from Obsidian by vault-publisher.",
        });
        say(`created ${repo.full_name}`);
      } else {
        say(`using ${repo.full_name}`);
      }

      const result = await this.build();
      say(`built ${result.pages.length} pages, ${result.files.length} files`);

      // Every one of these means the built site differs from what Obsidian
      // shows, which is the one promise this plugin exists to keep. A
      // truncated Bases view is the quietest of them: the table looks
      // perfectly well-formed and is simply missing rows.
      if (
        result.invalidNesting > 0 ||
        result.incompletePages > 0 ||
        result.basesTruncated.length > 0
      ) {
        say(
          `ABORTED: ${result.invalidNesting} blocks would break on reparse, ${result.incompletePages} pages serialized incomplete, ${result.basesTruncated.length} bases views truncated`,
        );
        for (const view of result.basesTruncated) say(`  truncated: ${view}`);
        await this.writePublishLog(log);
        return;
      }

      const commit = await client.commitFiles({
        branch: github.branch,
        message: `Publish ${result.pages.length} pages from Obsidian`,
        files: result.files,
      });
      say(`committed ${commit.commitSha.slice(0, 7)} to ${github.branch}`);

      const pages = await client.enablePages(github.branch);
      say(`pages: ${pages.html_url ?? pages.url} (${pages.status ?? "building"})`);

      log.push(`\nSite URL: ${pages.html_url ?? "(see repo settings)"}`);
    } catch (e) {
      const message =
        e instanceof GitHubError
          ? `${e.message} [status ${e.status}]`
          : e instanceof Error
            ? e.message
            : String(e);
      log.push(`FAILED: ${message}`);
      new Notice(`Site Publisher failed: ${message}`, 8000);
    }

    await this.writePublishLog(log);
  }

  private async writePublishLog(log: string[]): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(OUTPUT_FOLDER))) await adapter.mkdir(OUTPUT_FOLDER);
    await adapter.write(
      normalizePath(`${OUTPUT_FOLDER}/publish-log.md`),
      ["# Publish log", "", `Run: ${new Date().toISOString()}`, "", ...log.map((l) => `- ${l}`)].join(
        "\n",
      ),
    );
  }

  private async writeBuildReport(result: BuildResult): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(OUTPUT_FOLDER))) await adapter.mkdir(OUTPUT_FOLDER);

    const lines: string[] = ["# Build report", ""];
    lines.push(`Run: ${new Date().toISOString()}`);
    lines.push(`Pages: ${result.pages.length}, files: ${result.files.length}`);
    lines.push(`Total: ${Math.round(result.totalMs)}ms`);
    lines.push(`Blocks that would break on reparse: ${result.invalidNesting}`);
    lines.push(`Pages serialized incomplete: ${result.incompletePages}`);
    lines.push("");

    lines.push(
      "| Page | url | render ms | total ms | pending | incomplete | guarded | errored | unresolved links |",
    );
    lines.push("|---|---|---|---|---|---|---|---|---|");
    for (const p of result.pages) {
      lines.push(
        `| ${p.title} | ${p.url} | ${Math.round(p.renderMs)} | ${Math.round(p.totalMs)} | ${p.pending} | ${p.incomplete} | ${p.guarded} | ${p.errored} | ${p.unresolvedTargets.join(", ")} |`,
      );
    }

    const reasons = new Map<string, { n: number; ms: number }>();
    for (const page of result.pages) {
      const row = reasons.get(page.settleReason) ?? { n: 0, ms: 0 };
      row.n++;
      row.ms += page.totalMs;
      reasons.set(page.settleReason, row);
    }
    if (reasons.size) {
      lines.push("", "## How notes finished", "");
      lines.push("| reason | notes | total s | mean ms |");
      lines.push("|---|---|---|---|");
      for (const [reason, row] of [...reasons].sort((a, b) => b[1].ms - a[1].ms)) {
        lines.push(
          `| ${reason} | ${row.n} | ${(row.ms / 1000).toFixed(1)} | ${Math.round(row.ms / row.n)} |`,
        );
      }
      lines.push(
        "",
        "`fast-path` and `content-complete` finish from the content. `quiet` and",
        "`timeout` finish from a clock, and a hidden window clamps clocks to one",
        "wake-up a minute, so those two are where a backgrounded build loses time.",
      );
    }

    const drift = result.drift;
    if (drift && drift.ratio !== null) {
      lines.push("", "## Drift", "");
      lines.push(
        `Control notes: ${drift.samples.length} (identical, no async content)`,
      );
      lines.push(`First third: ${Math.round(drift.firstMs ?? 0)}ms mean render`);
      lines.push(`Last third:  ${Math.round(drift.lastMs ?? 0)}ms mean render`);
      lines.push(`Ratio: ${drift.ratio.toFixed(2)}x`);
      if (drift.heapGrowthBytes !== null) {
        lines.push(`Heap growth: ${formatBytes(drift.heapGrowthBytes)}`);
      }
      lines.push(
        drift.degraded
          ? "\n**DEGRADED.** The build slowed as it ran, so every other timing here is suspect."
          : "\nStable. Render time did not drift materially across the build.",
      );
      lines.push("", "| # | control | render ms | heap |");
      lines.push("|---|---|---|---|");
      for (const s of drift.samples) {
        lines.push(
          `| ${s.index} | ${s.path.split("/").pop()} | ${Math.round(s.renderMs)} | ${s.heapBytes === null ? "-" : formatBytes(s.heapBytes)} |`,
        );
      }
    }

    const basesPages = result.pages.filter((p) => p.bases.views > 0);
    if (basesPages.length) {
      lines.push("", "## Bases", "");
      lines.push(
        "| Page | views | tables | cards | rows | input values recovered | measurement rows dropped | unhandled |",
      );
      lines.push("|---|---|---|---|---|---|---|---|");
      for (const p of basesPages) {
        const b = p.bases;
        lines.push(
          `| ${p.title} | ${b.views} | ${b.tables} | ${b.cards} | ${b.rows} | ${b.inputValues} | ${b.measurementDropped} | ${b.unhandled.join(", ") || "-"} |`,
        );
      }
      if (result.basesTruncated.length) {
        lines.push("", "Truncated views (emitted/total):", "");
        for (const v of result.basesTruncated) lines.push(`- ${v}`);
      }
    }

    if (result.skipped.length) {
      lines.push("", "## Skipped", "");
      for (const s of result.skipped) lines.push(`- ${s.path}: ${s.reason}`);
    }

    await adapter.write(normalizePath(`${OUTPUT_FOLDER}/build-report.md`), lines.join("\n"));
  }

  // -- render spike --------------------------------------------------------

  private async runSpike(): Promise<void> {
    const app = this.app as App & { plugins?: { plugins?: Record<string, unknown> } };
    const started = performance.now();

    new Notice("Site Publisher spike: starting");

    const dataviewReady = await waitForDataviewIndex(app as never);
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(`${INPUT_FOLDER}/`))
      .sort((a, b) => a.path.localeCompare(b.path));

    if (!files.length) {
      new Notice(`Site Publisher spike: no notes under ${INPUT_FOLDER}/`);
      return;
    }

    const host = createRenderHost();
    const reports: NoteReport[] = [];

    try {
      for (const file of files) {
        const render = await renderFile(this.app, file, host);
        reports.push({ render, probes: probeHtml(render.html) });
      }
    } finally {
      host.remove();
    }

    const css = probeStylesheets();
    const elapsed = performance.now() - started;

    await this.writeOutput(reports, {
      dataviewReady,
      css,
      elapsedMs: elapsed,
      pluginIds: Object.keys(app.plugins?.plugins ?? {}),
      obsidianVersion: apiVersion,
    });

    new Notice(
      `Site Publisher spike: ${reports.length} notes in ${Math.round(elapsed)}ms. See ${OUTPUT_FOLDER}/report.md`,
    );
  }

  private async writeOutput(
    reports: NoteReport[],
    meta: {
      dataviewReady: boolean;
      css: ReturnType<typeof probeStylesheets>;
      elapsedMs: number;
      pluginIds: string[];
      obsidianVersion: string;
    },
  ): Promise<void> {
    const adapter = this.app.vault.adapter;
    const dir = normalizePath(OUTPUT_FOLDER);
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);

    for (const { render } of reports) {
      const name = render.path.replace(/[\/\\]/g, "__").replace(/\.md$/, "");
      await adapter.write(normalizePath(`${dir}/${name}.html`), render.html);
    }

    await adapter.write(normalizePath(`${dir}/report.md`), buildReport(reports, meta));
    await adapter.write(
      normalizePath(`${dir}/report.json`),
      JSON.stringify({ meta, reports }, null, 2),
    );
  }
}

function verdictMark(v: ProbeResult["verdict"]): string {
  const marks: Record<string, string> = {
    ok: "OK",
    partial: "PARTIAL",
    empty: "EMPTY",
    error: "ERROR",
    blocked: "BLOCKED",
  };
  return marks[v] ?? "-";
}

function buildReport(
  reports: NoteReport[],
  meta: {
    dataviewReady: boolean;
    css: ReturnType<typeof probeStylesheets>;
    elapsedMs: number;
    pluginIds: string[];
    obsidianVersion: string;
  },
): string {
  const lines: string[] = [];
  lines.push("# Render spike report", "");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Obsidian API version: ${meta.obsidianVersion}`);
  lines.push(`Dataview index ready before rendering: ${meta.dataviewReady}`);
  lines.push(`Enabled plugins: ${meta.pluginIds.join(", ") || "(none)"}`);
  lines.push(`Total time: ${Math.round(meta.elapsedMs)}ms for ${reports.length} notes`);
  lines.push("");

  lines.push("## Per note", "");
  lines.push(
    "| Note | total ms | render | settle | assets | normalize | serialize | mutations | skipped wait | <p> fixed | still invalid |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const { render } of reports) {
    const r = (n: number) => Math.round(n);
    lines.push(
      `| ${render.path} | ${r(render.totalMs)} | ${r(render.renderMs)} | ${r(render.settle.elapsedMs - render.settle.assetMs)} | ${r(render.settle.assetMs)} | ${r(render.normalizeMs)} | ${r(render.serializeMs)} | ${render.settle.mutations} | ${render.settle.skipped} | ${render.normalize.paragraphsRewritten} | ${render.normalize.remaining} |`,
    );
  }
  lines.push("");

  const errored = reports.filter((r) => r.render.error);
  if (errored.length) {
    lines.push("### Render errors", "");
    for (const { render } of errored) {
      lines.push(`- ${render.path}: ${render.error?.split("\n")[0]}`);
    }
    lines.push("");
  }

  lines.push("## Feature probes", "");
  const featureIds = Array.from(
    new Set(reports.flatMap((r) => r.probes.map((p) => p.id))),
  );
  lines.push(`| Note | ${featureIds.join(" | ")} |`);
  lines.push(`|---|${featureIds.map(() => "---").join("|")}|`);
  for (const { render, probes } of reports) {
    const cells = featureIds.map((id) => {
      const p = probes.find((x) => x.id === id);
      if (!p || p.verdict === "missing") return "-";
      const detail = Object.entries(p.breakdown)
        .map(([v, n]) => `${n} ${v}`)
        .join(", ");
      return `${verdictMark(p.verdict)} (${detail})`;
    });
    lines.push(`| ${render.path} | ${cells.join(" | ")} |`);
  }
  lines.push("");

  const problems = reports.flatMap(({ render, probes }) =>
    probes
      .filter((p) => p.verdict !== "ok" && p.verdict !== "missing")
      .map((p) => `- ${render.path} / ${p.id}: ${p.verdict} - ${p.note}`),
  );
  if (problems.length) {
    lines.push("### Problems", "", ...problems, "");
  }

  lines.push("## Static hazards", "");
  lines.push(
    "| Note | inline handlers | css vars | app:// urls | controls | data-* | embeds emptied by reparse |",
  );
  lines.push("|---|---|---|---|---|---|---|");
  for (const { render } of reports) {
    const h = findStaticHazards(render.html);
    lines.push(
      `| ${render.path} | ${h.inlineHandlers} | ${h.cssVarReferences} | ${h.appUrls} | ${h.interactiveControls} | ${h.rehydrationHooks} | ${countInvalidNesting(render.html)} |`,
    );
  }
  lines.push("");

  lines.push("## Stylesheets", "");
  lines.push(
    `${meta.css.readableSheets} of ${meta.css.totalSheets} sheets readable, ${meta.css.totalRules} rules total.`,
    "",
  );
  lines.push("| Origin | Source | Rules | Error |");
  lines.push("|---|---|---|---|");
  for (const s of meta.css.sheets) {
    lines.push(
      `| ${s.origin} | ${s.source.slice(0, 80)} | ${s.rules ?? "-"} | ${s.error ?? ""} |`,
    );
  }

  return lines.join("\n");
}
