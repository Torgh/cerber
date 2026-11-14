import { describe, expect, it } from "vitest";
import { samplePdf, withTempDataDir } from "@/lib/testUtils";
import * as ops from "@/lib/ops";
import { mutate } from "@/lib/server/db";
import type { Case, Db } from "@/lib/types";
import { POST as action } from "./action/route";
import { DELETE as removeDemo, POST as loadDemo } from "./demo/route";
import { GET as exportCase } from "./export/[id]/route";
import { GET as file } from "./files/[id]/route";
import { GET as state } from "./state/route";
import { POST as upload } from "./upload/route";

withTempDataDir();

const ORIGIN = "http://127.0.0.1:3200";
const json = (body: unknown, origin = ORIGIN) =>
  new Request(`${ORIGIN}/api/action`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
const form = (op: string, args: unknown, files: File[] = []) => {
  const f = new FormData();
  f.set("op", op);
  f.set("args", JSON.stringify(args));
  for (const x of files) f.append("files", x);
  return new Request(`${ORIGIN}/api/upload`, { method: "POST", headers: { Origin: ORIGIN }, body: f });
};
const getState = async () => (await (await state(new Request(`${ORIGIN}/api/state`))).json()) as { db: Db; today: string };

describe("API", () => {
  it("creates a case, adds a letter with a scan and serves the file", async () => {
    const res = await action(json({ op: "createCase", args: { title: "Domofon", category: "defect" } }));
    const { result } = (await res.json()) as { result: Case };
    expect(result.id).toBe(1);

    const pdf = new File([Buffer.from(samplePdf("Zgloszenie"))], "zgloszenie.pdf", { type: "application/pdf" });
    const up = await upload(
      form("addEvent", { caseId: 1, event: { date: "2026-11-02", kind: "submitted", replyDeadline: { days: 14, basis: "manual" } } }, [pdf]),
    );
    expect(up.status).toBe(200);

    const { db } = await getState();
    const ev = db.cases[0].events[0];
    expect(ev.files[0].pages).toBe(1);
    expect(db.cases[0].deadlines[0].due).toBe("2026-11-16");

    const got = await file(new Request(`${ORIGIN}/api/files/x`), { params: Promise.resolve({ id: ev.files[0].id }) });
    expect(got.headers.get("Content-Type")).toBe("application/pdf");
    const missing = await file(new Request(`${ORIGIN}/api/files/x`), { params: Promise.resolve({ id: "nopenope00" }) });
    expect(missing.status).toBe(404);

    await action(json({ op: "deleteEvent", args: { caseId: 1, eventId: ev.id } }));
    expect((await getState()).db.cases[0].events).toHaveLength(0);
  });

  it("marks a draft as sent with the proof of sending", async () => {
    await action(json({ op: "createCase", args: { title: "Dokumenty", category: "documents" } }));
    const draft = await mutate((db) => ops.addDraft(db, 1, "Wniosek członka", "Treść"));
    const proof = new File(["potwierdzenie"], "potwierdzenie.txt", { type: "text/plain" });
    const res = await upload(
      form("sendDraft", { caseId: 1, draftId: draft.id, event: { date: "2026-11-16", kind: "submitted", method: "in_person", replyDeadline: { days: 42, basis: "rules" } } }, [proof]),
    );
    expect(res.status).toBe(200);
    const c = (await getState()).db.cases[0];
    expect(c.events[0]).toMatchObject({ kind: "submitted", title: "Wniosek członka", draftId: draft.id });
    expect(c.events[0].files).toHaveLength(1);
    expect(c.drafts[0].sentAt).toBe("2026-11-16");
    expect((await upload(form("sendDraft", { caseId: 1, draftId: draft.id, event: { date: "2026-11-17" } }))).status).toBe(400);
  });

  it("keeps a file shared by a linked letter until its last copy goes", async () => {
    await action(json({ op: "createCase", args: { title: "A", category: "documents" } }));
    await action(json({ op: "createCase", args: { title: "B", category: "defect" } }));
    const pdf = new File([Buffer.from(samplePdf("Odpowiedz"))], "odp.pdf", { type: "application/pdf" });
    await upload(form("addEvent", { caseId: 1, event: { date: "2026-09-17", kind: "response", reference: "OS/4491/TM" } }, [pdf]));
    let db = (await getState()).db;
    const ev = db.cases[0].events[0];
    expect((await action(json({ op: "shareEvent", args: { caseId: 1, eventId: ev.id, otherCaseId: 2 } }))).status).toBe(200);
    db = (await getState()).db;
    const copy = db.cases[1].events[0];
    expect(copy.files[0].id).toBe(ev.files[0].id);
    expect(db.cases[1].related).toEqual([1]);

    const fileOk = async () => (await file(new Request(`${ORIGIN}/api/files/x`), { params: Promise.resolve({ id: ev.files[0].id }) })).status;
    await action(json({ op: "deleteEvent", args: { caseId: 1, eventId: ev.id } }));
    expect(await fileOk()).toBe(200); // still used by case B
    await action(json({ op: "deleteCase", args: { caseId: 2 } }));
    expect(await fileOk()).toBe(404);
  });

  it("saves people and exports a case", async () => {
    const res = await action(json({ op: "savePerson", args: { name: "Anna Nowak", role: "member" } }));
    const { result: person } = (await res.json()) as { result: { id: string } };
    await action(json({ op: "createCase", args: { title: "Dokumenty <b>", category: "documents" } }));
    await upload(form("addEvent", { caseId: 1, event: { date: "2026-08-13", kind: "letter", senderId: person.id, replyDeadline: { days: 14, basis: "manual" } } }));
    expect((await getState()).db.cases[0].events[0].senderId).toBe(person.id);

    const page = await exportCase(new Request(`${ORIGIN}/api/export/1`), { params: Promise.resolve({ id: "1" }) });
    expect(page.headers.get("Content-Type")).toContain("text/html");
    expect(page.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    const html = await page.text();
    expect(html).toContain("Dokumenty &lt;b&gt;");
    expect(html).toContain("Anna Nowak (członek spółdzielni)");
    const md = await exportCase(new Request(`${ORIGIN}/api/export/1?format=md`), { params: Promise.resolve({ id: "1" }) });
    expect(md.headers.get("Content-Disposition")).toContain("attachment");
    expect(await md.text()).toContain("## Chronologia");
    expect((await exportCase(new Request(`${ORIGIN}/api/export/x`), { params: Promise.resolve({ id: "x" }) })).status).toBe(400);
    expect((await exportCase(new Request(`${ORIGIN}/api/export/9`), { params: Promise.resolve({ id: "9" }) })).status).toBe(404);

    await action(json({ op: "deletePerson", args: { id: person.id } }));
    expect((await getState()).db.people).toEqual([]);
  });

  it("answers 204 while nothing changed", async () => {
    const { db } = await getState();
    const res = await state(new Request(`${ORIGIN}/api/state?since=${encodeURIComponent(db.updatedAt)}`));
    expect(res.status).toBe(204);
  });

  it("refuses other origins and unknown operations", async () => {
    expect((await action(json({ op: "createCase", args: {} }, "https://evil.example"))).status).toBe(403);
    expect((await action(json({ op: "dropTables", args: {} }))).status).toBe(400);
    expect((await action(json({ op: "updateCase", args: { caseId: 5, patch: {} } }))).status).toBe(404);
  });

  it("imports rules from text and refuses a scan without text", async () => {
    const text = "§ 1. Postanowienia ogólne.\n§ 2. Spółdzielnia odpowiada w terminie 14 dni.\n" + "Treść regulaminu. ".repeat(20);
    expect((await upload(form("addRules", { title: "Regulamin", kind: "rules", text }))).status).toBe(200);
    const scan = new File([new Uint8Array([0xff, 0xd8, 0xff])], "skan.jpg", { type: "image/jpeg" });
    const res = await upload(form("addRules", { title: "Skan", kind: "rules" }, [scan]));
    expect(res.status).toBe(400);
    expect((await getState()).db.rules).toHaveLength(1);
  });

  it("runs every operation of the board", async () => {
    const run = async (op: string, args: object) => {
      const res = await action(json({ op, args }));
      expect(res.status, op).toBe(200);
      return ((await res.json()) as { result: unknown }).result;
    };
    await run("createCase", { title: "A", category: "other" });
    await run("updateCase", { caseId: 1, patch: { title: "B" } });
    const ev = await upload(
      form("addEvent", { caseId: 1, event: { date: "2026-11-02", kind: "response" } }, [new File(["x"], "a.txt", { type: "text/plain" })]),
    );
    const { event } = (await ev.json()) as { event: { id: string; files: { id: string }[] } };
    await upload(form("attachFiles", { caseId: 1, eventId: event.id }, [new File(["y"], "b.txt", { type: "text/plain" })]));
    expect((await upload(form("attachFiles", { caseId: 1, eventId: event.id }))).status).toBe(400);
    await run("updateEvent", { caseId: 1, eventId: event.id, patch: { title: "Odp." } });
    await run("removeFile", { caseId: 1, eventId: event.id, fileId: event.files[0].id });
    const d = (await run("addDeadline", { caseId: 1, deadline: { party: "me", label: "Odwołanie", days: 14, basis: "letter" } })) as { id: string };
    await run("updateDeadline", { caseId: 1, deadlineId: d.id, patch: { dropped: true } });
    await run("deleteDeadline", { caseId: 1, deadlineId: d.id });
    await run("setDeadlineRule", { category: "defect", days: 14, source: "§ 4" });
    await run("setDeadlineRule", { category: "defect", days: null });
    const { db } = await getState();
    expect(db.cases[0]).toMatchObject({ title: "B", deadlines: [] });
    expect(db.cases[0].events[0].files).toHaveLength(1);
    expect(db.deadlineRules).toEqual([]);
    await run("deleteDraft", { caseId: 1, draftId: "none" });
    await run("deleteCase", { caseId: 1 });
    expect((await getState()).db.cases).toHaveLength(0);
    expect((await upload(form("nope", {}))).status).toBe(400);
  });

  it("deletes rules together with their file", async () => {
    const text = "§ 1. A.\n§ 2. B.\n" + "Treść regulaminu. ".repeat(20);
    const res = await upload(form("addRules", { title: "R", kind: "rules" }, [new File([text], "r.txt", { type: "text/plain" })]));
    const doc = (await res.json()) as { id: string; file: { id: string } };
    expect(doc.file.id).toBeTruthy();
    expect((await action(json({ op: "deleteRules", args: { id: doc.id } }))).status).toBe(200);
    const gone = await file(new Request(`${ORIGIN}/api/files/x`), { params: Promise.resolve({ id: doc.file.id }) });
    expect(gone.status).toBe(404);
  });

  it("loads and removes the demo", async () => {
    const res = await loadDemo(new Request(`${ORIGIN}/api/demo`, { method: "POST", headers: { Origin: ORIGIN } }));
    expect(await res.json()).toMatchObject({ ok: true, cases: 6 });
    expect((await getState()).db.cases).toHaveLength(6);
    await removeDemo(new Request(`${ORIGIN}/api/demo`, { method: "DELETE", headers: { Origin: ORIGIN } }));
    expect((await getState()).db.cases).toHaveLength(0);
  });
});
