import { expect, it } from "vitest";
import { addDemo } from "./demo";
import { caseLine, caseText } from "./format";
import * as ops from "./ops";
import { emptyDb } from "./types";

it("describes cases for Claude", () => {
  const db = emptyDb();
  const today = "2026-11-11";
  const [leak, water, docs, intercom, noise] = addDemo(db, today, { id: "demoscan01", name: "skan.jpg", mime: "image/jpeg", size: 1 });
  expect(caseLine(leak, today)).toContain("26 dni po terminie");
  expect(caseLine(water, today)).toContain("zostało 5 dni");
  expect(caseText(docs, today)).toContain("nie ma terminu");
  const it4 = caseText(intercom, today);
  expect(it4).toContain("read_document");
  expect(it4).toContain("PO TERMINIE");
  const it5 = caseText(noise, today);
  expect(it5).toContain("Analiza:");
  expect(it5).toContain("✗ Egzekwowanie");
  expect(caseText(leak, today)).toContain("Projekty pism");
  ops.updateCase(db, leak.id, { stage: "closed", outcome: "resolved" });
  expect(caseLine(leak, today)).toContain("Zamknięta – załatwiona");
  const due = ops.createCase(db, { title: "Dziś", category: "other" });
  ops.addEvent(db, due.id, { date: "2026-11-04", kind: "submitted", replyDeadline: { due: today, basis: "manual" } });
  expect(caseLine(due, today)).toContain("mija dziś");
});
