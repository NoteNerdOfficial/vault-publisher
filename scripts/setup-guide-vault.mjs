/**
 * Configures a documentation vault so Vault Publisher can publish it.
 *
 * The guide vault is a folder of notes -- it travels on its own, and whoever
 * receives it has no plugin in it and no settings. This writes both: the
 * Obsidian config a fresh vault needs, a `data.json` holding the publish
 * settings the notes describe, and a copy of the built plugin.
 *
 * It names no vault. Like `deploy.mjs`, the path is an argument and there is
 * no default, because the one thing worse than failing here is writing a
 * plugin and a config file into a directory nobody asked for:
 *
 *   node scripts/setup-guide-vault.mjs /path/to/the/guide/vault
 *
 * Add --no-plugin to write only the configuration, for a vault whose reader
 * installs the plugin from the community store.
 *
 * Everything it writes is a placeholder. The publish target is
 * `your-username/your-site-repo`, there is no token, and nothing identifying
 * whoever ran it reaches the vault -- a documentation vault gets shared, and
 * a shared vault publishes everything in it.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { id } = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

const args = process.argv.slice(2);
const withPlugin = !args.includes("--no-plugin");
const target = args.find((value) => !value.startsWith("--"));

if (!target) {
  console.error(
    [
      "Which vault? There is no default.",
      "",
      "  node scripts/setup-guide-vault.mjs /path/to/the/guide/vault",
      "  node scripts/setup-guide-vault.mjs /path/to/vault --no-plugin",
      "",
      "The vault must exist already: this configures a vault of notes, it",
      "does not write the notes.",
    ].join("\n"),
  );
  process.exit(1);
}

const vault = resolve(
  target.startsWith("~/") ? join(homedir(), target.slice(2)) : target,
);

if (!existsSync(vault) || !statSync(vault).isDirectory()) {
  console.error(`Not a directory: ${vault}`);
  process.exit(1);
}

/**
 * The settings the notes in the vault describe.
 *
 * Kept in step with `Reference/This vault as a worked example.md` by hand --
 * that note is a table of these values, and the two disagreeing would make
 * the documentation wrong about itself.
 */
const settings = {
  autoRun: "none",
  site: {
    siteName: "Vault Publisher — Guide",
    // The whole vault: this vault is the thing being published.
    folder: "",
    // Off: everything here is meant to be public, so a whitelist would be
    // ceremony. A vault that is private by default wants the opposite.
    requireFrontmatterFlag: null,
    updatedProperty: "updated",
    pinnedProperty: "pinned",
    // One folder, so the exclusion is visible in the build report.
    excludeFolders: ["Scratch"],
    publishWholeFolders: [],
    // Off, so the as-is example demonstrates the toggle rather than hiding it.
    publishHtmlFiles: false,
    homeNote: "Start here.md",
    theme: "studio",
    // Empty. `Examples/site-tokens.css` is in the vault to be tried.
    customCssPath: "",
    customDomain: "",
    failOnPrivacyLeak: false,
    failOnTruncatedBase: false,
  },
  commentOverlay: {
    enabled: false,
    onPublish: false,
    publishComments: false,
    publishContact: "",
    // Blank: whoever reads the vault is the reviewer, not whoever built it.
    reviewer: "",
    reviewFolder: "_vault-publisher/review",
  },
  publishPassword: "",
  sourceLink: { enabled: false, url: "" },
  relay: {
    provider: "none",
    sync: true,
    labels: "review",
    github: { owner: "", repo: "" },
    jira: {
      site: "",
      browseUrl: "",
      project: "",
      issueType: "Task",
      auth: "cloud",
      email: "",
      username: "",
    },
    asana: { project: "", workspace: "" },
    token: "",
  },
  github: {
    apiBase: "https://api.github.com",
    // Placeholders, and they stay placeholders. A real repository name in a
    // vault that gets shared is published the moment it is handed over.
    owner: "your-username",
    repo: "your-site-repo",
    branch: "gh-pages",
    token: "",
    private: false,
  },
};

const config = {
  "app.json": {
    alwaysUpdateLinks: true,
    newLinkFormat: "shortest",
    useMarkdownLinks: false,
    readableLineLength: true,
    showLineNumber: false,
    // The notes in here are hard wrapped at about 76 columns, for readable
    // diffs. With Obsidian's default (this off) every one of those newlines
    // renders as a <br>, in the vault and in anything built from it, so a
    // published page keeps the source's line breaks and the prose will not
    // reflow when the reader widens the column. On, a single newline is a
    // space, which is what the wrapping was ever meant to be.
    strictLineBreaks: true,
  },
  "appearance.json": { accentColor: "", theme: "system" },
  "core-plugins.json": {
    "file-explorer": true,
    "global-search": true,
    switcher: true,
    graph: true,
    backlink: true,
    "outgoing-link": true,
    "tag-pane": true,
    outline: true,
    "word-count": true,
    "file-recovery": true,
    bases: true,
    properties: true,
  },
  "community-plugins.json": [id],
};

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`wrote ${path.slice(vault.length + 1)}`);
}

const dotObsidian = join(vault, ".obsidian");
mkdirSync(dotObsidian, { recursive: true });
for (const [name, value] of Object.entries(config)) {
  writeJson(join(dotObsidian, name), value);
}

const pluginDir = join(dotObsidian, "plugins", id);
mkdirSync(pluginDir, { recursive: true });

const dataPath = join(pluginDir, "data.json");
// Said rather than silently overwritten: a vault being set up a second time
// may have a token and a real repository in here by now, and losing those to
// a convenience script is a bad trade.
if (existsSync(dataPath)) {
  console.log("\nNOTE: data.json already exists and was left alone.");
  console.log("  Delete it and run this again to reset to the placeholders.");
} else {
  writeJson(dataPath, settings);
}

if (withPlugin) {
  const built = join(root, "main.js");
  if (!existsSync(built)) {
    console.error("\nNo main.js. Run `npm run build` first, or pass --no-plugin.");
    process.exit(1);
  }
  for (const file of ["main.js", "manifest.json", "styles.css"]) {
    copyFileSync(join(root, file), join(pluginDir, file));
  }
  console.log(`copied the plugin into .obsidian/plugins/${id}/`);
} else {
  console.log(`\nNOTE: no plugin copied. Install ${id} into the vault yourself.`);
}

console.log(
  [
    "",
    "Done. One step is left and it cannot be done from here:",
    "",
    "  Obsidian -> Open folder as vault -> choose the vault",
    "",
    "Obsidian will not load a plugin from a vault it has never opened, so",
    "nothing runs until somebody does that once. Then: Settings ->",
    "Vault Publisher -> Build a preview.",
  ].join("\n"),
);
