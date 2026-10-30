// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  describeTokenState,
  isProtected,
  protectToken,
  revealToken,
  storageMode,
  tokenForStorage,
} from "./secrets";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * `safeStorage` is reached through Electron's `require`, which jsdom does not
 * have — so by default these tests see the no-encryption path, which is
 * exactly the plaintext case. Installing a fake `require` covers the rest.
 */
function installSafeStorage(storage: unknown): () => void {
  const had = "require" in globalThis;
  const previous = (globalThis as any).require;
  (globalThis as any).require = (id: string) => {
    if (id === "electron") return { safeStorage: storage };
    if (id === "buffer") return { Buffer };
    return undefined;
  };
  return () => {
    if (had) (globalThis as any).require = previous;
    else delete (globalThis as any).require;
  };
}

/** A stand-in for Electron's working safeStorage. */
function workingStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`sealed:${value}`, "utf8"),
    decryptString: (buffer: Buffer) => {
      const text = buffer.toString("utf8");
      if (!text.startsWith("sealed:")) throw new Error("not ours");
      return text.slice("sealed:".length);
    },
  };
}

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

describe("without encryption available", () => {
  it("reports plaintext storage", () => {
    expect(storageMode()).toBe("plaintext");
  });

  it("stores a token unchanged rather than refusing", () => {
    expect(protectToken("ghp_abc")).toBe("ghp_abc");
    expect(isProtected("ghp_abc")).toBe(false);
  });

  it("reads a plaintext token back as ready", () => {
    expect(revealToken("ghp_abc")).toEqual({
      state: "ready",
      token: "ghp_abc",
      sealed: "ghp_abc",
    });
  });

  it("reports nothing stored as none", () => {
    expect(revealToken("")).toEqual({ state: "none", token: "", sealed: "" });
  });

  /**
   * The bug this replaced. Ciphertext is on disk, encryption is unavailable
   * in this session, and the old code returned "" — indistinguishable from
   * "no token". The settings screen then showed an empty field and the next
   * save re-encrypted that empty value over the ciphertext, destroying a
   * token that was perfectly good.
   */
  it("reports ciphertext it cannot open as locked, keeping it intact", () => {
    const stored = "enc:v1:c2VhbGVkOmdocF9hYmM=";
    const revealed = revealToken(stored);

    expect(revealed.state).toBe("locked");
    expect(revealed.token).toBe("");
    // The part that matters: the caller can write this back untouched.
    expect(revealed.sealed).toBe(stored);
  });
});

describe("with encryption available", () => {
  it("round-trips a token", () => {
    restore = installSafeStorage(workingStorage());

    expect(storageMode()).toBe("encrypted");
    const sealed = protectToken("ghp_abc");
    expect(isProtected(sealed)).toBe(true);
    expect(sealed).not.toContain("ghp_abc");

    expect(revealToken(sealed)).toEqual({
      state: "ready",
      token: "ghp_abc",
      sealed,
    });
  });

  it("reports ciphertext from another machine as lost", () => {
    restore = installSafeStorage(workingStorage());
    // Valid base64, but not something this keychain produced.
    const foreign = "enc:v1:" + Buffer.from("someone else", "utf8").toString("base64");

    const revealed = revealToken(foreign);
    expect(revealed.state).toBe("lost");
    expect(revealed.token).toBe("");
    expect(revealed.sealed).toBe(foreign);
  });

  it("falls back to plaintext when encrypting throws", () => {
    restore = installSafeStorage({
      isEncryptionAvailable: () => true,
      encryptString: () => {
        throw new Error("keychain refused");
      },
      decryptString: () => "",
    });

    // Better a stored token than a user who cannot publish; the UI says which.
    expect(protectToken("ghp_abc")).toBe("ghp_abc");
  });

  it("treats unavailable encryption as absent", () => {
    restore = installSafeStorage({
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.from("x"),
      decryptString: () => "x",
    });

    expect(storageMode()).toBe("plaintext");
  });
});

describe("describeTokenState", () => {
  it("says nothing when there is nothing wrong", () => {
    expect(describeTokenState("ready")).toBeNull();
    expect(describeTokenState("none")).toBeNull();
  });

  // The two messages have to differ: one says restart, the other says replace.
  it("tells a locked token apart from a lost one", () => {
    expect(describeTokenState("locked")).toContain("left untouched");
    expect(describeTokenState("lost")).toContain("Paste a new token");
    expect(describeTokenState("locked")).not.toBe(describeTokenState("lost"));
  });
});

/**
 * The rule that decides what lands on disk. Tested directly because getting
 * it wrong is silent: the token is gone and nothing says so until the next
 * publish fails.
 */
describe("tokenForStorage", () => {
  it("writes back ciphertext it could not open", () => {
    const sealed = "enc:v1:c2VhbGVk";
    expect(tokenForStorage("", sealed)).toBe(sealed);
  });

  it("lets a deliberate replacement through", () => {
    // A real edit clears the sealed value, so there is nothing to preserve.
    expect(tokenForStorage("ghp_new", "")).toBe("ghp_new");
  });

  it("prefers a newly entered token over the old ciphertext", () => {
    expect(tokenForStorage("ghp_new", "enc:v1:old")).toBe("ghp_new");
  });

  it("clears the token when the field was emptied on purpose", () => {
    expect(tokenForStorage("", "")).toBe("");
  });
});
