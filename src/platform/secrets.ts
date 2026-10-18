/**
 * Keeping the GitHub token out of plaintext.
 *
 * The spike stored it in the plugin's `data.json`, which is a file inside the
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

/** Decrypts a stored token. A value that was never encrypted passes through. */
export function revealToken(stored: string): string {
  if (!stored) return "";
  if (!stored.startsWith(ENCRYPTED_PREFIX)) return stored;

  const storage = safeStorage();
  const payload = stored.slice(ENCRYPTED_PREFIX.length);
  if (!storage) return "";

  try {
    const req = nodeRequire();
    const Buffer = req ? req("buffer").Buffer : (globalThis as any).Buffer;
    return storage.decryptString(Buffer.from(payload, "base64"));
  } catch {
    // Wrong machine, reset keychain, or a changed OS user. The token is not
    // recoverable and the user has to paste a new one; returning empty makes
    // the settings UI show it as missing rather than show mojibake.
    return "";
  }
}

/** True when the stored value is ciphertext rather than a bare token. */
export function isProtected(stored: string): boolean {
  return stored.startsWith(ENCRYPTED_PREFIX);
}
