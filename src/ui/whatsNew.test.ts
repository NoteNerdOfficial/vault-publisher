import { describe, expect, it } from "vitest";
import { Release, compareVersions, latestRelease, releaseToShow } from "./whatsNew";

const notes = (version: string): Release => ({ version, title: version, lede: "", points: [] });
const RELEASES = [notes("0.2.0"), notes("0.3.0")];

describe("what's new", () => {
  it("compares versions part by part, not as text", () => {
    expect(compareVersions("0.1.14", "0.2.0")).toBe(-1);
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("0.2", "0.2.0")).toBe(0);
  });

  it("shows a release's notes once, after updating to it", () => {
    expect(releaseToShow("0.2.0", "0.1.14", false, RELEASES)?.version).toBe("0.2.0");
    expect(releaseToShow("0.2.0", "0.2.0", false, RELEASES)).toBeNull();
  });

  it("says nothing to a fresh install", () => {
    expect(releaseToShow("0.2.0", undefined, true, RELEASES)).toBeNull();
  });

  it("shows the newest notes when versions were skipped, and none from the future", () => {
    expect(releaseToShow("0.3.1", "0.1.14", false, RELEASES)?.version).toBe("0.3.0");
    expect(releaseToShow("0.2.5", "0.1.14", false, RELEASES)?.version).toBe("0.2.0");
    expect(releaseToShow("0.2.1", "0.2.0", false, RELEASES)).toBeNull();
  });

  it("finds the latest notes for the command, whatever was seen", () => {
    expect(latestRelease("0.2.0", RELEASES)?.version).toBe("0.2.0");
  });
});
