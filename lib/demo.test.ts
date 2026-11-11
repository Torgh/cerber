import { describe, expect, it } from "vitest";
import { addDemo, hasDemo, removeDemo } from "./demo";
import * as ops from "./ops";
import { caseStatus } from "./status";
import { emptyDb } from "./types";

const scan = { id: "demoscan01", name: "skan.jpg", mime: "image/jpeg", size: 1 };

describe("demo data", () => {
  it("covers every state relative to today", () => {
    const db = emptyDb();
    const today = "2026-11-11";
    const cases = addDemo(db, today, scan);
    const flags = cases.map((c) => caseStatus(c, today).flags);
    expect(flags[0]).toContain("overdue");
    expect(flags[1]).toContain("soon");
    expect(flags[2]).toContain("no-deadline");
    expect(flags[3]).toContain("to-analyze");
    expect(cases[4].stage).toBe("escalated");
    expect(flags[4]).toEqual([]);
    expect(cases[5].stage).toBe("closed");
    expect(() => addDemo(db, today, scan)).toThrow();
  });

  it("removes only demo data and keeps the user's own", () => {
    const db = emptyDb();
    ops.setDeadlineRule(db, "defect", 7, "mój regulamin § 1");
    const mine = ops.createCase(db, { title: "Moja sprawa", category: "other" });
    addDemo(db, "2026-11-11", scan);
    expect(db.deadlineRules.find((r) => r.category === "defect")?.days).toBe(7); // demo does not override
    const files = removeDemo(db);
    expect(files).toEqual([scan]);
    expect(hasDemo(db)).toBe(false);
    expect(db.cases).toEqual([mine]);
    expect(db.deadlineRules).toHaveLength(1);
    expect(db.nextCaseId).toBe(2);
  });
});
