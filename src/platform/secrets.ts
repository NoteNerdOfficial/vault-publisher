/**
 * Keeping the GitHub token out of plaintext.
 *
 * An early version stored it in the plugin's `data.json`, a file inside the
 * vault: synced to every device, backed up, and in a team repo potentially
 * committed. That is fine for a throwaway test vault and wrong for anything
 * else.
 *
 * Obsidian offers plugins no secret storage of its own. Electron does:
 * `safeStorage` encrypts with a key held in the OS keychain (Keychain on
 * macOS, libsecret on Linux, DPAPI on Windows), so the ciphertext in
 * `data.json` is useless on another machine and to anyone reading the file.
 *
 * It is reached through `remote`, which Obsidian still exposes -- the same
 * route that made `setBackgroundThrottling` reachable. That is an undocumented
 * surface and could be withdrawn, so every call is guarded and the fallback
 * is explicit rather than silent: `describeStorage()` reports which mode is in
 * use, and the settings UI tells the user plainly when their token is being
 * held in plaintext.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Marks a value as ciphertext, so a stored token is never mistaken for one. */
const ENCRYPTED_PREFIX = "enc:v1:";

function nodeRequire(): ((id: string) => any) | null {
  const candidates = [(globalThis as any).require, (window as any).require];
  for (const candidate of candidates) {
    if (typeof candidate === "function") return candidate;
  }
  return null;
}

function safeStorage(): any | null {
  const req = nodeRequire();
  if (!req) return null;
  try {
    const electron = req("electron");
    const storage =
      electron?.safeStorage ??
      electron?.remote?.safeStorage ??
      (() => {
        try {
          return req("@electron/remote")?.safeStorage;
        } catch {
          return null;
        }
      })();
    if (!storage) return null;
    return storage.isEncryptionAvailable?.() ? storage : null;
  } catch {
    return null;
  }
}

export type StorageMode = "encrypted" | "plaintext";

export function storageMode(): StorageMode {
  return safeStorage() ? "encrypted" : "plaintext";
}

export function describeStorage(): string {
  return storageMode() === "encrypted"
    ? "Encrypted with your operating system's keychain."
    : "Stored as plain text: this vault's data.json will contain the token.";
}

/**
 * Encrypts a token for storage. Returns it unchanged when encryption is
 * unavailable, because refusing to store it would leave the user unable to
 * publish at all; the UI says which happened.
 */
export function protectToken(token: string): string {
  if (!token) return "";
  const storage = safeStorage();
  if (!storage) return token;
  try {
    const buffer = storage.encryptString(token);
    return ENCRYPTED_PREFIX + buffer.toString("base64");
  } catch {
    return token;
  }
}

/**
 * What came back from trying to read the stored token.
 *
 * `locked` and `lost` were previously indistinguishable, and that cost the
 * user their token. Both returned `""`, the settings screen showed the field
 * as empty, and the next save -- changing the site name was enough -- wrote
 * that empty value over the ciphertext. A token that was merely unreadable
 * for a moment was destroyed by looking at the settings.
 */
export type TokenState =
  /** Nothing stored. */
  | "none"
  /** Decrypted, or stored in plaintext. Usable. */
  | "ready"
  /**
   * Ciphertext is present but `safeStorage` is not available right now --
   * Obsidian withdrew the `remote` bridge, or the keychain is locked. The
   * stored value is still good and must be left exactly as it is.
   */
  | "locked"
  /**
   * Decryption was attempted and failed: a different machine, a reset
   * keychain, a changed OS user. Not recoverable; the user needs a new token.
   */
  | "lost";

export interface RevealedToken {
  readonly state: TokenState;
  /** The usable token. Empty unless `state` is `ready`. */
  readonly token: string;
  /** Exactly what was on disk, to be written back untouched when unreadable. */
  readonly sealed: string;
}

/** Decrypts a stored token. A value that was never encrypted passes through. */
export function revealToken(stored: string): RevealedToken {
  if (!stored) return { state: "none", token: "", sealed: "" };
  if (!stored.startsWith(ENCRYPTED_PREFIX)) {
    return { state: "ready", token: stored, sealed: stored };
  }

  const storage = safeStorage();
  const payload = stored.slice(ENCRYPTED_PREFIX.length);
  if (!storage) return { state: "locked", token: "", sealed: stored };

  try {
    const req = nodeRequire();
    const Buffer = req ? req("buffer").Buffer : (globalThis as any).Buffer;
    const token = storage.decryptString(Buffer.from(payload, "base64"));
    return { state: "ready", token, sealed: stored };
  } catch {
    return { state: "lost", token: "", sealed: stored };
  }
}

/** What to tell the user, or null when there is nothing wrong. */
export function describeTokenState(state: TokenState): string | null {
  switch (state) {
    case "locked":
      return (
        "Your saved token could not be read right now, because this platform " +
        "is not offering encrypted storage in this session. It has been left " +
        "untouched on disk -- restarting Obsidian usually restores access. " +
        "Entering a new token here will replace it."
      );
    case "lost":
      return (
        "Your saved token could not be decrypted. This happens when the vault " +
        "has moved to another machine or user account, or the system keychain " +
        "was reset. Paste a new token to replace it."
      );
    default:
      return null;
  }
}

/**
 * What to write to disk for the token.
 *
 * `inMemory` is the usable token, empty when there is none or it could not be
 * read. `sealed` is what was already on disk, empty once the user has
 * deliberately edited the field.
 *
 * The rule in one place because getting it wrong destroys a token: ciphertext
 * we could not open, with nothing offered to replace it, is written back
 * exactly as it was. Re-encrypting an empty string would overwrite it, and
 * the save that does so is triggered by any unrelated settings change.
 */
export function tokenForStorage(inMemory: string, sealed: string): string {
  if (sealed && !inMemory) return sealed;
  return protectToken(inMemory);
}

/** True when the stored value is ciphertext rather than a bare token. */
export function isProtected(stored: string): boolean {
  return stored.startsWith(ENCRYPTED_PREFIX);
}
