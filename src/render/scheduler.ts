/**
 * Timers that survive a backgrounded window.
 *
 * Chromium clamps `setTimeout` in a hidden page: first to once a second, and
 * after a few minutes of being hidden to roughly once a *minute*. A 300-note
 * scale run measured the consequence exactly. The late Mermaid notes began at
 * 101s, 161s, 221s, 281s, 341s, 401s, 461s and 521s into the build, each one
 * consuming a single wake-up, and the build spent 578 of its 582 seconds
 * waiting rather than rendering. Nothing in this code has a 60s timeout; the
 * 20s one was simply firing 40s late.
 *
 * Which parts degraded was the giveaway. Notes that finished from a
 * MutationObserver callback, or from the fast path, were flat across the whole
 * build. Only notes that had to wait out a timer collapsed. Observer callbacks
 * and message tasks are not throttled; timers are.
 *
 * Timers inside a dedicated Worker are not throttled either, because the
 * throttling is a property of the page's frame scheduler and a worker has its
 * own. So the waiting happens there and the result is posted back.
 *
 * Publishing is exactly the moment someone switches away to do something else,
 * so "it is fast as long as you watch it" would not have been a fix.
 */

const WORKER_SOURCE = `
self.onmessage = function (event) {
  var data = event.data;
  if (data.cancel !== undefined) {
    clearTimeout(timers[data.cancel]);
    delete timers[data.cancel];
    return;
  }
  timers[data.id] = setTimeout(function () {
    delete timers[data.id];
    self.postMessage(data.id);
  }, data.delay);
};
var timers = {};
`;

export interface Scheduler {
  /** Same contract as window.setTimeout, minus the extra-arguments form. */
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
  /** True when timers run in a worker, false when we fell back to the page. */
  readonly unthrottled: boolean;
  dispose(): void;
}

/** The page's own timers. Correct, but clamped when the window is hidden. */
function pageScheduler(): Scheduler {
  return {
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (handle) => window.clearTimeout(handle),
    unthrottled: false,
    dispose: () => {},
  };
}

/**
 * Creates a scheduler backed by a worker, falling back to the page's timers if
 * a worker cannot be created.
 *
 * The fallback is not hypothetical: a stricter Content-Security-Policy, or a
 * future Obsidian that blocks blob workers, would land here. A slow publish is
 * a far better outcome than a publish that cannot start, so failure is silent
 * and reported through `unthrottled` rather than thrown.
 */
export function createScheduler(): Scheduler {
  let worker: Worker;
  let url: string;
  try {
    const blob = new Blob([WORKER_SOURCE], { type: "application/javascript" });
    url = URL.createObjectURL(blob);
    worker = new Worker(url);
  } catch {
    return pageScheduler();
  }

  const pending = new Map<number, () => void>();
  let nextId = 1;

  worker.onmessage = (event: MessageEvent<number>) => {
    const callback = pending.get(event.data);
    if (!callback) return;
    pending.delete(event.data);
    callback();
  };

  // A worker that dies mid-build must not strand every outstanding wait, so
  // anything still pending is released rather than left to hang forever.
  worker.onerror = () => {
    const stranded = Array.from(pending.values());
    pending.clear();
    for (const callback of stranded) callback();
  };

  return {
    setTimeout(callback, delayMs) {
      const id = nextId++;
      pending.set(id, callback);
      worker.postMessage({ id, delay: delayMs });
      return id;
    },
    clearTimeout(handle) {
      if (!pending.delete(handle)) return;
      worker.postMessage({ cancel: handle });
    },
    unthrottled: true,
    dispose() {
      pending.clear();
      worker.terminate();
      URL.revokeObjectURL(url);
    },
  };
}

/**
 * The scheduler the render pipeline uses.
 *
 * One worker for the plugin's lifetime rather than one per note: a publish
 * creates thousands of short waits, and spawning a worker for each would cost
 * more than the throttling it avoids.
 */
let shared: Scheduler | null = null;

export function sharedScheduler(): Scheduler {
  if (!shared) shared = createScheduler();
  return shared;
}

export function disposeSharedScheduler(): void {
  shared?.dispose();
  shared = null;
}
