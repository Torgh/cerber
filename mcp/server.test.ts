/** The MCP server as Claude uses it: a real stdio client against a temporary data folder. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sampleMsg, samplePdf } from "../lib/testUtils";

let dir = "";
let client: Client;

type Out = { isError?: boolean; content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] };

async function call(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; images: number; isError: boolean }> {
  const r = (await client.callTool({ name, arguments: args })) as Out;
  return {
    text: r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n"),
    images: r.content.filter((c) => c.type === "image").length,
    isError: !!r.isError,
  };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cerber-mcp-"));
  fs.writeFileSync(path.join(dir, "odpowiedz.pdf"), samplePdf("Spoldzielnia: naprawa do 30.11.2026"));
  client = new Client({ name: "test", version: "1" });
  await client.connect(
    new StdioClientTransport({
      command: "bun",
      args: [path.resolve(__dirname, "server.ts")],
      env: { ...(process.env as Record<string, string>), CERBER_DATA_DIR: path.join(dir, "data") },
    }),
  );
});

afterAll(async () => {
  await client?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("MCP server", () => {
  it("lists its tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["get_overview", "add_event", "read_document", "save_analysis", "import_rules"]));
  });

  it("runs a case from the letter to the analysed reply", async () => {
    const rules = await call("import_rules", {
      title: "Regulamin usterek",
      kind: "rules",
      text: "§ 1. Ogólne.\n§ 4. Spółdzielnia odpowiada na zgłoszenie w terminie 14 dni.\n" + "Treść. ".repeat(40),
    });
    expect(rules.text).toContain("Wczytano");
    expect((await call("search_rules", { query: "termin odpowiedzi" })).text).toContain("§ 4");
    await call("set_deadline_rule", { category: "defect", days: 14, source: "Regulamin usterek § 4" });

    expect((await call("create_case", { title: "Przeciek", category: "defect" })).text).toContain("#1");
    const sent = await call("add_event", { case_id: 1, date: "2026-10-01", kind: "submitted" });
    expect(sent.text).toContain("Termin odpowiedzi: 15 paź 2026");

    const reply = await call("add_event", { case_id: 1, date: "2026-10-10", kind: "response", files: [path.join(dir, "odpowiedz.pdf")] });
    const eventId = /zdarzenie (\S+) /.exec(reply.text)![1];
    const doc = await call("read_document", { case_id: 1, event_id: eventId });
    expect(doc.text).toContain("naprawa do 30.11.2026");
    expect(doc.images).toBe(1);

    const saved = await call("save_analysis", {
      case_id: 1,
      event_id: eventId,
      summary: "Obiecuje naprawę.",
      commitments: [{ label: "Naprawa pionu", due: "2026-11-30" }],
    });
    expect(saved.text).toContain("Naprawa pionu");
    const overview = await call("get_overview");
    expect(overview.text).toContain("Przeciek");
    expect((await call("get_case", { case_id: 1 })).text).toContain("Analiza: Obiecuje naprawę.");
  });

  it("reads an Outlook e-mail with its attachments, and sends a draft", async () => {
    const mail = path.join(dir, "zgloszenie.msg");
    fs.writeFileSync(
      mail,
      sampleMsg({
        subject: "Wniosek o dokumenty",
        body: "Proszę o kopie uchwał.",
        fromEmail: "ja@example.com",
        date: "2026-08-13T16:47:01Z",
        attachments: [
          { name: "image001.png", data: new Uint8Array(50), contentId: "logo" },
          { name: "pismo.pdf", data: samplePdf("Pismo L.dz. 7415") },
        ],
      }),
    );
    await call("create_case", { title: "Dokumenty", category: "documents" });
    const sent = await call("add_event", { case_id: 2, date: "2026-08-13", kind: "submitted", files: [mail], no_deadline: true });
    const eventId = /zdarzenie (\S+) /.exec(sent.text)![1];
    const doc = await call("read_document", { case_id: 2, event_id: eventId });
    expect(doc.isError).toBe(false);
    expect(doc.text).toContain("Temat: Wniosek o dokumenty");
    expect(doc.text).toContain("Data: 13.08.2026, 18:47:01");
    expect(doc.text).toContain("Proszę o kopie uchwał.");
    expect(doc.text).toContain("Załącznik 2: pismo.pdf");
    expect(doc.text).toContain("Pismo L.dz. 7415");
    expect(doc.text).not.toContain("Załącznik 1:"); // the signature logo is skipped
    expect(doc.images).toBe(1);
    expect((await call("read_scan", { path: mail, pages: [1] })).images).toBe(0);

    const draft = await call("save_draft", { case_id: 2, title: "Ponaglenie", body: "Szanowni Państwo…" });
    const draftId = /\[(\S+)\]/.exec(draft.text)![1];
    expect((await call("get_overview")).text).toContain("✉ Projekty pism do wysłania");
    const done = await call("send_draft", { case_id: 2, draft_id: draftId, date: "2026-11-14", kind: "reminder", reply_deadline: { days: 14, basis: "manual" } });
    expect(done.text).toContain("Termin odpowiedzi: 30 lis 2026");
    expect((await call("get_case", { case_id: 2 })).text).toContain("– wysłany 2026-11-14");
    expect((await call("send_draft", { case_id: 2, draft_id: draftId, date: "2026-11-15" })).isError).toBe(true);
  });

  it("keeps people, links letters, moves promises and reports", async () => {
    const member = await call("save_person", { name: "Anna Nowak", role: "member" });
    const memberId = /\[(\S+)\]/.exec(member.text)![1];
    const proxy = await call("save_person", { name: "Jan Nowak", role: "proxy", proxy_for: memberId, proxy_scope: "sprawy lokalu" });
    const proxyId = /\[(\S+)\]/.exec(proxy.text)![1];
    expect((await call("get_people")).text).toContain("Jan Nowak (pełnomocnik – Anna Nowak, zakres: sprawy lokalu)");

    await call("create_case", { title: "Szlabany", category: "defect" });
    const letter = await call("add_event", { case_id: 3, date: "2026-08-13", kind: "letter", sender_id: proxyId, registered_date: "2026-08-14", reply_deadline: { days: 42, basis: "manual" } });
    const letterId = /zdarzenie (\S+) /.exec(letter.text)![1];
    const shared = await call("share_event", { case_id: 3, event_id: letterId, other_case_id: 2, no_deadline: true });
    expect(shared.text).toContain("Pismo dodane do sprawy #2");
    const reply = await call("add_event", { case_id: 3, date: "2026-09-17", kind: "response", reference: "OS/4491/TM", letter_date: "2026-09-11" });
    const replyId = /zdarzenie (\S+) /.exec(reply.text)![1];
    const first = await call("save_analysis", { case_id: 3, event_id: replyId, summary: "Ankieta.", commitments: [{ label: "Ankieta", due: "2026-12-31" }], formal: { signer: "admin", appeal_instruction: false } });
    expect(first.text).toContain("Nowe terminy: Ankieta");
    const caseText = (await call("get_case", { case_id: 3 })).text;
    const ankieta = /\[(\S+)\] Ankieta/.exec(caseText)![1];
    expect(caseText).toContain("nadawca: Jan Nowak");
    expect(caseText).toContain("spółdzielnia datuje je na 14 sie 2026");
    expect(caseText).toContain("To samo pismo także w: #2");
    expect(caseText).toContain("BEZ pouczenia o odwołaniu");

    const moved = await call("set_deadline", { case_id: 3, deadline_id: ankieta, due: "2027-03-31", moved_on: "2027-01-10", earlier: [{ due: "2022-08-31", moved_on: "2022-10-14" }] });
    expect(moved.text).toContain("31 sie 2022 → 31 gru 2026 → 31 mar 2027");
    const reply2 = await call("add_event", { case_id: 3, date: "2027-04-02", kind: "response" });
    const reply2Id = /zdarzenie (\S+) /.exec(reply2.text)![1];
    expect((await call("save_analysis", { case_id: 3, event_id: reply2Id, summary: "Znowu.", commitments: [{ label: "Ankieta", due: "2027-06-30", replaces: ankieta }] })).text).toContain(
      "Przesunięte obietnice: Ankieta",
    );
    expect((await call("link_cases", { case_id: 3, other_case_id: 1 })).text).toContain("Powiązano");
    expect((await call("link_cases", { case_id: 3, other_case_id: 1, unlink: true })).text).toContain("Rozłączono");

    const st = await call("get_stats");
    expect(st.text).toContain("## Według sygnatury");
    expect(st.text).toContain("TM:");
    expect(st.text).toContain("przesunięcia: 3");
    expect((await call("get_overview")).text).toContain("Osoby: Anna Nowak (członek spółdzielni)");
    const report = await call("export_case", { case_id: 3 });
    expect(report.text).toContain("# Sprawa #3: Szlabany");
    expect(report.text).toContain("Jan Nowak (pełnomocnik – Anna Nowak, zakres: sprawy lokalu)");

    const dup = await call("add_event", { case_id: 1, date: "2026-09-17", kind: "response" });
    const dupId = /zdarzenie (\S+) /.exec(dup.text)![1];
    expect((await call("link_events", { case_id: 3, event_id: replyId, other_case_id: 1, other_event_id: dupId })).text).toContain("Połączono");
    expect((await call("update_event", { case_id: 3, event_id: replyId, letter_date: "", sender_id: "" })).isError).toBe(false);
    expect((await call("save_person", { person_id: proxyId, delete: true })).text).toContain("Usunięto Jan Nowak");
    expect((await call("save_person", { delete: true })).isError).toBe(true);
  });

  it("reports errors instead of crashing", async () => {
    const r = await call("get_case", { case_id: 404 });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Nie ma sprawy #404");
  });
});
