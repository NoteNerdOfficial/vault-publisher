/**
 * Scrambling a published site behind a password.
 *
 * **What this is, and what it is not.** A site published to GitHub Pages is
 * public: `main.ts` already knows it -- "Pages cannot serve a private
 * repository on a free plan" -- and every byte of it is served to anyone
 * who asks. So a password here cannot be a login, and a prompt that hides
 * content already sitting in the document would be worse than nothing: it
 * would tell the owner their notes are private while `curl` returned them
 * in full.
 *
 * What it is instead: the files themselves are encrypted at build time, and
 * a reader who does not have the password downloads ciphertext. That is
 * real, and it is the only form of this a static host can support. It is
 * still a shared secret rather than access control -- one password for
 * everyone, no revocation short of republishing, and anyone who has it can
 * pass it on.
 *
 * **Everything goes in, or nothing is protected.** Encrypting the body of a
 * page while publishing a navigation tree listing "Clients/Acme/Q3 Plan"
 * protects nothing worth protecting. So a protected build encrypts each
 * page whole -- title, content, navigation, search payload and all, since
 * they are all inside the one document -- and its attachments separately.
 * What is left in the clear is a shell that says a password is needed.
 *
 * **The numbers.** PBKDF2-HMAC-SHA256 at 600,000 iterations, which is the
 * figure OWASP currently gives for this algorithm, measured here at 207ms
 * on a desktop and so roughly a second on a mid-range phone -- once, at
 * unlock. AES-GCM costs nothing by comparison: 1MB encrypts in 1.5ms. The
 * cost is deliberately in the key derivation, because the attack that
 * matters is an offline guess against files somebody already downloaded.
 */

/**
 * The shape of an encrypted payload. Bumped if a reader must be told.
 *
 * It travels with every file rather than being assumed, so a page from an
 * older build cannot be fed to a newer reader that would derive a
 * different key from the same password and simply fail to decrypt.
 */
export const LOCK_VERSION = 1;

/**
 * Iterations for the key derivation.
 *
 * OWASP's current figure for PBKDF2-HMAC-SHA256. Carried in the payload
 * rather than compiled into the reader, so raising it later does not strand
 * sites published before the change.
 */
export const LOCK_ITERATIONS = 600000;

/** Bytes of salt, per build, and of IV, per file. */
export const SALT_BYTES = 16;
export const IV_BYTES = 12;

export interface LockedPayload {
  v: number;
  /** Base64. One per build, shared by every file in it. */
  salt: string;
  iterations: number;
  /** Base64. One per file: never reused under the same key. */
  iv: string;
  /** Base64 AES-GCM ciphertext, tag included. */
  data: string;
}

/**
 * WebCrypto, from wherever this is running.
 *
 * The build runs inside Obsidian, which is Electron on the desktop and a
 * web view on mobile, and the same code is exercised by tests under Node.
 * All three have WebCrypto; they do not all reach it by the same name, and
 * a secure context is not something this can assume on `app://`.
 */
/**
 * WebCrypto, by the one name all three hosts agree on.
 *
 * `crypto` is a global in a browser, in an Electron renderer and in Node 18
 * and later, so naming it directly reaches every host this runs in without
 * `globalThis` -- which the plugin review rejects, because a popout window
 * has its own and `globalThis` is not it.
 */
function webCrypto(): Crypto | undefined {
  return typeof crypto === "undefined" ? undefined : crypto;
}

function subtle(): SubtleCrypto {
  const web = webCrypto();
  if (web?.subtle) return web.subtle;
  throw new Error(
    "This build cannot encrypt: no WebCrypto in this environment.",
  );
}

function randomBytes(length: number): Uint8Array {
  const web = webCrypto();
  if (!web?.getRandomValues) {
    throw new Error("This build cannot encrypt: no secure random source.");
  }
  return web.getRandomValues(new Uint8Array(length));
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // In chunks: a spread of a megabyte of bytes into String.fromCharCode
  // overflows the argument list.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** A fresh salt, one per build. */
export function newSalt(): Uint8Array {
  return randomBytes(SALT_BYTES);
}

export async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number = LOCK_ITERATIONS,
): Promise<CryptoKey> {
  const base = await subtle().importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle().deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypts one file.
 *
 * A new IV every time, which is the one rule AES-GCM does not forgive: the
 * same key and IV over two different files leaks the difference between
 * them.
 */
export async function lock(
  plain: Uint8Array,
  key: CryptoKey,
  salt: Uint8Array,
  iterations: number = LOCK_ITERATIONS,
): Promise<LockedPayload> {
  const iv = randomBytes(IV_BYTES);
  const data = await subtle().encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    plain as BufferSource,
  );
  return {
    v: LOCK_VERSION,
    salt: toBase64(salt),
    iterations,
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(data)),
  };
}

export async function lockText(
  plain: string,
  key: CryptoKey,
  salt: Uint8Array,
  iterations: number = LOCK_ITERATIONS,
): Promise<LockedPayload> {
  return lock(new TextEncoder().encode(plain), key, salt, iterations);
}

/**
 * Decrypts one, or throws.
 *
 * A wrong password and a corrupted file are the same failure here, because
 * AES-GCM authenticates: there is no way to tell them apart and no reason
 * to try. The reader says "that password did not work", which is true of
 * both and actionable for the one that happens.
 */
export async function unlock(
  payload: LockedPayload,
  key: CryptoKey,
): Promise<Uint8Array> {
  const plain = await subtle().decrypt(
    { name: "AES-GCM", iv: fromBase64(payload.iv) as BufferSource },
    key,
    fromBase64(payload.data) as BufferSource,
  );
  return new Uint8Array(plain);
}

export async function unlockText(
  payload: LockedPayload,
  key: CryptoKey,
): Promise<string> {
  return new TextDecoder().decode(await unlock(payload, key));
}
