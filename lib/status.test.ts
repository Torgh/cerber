import { describe, expect, it } from "vitest";
import { caseText, deadlineText } from "./format";
import * as ops from "./ops";
import { answeredShare, caseRank, caseStatus, deadlineState, isIncomplete } from "./status";
import { emptyDb, type Analysis, type FileRef } from "./types";

const scan: FileRef = { id: "scan0001", name: "skan.pdf", mime: "application/pdf", size: 1 };
const points = (...a: ("yes" | "partly" | "no")[]): Analysis["points"] => a.map((answered, i) => ({ point: `Punkt ${i + 1}`, answered }));

/** My letter on 1 Oct (14 days), the reply on 10 Oct with the given points. */
function answered(p?: Analysis["points"]) {
  const db = emptyDb();
  const c = ops.createCase(db, { title: "Dokumenty", category: "documents" });
  ops.addEvent(db, c.id, { date: "2026-10-01", kind: "submitted", replyDeadline: { days: 14, basis: "manual" } });
  const { event } = ops.addEvent(db, c.id, { date: "2026-10-10", kind: "response", files: [scan] });
  ops.saveAnalysis(db, c.id, event.id, { summary: "Odpowiedź.", points: p });
  return { db, c, reply: event };
}

describe("incomplete replies", () => {
  it("scores the points of a reply", () => {
    expect(answeredShare(undefined)).toBeUndefined();
    expect(answeredShare({ at: "", summary: "", points: [] })).toBeUndefined();
    expect(answeredShare({ at: "", summary: "", points: points("yes", "partly", "no", "no") })).toEqual({
      share: 0.375,
      answered: 1,
      total: 4,
      missing: ["Punkt 3", "Punkt 4"],
    });
    expect(isIncomplete({ at: "", summary: "", points: points("yes", "no") })).toBe(false); // exactly half is enough
    expect(isIncomplete({ at: "", summary: "", points: points("partly", "no") })).toBe(true);
  });

  it("marks the deadline met only formally and flags the case", () => {
    const { c, reply } = answered(points("partly", "no", "no"));
    const d = c.deadlines[0];
    expect(deadlineState(d, "2026-11-14", c)).toMatchObject({ state: "done", incomplete: true });
    expect(deadlineState(d, "2026-11-14")).not.toHaveProperty("incomplete"); // without the case nothing is known
    expect(deadlineText(deadlineState(d, "2026-11-14", c))).toContain("NIEPEŁNA");

    const st = caseStatus(c, "2026-11-14");
    expect(st.flags).toContain("incomplete");
    expect(st.flags).not.toContain("stalled");
    expect(caseRank(c, st)).toBe(2);
    const text = caseText(c, "2026-11-14");
    expect(text).toContain("niepełna: załatwia 0 z 3 punktów");
    expect(text).toContain("bez odpowiedzi: Punkt 2; Punkt 3");
    expect(reply.analysis?.points).toHaveLength(3);
  });

  it("does not flag a reply that settles my points, or a case with something to wait for", () => {
    const ok = answered(points("yes", "partly"));
    expect(deadlineState(ok.c.deadlines[0], "2026-10-12", ok.c).incomplete).toBeUndefined();
    expect(caseStatus(ok.c, "2026-10-12").flags).toEqual([]);

    const waiting = answered(points("no"));
    ops.addDeadline(waiting.db, waiting.c.id, { party: "coop", label: "Ankieta", due: "2026-12-31", basis: "letter" }, "2026-10-10");
    expect(caseStatus(waiting.c, "2026-11-14").flags).toEqual([]);
  });
});

describe("cases with no next step", () => {
  it("flags an answered case without deadlines after two weeks", () => {
    const { c } = answered(points("yes"));
    expect(caseStatus(c, "2026-10-23").flags).toEqual([]);
    const st = caseStatus(c, "2026-10-24");
    expect(st.flags).toEqual(["stalled"]);
    expect(st.idleDays).toBe(14);
    expect(caseText(c, "2026-10-24")).toContain("Od 14 dni nic się nie dzieje");
  });

  it("does not flag closed cases", () => {
    const { db, c } = answered(points("no"));
    ops.addDraft(db, c.id, "Ponaglenie", "Treść");
    ops.updateCase(db, c.id, { stage: "closed", outcome: "refused" });
    expect(caseStatus(c, "2027-01-01").flags).toEqual([]);
  });
});

describe("drafts to send", () => {
  it("flags an unsent draft until it is sent, then the letter waits for its reply", () => {
    const { db, c } = answered(points("no"));
    const draft = ops.addDraft(db, c.id, "Ponaglenie o punkty 2–3", "Szanowni Państwo…");
    let st = caseStatus(c, "2026-11-14");
    expect(st.flags).toEqual(["draft-unsent"]); // the draft is the next step, so not "incomplete"
    expect(st.unsent.map((d) => d.id)).toEqual([draft.id]);
    expect(caseText(c, "2026-11-14")).toContain("– NIEWYSŁANY");

    const { event, deadline } = ops.sendDraft(db, c.id, draft.id, { date: "2026-11-16", method: "email", replyDeadline: { days: 14, basis: "manual" } });
    expect(event).toMatchObject({ kind: "letter", title: "Ponaglenie o punkty 2–3", draftId: draft.id, method: "email" });
    expect(draft).toMatchObject({ sentAt: "2026-11-16", sentEventId: event.id });
    expect(deadline?.due).toBe("2026-11-30");
    expect(c.stage).toBe("waiting");
    st = caseStatus(c, "2026-11-17");
    expect(st.flags).toEqual([]);
    const text = caseText(c, "2026-11-17");
    expect(text).toContain(`– wysłany 2026-11-16 [event ${event.id}]`);
    expect(text).toContain(`📝 Treść: projekt [${draft.id}]`);

    expect(() => ops.sendDraft(db, c.id, draft.id, { date: "2026-11-17" })).toThrow("już oznaczony");
    expect(() => ops.sendDraft(db, c.id, "nope", { date: "2026-11-17" })).toThrow("Nie ma takiego projektu");

    // Deleting the letter makes the draft unsent again; deleting the draft unlinks the letter.
    ops.deleteEvent(db, c.id, event.id);
    expect(draft.sentAt).toBeUndefined();
    const again = ops.sendDraft(db, c.id, draft.id, { date: "2026-11-18", kind: "reminder", title: "Ponaglenie" });
    expect(again.event).toMatchObject({ kind: "reminder", title: "Ponaglenie" });
    ops.deleteDraft(db, c.id, draft.id);
    expect(again.event.draftId).toBeUndefined();
  });

  it("only sends a draft as my letter", () => {
    const db = emptyDb();
    const c = ops.createCase(db, { title: "A", category: "other" });
    const d = ops.addDraft(db, c.id, "Wniosek", "…");
    expect(() => ops.sendDraft(db, c.id, d.id, { date: "2026-11-14", kind: "response" })).toThrow("pismo ode mnie");
    expect(d.sentAt).toBeUndefined();
  });
});
