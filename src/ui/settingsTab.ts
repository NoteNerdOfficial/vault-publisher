import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { THEMES } from "../publish/themes";
import { describeStorage, storageMode } from "../platform/secrets";

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
  settings: {
    site: {
      siteName: string;
      folder: string;
      requireFrontmatterFlag: string | null;
      theme?: string;
      failOnPrivacyLeak?: boolean;
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

  constructor(app: App, host: SettingsHost & { app: App }) {
    super(app, host as never);
    this.host = host;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderConnection(containerEl);
    this.renderContent(containerEl);
    this.renderTheme(containerEl);
    this.renderPublish(containerEl);
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
            github.token = value.trim();
            await this.host.saveSettings();
          });
      });

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

    new Setting(root)
      .setName("Folder")
      .setDesc("Only notes inside this folder are published. Leave empty for the whole vault.")
      .addText((text) =>
        text
          .setPlaceholder("(whole vault)")
          .setValue(site.folder)
          .onChange(async (value) => {
            site.folder = value.trim().replace(/^\/+|\/+$/g, "");
            await this.host.saveSettings();
          }),
      );

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
  }

  // -- 3. how it looks -----------------------------------------------------

  private renderTheme(root: HTMLElement): void {
    new Setting(root).setName("Theme").setHeading();

    const site = this.host.settings.site;
    const description = root.createDiv();
    description.style.cssText = "font-size:0.9em;opacity:0.75;margin:-0.5em 0 1.5em;";

    const describe = () => {
      const theme = THEMES.find((t) => t.name === site.theme) ?? THEMES[0];
      description.setText(theme.description);
    };

    new Setting(root)
      .setName("Style")
      .setDesc("Applied the next time the site is built.")
      .addDropdown((dropdown) => {
        for (const theme of THEMES) dropdown.addOption(theme.name, theme.label);
        dropdown.setValue(site.theme ?? THEMES[0].name);
        dropdown.onChange(async (value) => {
          site.theme = value;
          describe();
          await this.host.saveSettings();
        });
      });

    describe();
  }

  // -- 4. publish ----------------------------------------------------------

  private renderPublish(root: HTMLElement): void {
    new Setting(root).setName("Publish").setHeading();

    new Setting(root)
      .setName("Build a preview")
      .setDesc("Renders the site into a folder in this vault without sending anything to GitHub.")
      .addButton((button) =>
        button.setButtonText("Build preview").onClick(async () => {
          button.setDisabled(true);
          try {
            await this.host.buildToPreview();
          } catch (error) {
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
            try {
              await this.host.publish();
            } catch (error) {
              new Notice(`Publish failed: ${error instanceof Error ? error.message : error}`);
            } finally {
              button.setDisabled(false);
            }
          }),
      );
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
