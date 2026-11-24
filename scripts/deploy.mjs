/**
 * Copies the built plugin into the test vault.
 *
 * Obsidian loads a plugin from the vault's own .obsidian/plugins/<id>/ folder,
 * which is a real copy rather than a link back to this repo, so a build here
 * does not reach it on its own.
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { id, version } = JSON.parse(
  readFileSync(join(root, "manifest.json"), "utf8"),
);

/**
 * Which vault to deploy into, asked three ways and named in none of them.
 *
 * The test vault lives outside the repo so that plugin source is never mixed
 * up with the content used to exercise it -- and its name is the owner's
 * business, so this file, which is committed, must not carry it. It used to:
 * a default built from homedir() and a folder name, which published one
 * person's directory layout to everybody who ever clones this.
 *
 * So the path comes from outside the repo's history instead:
 *
 *   1. a path argument, for a one-off deploy somewhere else
 *   2. VAULT_PUBLISHER_VAULT, for a shell or CI that already knows
 *   3. .vault-path, a gitignored one-line file in this clone
 *
 * The argument wins, then the variable, then the file. There is no fourth
 * fallback on purpose: a wrong guess here copies a plugin into a directory
 * nobody asked for, and failing with instructions is cheaper than that.
 */
const PATH_FILE = join(root, ".vault-path");

/**
 * Where the plugin logs each auto-run, relative to the vault. Mirrors
 * `OUTPUT_FOLDER` in src/main.ts, which this script cannot import.
 */
const RUN_LOG = join("_vault-publisher", "run-log.md");

/** How long a reload's auto-run may take before this stops waiting. */
const AUTO_RUN_LIMIT_MS = 180_000;

function configuredVault() {
  if (process.argv[2]) return process.argv[2];
  if (process.env.VAULT_PUBLISHER_VAULT) return process.env.VAULT_PUBLISHER_VAULT;
  if (!existsSync(PATH_FILE)) return null;

  // One path, with the blank lines and stray whitespace of a hand-written
  // file forgiven, and a leading ~ expanded because a file that looks like
  // config is a file people write shell paths into.
  const line = readFileSync(PATH_FILE, "utf8")
    .split("\n")
    .map((value) => value.trim())
    .find((value) => value && !value.startsWith("#"));
  if (!line) return null;
  return line.startsWith("~/") ? join(homedir(), line.slice(2)) : line;
}

const vault = configuredVault();

if (!vault) {
  console.error("No vault configured.");
  console.error("");
  console.error("Say which vault to deploy into, any one of:");
  console.error("  node scripts/deploy.mjs /path/to/vault");
  console.error("  VAULT_PUBLISHER_VAULT=/path/to/vault npm run deploy");
  console.error("  echo /path/to/vault > .vault-path   (gitignored)");
  process.exit(1);
}

if (!existsSync(vault)) {
  console.error(`No vault at ${vault}`);
  console.error(
    "Check the path, or point .vault-path or VAULT_PUBLISHER_VAULT somewhere" +
      " that exists.",
  );
  process.exit(1);
}

const target = join(vault, ".obsidian", "plugins", id);

if (!existsSync(target)) mkdirSync(target, { recursive: true });

/**
 * The marker hot-reload watches for, written before the files it watches.
 *
 * pjeby/hot-reload reloads a plugin when its main.js changes, but only for
 * folders carrying this empty file -- otherwise every deploy is a copy into
 * a folder nobody is watching, and the way to see a change is to toggle the
 * plugin off and on by hand. The first deploy into a fresh vault creates the
 * plugin folder, so without this it also creates the one case where the
 * reload silently does not happen.
 *
 * Written first, not last: the watcher keys off the file change, and a
 * marker that arrives in the same instant as the main.js it was meant to
 * authorise can miss that first reload.
 */
const marker = join(target, ".hotreload");
const markerWasMissing = !existsSync(marker);
if (markerWasMissing) writeFileSync(marker, "");

// Read before the copy, so a run the reload starts can be told from an old one.
const runLog = join(vault, RUN_LOG);
const runLogBefore = existsSync(runLog) ? readFileSync(runLog, "utf8").length : 0;

/*
 * `styles.css` is optional to Obsidian but not to us once it exists: a copy
 * that skipped it would leave the running plugin with last deploy's rules,
 * which looks like a CSS change that did not take rather than a file that
 * never arrived. Listed, and checked, so adding one is not a thing to
 * remember here as well.
 */
for (const file of ["main.js", "manifest.json", "styles.css"]) {
  const from = join(root, file);
  if (!existsSync(from)) {
    if (file === "styles.css") continue;
    console.error(`cannot deploy: ${file} is missing. Run \`npm run build\` first.`);
    process.exit(1);
  }
  copyFileSync(from, join(target, file));
}

console.log(`deployed ${id} v${version} -> ${target}`);
if (markerWasMissing) console.log("wrote .hotreload (this folder was not watched)");
if (reportVaultState(vault)) await waitForAutoRun(vault, target);

/**
 * Says whether Obsidian actually has this vault open.
 *
 * Deploying is silent and so is Obsidian: a copy into a vault nobody has open
 * looks exactly like a successful deploy, and the plugin simply never runs.
 * An hour went into that, with the real cause being a vault opened one folder
 * too high -- the repo root rather than the vault inside it, which Obsidian
 * happily registered as a new empty vault.
 *
 * Obsidian keeps its vault list in app support and reads it only at startup,
 * so this can report but not fix; a vault it has never seen cannot be opened
 * by URI either, and needs one pass through "Open folder as vault".
 */
