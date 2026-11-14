import { describe, expect, it } from "vitest";
import { removeDemo } from "./demo";
import { caseText, deadlineText, eventDates, personText } from "./format";
import * as ops from "./ops";
import { escapeHtml, reportHtml, reportMarkdown } from "./report";
import { handlerOf, replyRecords, stats } from "./stats";
import { deadlineState, formalIssues, promiseMoves } from "./status";
import { emptyDb, type FileRef } from "./types";

const scan = (id: string, name = `${id}.pdf`, size = 10): FileRef => ({ id, name, mime: "application/pdf", size });

describe("letter dates", () => {
  it("keeps the date on the letter, the cooperative's date and an uncertain date", () => {
    const db = emptyDb();
    const c = ops.createCase(db, { title: "A", category: "other" });
    const { event: mine } = ops.addEvent(db, c.id, { date: "2026-09-07", kind: "letter", registeredDate: "2026-09-08", dateApprox: true, replyDeadline: { days: 14, basis: "manual" } });
    expect(mine).toMatchObject({ registeredDate: "2026-09-08", dateApprox: true });
    expect(eventDates(mine)).toEqual(["spółdzielnia datuje je na 08 wrz 2026", "data przybliżona"]);
    // The same date as the event is not stored twice.
    const { event: same } = ops.addEvent(db, c.id, { date: "2026-09-07", kind: "note", letterDate: "2026-09-07" });
    expect(same.letterDate).toBeUndefined();

    // Received late, but dated within the deadline.
    const { event: reply } = ops.addEvent(db, c.id, { date: "2026-09-25", kind: "response", letterDate: "2026-09-18" });
    const s = deadlineState(c.deadlines[0], "2026-10-01", c);
    expect(s).toMatchObject({ state: "done", datedInTime: "2026-09-18" });
    expect(deadlineText(s)).toContain("pismo datowane 18 wrz 2026, w terminie");

    ops.updateEvent(db, c.id, reply.id, { letterDate: null, dateApprox: true });
    expect(reply).toMatchObject({ letterDate: undefined, dateApprox: true });
    expect(deadlineState(c.deadlines[0], "2026-10-01", c).datedInTime).toBeUndefined();
    expect(() => ops.addEvent(db, c.id, { date: "2026-09-01", kind: "note", letterDate: "2026-13-01" })).toThrow("Data na piśmie");
    expect(() => ops.updateEvent(db, c.id, reply.id, { registeredDate: "x" })).toThrow("Data rejestracji");
  });
});

describe("moved promises", () => {
  it("records each move and counts the ones made after the date had passed", () => {
    const db = emptyDb();
    const c = ops.createCase(db, { title: "Szlabany", category: "defect" });
    const { event: r1 } = ops.addEvent(db, c.id, { date: "2022-07-01", kind: "response" });
    const { added } = ops.saveAnalysis(db, c.id, r1.id, { summary: "Ankieta w lipcu.", commitments: [{ label: "Ankieta", due: "2022-07-31" }] });
    const d = added[0];

    // A later letter moves the same promise.
    const { event: r2 } = ops.addEvent(db, c.id, { date: "2022-07-21", kind: "response" });
    const res = ops.saveAnalysis(db, c.id, r2.id, { summary: "Ankieta w sierpniu.", commitments: [{ label: "Ankieta o szlabanach", due: "2022-08-31", replaces: d.id }] });
    expect(res.added).toEqual([]);
    expect(res.moved).toEqual([d]);
    expect(d).toMatchObject({ due: "2022-08-31", label: "Ankieta o szlabanach", fromEventId: r2.id });
    // Saving the same analysis again does not add another move.
    ops.saveAnalysis(db, c.id, r2.id, { summary: "Ankieta w sierpniu.", commitments: [{ label: "Ankieta o szlabanach", due: "2022-08-31", replaces: d.id }] });
    expect(d.history).toEqual([{ due: "2022-07-31", movedOn: "2022-07-21", source: "Odpowiedź spółdzielni, 2022-07-01" }]);

    // Moved again much later, after the date had passed – a broken promise.
    ops.updateDeadline(db, c.id, d.id, { due: "2026-12-31", movedOn: "2026-09-11", source: "pismo z 11.09.2026" });
    expect(promiseMoves(d)).toEqual({ moved: 2, broken: 1, dates: ["2022-07-31", "2022-08-31", "2026-12-31"] });
    expect(deadlineText(deadlineState(d, "2026-11-14", c))).toContain("Przesuwany 2× (1× dopiero po upływie terminu): 31 lip 2022 → 31 sie 2022 → 31 gru 2026.");

    // A correction without movedOn changes the date only; earlier promises can be added from old letters.
    ops.updateDeadline(db, c.id, d.id, { due: "2026-12-30" });
    ops.updateDeadline(db, c.id, d.id, { earlier: [{ due: "2022-06-30", movedOn: "2022-07-01" }] });
    expect(d.history!.map((h) => h.due)).toEqual(["2022-06-30", "2022-07-31", "2022-08-31"]);
    expect(() => ops.saveAnalysis(db, c.id, r2.id, { summary: "x", commitments: [{ label: "A", due: "2026-01-01", replaces: "nope" }] })).toThrow("Nie ma terminu");
    expect(() => ops.updateDeadline(db, c.id, d.id, { due: "2027-01-01", movedOn: "zle" })).toThrow("Data przesunięcia");
  });
});

