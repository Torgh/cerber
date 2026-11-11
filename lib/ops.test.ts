import { describe, expect, it } from "vitest";
import * as ops from "./ops";
import { caseStatus } from "./status";
import { emptyDb } from "./types";

describe("case flow", () => {
  it("letter without a rule waits without a deadline", () => {
    const db = emptyDb();
    const c = ops.createCase(db, { title: "Przeciek", category: "defect" });
    ops.addEvent(db, c.id, { date: "2026-10-02", kind: "submitted" });
    expect(c.stage).toBe("waiting");
    expect(c.deadlines).toHaveLength(0);
    expect(caseStatus(c, "2026-10-05").flags).toContain("no-deadline");
  });

  it("uses the category rule, flags overdue, and a reply meets it", () => {
    const db = emptyDb();
    ops.setDeadlineRule(db, "defect", 14, "Regulamin § 4");
    const c = ops.createCase(db, { title: "Przeciek", category: "defect" });
    const { deadline } = ops.addEvent(db, c.id, { date: "2026-10-01", kind: "submitted" });
    expect(deadline?.due).toBe("2026-10-15");
    expect(caseStatus(c, "2026-10-20").flags).toContain("overdue");
    const { event } = ops.addEvent(db, c.id, { date: "2026-10-22", kind: "response", files: [{ id: "abcdef123", name: "a.pdf", mime: "application/pdf", size: 1 }] });
    expect(c.stage).toBe("answered");
    expect(c.deadlines[0].doneAt).toBe("2026-10-22");
    const st = caseStatus(c, "2026-10-23");
    expect(st.flags).not.toContain("overdue");
    expect(st.flags).toContain("to-analyze");
    ops.saveAnalysis(db, c.id, event.id, { summary: "ok", commitments: [{ label: "Wymiana pionu", due: "2026-11-30" }] });
    ops.saveAnalysis(db, c.id, event.id, { summary: "ok", commitments: [{ label: "Wymiana pionu", due: "2026-12-01" }] });
    expect(c.deadlines.filter((d) => d.label === "Wymiana pionu")).toHaveLength(1);
    expect(caseStatus(c, "2026-10-23").flags).not.toContain("to-analyze");
  });

  it("manual deadline and deleting the reply reopens it", () => {
    const db = emptyDb();
    const c = ops.createCase(db, { title: "Kopie uchwał", category: "documents" });
    ops.addEvent(db, c.id, { date: "2026-11-02", kind: "submitted", replyDeadline: { days: 7, basis: "manual" } });
    expect(c.deadlines[0].due).toBe("2026-11-09");
    const { event } = ops.addEvent(db, c.id, { date: "2026-11-05", kind: "response" });
    ops.deleteEvent(db, c.id, event.id);
    expect(c.deadlines[0].doneAt).toBeUndefined();
  });
});
