import { describe, expect, it } from "vitest";

import {
  resolveDashboardProjectKey,
  resolveStoredProjectKey,
} from "./project-preference";

const keys = ["ARG", "CORE"];

describe("project preference", () => {
  it("keeps a valid stored project key", () => {
    expect(resolveStoredProjectKey("CORE", keys)).toBe("CORE");
  });

  it("rejects a stale or missing stored key", () => {
    expect(resolveStoredProjectKey("GONE", keys)).toBeNull();
    expect(resolveStoredProjectKey(null, keys)).toBeNull();
  });

  it("falls back to the first project on /dashboard", () => {
    expect(resolveDashboardProjectKey(null, keys)).toBe("ARG");
    expect(resolveDashboardProjectKey("GONE", keys)).toBe("ARG");
    expect(resolveDashboardProjectKey("CORE", keys)).toBe("CORE");
  });

  it("returns null when there are no projects", () => {
    expect(resolveDashboardProjectKey("ARG", [])).toBeNull();
  });
});
