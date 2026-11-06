import { describe, expect, it } from "vitest";
import {
  LOCK_ITERATIONS,
  LOCK_VERSION,
  deriveKey,
  fromBase64,
  lockText,
  newSalt,
  toBase64,
  unlock,
  unlockText,
} from "./encrypt";

// The tests derive real keys, and a real key derivation is deliberately
// expensive. A low count exercises every path at the same cost as one.
const FAST = 1000;

/**
 * Whether one run of bytes appears inside another.
 *
 * Written out rather than done by decoding the ciphertext to a string: it
 * is not text, decoding it would be lossy, and a leak is a run of bytes
 * whether or not the result happens to be printable.
 */
function holds(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (!needle.length || needle.length > haystack.length) return false;
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let found = true;
    for (let j = 0; j < needle.length && found; j++) {
      if (haystack[i + j] !== needle[j]) found = false;
    }
    if (found) return true;
  }
  return false;
}

/**
 * The helper the leak test leans on, checked first.
 *
 * A search that always answered "no" would make that test pass for the
 * wrong reason and say nothing at all, which is the failure mode of every
 * negative assertion.
 */
describe("the byte search the leak test uses", () => {
  const utf8 = (text: string) => new TextEncoder().encode(text);

  it("finds a run of bytes that is there", () => {
    expect(holds(utf8("a leaked path here"), utf8("leaked"))).toBe(true);
    expect(holds(utf8("abc"), utf8("abc"))).toBe(true);
    expect(holds(utf8("abc"), utf8("a"))).toBe(true);
    expect(holds(utf8("abc"), utf8("c"))).toBe(true);
  });

  it("does not find one that is not", () => {
    expect(holds(utf8("abc"), utf8("abcd"))).toBe(false);
    expect(holds(utf8("abc"), utf8("d"))).toBe(false);
    expect(holds(utf8("abcabd"), utf8("abe"))).toBe(false);
    // A near miss that restarts inside an earlier partial match.
    expect(holds(utf8("aaab"), utf8("aab"))).toBe(true);
  });

  it("finds nothing in nothing", () => {
    expect(holds(utf8(""), utf8("a"))).toBe(false);
    expect(holds(utf8("abc"), utf8(""))).toBe(false);
  });
});

describe("locking and unlocking", () => {
  it("round-trips text", async () => {
    const salt = newSalt();
    const key = await deriveKey("open sesame", salt, FAST);
    const payload = await lockText("<h1>The quarterly plan</h1>", key, salt, FAST);

    expect(payload.v).toBe(LOCK_VERSION);
    expect(payload.iterations).toBe(FAST);
    expect(await unlockText(payload, key)).toBe("<h1>The quarterly plan</h1>");
  });

  /**
   * The whole point: what is published is ciphertext, and nothing about the
   * content survives into it in a readable form.
   *
   * Asked three ways, because "search the payload for the secret" is the
   * obvious check and the weakest one.
   *
   * **The fields, by name.** The leak worth fearing is not a cipher that
   * fails; it is a field added here later that happens to carry the vault
   * path beside the ciphertext. A whitelist catches that with certainty,
   * where a substring search catches it only if the path is spelled the way
   * the search expects.
   *
   * **The ciphertext, as bytes.** This is the real property, and comparing
   * bytes is what states it. Searching the base64 *text* asks a different
   * question -- whether one 64-symbol encoding happens to contain another
   * string -- and the answer to that is partly luck.
   *
   * **Which is how this test used to fail about once a fortnight.** It
   * searched the payload for `"Q3"`, two characters, both of them in the
   * base64 alphabet. Measured over 2,000 payloads of this exact shape, a
   * 141-character payload contains `"Q3"` by chance **1.5% of the time**,
   * while `"Acme"`, `"Clients"`, `"Plan"` and `"open sesame"` never once
   * appeared. A probe has to be long enough to mean something: four
   * characters is already a one-in-sixteen-million coincidence per
   * position, and two is a coin toss by comparison. The fragment is gone
   * and the words it came from are still here.
   */
  it("leaves nothing of the content in the payload", async () => {
    const secret = "Clients/Acme/Q3 Plan";
    const password = "open sesame";
    const salt = newSalt();
    const key = await deriveKey(password, salt, FAST);
    const payload = await lockText(secret, key, salt, FAST);

    expect(Object.keys(payload).sort()).toEqual([
      "data",
      "iterations",
      "iv",
      "salt",
      "v",
    ]);

    const ciphertext = fromBase64(payload.data);
    const utf8 = (text: string) => new TextEncoder().encode(text);

    expect(holds(ciphertext, utf8(secret))).toBe(false);
    expect(holds(ciphertext, utf8(password))).toBe(false);
    for (const word of ["Clients", "Acme", "Plan"]) {
      expect(holds(ciphertext, utf8(word))).toBe(false);
    }

    // And the assembled payload, for the same words -- the salt and the IV
    // are published beside the ciphertext and must not carry anything
    // either.
    for (const word of ["Clients", "Acme", "Plan", password]) {
      expect(JSON.stringify(payload)).not.toContain(word);
    }
  });

  it("refuses the wrong password", async () => {
    const salt = newSalt();
    const right = await deriveKey("open sesame", salt, FAST);
    const wrong = await deriveKey("open sesam", salt, FAST);
    const payload = await lockText("secret", right, salt, FAST);

    await expect(unlock(payload, wrong)).rejects.toThrow();
  });

  /*
   * The one rule AES-GCM does not forgive. The same key and IV over two
   * files leaks the difference between them, so every file gets its own.
   */
  it("never reuses an IV", async () => {
    const salt = newSalt();
    const key = await deriveKey("open sesame", salt, FAST);
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      seen.add((await lockText("same text every time", key, salt, FAST)).iv);
    }
    expect(seen.size).toBe(20);
  });

  // Same password, different build: the salt is what stops one build's
  // ciphertext being attackable with work done against another's.
  it("gives a different key for a different salt", async () => {
    const payload = await lockText(
      "secret",
      await deriveKey("same password", newSalt(), FAST),
      newSalt(),
      FAST,
    );
    const other = await deriveKey("same password", newSalt(), FAST);
    await expect(unlock(payload, other)).rejects.toThrow();
  });

  it("carries the cost it was built with, so raising it later strands nothing", async () => {
    const salt = newSalt();
    const key = await deriveKey("p", salt, FAST);
    const payload = await lockText("x", key, salt, FAST);

    // A reader derives from what the payload says, not from today's figure.
    expect(payload.iterations).toBe(FAST);
    expect(payload.iterations).not.toBe(LOCK_ITERATIONS);
    expect(await unlockText(payload, await deriveKey("p", fromBase64(payload.salt), payload.iterations))).toBe("x");
  });
});

describe("base64", () => {
  it("round-trips bytes, including a payload too big to spread", () => {
    const bytes = new Uint8Array(200000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
  });
});
