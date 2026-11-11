/** The MCP server as Claude uses it: a real stdio client against a temporary data folder. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { samplePdf } from "../lib/testUtils";

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

  it("reports errors instead of crashing", async () => {
    const r = await call("get_case", { case_id: 404 });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Nie ma sprawy #404");
  });
});
