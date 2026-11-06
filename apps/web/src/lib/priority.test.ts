import { describe, expect, it } from "vitest";

import { priorityTier } from "./priority";

describe("priorityTier", () => {
  it("maps every tier boundary", () => {
    expect(priorityTier(0).label).toBe("Low / Cosmetic");
    expect(priorityTier(25).label).toBe("Low / Cosmetic");
    expect(priorityTier(26).label).toBe("Medium / Functional Flaw");
    expect(priorityTier(50).label).toBe("Medium / Functional Flaw");
    expect(priorityTier(51).label).toBe("High / Flow Blocked");
    expect(priorityTier(75).label).toBe("High / Flow Blocked");
    expect(priorityTier(76).label).toBe(
      "Critical / System Blocker / Data Loss",
    );
    expect(priorityTier(100).label).toBe(
      "Critical / System Blocker / Data Loss",
    );
  });

  it("keeps the tier stable for every integer in the range", () => {
    for (let value = 0; value <= 100; value += 1) {
      expect(priorityTier(value).label).toBeTruthy();
    }
  });
});
