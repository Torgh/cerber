import { describe, expect, it } from "vitest";
import * as ops from "./ops";
import { searchRules, splitSections } from "./rules";
import { caseRank, caseStatus, deadlineState } from "./status";
import { emptyDb, type FileRef } from "./types";

const file = (id: string): FileRef => ({ id, name: `${id}.pdf`, mime: "application/pdf", size: 1 });

describe("editing a case", () => {
  it("updates, closes and reopens a case", () => {
    const db = emptyDb();
    const c = ops.createCase(db, { title: " Przeciek ", category: "defect", description: " opis " });
    expect(c).toMatchObject({ title: "Przeciek", description: "opis", stage: "draft" });
    ops.updateCase(db, c.id, { stage: "closed", outcome: "refused", title: "Nowy", category: "billing", description: "" });
    expect(c).toMatchObject({ stage: "closed", outcome: "refused", title: "Nowy", category: "billing", description: undefined });
    ops.updateCase(db, c.id, { stage: "waiting" });
    expect(c.outcome).toBeUndefined();
    expect(() => ops.updateCase(db, c.id, { title: " " })).toThrow("tytuł");
    expect(() => ops.createCase(db, { title: "", category: "other" })).toThrow();
    expect(ops.deleteCase(db, c.id).id).toBe(c.id);
    expect(db.cases).toHaveLength(0);
  });

  it("edits events and their files", () => {
    const db = emptyDb();
    const c = ops.createCase(db, { title: "A", category: "other" });
    const { event } = ops.addEvent(db, c.id, { date: "2026-10-05", kind: "call", title: "Telefon" });
    ops.addEvent(db, c.id, { date: "2026-10-01", kind: "note" });
    expect(c.events[0].kind).toBe("note"); // sorted by date
    ops.updateEvent(db, c.id, event.id, { date: "2026-09-30", title: "", description: " x ", method: "email", reference: " L.dz. 1 " });
    expect(c.events[0]).toMatchObject({ id: event.id, title: "Rozmowa telefoniczna", description: "x", method: "email", reference: "L.dz. 1" });
    ops.attachFiles(db, c.id, event.id, [file("aaaaaa1"), file("bbbbbb2")]);
    expect(ops.removeFile(db, c.id, event.id, "aaaaaa1").id).toBe("aaaaaa1");
    expect(() => ops.removeFile(db, c.id, event.id, "zzz")).toThrow();
    expect(() => ops.updateEvent(db, c.id, "nope", {})).toThrow("nie ma zdarzenia");
    expect(() => ops.addEvent(db, c.id, { date: "2026-02-30", kind: "note" })).toThrow("nieprawidłowa data");
    expect(ops.deleteEvent(db, c.id, event.id)).toEqual([file("bbbbbb2")]);
  });

  it("appeals escalate, and a closed case stays closed", () => {
    const db = emptyDb();
    const c = ops.createCase(db, { title: "A", category: "complaint" });
    ops.addEvent(db, c.id, { date: "2026-10-01", kind: "appeal", replyDeadline: { due: "2026-10-31", basis: "rules", source: "Statut § 15", label: "RN" } });
    expect(c.stage).toBe("escalated");
    expect(c.deadlines[0]).toMatchObject({ label: "RN", due: "2026-10-31", source: "Statut § 15" });
    ops.addEvent(db, c.id, { date: "2026-10-02", kind: "reminder", replyDeadline: null });
    expect(c.stage).toBe("escalated");
    ops.updateCase(db, c.id, { stage: "closed" });
    ops.addEvent(db, c.id, { date: "2026-10-03", kind: "response" });
    expect(c.stage).toBe("closed");
    expect(() => ops.addEvent(db, c.id, { date: "2026-10-04", kind: "letter", replyDeadline: { basis: "manual" } })).toThrow("liczbę dni");
  });
});

