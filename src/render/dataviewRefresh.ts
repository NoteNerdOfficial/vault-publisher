/**
 * Holding Dataview still while we photograph it.
 *
 * Dataview re-executes every query on a timer (`refreshInterval`, 2500ms by
 * default) for as long as the block exists. During a refresh it tears its
 * cells down and rebuilds them, so for a moment the table is full of empty
 * spans again.
 *
 * That makes a snapshot non-deterministic. A publish can catch a block
 * mid-rebuild and serialize the empty version, and no amount of waiting fixes
 * it: waiting longer only means a different coin toss. One run measured 13
 * unfilled cells after 56 seconds of waiting, on a note that had rendered
 * correctly many times before.
 *
 * Reaching into another plugin's settings is not something to do lightly, so
 * this does the least it can: flips one in-memory flag, never writes to
 * Dataview's `data.json`, and restores the previous value even if the publish
 * throws. The user's saved configuration is untouched, and a crash mid-run
 * costs them nothing worse than a restart.
 */

interface DataviewPluginShape {
  settings?: { refreshEnabled?: boolean };
}

interface AppWithPlugins {
  plugins?: { plugins?: Record<string, unknown> };
}

/**
 * Runs `fn` with Dataview's periodic refresh suspended.
 *
 * A no-op when Dataview is absent or its settings are not shaped as expected,
 * because a publish without Dataview should not fail over this.
 */
export async function withDataviewRefreshSuspended<T>(
  app: AppWithPlugins,
  fn: () => Promise<T>,
): Promise<T> {
  const dataview = app.plugins?.plugins?.["dataview"] as
    | DataviewPluginShape
    | undefined;
  const settings = dataview?.settings;

  if (!settings || typeof settings.refreshEnabled !== "boolean") {
    return fn();
  }

  const previous = settings.refreshEnabled;
  settings.refreshEnabled = false;
  try {
    return await fn();
  } finally {
    settings.refreshEnabled = previous;
  }
}