function reportVaultState(vaultPath) {
  const registry = join(
    homedir(),
    "Library/Application Support/obsidian/obsidian.json",
  );
  if (!existsSync(registry)) return false;

  let vaults;
  try {
    vaults = Object.values(JSON.parse(readFileSync(registry, "utf8")).vaults);
  } catch {
    return false;
  }

  const wanted = resolve(vaultPath);
  const entry = vaults.find((v) => resolve(v.path) === wanted);
  const open = vaults.filter((v) => v.open).map((v) => v.path);

  /*
   * The list says which vaults were open when Obsidian last ran, and keeps
   * saying so after it quits. Reporting "open" from that alone is how a
   * deploy into a closed Obsidian once read as a live one.
   */
  if (entry?.open && !obsidianRunning()) {
    console.log("");
    console.log("WARNING: Obsidian is not running. The vault was open when it last quit,");
    console.log("  so it will load this build when Obsidian starts, but nothing runs it now.");
    return false;
  }

  if (entry?.open) {
    console.log("vault is open in Obsidian");
    return reportHotReload(vaultPath);
  }

  console.log("");
  console.log(
    entry
      ? "WARNING: Obsidian knows this vault but does not have it open."
      : "WARNING: Obsidian has never opened this vault, so it is not in its list.",
  );
  console.log(`  deployed to: ${wanted}`);
  console.log(`  open now:    ${open.length ? open.join(", ") : "(none)"}`);
  console.log("  Nothing will run until it is opened as a vault.");
  return false;
}

/** Whether an Obsidian process exists. Unknown counts as running. */
function obsidianRunning() {
  try {
    execFileSync("pgrep", ["-x", "Obsidian"], { stdio: "ignore" });
    return true;
  } catch (error) {
    // pgrep exits 1 when nothing matched; anything else means it could not
    // answer, and a warning built on that would be a guess.
    return error?.status !== 1;
  }
}

/**
 * Waits out the auto-run the reload starts, and says how it went.
 *
 * With autoRun set, every load of the plugin -- so every hot reload --
 * rebuilds the preview: every note rendered, the folder rewritten. Obsidian
 * is slow to answer anything for the seconds that takes, and a command or a
 * debugger call sent straight after a deploy waits behind it. That was
 * taken for a freeze twice before the run log showed what it was. So the
 * deploy is not finished until that run is, and a run that failed fails the
 * deploy rather than scrolling past as a notice.
 */
async function waitForAutoRun(vaultPath, pluginDir) {
  let mode = "none";
  try {
    mode = JSON.parse(readFileSync(join(pluginDir, "data.json"), "utf8")).autoRun ?? "none";
  } catch {
    // No settings yet means the default, which runs nothing.
  }
  if (mode === "none") return;

  console.log(`autoRun is "${mode}": waiting for the reload's run to finish...`);
  const logPath = join(vaultPath, RUN_LOG);
  const startedAt = Date.now();
  let sawStart = false;

  while (Date.now() - startedAt < AUTO_RUN_LIMIT_MS) {
    await new Promise((r) => setTimeout(r, 500));
    const fresh = existsSync(logPath) ? readFileSync(logPath, "utf8").slice(runLogBefore) : "";
    // A log that shrank was rewritten; read it all rather than miss the run.
    const text = fresh || (existsSync(logPath) && readFileSync(logPath, "utf8").length < runLogBefore
      ? readFileSync(logPath, "utf8")
      : "");
    if (/ start /.test(text)) sawStart = true;
    const failed = text.match(/ (FAILED [^\n]*)/);
    if (failed) {
      console.log(`autoRun ${failed[1]} -- see ${RUN_LOG}`);
      process.exitCode = 1;
      return;
    }
    const done = text.match(/ (done [^\n]*)/);
    if (done) {
      console.log(`autoRun ${done[1]}; Obsidian is free again`);
      return;
    }
    if (!sawStart && Date.now() - startedAt > 20_000) {
      console.log("NOTE: no auto-run started within 20s of the copy, so the reload may not have happened.");
      return;
    }
  }
  console.log(`NOTE: the auto-run was still going after ${AUTO_RUN_LIMIT_MS / 1000}s. Obsidian may be slow to answer until it ends.`);
}

/**
 * Whether anything is actually watching the files just copied.
 *
 * This line used to read "the plugin will hot-reload", asserted from nothing
 * but the vault being open -- which is the same mistake the warning above
 * exists to prevent, one level down. A vault can be open, the deploy can
 * land, and the reload can still not happen, because hot-reload is a
 * separate community plugin that has to be installed and enabled. Saying so
 * from a fact not in evidence costs exactly what the hour above cost: a
 * change that appears not to work, and a search in the wrong place.
 *
 * The marker is this script's own doing now, so what is left to check is the
 * plugin behind it.
 */
function reportHotReload(vaultPath) {
  const enabledList = join(
    vaultPath,
    ".obsidian",
    "community-plugins.json",
  );

  let enabled;
  try {
    enabled = JSON.parse(readFileSync(enabledList, "utf8"));
  } catch {
    // No list, or unreadable: say nothing rather than guess either way.
    return false;
  }

  if (enabled.includes("hot-reload")) {
    console.log("hot-reload is enabled: the plugin will reload on its own");
    return true;
  }

  const installed = existsSync(
    join(vaultPath, ".obsidian", "plugins", "hot-reload"),
  );

  console.log("");
  console.log(
    installed
      ? "NOTE: hot-reload is installed but not enabled, so nothing is watching."
      : "NOTE: hot-reload is not installed, so nothing is watching.",
  );
  console.log(
    "  The files are in place; toggle this plugin off and on in Obsidian to",
  );
  console.log(
    installed
      ? "  pick them up, or enable hot-reload to stop having to."
      : "  pick them up, or install pjeby/hot-reload to stop having to.",
  );
  return false;
}
