/**
 * Reaching into APIs the type system cannot see.
 *
 * Three things this plugin needs exist only on the desktop app, are not in
 * the published typings, and move between versions: `require`, Electron's
 * `shell` and `safeStorage`, and the `BrowserWindow` behind
 * `setBackgroundThrottling`. The code that uses them has to assume nothing
 * and check everything.
 *
 * The obvious way to write that is `(x as any).y?.z?.()`, which is what this
 * module replaces. `any` switches the type checker off for everything
 * downstream of it: one `any` at the bridge turned into a hundred unchecked
 * property reads and calls, and the only thing holding the result together
 * was the `try`/`catch` around it. The plugin review counted them.
 *
 * So the bridge deals in `unknown` instead, and narrowing is explicit. The
 * cost is a helper call per hop rather than a dot; the gain is that a typo
 * in a property name is a type error again, and a value that turns out not
 * to be callable is a `null` rather than a `TypeError` at run time.
 */

/** An object whose contents are unknown, which is what an untyped value is. */
export type UnknownRecord = Record<string, unknown>;

/** Anything callable, with nothing assumed about its signature. */
export type UnknownFunction = (...args: unknown[]) => unknown;

/**
 * True for anything a property can be read from.
 *
 * Functions are included deliberately. Electron's bridges hang properties
 * off functions -- `require` itself has them -- and a check that excluded
 * them would send the caller back to `any` for exactly the cases this exists
 * to serve.
 */
export function isRecord(value: unknown): value is UnknownRecord {
  return (typeof value === "object" || typeof value === "function") && value !== null;
}

/** One property of an unknown value; `undefined` when it cannot have one. */
export function prop(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

/**
 * A chain of properties, stopping at the first one that is absent.
 *
 * `propPath(e, "remote", "safeStorage")` is `e?.remote?.safeStorage` without
 * the `any` that the optional chain needed to compile.
 */
export function propPath(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (current === undefined || current === null) return undefined;
    current = prop(current, key);
  }
  return current;
}

/** The value as something callable, or `null`. */
export function asFunction(value: unknown): UnknownFunction | null {
  return typeof value === "function" ? (value as UnknownFunction) : null;
}

/** True when `owner` has a callable `key`. */
export function hasMethod(owner: unknown, key: string): boolean {
  return asFunction(prop(owner, key)) !== null;
}

/**
 * Calls `key` on `owner`, with `owner` as the receiver.
 *
 * The receiver matters: `safeStorage.encryptString` and
 * `webContents.setBackgroundThrottling` are methods, and calling either one
 * detached from its object throws inside Electron rather than here.
 */
export function callMethod(owner: unknown, key: string, ...args: unknown[]): unknown {
  const fn = asFunction(prop(owner, key));
  if (!fn) return undefined;
  return Reflect.apply(fn, owner, args);
}

/** The value when it is a non-empty string, else `null`. */
export function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** `require`, as the desktop renderer exposes it. */
export type NodeRequire = (id: string) => unknown;

/**
 * The renderer's `require`, or `null` where there is none.
 *
 * Read off `window` rather than `globalThis`: a popout window has its own,
 * and the review's `no-global-this` rule is about exactly that. Guarded by
 * `typeof` because a test running in plain Node has no window at all, which
 * is also the honest answer for mobile.
 */
export function nodeRequire(): NodeRequire | null {
  const host: unknown = typeof window === "undefined" ? undefined : window;
  const fn = asFunction(prop(host, "require"));
  return fn ? (fn as NodeRequire) : null;
}

/**
 * `require(id)`, or `null` when there is no `require` or the module is not
 * there. A missing optional bridge is an expected answer, not an error.
 */
export function requireModule(id: string): unknown {
  const req = nodeRequire();
  if (!req) return null;
  try {
    return req(id) ?? null;
  } catch {
    return null;
  }
}

/** Node's `process`, where there is one. */
export function nodeProcess(): unknown {
  return typeof process === "undefined" ? null : process;
}