describe("people", () => {
  it("keeps members and proxies and the sender of a letter", () => {
    const db = emptyDb();
    const member = ops.savePerson(db, { name: " Anna Nowak ", role: "member" });
    const proxy = ops.savePerson(db, { name: "Jan Nowak", role: "proxy", proxyFor: member.id, proxyScope: "sprawy lokalu nr 3" });
    expect(personText(db, proxy)).toBe("Jan Nowak (pełnomocnik – Anna Nowak, zakres: sprawy lokalu nr 3)");
    expect(personText(db, member)).toBe("Anna Nowak (członek spółdzielni)");

    const c = ops.createCase(db, { title: "Dokumenty", category: "documents" });
    const { event } = ops.addEvent(db, c.id, { date: "2026-08-13", kind: "letter", senderId: proxy.id });
    expect(caseText(c, "2026-08-14", db)).toContain("nadawca: Jan Nowak (pełnomocnik – Anna Nowak, zakres: sprawy lokalu nr 3)");
    expect(() => ops.addEvent(db, c.id, { date: "2026-08-13", kind: "letter", senderId: "nope" })).toThrow("Nie ma osoby");

    ops.savePerson(db, { id: proxy.id, role: "other" });
    expect(proxy).toMatchObject({ role: "other", proxyFor: undefined, proxyScope: undefined });
    expect(() => ops.savePerson(db, { id: member.id, role: "proxy", proxyFor: member.id })).toThrow("własnym");
    expect(() => ops.savePerson(db, { name: " " })).toThrow("imię");
    expect(() => ops.savePerson(db, { id: member.id, name: "" })).toThrow("imię");
    expect(() => ops.savePerson(db, { id: "nope" })).toThrow("Nie ma osoby");

    ops.savePerson(db, { id: proxy.id, role: "proxy", proxyFor: member.id });
    ops.deletePerson(db, member.id);
    expect(proxy.proxyFor).toBeUndefined();
    ops.deletePerson(db, proxy.id);
    expect(event.senderId).toBeUndefined();
    expect(() => ops.deletePerson(db, "nope")).toThrow();
  });
});

