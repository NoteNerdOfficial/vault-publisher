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

describe("locking and unlocking", () => {
  it("round-trips text", async () => {
    const salt = newSalt();
    const key = await deriveKey("open sesame", salt, FAST);
    const payload = await lockText("<h1>The quarterly plan</h1>", key, salt, FAST);

    expect(payload.v).toBe(LOCK_VERSION);
    expect(payload.iterations).toBe(FAST);
    expect(await unlockText(payload, key)).toBe("<h1>The quarterly plan</h1>");
  });

  // The whole point: what is published is ciphertext, and nothing about the
  // content survives into it in a readable form.
  it("leaves nothing of the content in the payload", async () => {
    const salt = newSalt();
    const key = await deriveKey("open sesame", salt, FAST);
    const payload = await lockText("Clients/Acme/Q3 Plan", key, salt, FAST);

    expect(JSON.stringify(payload)).not.toContain("Acme");
    expect(JSON.stringify(payload)).not.toContain("Q3");
    expect(JSON.stringify(payload)).not.toContain("open sesame");
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
