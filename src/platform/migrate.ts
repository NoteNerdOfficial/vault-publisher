import { App, normalizePath } from "obsidian";

/**
 * Carrying settings across a change of plugin id.
 *
 * Obsidian keys a plugin's data by its manifest id and nothing else, so
 * renaming `site-publisher-spike` to `vault-publisher` does not rename
 * anything: it introduces a second, unrelated plugin whose `loadData()`
 * returns null. The old settings are still on disk, in the old folder, where
 * nothing will ever read them again.
 *
 * Which matters more here than it usually would, because those settings
 * include a GitHub token. Silently losing it means the user's next publish
 * fails with an authentication error that has no obvious cause, and the
 * natural fix -- paste a new token -- leaves the old one lying in a stale
 * folder inside the vault.
 *
 * So the new plugin reads the old folder once, on a first run that finds no
 * data of its own. The token travels fine: `safeStorage` ciphertext is bound
 * to the machine's keychain rather than to the plugin, and a rename does not
 * move machines.
 *
 * Deliberately only on a *first* run. Someone who resets their settings and
 * restarts must not have the old ones quietly restored over the top.
 */

/** Ids this plugin has shipped under, newest last. */
export const LEGACY_PLUGIN_IDS = ["site-publisher-spike"];

export interface MigrationResult {
  /** The id the settings came from, or null when nothing was imported. */
  from: string | null;
  data: unknown | null;
  /** Folder the old plugin still occupies, for telling the user about it. */
  staleFolder: string | null;
}

/**
 * The first old plugin folder still present, or null.
 *
 * Checked on every load, not only when a migration happens. The migration
 * runs once, but the folder it read from stays until someone removes it, and
 * a user who did not open settings that first time would otherwise never be
 * told the old copy of their token is still sitting there.
 */
export async function findLegacyFolder(
  app: App,
  legacyIds: string[] = LEGACY_PLUGIN_IDS,
): Promise<string | null> {
  for (const id of legacyIds) {
    const folder = normalizePath(`${app.vault.configDir}/plugins/${id}`);
    try {
      if (await app.vault.adapter.exists(folder)) return folder;
    } catch {
      // Unreadable is the same as absent for this purpose.
    }
  }
  return null;
}

export async function migrateLegacySettings(
  app: App,
  legacyIds: string[] = LEGACY_PLUGIN_IDS,
): Promise<MigrationResult> {
  const adapter = app.vault.adapter;

  for (const id of legacyIds) {
    const folder = normalizePath(`${app.vault.configDir}/plugins/${id}`);
    const dataPath = normalizePath(`${folder}/data.json`);

    try {
      if (!(await adapter.exists(dataPath))) continue;
      const raw = await adapter.read(dataPath);
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") continue;
      return { from: id, data: parsed, staleFolder: folder };
    } catch {
      // A damaged or unreadable file is not worth failing a load over: the
      // user ends up configuring the plugin again, which is the same place
      // they would be without any of this.
    }
  }

  return { from: null, data: null, staleFolder: null };
}

/**
 * Whether anything is actually stored for this plugin.
 *
 * `loadData()` returns null for a first run, but an empty object is also
 * possible, and treating that as "already configured" would skip the
 * migration for exactly the users who need it.
 */
export function hasStoredSettings(stored: unknown): boolean {
  return Boolean(
    stored && typeof stored === "object" && Object.keys(stored).length > 0,
  );
}
