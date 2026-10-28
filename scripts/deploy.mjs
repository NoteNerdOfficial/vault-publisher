/**
 * Copies the built plugin into the test vault.
 *
 * Obsidian loads a plugin from the vault's own .obsidian/plugins/<id>/ folder,
 * which is a real copy rather than a link back to this repo, so a build here
 * does not reach it on its own.
 */
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

for (const file of ["main.js", "manifest.json"]) {
  copyFileSync(join(root, file), join(target, file));
}

console.log(`deployed ${id} v${version} -> ${target}`);
if (markerWasMissing) console.log("wrote .hotreload (this folder was not watched)");
reportVaultState(vault);

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
  if (!existsSync(registry)) return;

  let vaults;
  try {
    vaults = Object.values(JSON.parse(readFileSync(registry, "utf8")).vaults);
  } catch {
    return;
  }

  const wanted = resolve(vaultPath);
  const entry = vaults.find((v) => resolve(v.path) === wanted);
  const open = vaults.filter((v) => v.open).map((v) => v.path);

  if (entry?.open) {
    console.log("vault is open in Obsidian");
    reportHotReload(vaultPath);
    return;
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
    return;
  }

  if (enabled.includes("hot-reload")) {
    console.log("hot-reload is enabled: the plugin will reload on its own");
    return;
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
}
