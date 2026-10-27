import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { THEMES, getTheme } from "../publish/themes";
import { SiteConfig, isScopeChosen, resolveHomeNote, selectNotes } from "../publish/buildSite";
import {
  TokenState,
  describeStorage,
  describeTokenState,
  storageMode,
} from "../platform/secrets";

/**
 * The settings screen.
 *
 * The goal the whole project is measured against is that setup is simple,
 * so this is ordered the way a first run actually goes -- connect, choose
 * what to publish, choose how it looks, publish -- rather than grouped by
 * which part of the code owns each field. Someone opening this for the first
 * time should be able to work down it once and be done.
 *
 * Two things it deliberately does:
 *
 * It verifies the token by calling GitHub rather than by checking the string
 * looks plausible, and shows which account answered. A token that is valid
 * but belongs to the wrong account is the error people actually hit, and no
 * amount of format checking catches it.
 *
 * It says where the token is stored, in plain words, every time. Secret
 * handling that quietly degrades to plaintext is worse than none, because
 * the user believes something that is not true.
 */

export interface SettingsHost {
  /** Set by this tab so a running build can report what it is doing. */
  progress: ((step: string, done?: number, total?: number) => void) | null;
  /** Folder an earlier version of this plugin left behind, if any. */
  legacyFolder: string | null;
  /** Deletes that folder. Resolves to false if it could not be removed. */
  removeLegacyFolder(): Promise<boolean>;
  /** Whether the stored token could be read. */
  tokenState: TokenState;
  /** Replaces the token. Use this rather than assigning to settings. */
  setToken(value: string): void;
  settings: {
    site: {
      siteName: string;
      /** Folder path, `""` for the whole vault, `null` for unchosen. */
      folder: string | null;
      requireFrontmatterFlag: string | null;
      homeNote?: string;
      updatedProperty?: string;
      pinnedProperty?: string;
      theme?: string;
      failOnPrivacyLeak?: boolean;
      failOnTruncatedBase?: boolean;
      customDomain?: string;
    };
    github: {
      apiBase: string;
      owner: string;
      repo: string;
      branch: string;
      token: string;
      private: boolean;
    };
  };
  saveSettings(): Promise<void>;
  /** Resolves to the authenticated login, or throws. */
  verifyToken(): Promise<string>;
  publish(): Promise<void>;
  buildToPreview(): Promise<void>;
}

export class VaultPublisherSettingsTab extends PluginSettingTab {
  private host: SettingsHost;
  private statusEl: HTMLElement | null = null;
  private progressEl: HTMLElement | null = null;
  private progressBar: HTMLElement | null = null;
  /**
   * Whether the folder field is showing, when no folder has been typed yet.
   *
   * Not persisted: it only disambiguates a state the stored value cannot,
   * which is "wants a folder, has not named one". Once a folder is named the
   * value speaks for itself, and on a reopen that is what it is read from.
   */
  private folderMode = false;

  /** Which of the three scope states the controls should show. */
  private scopeMode(): "unset" | "vault" | "folder" {
    const folder = this.host.settings.site.folder;
    if (folder === "") return "vault";
    if (folder !== null) return "folder";
    return this.folderMode ? "folder" : "unset";
  }

  constructor(app: App, host: SettingsHost & { app: App }) {
    super(app, host as never);
    this.host = host;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderLegacyNotice(containerEl);
    this.renderFirstRun(containerEl);
    this.renderConnection(containerEl);
    this.renderContent(containerEl);
    this.renderTheme(containerEl);
    this.renderPublish(containerEl);
  }

