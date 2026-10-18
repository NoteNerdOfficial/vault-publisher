/**
 * Copies the built plugin into the spike vault.
 *
 * Obsidian loads a plugin from the vault's own .obsidian/plugins/<id>/ folder,
 * which is a real copy rather than a link back to this repo, so a build here
 * does not reach it on its own.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { id, version } = JSON.parse(
  readFileSync(join(root, "manifest.json"), "utf8"),
);

// The test vault lives outside the repo so that plugin source is never mixed
// up with the content used to exercise it. Override with VAULT_PUBLISHER_VAULT
// or a path argument; the argument wins.
const DEFAULT_VAULT = join(homedir(), "Documents/Obsidian/spike-vault");
const vault =
  process.argv[2] ?? process.env.VAULT_PUBLISHER_VAULT ?? DEFAULT_VAULT;

if (!existsSync(vault)) {
  console.error(`No vault at ${vault}`);
  console.error(
    "Pass a vault path, or set VAULT_PUBLISHER_VAULT to where yours lives.",
  );
  process.exit(1);
}

const target = join(vault, ".obsidian", "plugins", id);

if (!existsSync(target)) mkdirSync(target, { recursive: true });

for (const file of ["main.js", "manifest.json"]) {
  copyFileSync(join(root, file), join(target, file));
}

console.log(`deployed ${id} v${version} -> ${target}`);
reportVaultState(vault);

/**
 * Says whether Obsidian actually has this vault open.
 *
 * Deploying is silent and so is Obsidian: a copy into a vault nobody has open
 * looks exactly like a successful deploy, and the plugin simply never runs.
 * An hour went into that, with the real cause being a vault opened one folder
 * too high -- the repo root rather than spike-vault, which Obsidian happily
 * registered as a new empty vault.
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
    console.log("vault is open in Obsidian: the plugin will hot-reload");
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
