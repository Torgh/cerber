import { describe, expect, it } from "vitest";
import { deadlineFrom, holidays, isWorkingDay } from "./dates";

describe("deadlines", () => {
  it("counts calendar days", () => {
    expect(deadlineFrom("2026-10-02", 30)).toBe("2026-11-02"); // Sun 1.11 is a holiday and a Sunday → Mon 2.11
  });
  it("moves a Saturday end to Monday", () => {
    expect(deadlineFrom("2026-11-07", 7)).toBe("2026-11-16"); // Sat 14.11 → Mon 16.11
  });
  it("skips Easter Monday and Christmas Eve", () => {
    expect(holidays(2026).has("2026-04-06")).toBe(true);
    expect(holidays(2026).has("2026-06-04")).toBe(true); // Boże Ciało
    expect(isWorkingDay("2026-12-24")).toBe(false);
    expect(deadlineFrom("2026-12-10", 14)).toBe("2026-12-28"); // Thu 24 → 25, 26 holidays, 27 Sunday
  });
});