  /**
   * Offers to clear out the folder the plugin used to live in.
   *
   * The rename left a complete copy of the old settings behind, and those
   * settings include the GitHub token. It is encrypted, and it is still a
   * credential sitting in a folder nothing will ever load again, inside a
   * vault that is probably synced. Worth one button rather than a line in a
   * changelog nobody reads.
   */
  private renderLegacyNotice(root: HTMLElement): void {
    const folder = this.host.legacyFolder;
    if (!folder) return;

    new Setting(root).setName("Leftover from the old plugin").setHeading();

    new Setting(root)
      .setName("Remove the previous plugin folder")
      .setDesc(
        `Your settings were brought across from ${folder}. That folder still ` +
          "holds a copy of them, including your GitHub token, and nothing " +
          "reads it any more.",
      )
      .addButton((button) =>
        button
          .setButtonText("Remove")
          .setWarning()
          .onClick(async () => {
            button.setDisabled(true);
            const removed = await this.host.removeLegacyFolder();
            new Notice(
              removed
                ? "Removed the old plugin folder."
                : "Could not remove it; delete it by hand if you want it gone.",
            );
            this.display();
          }),
      );
  }

  /**
   * A checklist, shown only until setup is finished.
   *
   * Three screens was the goal, and three screens for someone who has already
   * set the thing up is two screens too many. So this is not a wizard that
   * must be clicked through: it is a short list of what is still missing,
   * which disappears once nothing is.
   */
  private renderFirstRun(root: HTMLElement): void {
    const { github, site } = this.host.settings;
    const steps: { done: boolean; text: string }[] = [
      { done: Boolean(github.token), text: "Add a GitHub token" },
      { done: Boolean(github.owner && github.repo), text: "Name the repository to publish to" },
      { done: Boolean(site.siteName), text: "Give the site a name" },
      { done: isScopeChosen(site), text: "Choose what to publish" },
    ];
    if (steps.every((step) => step.done)) return;

    new Setting(root).setName("Finish setting up").setHeading();

    const list = root.createEl("ol");
    list.style.cssText =
      "margin:-0.5em 0 1.5em;padding-left:1.4em;font-size:0.9em;line-height:1.8;";
    for (const step of steps) {
      const item = list.createEl("li");
      item.setText(step.done ? `${step.text} — done` : step.text);
      item.style.opacity = step.done ? "0.5" : "1";
      if (step.done) item.style.textDecoration = "line-through";
    }

    const note = root.createDiv();
    note.style.cssText = "font-size:0.85em;opacity:0.75;margin:-1em 0 1.5em;";
    note.setText(
      "The repository is created for you on the first publish, and GitHub Pages is switched on automatically.",
    );
  }

  // -- 1. connect ----------------------------------------------------------