describe("one letter in several cases", () => {
  it("shares a reply with another case: same files, own analysis, deadlines met in both", () => {
    const db = emptyDb();
    const gates = ops.createCase(db, { title: "Szlabany", category: "defect" });
    const docs = ops.createCase(db, { title: "Dokumenty", category: "documents" });
    ops.addEvent(db, gates.id, { date: "2026-08-13", kind: "letter", replyDeadline: { days: 42, basis: "rules" } });
    ops.addEvent(db, docs.id, { date: "2026-08-13", kind: "letter", replyDeadline: { days: 42, basis: "rules" } });
    const { event: reply } = ops.addEvent(db, docs.id, { date: "2026-09-17", kind: "response", reference: "OS/4491/TM", files: [scan("scan0001")] });

    const { event: copy } = ops.shareEvent(db, docs.id, reply.id, gates.id);
    expect(copy).toMatchObject({ kind: "response", reference: "OS/4491/TM", linkId: reply.linkId });
    expect(copy.files).toEqual(reply.files);
    expect(gates.deadlines[0].doneEventId).toBe(copy.id);
    expect(gates.related).toEqual([docs.id]);
    expect(docs.related).toEqual([gates.id]);
    expect(caseText(gates, "2026-09-18", db)).toContain(`🔗 To samo pismo także w: #${docs.id}`);
    expect(caseText(gates, "2026-09-18", db)).toContain(`Powiązane sprawy: #${docs.id} Dokumenty`);
    expect(() => ops.shareEvent(db, docs.id, reply.id, gates.id)).toThrow("już w sprawie");
    expect(() => ops.shareEvent(db, docs.id, reply.id, docs.id)).toThrow("ta sama");

    // Edits and files reach both copies; the analysis does not.
    ops.updateEvent(db, gates.id, copy.id, { letterDate: "2026-09-11", reference: "L.dz. OS/4491/TM" });
    expect(reply).toMatchObject({ letterDate: "2026-09-11", reference: "L.dz. OS/4491/TM" });
    ops.attachFiles(db, docs.id, reply.id, [scan("scan0002")]);
    expect(copy.files.map((f) => f.id)).toEqual(["scan0001", "scan0002"]);
    ops.saveAnalysis(db, gates.id, copy.id, { summary: "O szlabanach." });
    expect(reply.analysis).toBeUndefined();

    // A file removed from one copy stays on disk only while something else uses it.
    const removed = ops.removeFile(db, gates.id, copy.id, "scan0002");
    expect(reply.files.map((f) => f.id)).toEqual(["scan0001"]);
    expect(ops.unreferenced(db, [removed])).toEqual([removed]);
    // Deleting one copy keeps the file for the other.
    expect(ops.unreferenced(db, ops.deleteEvent(db, gates.id, copy.id))).toEqual([]);
    expect(gates.deadlines[0].doneAt).toBeUndefined();
  });

  it("links a letter added twice and drops the duplicate files", () => {
    const db = emptyDb();
    const a = ops.createCase(db, { title: "A", category: "other" });
    const b = ops.createCase(db, { title: "B", category: "other" });
    const { event: ea } = ops.addEvent(db, a.id, { date: "2026-09-17", kind: "response", files: [scan("aaaaaa1", "154__SCAN.pdf", 99)] });
    const { event: eb } = ops.addEvent(db, b.id, { date: "2026-09-17", kind: "response", files: [scan("bbbbbb1", "154__SCAN.pdf", 99), scan("bbbbbb2", "zdjecie.pdf")] });
    const { event: note } = ops.addEvent(db, b.id, { date: "2026-09-17", kind: "note" });
    const gone = ops.linkEvents(db, a.id, ea.id, b.id, eb.id);
    expect(gone.map((f) => f.id)).toEqual(["bbbbbb1"]);
    expect(eb.files.map((f) => f.id)).toEqual(["aaaaaa1", "bbbbbb2"]);
    expect(ea.files.map((f) => f.id)).toEqual(["aaaaaa1", "bbbbbb2"]);
    expect(ea.linkId).toBe(eb.linkId);
    expect(() => ops.linkEvents(db, a.id, ea.id, b.id, note.id)).toThrow("tego samego rodzaju");
    expect(() => ops.linkEvents(db, a.id, ea.id, a.id, ea.id)).toThrow("to samo zdarzenie");
  });

  it("links and unlinks cases, and forgets a deleted case", () => {
    const db = emptyDb();
    const a = ops.createCase(db, { title: "A", category: "other" });
    const b = ops.createCase(db, { title: "B", category: "other" });
    const c = ops.createCase(db, { title: "C", category: "other" });
    ops.linkCases(db, a.id, b.id);
    ops.linkCases(db, a.id, c.id);
    ops.linkCases(db, a.id, b.id);
    expect(a.related).toEqual([b.id, c.id]);
    ops.linkCases(db, a.id, b.id, true);
    expect(a.related).toEqual([c.id]);
    expect(b.related).toBeUndefined();
    ops.deleteCase(db, c.id);
    expect(a.related).toBeUndefined();
    expect(() => ops.linkCases(db, a.id, a.id)).toThrow("sama ze sobą");
  });
});

