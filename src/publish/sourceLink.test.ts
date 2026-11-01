import { describe, expect, it } from "vitest";
import {
  githubWebHost,
  resolveSourceUrl,
  sourceUrlProblem,
} from "./sourceLink";

const REPO = { apiBase: "https://api.github.com", owner: "someone", repo: "vault" };

describe("the web address of a GitHub host", () => {
  it("is github.com when the API is the hosted one", () => {
    expect(githubWebHost("https://api.github.com")).toBe("https://github.com");
  });

  // Enterprise Server's API root is a path on the same host people read.
  it("drops the API path an Enterprise Server carries", () => {
    expect(githubWebHost("https://github.example.com/api/v3")).toBe(
      "https://github.example.com",
    );
  });

  it("keeps a port, which an Enterprise Server behind one needs", () => {
    expect(githubWebHost("https://github.example.com:8443/api/v3")).toBe(
      "https://github.example.com:8443",
    );
  });

  it("falls back to github.com rather than throwing on nonsense", () => {
    expect(githubWebHost("not a url")).toBe("https://github.com");
    expect(githubWebHost("")).toBe("https://github.com");
  });
});

describe("an address somebody typed", () => {
  it("is fine when it is a full https address", () => {
    expect(sourceUrlProblem("https://example.com/someone/vault")).toBeNull();
  });

  it("is fine empty, which means derive one", () => {
    expect(sourceUrlProblem("")).toBeNull();
  });

  it("is refused when it is not a full address", () => {
    expect(sourceUrlProblem("example.com/someone/vault")).toContain("https://");
  });

  /*
   * The value goes into an `href` on every page of the site, so a scheme
   * that runs rather than navigates would be a script the publisher put in
   * their own bar for every reader to click.
   */
  it("is refused when a browser would run it rather than follow it", () => {
    expect(sourceUrlProblem("javascript:alert(1)")).toContain("http");
    expect(resolveSourceUrl({ enabled: true, url: "javascript:alert(1)" }, REPO)).toBeNull();
  });
});

describe("the address the button links to", () => {
  it("is nothing at all while the switch is off", () => {
    expect(resolveSourceUrl({ enabled: false, url: "" }, REPO)).toBeNull();
    // Even with an address typed: the switch is the decision, not the field.
    expect(
      resolveSourceUrl({ enabled: false, url: "https://example.com/x" }, REPO),
    ).toBeNull();
  });

  it("is nothing when the setting has never been written", () => {
    expect(resolveSourceUrl(undefined, REPO)).toBeNull();
  });

  it("is the repository the site publishes to when nothing is typed", () => {
    expect(resolveSourceUrl({ enabled: true, url: "" }, REPO)).toBe(
      "https://github.com/someone/vault",
    );
  });

  it("derives against an Enterprise host, not github.com", () => {
    expect(
      resolveSourceUrl(
        { enabled: true, url: "" },
        { apiBase: "https://github.example.com/api/v3", owner: "team", repo: "notes" },
      ),
    ).toBe("https://github.example.com/team/notes");
  });

  // The vault's source is often not in the repository the built site is
  // pushed to, which is the whole reason the field exists.
  it("uses a typed address as it stands, inferring nothing", () => {
    expect(
      resolveSourceUrl({ enabled: true, url: " https://gitlab.com/team/vault/ " }, REPO),
    ).toBe("https://gitlab.com/team/vault");
  });

  // No address means no button, rather than a button that leads nowhere.
  it("is nothing when nothing is typed and no repository is named", () => {
    expect(
      resolveSourceUrl({ enabled: true, url: "" }, { apiBase: "", owner: "", repo: "" }),
    ).toBeNull();
    expect(
      resolveSourceUrl(
        { enabled: true, url: "" },
        { apiBase: "https://api.github.com", owner: "someone", repo: "" },
      ),
    ).toBeNull();
  });
});