  private renderConnection(root: HTMLElement): void {
    new Setting(root).setName("GitHub").setHeading();

    const github = this.host.settings.github;

    new Setting(root)
      .setName("Personal access token")
      .setDesc(describeStorage())
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "off";
        text
          .setPlaceholder("github_pat_… or ghp_…")
          .setValue(github.token ? "••••••••••••" : "")
          .onChange(async (value) => {
            // An untouched field shows dots; only a real edit replaces the
            // stored token, or opening settings would wipe it.
            if (value.includes("•")) return;
            this.host.setToken(value.trim());
            await this.host.saveSettings();
          });
      });

    // A token that is present but unreadable. Worth its own notice, because
    // the field looks empty and the remedy is not to paste a new token.
    const trouble = describeTokenState(this.host.tokenState);
    if (trouble) {
      const notice = root.createDiv({ cls: "osp-settings-warning" });
      notice.setText(trouble);
      notice.style.cssText =
        "font-size:0.85em;opacity:0.8;border-left:2px solid var(--text-warning);padding-left:0.75em;margin:0 0 1em;";
    }

    if (storageMode() === "plaintext") {
      const warning = root.createDiv({ cls: "osp-settings-warning" });
      warning.setText(
        "This platform does not offer encrypted storage, so the token is " +
          "saved as plain text in this vault. Use a fine-grained token " +
          "limited to the one repository you publish to.",
      );
      warning.style.cssText =
        "font-size:0.85em;opacity:0.8;border-left:2px solid var(--text-warning);padding-left:0.75em;margin:0 0 1em;";
    }

    new Setting(root)
      .setName("Connection")
      .setDesc("Checks the token against GitHub and reports which account it belongs to.")
      .addButton((button) =>
        button.setButtonText("Verify").onClick(async () => {
          this.setStatus("Checking…");
          try {
            const login = await this.host.verifyToken();
            this.setStatus(`Connected as ${login}.`, "ok");
          } catch (error) {
            this.setStatus(
              error instanceof Error ? error.message : String(error),
              "error",
            );
          }
        }),
      );

    this.statusEl = root.createDiv({ cls: "osp-settings-status" });
    this.statusEl.style.cssText = "font-size:0.9em;margin:-0.5em 0 1.5em;min-height:1.2em;";

    new Setting(root)
      .setName("Repository")
      .setDesc("Owner and name, for example: acme-team and handbook. Created on first publish if it does not exist.")
      .addText((text) =>
        text
          .setPlaceholder("owner")
          .setValue(github.owner)
          .onChange(async (value) => {
            github.owner = value.trim();
            await this.host.saveSettings();
          }),
      )
      .addText((text) =>
        text
          .setPlaceholder("repository")
          .setValue(github.repo)
          .onChange(async (value) => {
            github.repo = value.trim();
            await this.host.saveSettings();
          }),
      );

    new Setting(root)
      .setName("Branch")
      .setDesc("The branch GitHub Pages serves. No Actions workflow is used.")
      .addText((text) =>
        text
          .setPlaceholder("gh-pages")
          .setValue(github.branch)
          .onChange(async (value) => {
            github.branch = value.trim() || "gh-pages";
            await this.host.saveSettings();
          }),
      );

    new Setting(root)
      .setName("Custom domain")
      .setDesc(
        "Optional. Point a CNAME record at your GitHub Pages address first, " +
          "then put the domain here and publish.",
      )
      .addText((text) =>
        text
          .setPlaceholder("notes.example.com")
          .setValue(this.host.settings.site.customDomain ?? "")
          .onChange(async (value) => {
            this.host.settings.site.customDomain =
              value.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "") || undefined;
            await this.host.saveSettings();
          }),
      );

    new Setting(root)
      .setName("GitHub Enterprise")
      .setDesc("API base URL. Leave as is for github.com.")
      .addText((text) =>
        text
          .setPlaceholder("https://api.github.com")
          .setValue(github.apiBase)
          .onChange(async (value) => {
            github.apiBase = value.trim() || "https://api.github.com";
            await this.host.saveSettings();
          }),
      );
  }

  // -- 2. what to publish --------------------------------------------------

  private renderContent(root: HTMLElement): void {
    new Setting(root).setName("What to publish").setHeading();

    const site = this.host.settings.site;

    new Setting(root)
      .setName("Site name")
      .setDesc("Shown in the header and the browser tab.")
      .addText((text) =>
        text
          .setPlaceholder("My notes")
          .setValue(site.siteName)
          .onChange(async (value) => {
            site.siteName = value;
            await this.host.saveSettings();
          }),
      );

    // Three states, so a control with three states. A text box cannot tell
    // "the whole vault" from "I have not decided", and the difference between
    // those two is every private note in the vault.
    new Setting(root)
      .setName("Scope")
      .setDesc(
        "Publishing the whole vault publishes every note in it. Choose " +
          "deliberately: this is the setting that decides what becomes public.",
      )
      .addDropdown((dropdown) => {
        dropdown.addOption("unset", "— choose —");
        dropdown.addOption("vault", "The whole vault");
        dropdown.addOption("folder", "One folder");
        dropdown.setValue(this.scopeMode());
        dropdown.onChange(async (value) => {
          // Picking "One folder" does not itself choose a scope: an empty
          // folder path is not an answer. So the stored value stays null
          // until something is typed, and only the mode changes.
          this.folderMode = value === "folder";
          site.folder = value === "vault" ? "" : null;
          await this.host.saveSettings();
          // Redrawn because the folder field below appears and disappears
          // with this choice, and the checklist above it changes too.
          this.display();
        });
      });

    if (this.scopeMode() === "folder") {
      new Setting(root)
        .setName("Folder")
        .setDesc("Only notes inside this folder are published.")
        .addText((text) =>
          text
            .setPlaceholder("notes")
            .setValue(site.folder ?? "")
            .onChange(async (value) => {
              const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
              site.folder = trimmed || null;
              await this.host.saveSettings();
            }),
        );
    }

    new Setting(root)
      .setName("Require a frontmatter flag")
      .setDesc(
        "When set, a note is published only if this property is true. " +
          "Safer for a vault that holds private notes alongside public ones.",
      )
      .addText((text) =>
        text
          .setPlaceholder("publish")
          .setValue(site.requireFrontmatterFlag ?? "")
          .onChange(async (value) => {
            site.requireFrontmatterFlag = value.trim() || null;
            await this.host.saveSettings();
          }),
      );

    // The field is a path, but the useful half is the answer: this says
    // which note the front page is actually going to be, including when the
    // field is empty and the vault's own README is winning.
    new Setting(root)
      .setName("Homepage")
      .setDesc(this.describeHome())
      .addText((text) =>
        text
          .setPlaceholder("README.md")
          .setValue(site.homeNote ?? "")
          .onChange(async (value) => {
            site.homeNote = value.trim() || undefined;
            await this.host.saveSettings();
          }),
      )
      .addExtraButton((button) =>
        button
          .setIcon("refresh-cw")
          .setTooltip("Check which note this resolves to")
          .onClick(() => this.display()),
      );

    new Setting(root)
      .setName("Date property")
      .setDesc(
        "Frontmatter key holding a note's own last-edited date. It dates the " +
          "note's header and orders Recently updated. A note without it falls " +
          "back to the file's modified time.",
      )
      .addText((text) =>
        text
          .setPlaceholder("updated")
          .setValue(site.updatedProperty ?? "")
          .onChange(async (value) => {
            site.updatedProperty = value.trim() || undefined;
            await this.host.saveSettings();
          }),
      );

    new Setting(root)
      .setName("Start here property")
      .setDesc(
        "Frontmatter key that marks a note as a place to begin. Notes with it " +
          "set to true lead the jump-to panel. Bookmarks are deliberately not " +
          "used: they can name notes you are not publishing.",
      )
      .addText((text) =>
        text
          .setPlaceholder("pinned")
          .setValue(site.pinnedProperty ?? "")
          .onChange(async (value) => {
            site.pinnedProperty = value.trim() || undefined;
            await this.host.saveSettings();
          }),
      );

    new Setting(root)
      .setName("Refuse to publish if private notes are exposed")
      .setDesc(
        "A query inside a published note reads the whole vault, so it can print " +
          "the name or fields of a note you are not publishing. This is always " +
          "reported; turn it on to make it stop the publish.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(site.failOnPrivacyLeak ?? false)
          .onChange(async (value) => {
            site.failOnPrivacyLeak = value;
            await this.host.saveSettings();
          }),
      );

    new Setting(root)
      .setName("Refuse to publish a shortened Bases view")
      .setDesc(
        "Bases only builds the rows it is currently showing, so a long view " +
          "reaches the publisher short. Published pages say how many rows " +
          "they are showing; turn this on to stop the publish instead.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(site.failOnTruncatedBase ?? false)
          .onChange(async (value) => {
            site.failOnTruncatedBase = value;
            await this.host.saveSettings();
          }),
      );
  }

  /**
   * What the front page will be, in one sentence.
   *
   * Resolved against the notes the scope actually matches, because that is
   * the question: a `README.md` outside the published folder is not the
   * site's homepage, and a homepage named but not published is a typo the
   * user would otherwise only find after publishing.
   */
  private describeHome(): string {
    const site = this.host.settings.site;
    const fallback =
      "Leave empty to use the vault's README, then index.md, then Home.md. " +
      "With none of those, the front page is a generated overview: what you " +
      "marked as a starting point, the most linked notes, what changed " +
      "lately, and the tags.";

    if (!isScopeChosen(site)) return fallback;

    const home = resolveHomeNote(selectNotes(this.app, site as SiteConfig), site);
    const named = site.homeNote?.trim();

    if (named && !home.path) {
      return `Nothing published matches "${named}", so the front page is the generated overview. ${fallback}`;
    }
    if (named && home.path && home.unresolved) {
      return `Nothing published matches "${named}". Using ${home.path} instead. ${fallback}`;
    }
    if (home.path) {
      return `Now using ${home.path}, published as the front page rather than at its own address. ${fallback}`;
    }
    return fallback;
  }

  // -- 3. how it looks -----------------------------------------------------

  private renderTheme(root: HTMLElement): void {
    new Setting(root).setName("Theme").setHeading();

    const site = this.host.settings.site;

    // A site can be configured for a theme that no longer ships. The build
    // already falls back, so the honest thing is to show what will actually
    // be used rather than an empty dropdown over a stale name.
    const retired = site.theme !== undefined && getTheme(site.theme).name !== site.theme;
    const chosen = getTheme(site.theme).name;

    const description = root.createDiv();
    description.style.cssText = "font-size:0.9em;opacity:0.75;margin:-0.5em 0 1.5em;";

    const describe = (name: string) => {
      description.setText(getTheme(name).description);
    };

    if (retired) {
      const notice = root.createDiv();
      notice.setText(
        `This site was set to "${site.theme}", which is no longer one of the themes. It will build as ${getTheme(chosen).label} until you pick another.`,
      );
      notice.style.cssText =
        "font-size:0.9em;margin:-0.5em 0 1em;padding:0.6em 0.8em;border-radius:6px;" +
        "background:var(--background-modifier-error-hover);color:var(--text-normal);";
    }

    const preview = root.createDiv();
    preview.style.cssText = "margin:0 0 1.5em;";

    new Setting(root)
      .setName("Style")
      .setDesc("Applied the next time the site is built.")
      .addDropdown((dropdown) => {
        for (const theme of THEMES) dropdown.addOption(theme.name, theme.label);
        dropdown.setValue(chosen);
        dropdown.onChange(async (value) => {
          site.theme = value;
          describe(value);
          this.renderThemePreview(preview, value);
          await this.host.saveSettings();
        });
      });

    describe(chosen);
    this.renderThemePreview(preview, chosen);
  }

  /**
   * A sample of the theme, drawn from its own tokens.
   *
   * Picking a look from three words and a dropdown is guesswork, and the
   * honest alternative -- build the site and look -- costs a full render.
   * This is deliberately a small specimen rather than a screenshot: the
   * colours, the type pairing and the heading scale all come from the same
   * token set the published stylesheet uses, so it cannot drift from the
   * real thing the way a stored image would.
   *
   * It is not a page preview and does not pretend to be. Layout, the table
   * of contents and plugin output are not represented.
   */
  private renderThemePreview(host: HTMLElement, themeName: string): void {
    const theme = getTheme(themeName);
    const dark = document.body.classList.contains("theme-dark");
    const palette = { ...theme.base, ...(dark ? theme.dark : theme.light) };
    const v = (name: string) => palette[name] ?? "";

    host.empty();

    const card = host.createDiv();
    card.style.cssText = [
      `background:${v("--osp-bg")}`,
      `color:${v("--osp-text")}`,
      `border:1px solid ${v("--osp-border")}`,
      `border-radius:${v("--osp-radius")}`,
      "padding:1.1rem 1.25rem",
      "overflow:hidden",
    ].join(";");

    const eyebrow = card.createDiv();
    eyebrow.setText(
      (this.host.settings.site.siteName || "Your site").toUpperCase(),
    );
    eyebrow.style.cssText = [
      `font-family:${v("--osp-font-ui")}`,
      `color:${v("--osp-text-muted")}`,
      `letter-spacing:${v("--osp-eyebrow-tracking")}`,
      "font-size:0.65rem",
      "font-weight:600",
      "margin-bottom:0.6rem",
    ].join(";");

    const heading = card.createDiv();
    heading.setText("A note about rivers");
    heading.style.cssText = [
      `font-family:${v("--osp-font-display")}`,
      `font-weight:${v("--osp-title-weight")}`,
      `letter-spacing:${v("--osp-title-tracking")}`,
      "font-size:1.35rem",
      "line-height:1.15",
      "margin-bottom:0.4rem",
    ].join(";");

    const body = card.createDiv();
    body.innerHTML =
      'Water finds the cheapest path downhill, and so does a note that has been ' +
      'rewritten often enough. <span class="osp-preview-link">A link looks like this</span>.';
    body.style.cssText = [
      `font-family:${v("--osp-font-body")}`,
      `line-height:${v("--osp-line-height")}`,
      "font-size:0.9rem",
    ].join(";");

    const link = body.querySelector(".osp-preview-link") as HTMLElement | null;
    if (link) {
      link.style.cssText = [
        `color:${v("--osp-link")}`,
        "text-decoration:underline",
        `text-decoration-thickness:${v("--osp-link-underline")}`,
        "text-underline-offset:3px",
      ].join(";");
    }

    const swatches = card.createDiv();
    swatches.style.cssText = "display:flex;gap:6px;margin-top:0.9rem;";
    for (const token of ["--osp-accent", "--osp-link", "--osp-surface", "--osp-border"]) {
      const dot = swatches.createDiv();
      dot.style.cssText = [
        "width:16px",
        "height:16px",
        "border-radius:50%",
        `background:${v(token)}`,
        `border:1px solid ${v("--osp-border")}`,
      ].join(";");
    }
  }

  // -- 4. publish ----------------------------------------------------------

  private renderPublish(root: HTMLElement): void {
    new Setting(root).setName("Publish").setHeading();

    this.progressEl = root.createDiv();
    this.progressEl.style.cssText =
      "font-size:0.9em;margin:0 0 0.75em;min-height:1.3em;color:var(--text-muted);";

    const track = root.createDiv();
    track.style.cssText =
      "height:4px;border-radius:2px;background:var(--background-modifier-border);margin:0 0 1.25em;overflow:hidden;";
    this.progressBar = track.createDiv();
    this.progressBar.style.cssText =
      "height:100%;width:0;background:var(--interactive-accent);transition:width 120ms linear;";

    // The sink stays registered for the life of the tab: a publish started
    // from here keeps reporting even if the user scrolls away, and a publish
    // started from the command palette fills this in if the tab is open.
    this.host.progress = (step, done, total) => {
      if (this.progressEl) this.progressEl.setText(step);
      if (this.progressBar) {
        const pct =
          done !== undefined && total ? Math.round((done / total) * 100) : null;
        this.progressBar.style.width = pct === null ? "100%" : `${pct}%`;
        this.progressBar.style.opacity = pct === null ? "0.35" : "1";
      }
    };

    new Setting(root)
      .setName("Build a preview")
      .setDesc("Renders the site into a folder in this vault without sending anything to GitHub.")
      .addButton((button) =>
        button.setButtonText("Build preview").onClick(async () => {
          button.setDisabled(true);
          this.setProgress("Starting…");
          try {
            await this.host.buildToPreview();
            this.setProgress("Preview built.");
          } catch (error) {
            this.setProgress("Build failed.");
            new Notice(`Build failed: ${error instanceof Error ? error.message : error}`);
          } finally {
            button.setDisabled(false);
          }
        }),
      );

    new Setting(root)
      .setName("Publish to GitHub")
      .setDesc("Renders every selected note and commits the result. Keep Obsidian open until it finishes.")
      .addButton((button) =>
        button
          .setButtonText("Publish")
          .setCta()
          .onClick(async () => {
            button.setDisabled(true);
            this.setProgress("Starting…");
            try {
              await this.host.publish();
            } catch (error) {
              this.setProgress("Publish failed.");
              new Notice(`Publish failed: ${error instanceof Error ? error.message : error}`);
            } finally {
              button.setDisabled(false);
            }
          }),
      );
  }

  private setProgress(text: string): void {
    this.host.progress?.(text);
  }

  /** Stops reporting into elements that are about to be discarded. */
  hide(): void {
    this.host.progress = null;
  }

  private setStatus(message: string, kind: "ok" | "error" | "info" = "info"): void {
    if (!this.statusEl) return;
    this.statusEl.setText(message);
    this.statusEl.style.color =
      kind === "ok"
        ? "var(--text-success)"
        : kind === "error"
          ? "var(--text-error)"
          : "var(--text-muted)";
  }
}