describe("the form of a reply", () => {
  it("lists formal shortcomings", () => {
    expect(formalIssues(undefined)).toEqual([]);
    expect(formalIssues({ at: "", summary: "", formal: { signer: "board", appealInstruction: true, justification: true } })).toEqual([]);
    expect(formalIssues({ at: "", summary: "", formal: { signer: "admin", signedBy: "Administracja Osiedla", appealInstruction: false, justification: false } })).toEqual([
      "podpisane przez: Administracja Osiedla – nie organ spółdzielni",
      "brak pouczenia o odwołaniu",
      "brak uzasadnienia",
    ]);

    const db = emptyDb();
    const c = ops.createCase(db, { title: "A", category: "documents" });
    const { event } = ops.addEvent(db, c.id, { date: "2026-09-17", kind: "response", reference: "OS/4491/TM" });
    ops.saveAnalysis(db, c.id, event.id, { summary: "Odmowa.", formal: { signer: "other", signedBy: "  ", appealInstruction: false } });
    expect(event.analysis?.formal).toEqual({ signer: "other", signedBy: undefined, appealInstruction: false, justification: undefined });
    const text = caseText(c, "2026-09-18", db);
    expect(text).toContain("Forma: podpis: inna osoba lub komórka (inna osoba lub komórka) · BEZ pouczenia o odwołaniu");
    expect(text).toContain("⚑ Braki formalne odpowiedzi: 2026-09-17 (OS/4491/TM): podpisane przez: inna osoba lub komórka – nie organ spółdzielni, brak pouczenia o odwołaniu.");
  });
});

/** Two cases: one reply on time with a moved promise, one late and incomplete, one letter waiting. */
function history() {
  const db = emptyDb();
  const a = ops.createCase(db, { title: "Wraki", category: "complaint" });
  ops.addEvent(db, a.id, { date: "2024-06-06", kind: "submitted", replyDeadline: { days: 42, basis: "rules", source: "Statut § 23" } });
  const { event: r1 } = ops.addEvent(db, a.id, { date: "2024-06-13", kind: "response", reference: "L.dz. OS-4653/AG" });
  ops.addEvent(db, a.id, { date: "2025-07-15", kind: "reminder", replyDeadline: { days: 42, basis: "rules" } });
  const { event: r2 } = ops.addEvent(db, a.id, { date: "2025-09-05", kind: "response", reference: "OS-4509/AG", letterDate: "2025-09-04" });
  ops.saveAnalysis(db, a.id, r2.id, {
    summary: "Odmowa.",
    points: [
      { point: "Zgłosić Straży Miejskiej", answered: "no" },
      { point: "Kiedy", answered: "no" },
    ],
    formal: { signer: "admin", appealInstruction: false },
    commitments: [{ label: "Ekspertyza", due: "2025-10-31" }],
  });
  ops.updateDeadline(db, a.id, a.deadlines.find((d) => d.label === "Ekspertyza")!.id, { due: "2026-09-30", movedOn: "2026-09-07" });
  const b = ops.createCase(db, { title: "Dokumenty", category: "documents" });
  ops.addEvent(db, b.id, { date: "2026-08-13", kind: "letter", replyDeadline: { days: 14, basis: "manual" } });
  const demo = ops.createCase(db, { title: "Demo", category: "other" });
  demo.demo = true;
  return { db, a, b, r1 };
}

describe("statistics", () => {
  it("reads who handled a letter from its reference", () => {
    expect(handlerOf("L.dz. OS-4653/AG")).toBe("AG");
    expect(handlerOf("OS/7415/tm ")).toBe("TM");
    expect(handlerOf("123")).toBeUndefined();
    expect(handlerOf(undefined)).toBeUndefined();
  });

  it("counts replies on time, late, incomplete and waiting", () => {
    const { db, b } = history();
    const recs = replyRecords(db, "2026-11-14");
    expect(recs.map((r) => [r.caseId, r.days, r.late, r.pending, r.incomplete, r.handler])).toEqual([
      [1, 7, 0, false, false, "AG"],
      [1, 52, 10, false, true, "AG"],
      [b.id, undefined, 79, true, false, undefined],
    ]);
    const s = stats(db, "2026-11-14");
    expect(s.total).toMatchObject({ letters: 3, answered: 2, onTime: 1, late: 1, pending: 1, pendingLate: 1, avgDays: 30, medianDays: 30, incomplete: 1, formal: 1 });
    expect(s.total.maxLate).toEqual({ days: 79, caseId: b.id, letterDate: "2026-08-13" });
    expect(s.byYear.map((y) => [y.year, y.s.letters])).toEqual([
      ["2024", 1],
      ["2025", 1],
      ["2026", 1],
    ]);
    expect(s.byHandler).toEqual([expect.objectContaining({ handler: "AG", s: expect.objectContaining({ answered: 2, medianDays: 30 }) })]);
    expect(s.promises).toMatchObject({ count: 1, moved: 1, broken: 1 });
    expect(s.promises.items[0].dates).toEqual(["2025-10-31", "2026-09-30"]);

    // Closing a case without an answer stops counting its letter as waiting.
    ops.updateCase(db, b.id, { stage: "closed", outcome: "withdrawn" });
    expect(stats(db, "2026-11-14").total.pending).toBe(0);
    // Only demo data: the demo counts.
    const only = emptyDb();
    const d = ops.createCase(only, { title: "Demo", category: "other" });
    d.demo = true;
    ops.addEvent(only, d.id, { date: "2026-11-01", kind: "letter", replyDeadline: { days: 14, basis: "manual" } });
    expect(stats(only, "2026-11-14").total.letters).toBe(1);
    expect(stats(emptyDb(), "2026-11-14").total).toMatchObject({ letters: 0, avgDays: undefined, medianDays: undefined, maxLate: undefined });
  });
});

