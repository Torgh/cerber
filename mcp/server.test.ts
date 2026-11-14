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

  it("reports errors instead of crashing", async () => {
    const r = await call("get_case", { case_id: 404 });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Nie ma sprawy #404");
  });
});
