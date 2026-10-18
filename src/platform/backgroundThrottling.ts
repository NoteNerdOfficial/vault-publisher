/**
 * Finding out whether we can stop Obsidian's window being throttled.
 *
 * Chromium defers work in a window the user is not looking at. Measured on a
 * backgrounded Obsidian: a 50ms sleep took 3,485ms, and a 2,000ms one landed
 * at 11,485ms. That is not only our problem. Dataview fills its cells from
 * its own timers, so a dataviewjs note finished anywhere between 1s and 10s
 * depending on when its wake-up happened to land, and no amount of care in
 * our completion detection can make another plugin's scheduler run sooner.
 *
 * Worker timers were the first attempt and did not work: the delays above
 * were measured *through* them, because the results still have to be
 * delivered to the main thread, and the main thread is what is throttled.
 *
 * Electron exposes `webContents.setBackgroundThrottling(false)`, which turns
 * this off for a window. It is our own application window and the call is
 * reversible, so using it for the length of a publish and restoring it
 * afterwards is reasonable. Whether it is reachable from a renderer is the
 * open question: Electron removed `remote` from renderers in v14, and what
 * Obsidian re-exposes is version-dependent and undocumented.
 *
 * So this probes first and reports what it found, rather than assuming a path
 * exists. Everything is wrapped: a plugin that crashes on load because an
 * internal API moved is worse than a slow publish.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ProbeFinding {
  path: string;
  available: boolean;
  detail: string;
}

export interface ThrottlingProbe {
  findings: ProbeFinding[];
  /** True when some path reached a usable setBackgroundThrottling. */
  reachable: boolean;
  electronVersion: string | null;
}

/** `require` as the renderer exposes it. Obsidian runs with node integration. */
function nodeRequire(): ((id: string) => any) | null {
  // Dynamic import() does not work in this environment; require() does.
  const candidates = [
    (globalThis as any).require,
    (window as any).require,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "function") return candidate;
  }
  return null;
}

/** Describes a value without assuming anything about its shape. */
function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  const type = typeof value;
  if (type !== "object" && type !== "function") return type;
  try {
    const keys = Object.keys(value as object).slice(0, 12);
    return keys.length ? `${type}: ${keys.join(", ")}` : type;
  } catch {
    return type;
  }
}

export function probeBackgroundThrottling(): ThrottlingProbe {
  const findings: ProbeFinding[] = [];
  const add = (path: string, available: boolean, detail: string) =>
    findings.push({ path, available, detail });

  const req = nodeRequire();
  add("require()", req !== null, req ? "function" : "not exposed");

  let electronVersion: string | null = null;
  try {
    electronVersion = (process as any)?.versions?.electron ?? null;
  } catch {
    electronVersion = null;
  }
  add("process.versions.electron", electronVersion !== null, electronVersion ?? "unknown");

  if (!req) return { findings, reachable: false, electronVersion };

  let electron: any = null;
  try {
    electron = req("electron");
    add("require('electron')", true, describe(electron));
  } catch (error) {
    add("require('electron')", false, String(error).slice(0, 120));
  }

  // The candidate routes to a BrowserWindow, in rough order of likelihood.
  const routes: { path: string; get: () => any }[] = [
    {
      path: "require('electron').remote.getCurrentWindow()",
      get: () => electron?.remote?.getCurrentWindow?.(),
    },
    {
      path: "require('@electron/remote').getCurrentWindow()",
      get: () => req("@electron/remote")?.getCurrentWindow?.(),
    },
    {
      path: "electron.getCurrentWindow()",
      get: () => electron?.getCurrentWindow?.(),
    },
    {
      path: "electron.webFrame (not a window)",
      get: () => electron?.webFrame,
    },
  ];

  let reachable = false;
  for (const route of routes) {
    let value: any;
    try {
      value = route.get();
    } catch (error) {
      add(route.path, false, String(error).slice(0, 120));
      continue;
    }

    if (!value) {
      add(route.path, false, "undefined");
      continue;
    }

    const setter = value?.webContents?.setBackgroundThrottling;
    if (typeof setter === "function") {
      reachable = true;
      add(route.path, true, "HAS webContents.setBackgroundThrottling");
    } else {
      add(route.path, true, `present, but no setter (${describe(value)})`);
    }
  }

  return { findings, reachable, electronVersion };
}

/**
 * Turns background throttling off, returning a function that restores the
 * previous state. A no-op returning a no-op when the API is unreachable.
 *
 * Deliberately not called anywhere yet: the probe decides whether this is
 * worth wiring into publish at all.
 */
export function suspendBackgroundThrottling(): () => void {
  const req = nodeRequire();
  if (!req) return () => {};

  let contents: any = null;
  try {
    const electron = req("electron");
    const win =
      electron?.remote?.getCurrentWindow?.() ??
      (() => {
        try {
          return req("@electron/remote")?.getCurrentWindow?.();
        } catch {
          return null;
        }
      })();
    contents = win?.webContents ?? null;
  } catch {
    return () => {};
  }

  if (typeof contents?.setBackgroundThrottling !== "function") return () => {};

  try {
    contents.setBackgroundThrottling(false);
  } catch {
    return () => {};
  }

  return () => {
    try {
      contents.setBackgroundThrottling(true);
    } catch {
      // Restoring is best effort. Leaving throttling off costs battery, not
      // correctness, and throwing here would mask whatever the publish did.
    }
  };
}