describe("deadlines", () => {
  it("adds, edits, meets, drops and deletes a deadline", () => {
    const db = emptyDb();
    const c = ops.createCase(db, { title: "A", category: "other" });
    const { event } = ops.addEvent(db, c.id, { date: "2026-11-02", kind: "submitted", replyDeadline: null });
    const d = ops.addDeadline(db, c.id, { party: "coop", type: "reply", label: "Odpowiedź", days: 7, basis: "manual", fromEventId: event.id }, "2026-11-11");
    expect(d.due).toBe("2026-11-09");
    const mine = ops.addDeadline(db, c.id, { party: "me", label: "Odwołanie", due: "2026-11-20", basis: "letter" }, "2026-11-11");
    expect(deadlineState(mine, "2026-11-11").state).toBe("open");
    expect(caseStatus(c, "2026-11-15").flags).toEqual(["overdue", "my-soon"]);
    ops.updateDeadline(db, c.id, d.id, { doneAt: "2026-11-08", label: "Odp.", source: "§ 4", basis: "rules", due: "2026-11-10" });
    expect(deadlineState(d, "2026-11-15").state).toBe("done");
    ops.updateDeadline(db, c.id, d.id, { doneAt: null });
    expect(d.doneAt).toBeUndefined();
    ops.updateDeadline(db, c.id, mine.id, { dropped: true });
    expect(deadlineState(mine, "2026-11-30").state).toBe("dropped");
    expect(caseStatus(c, "2026-11-30").flags).toEqual(["overdue"]);
    expect(() => ops.addDeadline(db, c.id, { party: "me", label: " ", basis: "manual", days: 1 }, "2026-11-11")).toThrow();
    expect(() => ops.updateDeadline(db, c.id, "nope", {})).toThrow();
    ops.deleteDeadline(db, c.id, d.id);
    ops.deleteDeadline(db, c.id, mine.id);
    expect(c.deadlines).toHaveLength(0);
  });

  it("orders the list by urgency", () => {
    const db = emptyDb();
    const draft = ops.createCase(db, { title: "Szkic", category: "other" });
    const closed = ops.createCase(db, { title: "Z", category: "other" });
    ops.updateCase(db, closed.id, { stage: "closed" });
    const soon = ops.createCase(db, { title: "S", category: "other" });
    ops.addEvent(db, soon.id, { date: "2026-11-10", kind: "submitted", replyDeadline: { days: 3, basis: "manual" } });
    const t = "2026-11-11";
    expect(caseRank(draft, caseStatus(draft, t))).toBe(4);
    expect(caseRank(closed, caseStatus(closed, t))).toBe(9);
    expect(caseRank(soon, caseStatus(soon, t))).toBe(2);
  });
});

describe("drafts and rules", () => {
  it("keeps drafts", () => {
    const db = emptyDb();
    const c = ops.createCase(db, { title: "A", category: "other" });
    const d = ops.addDraft(db, c.id, "", "Treść");
    expect(d.title).toBe("Projekt pisma");
    ops.deleteDraft(db, c.id, d.id);
    expect(c.drafts).toEqual([]);
  });

  it("replaces and deletes rules, and sets deadline rules", () => {
    const db = emptyDb();
    const old = ops.addRules(db, { title: "Regulamin 2020", kind: "rules", text: "§ 1. A\n§ 2. Termin 30 dni." });
    const neu = ops.addRules(db, { title: "Regulamin 2024", kind: "rules", text: "§ 1. A\n§ 2. Termin 14 dni.", validFrom: "2024-01-01", replaces: old.id });
    expect(old.supersededBy).toBe(neu.id);
    expect(searchRules(db.rules, "termin").map((h) => h.docTitle)).toEqual(["Regulamin 2024"]);
    expect(searchRules(db.rules, "termin", 8, true)).toHaveLength(2);
    expect(searchRules(db.rules, "§ 2")[0].ref).toBe("§ 2");
    ops.deleteRules(db, neu.id);
    expect(old.supersededBy).toBeUndefined();
    expect(() => ops.deleteRules(db, "nope")).toThrow();
    expect(() => ops.addRules(db, { title: "X", kind: "rules", text: "  " })).toThrow("nie zawiera tekstu");
    expect(() => ops.addRules(db, { title: "X", kind: "rules", text: "a", replaces: "nope" })).toThrow();
    ops.setDeadlineRule(db, "defect", 14, "§ 4");
    ops.setDeadlineRule(db, "defect", 21, "§ 5");
    expect(db.deadlineRules).toEqual([{ category: "defect", days: 21, source: "§ 5" }]);
    expect(() => ops.setDeadlineRule(db, "defect", -1)).toThrow();
    ops.setDeadlineRule(db, "defect", null);
    expect(db.deadlineRules).toEqual([]);
  });

  it("splits a text without paragraphs into pieces", () => {
    const text = Array.from({ length: 6 }, (_, i) => `Akapit ${i} `.repeat(60)).join("\n\n");
    const parts = splitSections(text);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].ref).toBe("fragment 1");
    expect(splitSections("Art. 8¹ Prawo.\nArt. 9. Inne.").map((s) => s.ref)).toEqual(["Art. 8¹", "Art. 9"]);
  });
});