describe("case report", () => {
  it("writes the chronology with deadlines, moved promises, unanswered points and formal shortcomings", () => {
    const { db, a } = history();
    const p = ops.savePerson(db, { name: "Jan Nowak", role: "proxy" });
    ops.updateEvent(db, a.id, a.events[0].id, { senderId: p.id });
    ops.linkCases(db, a.id, 2);
    const md = reportMarkdown(a, db, "2026-11-14");
    expect(md).toContain("# Sprawa #1: Wraki");
    expect(md).toContain("Powiązane sprawy: #2 Dokumenty");
    expect(md).toContain("| 06 cze 2024 | Jan Nowak (pełnomocnik) | Zgłoszenie |  | Zgłoszenie |");
    expect(md).toContain("| 05 wrz 2025 | spółdzielnia | Odpowiedź spółdzielni | OS-4509/AG | Odpowiedź spółdzielni, pismo z 04 wrz 2025 |");
    expect(md).toContain("| 06 cze 2024 Zgłoszenie | 18 lip 2024 | Statut § 23 | 13 cze 2024 (L.dz. OS-4653/AG) | w terminie |");
    expect(md).toContain("10 dni po terminie; odpowiedź niepełna");
    expect(md).toContain("Spółdzielnia: Ekspertyza – NIESPEŁNIONE – 45 dni po terminie");
    expect(md).toContain("Termin przesuwany 1×, 1× dopiero po jego upływie: 31 paź 2025 → 30 wrz 2026.");
    expect(md).toContain("05 wrz 2025 (OS-4509/AG): bez odpowiedzi – Zgłosić Straży Miejskiej");
    expect(md).toContain("## Braki formalne odpowiedzi");

    const waiting = reportMarkdown(db.cases[1], db, "2026-11-14");
    expect(waiting).toContain("BRAK ODPOWIEDZI – 79 dni po terminie");
    expect(reportMarkdown(db.cases[1], db, "2026-08-20")).toContain("czeka, zostało 7 dni");
  });

  it("escapes everything in the printable page", () => {
    const db = emptyDb();
    const c = ops.createCase(db, { title: "<script>alert(1)</script>", category: "other", description: 'a "b" & c' });
    ops.addEvent(db, c.id, { date: "2026-01-05", kind: "note", title: "<img src=x onerror=alert(1)>" });
    const html = reportHtml(c, db, "2026-01-06");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("a &quot;b&quot; &amp; c");
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
    expect(reportMarkdown(c, db, "2026-01-06")).not.toContain("## Terminy odpowiedzi");
    // A backslash before a pipe must not undo the escaping of the table cell.
    ops.addEvent(db, c.id, { date: "2026-01-06", kind: "note", title: "a\\|b" });
    expect(reportMarkdown(c, db, "2026-01-07")).toContain("| a\\\\\\|b |");
  });
});

describe("demo removal", () => {
  it("removes demo people and links to demo cases", () => {
    const db = emptyDb();
    const mine = ops.createCase(db, { title: "Moja", category: "other" });
    const demo = ops.createCase(db, { title: "Demo", category: "other" });
    demo.demo = true;
    ops.linkCases(db, mine.id, demo.id);
    const p = ops.savePerson(db, { name: "Demo Osoba" });
    p.demo = true;
    removeDemo(db);
    expect(mine.related).toBeUndefined();
    expect(db.people).toEqual([]);
  });
});
