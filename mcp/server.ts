/**
 * Cerber MCP server: lets Claude (Claude Code / Claude Desktop) work on your cases with the
 * cooperative – read the scans of its letters, check them against the statute and rules, and keep the
 * timeline and deadlines up to date. It reads and writes the same JSON file as the web app, so changes
 * show up on the board within a few seconds.
 *
 *   claude mcp add --scope user cerber -- <path-to-bun> <path-to-cerber>/mcp/server.ts
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { formatDate, plDays, today } from "../lib/dates";
import { caseLine, caseText } from "../lib/format";
import * as ops from "../lib/ops";
import { searchRules } from "../lib/rules";
import { mutate, readDb, dataDir } from "../lib/server/db";
import { deleteStored, mimeOf, readStored, storeFromPath } from "../lib/server/files";
import { imageForClaude, pdfPageImages, pdfText, type PageImage } from "../lib/server/pdf";
import { caseRank, caseStatus } from "../lib/status";
import { CATEGORIES, CATEGORY_LABEL, EVENT_KINDS, RULES_KIND_LABEL, type FileRef } from "../lib/types";

const INSTRUCTIONS = `Cerber pilnuje spraw, które użytkownik (lokator) zgłasza do swojej spółdzielni mieszkaniowej.
Każda sprawa ma etap (szkic → czeka na odpowiedź → odpowiedź → eskalacja → zamknięta), oś czasu zdarzeń
(pisma, odpowiedzi, telefony, oględziny) i terminy – spółdzielni (odpowiedź, zobowiązania) i użytkownika (np. odwołanie).
Użytkownik ogląda tablicę na żywo (http://127.0.0.1:3200), więc zmieniaj dane narzędziami zamiast tylko je opisywać.

Jak pracować:
- Zacznij od get_overview: co jest po terminie, co się zbliża, co czeka na analizę, gdzie brakuje terminu.
- Nowe pismo użytkownika: add_event (kind submitted / reminder / appeal / letter, data DORĘCZENIA lub złożenia, sposób).
  Termin odpowiedzi: jeśli kategoria ma regułę z regulaminu, zostanie użyta sama. Jeśli nie – poszukaj w regulaminie
  (search_rules) i podaj reply_deadline z paragrafem jako source; gdy regulamin nic nie mówi, ZAPYTAJ użytkownika
  i ustaw termin z basis "manual". Nigdy nie zakładaj domyślnej liczby dni.
- Odpowiedź spółdzielni (zwykle skan): add_event kind "response" z plikiem (files: ścieżki), potem read_document,
  przeanalizuj i zapisz save_analysis:
  • czy odpowiada na każdy punkt pisma użytkownika (points),
  • czy powołane przepisy istnieją i mówią to, co twierdzi spółdzielnia – sprawdź search_rules / get_rules (issues, z paragrafem),
  • zobowiązania spółdzielni z datami (commitments) i terminy użytkownika, np. na odwołanie (my_deadlines),
  • sugerowany następny krok (next_step).
  Cytuj tylko to, co jest w dokumentach. Datę lub kwotę, której nie da się odczytać, nazwij nieczytelną – nie zgaduj.
- Po terminie: zaproponuj ponaglenie (save_draft), dalej odwołanie do organu wskazanego w statucie (zwykle Rada Nadzorcza).
  Projekty pism zapisuj save_draft – użytkownik sam je wysyła.
- Regulaminy: import_rules wczytuje PDF/TXT z warstwą tekstową. Skan bez tekstu: przeczytaj go read_scan i przekaż
  tekst do import_rules. Terminy, które regulamin daje spółdzielni dla danej kategorii spraw, zapisz set_deadline_rule.
- Odpowiadaj po polsku, zwięźle. Nie jesteś prawnikiem: przy sporze o pieniądze lub prawa do lokalu zasugeruj
  konsultację (np. bezpłatna pomoc prawna w powiecie).`;

const server = new McpServer({ name: "cerber", version: "0.1.0" }, { instructions: INSTRUCTIONS });

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

function tool<S extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: S,
  run: (args: z.infer<z.ZodObject<S>>) => Promise<{ content: Content[] }>,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server.registerTool as any)(name, { description, inputSchema: shape }, async (args: z.infer<z.ZodObject<S>>) => {
    try {
      return await run(args);
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }] };
    }
  });
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "RRRR-MM-DD");
const category = z.enum(CATEGORIES as [string, ...string[]]).describe(
  Object.entries(CATEGORY_LABEL)
    .map(([k, v]) => `${k} = ${v}`)
    .join("; "),
);
const deadlineInput = z
  .object({
    days: z.number().int().positive().optional().describe("Liczba dni od daty zdarzenia (kalendarzowych; koniec w sobotę/święto przesuwa się na następny dzień roboczy)"),
    due: date.optional().describe("Albo konkretna data"),
    basis: z.enum(["rules", "law", "letter", "manual"]).describe("rules = regulamin/statut, law = ustawa, letter = z pisma, manual = podany przez użytkownika"),
    source: z.string().optional().describe('np. "Regulamin usuwania usterek § 4 ust. 2"'),
  })
  .describe("Termin odpowiedzi spółdzielni");

async function storePaths(paths: string[] | undefined): Promise<FileRef[]> {
  const out: FileRef[] = [];
  for (const p of paths ?? []) out.push(await storeFromPath(p));
  return out;
}

tool("get_overview", "Przegląd: sprawy po terminie, zbliżające się terminy, odpowiedzi do analizy, sprawy bez terminu.", {}, async () => {
  const db = await readDb();
  const t = today();
  const open = db.cases.filter((c) => c.stage !== "closed");
  const rows = open.map((c) => ({ c, s: caseStatus(c, t) })).sort((a, b) => caseRank(a.c, a.s) - caseRank(b.c, b.s));
  const lines = [`Dziś: ${formatDate(t)}. Otwarte sprawy: ${open.length}, zamknięte: ${db.cases.length - open.length}.`, ""];
  const group = (title: string, pick: (s: ReturnType<typeof caseStatus>) => boolean) => {
    const g = rows.filter((r) => pick(r.s));
    if (g.length) lines.push(`## ${title}`, ...g.map((r) => `- ${caseLine(r.c, t)}`), "");
  };
  group("⚠ Po terminie", (s) => s.flags.includes("overdue") || s.flags.includes("my-overdue"));
  group("📥 Odpowiedzi do analizy", (s) => s.flags.includes("to-analyze"));
  group("❔ Czekają bez terminu", (s) => s.flags.includes("no-deadline"));
  group("⏳ Terminy w ciągu 7 dni", (s) => s.flags.includes("soon") || s.flags.includes("my-soon"));
  const rest = rows.filter((r) => !r.s.flags.length);
  if (rest.length) lines.push("## Pozostałe", ...rest.map((r) => `- ${caseLine(r.c, t)}`), "");
  lines.push(
    `Regulaminy: ${db.rules.filter((r) => !r.supersededBy).map((r) => r.title).join(", ") || "brak – poproś użytkownika o statut i regulaminy (import_rules)"}.`,
    `Reguły terminów: ${db.deadlineRules.map((r) => `${CATEGORY_LABEL[r.category]} ${plDays(r.days)} (${r.source})`).join("; ") || "brak"}.`,
    `Dane: ${dataDir()}`,
  );
  return text(lines.join("\n"));
});

tool("list_cases", "Lista spraw z etapem i najbliższym terminem.", { include_closed: z.boolean().optional() }, async ({ include_closed }) => {
  const db = await readDb();
  const t = today();
  const cs = db.cases.filter((c) => include_closed || c.stage !== "closed");
  return text(cs.map((c) => `- ${caseLine(c, t)}`).join("\n") || "Brak spraw.");
});

tool("get_case", "Cała sprawa: opis, oś czasu (z id zdarzeń i plików), analizy, terminy, projekty pism.", { case_id: z.number().int() }, async ({ case_id }) => {
  const db = await readDb();
  return text(caseText(ops.getCase(db, case_id), today()));
});

tool(
  "create_case",
  "Nowa sprawa (etap: szkic). Pismo do spółdzielni dodaj potem add_event.",
  { title: z.string(), category, description: z.string().optional().describe("Czego dotyczy, czego użytkownik żąda") },
  async (a) => {
    const c = await mutate((db) => ops.createCase(db, a as ops.CaseInput));
    return text(`Utworzono sprawę #${c.id} „${c.title}”.`);
  },
);

tool(
  "update_case",
  "Zmiana tytułu, kategorii, opisu, etapu lub wyniku (przy zamknięciu).",
  {
    case_id: z.number().int(),
    title: z.string().optional(),
    category: category.optional(),
    description: z.string().optional(),
    stage: z.enum(["draft", "waiting", "answered", "escalated", "closed"]).optional(),
    outcome: z.enum(["resolved", "partly", "refused", "withdrawn"]).optional(),
  },
  async ({ case_id, ...patch }) => {
    const c = await mutate((db) => ops.updateCase(db, case_id, patch as ops.CasePatch));
    return text(caseLine(c, today()));
  },
);

tool(
  "add_event",
  "Dodaje zdarzenie na oś czasu. Pisma użytkownika (submitted/reminder/appeal/letter) zakładają termin odpowiedzi; response spełnia otwarte terminy odpowiedzi.",
  {
    case_id: z.number().int(),
    date: date.describe("Data zdarzenia; dla pism użytkownika – data złożenia lub doręczenia (od niej liczy się termin)"),
    kind: z.enum(EVENT_KINDS as [string, ...string[]]),
    title: z.string().optional(),
    description: z.string().optional().describe("Treść / streszczenie"),
    method: z.enum(["in_person", "registered", "email", "epuap", "mailbox", "other"]).optional(),
    reference: z.string().optional().describe("Sygnatura / L.dz. pisma"),
    files: z.array(z.string()).optional().describe("Pełne ścieżki plików na dysku użytkownika (skany, PDF, zdjęcia)"),
    reply_deadline: deadlineInput.optional(),
    no_deadline: z.boolean().optional().describe("true: pismo bez terminu odpowiedzi (nie używaj reguły kategorii)"),
  },
  async ({ case_id, files, reply_deadline, no_deadline, ...rest }) => {
    const refs = await storePaths(files);
    try {
      const { event, deadline } = await mutate((db) =>
        ops.addEvent(db, case_id, {
          ...(rest as Omit<ops.EventInput, "files" | "replyDeadline">),
          files: refs,
          replyDeadline: no_deadline ? null : (reply_deadline as ops.DeadlineInput | undefined),
        }),
      );
      const lines = [`Dodano zdarzenie ${event.id} (${event.date}) do sprawy #${case_id}.`];
      if (refs.length) lines.push(`Pliki: ${refs.map((f) => `${f.name} [${f.id}]`).join(", ")}`);
      if (deadline) lines.push(`Termin odpowiedzi: ${formatDate(deadline.due)} [${deadline.id}] (${deadline.source ?? deadline.basis}).`);
      else if (["submitted", "reminder", "appeal", "letter"].includes(event.kind) && !no_deadline)
        lines.push("Brak terminu odpowiedzi: kategoria nie ma reguły z regulaminu. Sprawdź search_rules albo zapytaj użytkownika i ustaw set_deadline.");
      if (event.kind === "response" && refs.length) lines.push(`Teraz przeczytaj skan: read_document(case_id=${case_id}, event_id="${event.id}").`);
      return text(lines.join("\n"));
    } catch (err) {
      for (const f of refs) await deleteStored(f);
      throw err;
    }
  },
);

tool(
  "update_event",
  "Poprawia zdarzenie (data, tytuł, opis, sposób, sygnatura).",
  {
    case_id: z.number().int(),
    event_id: z.string(),
    date: date.optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    method: z.enum(["in_person", "registered", "email", "epuap", "mailbox", "other"]).optional(),
    reference: z.string().optional(),
  },
  async ({ case_id, event_id, ...patch }) => {
    const e = await mutate((db) => ops.updateEvent(db, case_id, event_id, patch as ops.EventPatch));
    return text(`Zapisano zdarzenie ${e.id}: ${e.date} ${e.title}.`);
  },
);

tool(
  "attach_document",
  "Dołącza plik z dysku użytkownika (skan, PDF, zdjęcie) do zdarzenia.",
  { case_id: z.number().int(), event_id: z.string(), path: z.string().describe("Pełna ścieżka pliku") },
  async ({ case_id, event_id, path: p }) => {
    const ref = await storeFromPath(p);
    try {
      await mutate((db) => ops.attachFiles(db, case_id, event_id, [ref]));
    } catch (err) {
      await deleteStored(ref);
      throw err;
    }
    return text(`Dołączono ${ref.name} [${ref.id}]${ref.pages ? `, ${ref.pages} str.` : ""}.`);
  },
);

async function renderFile(data: Uint8Array, mime: string, pages?: number[]): Promise<{ textLayer: string[]; images: PageImage[]; total: number }> {
  if (mime === "application/pdf") {
    const textLayer = await pdfText(data);
    const total = textLayer.length;
    const want = (pages?.length ? pages : Array.from({ length: Math.min(total, 10) }, (_, i) => i + 1)).filter((p) => p >= 1 && p <= total);
    return { textLayer, images: await pdfPageImages(data, want), total };
  }
  if (mime.startsWith("image/")) return { textLayer: [], images: [await imageForClaude(data)], total: 1 };
  if (mime.startsWith("text/")) return { textLayer: [new TextDecoder().decode(data)], images: [], total: 1 };
  throw new Error(`Nie umiem odczytać plików ${mime}. Zapisz pismo jako PDF albo zdjęcie.`);
}

function pageContent(r: Awaited<ReturnType<typeof renderFile>>): Content[] {
  const out: Content[] = [];
  const hasText = r.textLayer.some((t) => t.replace(/\s/g, "").length >= 10);
  if (hasText) out.push({ type: "text", text: `Warstwa tekstowa:\n${r.textLayer.map((t, i) => `--- strona ${i + 1} ---\n${t}`).join("\n")}` });
  for (const img of r.images) {
    out.push({ type: "text", text: `--- obraz strony ${img.page}/${r.total} ---` });
    out.push({ type: "image", data: img.data, mimeType: img.mime });
  }
  if (r.total > r.images.length && r.images.length) out.push({ type: "text", text: `Pokazano ${r.images.length} z ${r.total} stron – resztę odczytasz z parametrem pages.` });
  return out;
}

tool(
  "read_document",
  "Zwraca skan / dokument ze zdarzenia (obrazy stron + warstwa tekstowa) razem z kontekstem sprawy, do analizy. Po analizie wywołaj save_analysis.",
  {
    case_id: z.number().int(),
    event_id: z.string(),
    file_id: z.string().optional().describe("Domyślnie wszystkie pliki zdarzenia"),
    pages: z.array(z.number().int()).optional().describe("Strony PDF (domyślnie pierwsze 10)"),
  },
  async ({ case_id, event_id, file_id, pages }) => {
    const db = await readDb();
    const c = ops.getCase(db, case_id);
    const e = ops.getEvent(c, event_id);
    const files = file_id ? e.files.filter((f) => f.id === file_id) : e.files;
    if (!files.length) throw new Error("To zdarzenie nie ma plików. Dołącz skan attach_document.");
    const content: Content[] = [
      {
        type: "text",
        text: `# Kontekst sprawy\n${caseText(c, today())}\n\n# Analizowany dokument: ${e.title} (${e.date}) [event ${e.id}]\n` +
          (e.kind === "response"
            ? "Sprawdź: na które punkty pism użytkownika odpowiada; czy powołane przepisy istnieją i mówią to samo (search_rules / get_rules); zobowiązania z datami; pouczenia i terminy na odwołanie; następny krok. Zapisz save_analysis."
            : "Przeczytaj dokument i zapisz najważniejsze ustalenia save_analysis."),
      },
    ];
    for (const f of files) {
      content.push({ type: "text", text: `## Plik ${f.name} [${f.id}]` });
      content.push(...pageContent(await renderFile(await readStored(f), f.mime, pages)));
    }
    return { content };
  },
);

tool(
  "read_scan",
  "Odczytuje dowolny plik z dysku użytkownika (np. zeskanowany regulamin przed import_rules) – bez zapisywania go.",
  { path: z.string(), pages: z.array(z.number().int()).optional() },
  async ({ path: p, pages }) => {
    const abs = path.resolve(p);
    const data = new Uint8Array(await fs.readFile(abs));
    return { content: [{ type: "text", text: `Plik ${abs}` }, ...pageContent(await renderFile(data, mimeOf(abs), pages))] };
  },
);

tool(
  "save_analysis",
  "Zapisuje analizę dokumentu na zdarzeniu. Zobowiązania spółdzielni i terminy użytkownika trafiają do terminów sprawy (ponowny zapis ich nie dubluje).",
  {
    case_id: z.number().int(),
    event_id: z.string(),
    summary: z.string().describe("2–4 zdania: co spółdzielnia odpowiada i jak to ocenić"),
    points: z
      .array(z.object({ point: z.string(), answered: z.enum(["yes", "partly", "no"]), note: z.string().optional() }))
      .optional()
      .describe("Punkty pisma użytkownika i czy odpowiedź je załatwia"),
    issues: z.array(z.object({ text: z.string(), source: z.string().optional() })).optional().describe("Zastrzeżenia, z paragrafem źródła"),
    next_step: z.string().optional(),
    commitments: z.array(z.object({ label: z.string(), due: date, source: z.string().optional() })).optional().describe("Co spółdzielnia obiecuje i do kiedy"),
    my_deadlines: z.array(z.object({ label: z.string(), due: date, source: z.string().optional() })).optional().describe("Terminy użytkownika, np. na odwołanie"),
  },
  async ({ case_id, event_id, next_step, my_deadlines, ...rest }) => {
    const { added } = await mutate((db) =>
      ops.saveAnalysis(db, case_id, event_id, { ...(rest as Omit<ops.AnalysisInput, "nextStep" | "myDeadlines">), nextStep: next_step, myDeadlines: my_deadlines }),
    );
    return text(`Zapisano analizę.${added.length ? ` Nowe terminy: ${added.map((d) => `${d.label} – ${formatDate(d.due)}`).join("; ")}.` : ""}`);
  },
);

tool(
  "set_deadline",
  "Dodaje termin (bez deadline_id) albo zmienia istniejący: data, podstawa, spełnienie (done_at), nieaktualny (dropped).",
  {
    case_id: z.number().int(),
    deadline_id: z.string().optional(),
    party: z.enum(["coop", "me"]).optional().describe("coop = spółdzielnia, me = użytkownik (przy dodawaniu wymagane)"),
    type: z.enum(["reply", "task"]).optional().describe("reply = odpowiedź na pismo (spełnia ją następna odpowiedź spółdzielni)"),
    label: z.string().optional(),
    days: z.number().int().positive().optional(),
    from: date.optional().describe("Początek liczenia dla days (domyślnie data from_event_id albo dziś)"),
    from_event_id: z.string().optional(),
    due: date.optional(),
    basis: z.enum(["rules", "law", "letter", "manual"]).optional(),
    source: z.string().optional(),
    done_at: date.optional(),
    reopen: z.boolean().optional().describe("Cofnij spełnienie"),
    dropped: z.boolean().optional(),
  },
  async (a) => {
    const t = today();
    if (a.deadline_id) {
      const d = await mutate((db) =>
        ops.updateDeadline(db, a.case_id, a.deadline_id!, {
          label: a.label,
          due: a.due,
          basis: a.basis,
          source: a.source,
          doneAt: a.reopen ? null : a.done_at,
          dropped: a.dropped,
        }),
      );
      return text(`Zapisano termin ${d.id}: ${d.label} – ${formatDate(d.due)}.`);
    }
    if (!a.party || !a.label || !a.basis) throw new Error("Nowy termin wymaga party, label i basis.");
    const d = await mutate((db) =>
      ops.addDeadline(db, a.case_id, { party: a.party!, type: a.type, label: a.label!, days: a.days, due: a.due, from: a.from, fromEventId: a.from_event_id, basis: a.basis!, source: a.source }, t),
    );
    return text(`Dodano termin ${d.id}: ${d.label} – ${formatDate(d.due)}.`);
  },
);

tool(
  "save_draft",
  "Zapisuje projekt pisma (ponaglenie, odwołanie, wniosek) w sprawie – użytkownik zobaczy go w aplikacji i sam wyśle.",
  { case_id: z.number().int(), title: z.string(), body: z.string().describe("Pełna treść pisma, gotowa do wydruku") },
  async ({ case_id, title, body }) => {
    const d = await mutate((db) => ops.addDraft(db, case_id, title, body));
    return text(`Zapisano projekt „${d.title}” [${d.id}]. Gdy użytkownik go wyśle, dodaj zdarzenie add_event z datą doręczenia.`);
  },
);

tool(
  "import_rules",
  "Wczytuje statut / regulamin / ustawę: z pliku PDF/TXT z warstwą tekstową (path) albo z tekstu (text, np. po odczytaniu skanu read_scan). Dzieli na paragrafy.",
  {
    title: z.string(),
    kind: z.enum(["statute", "rules", "law", "other"]).describe(Object.entries(RULES_KIND_LABEL).map(([k, v]) => `${k} = ${v}`).join("; ")),
    path: z.string().optional(),
    text: z.string().optional(),
    valid_from: date.optional(),
    replaces: z.string().optional().describe("id starszej wersji tego dokumentu"),
  },
  async ({ title, kind, path: p, text: body, valid_from, replaces }) => {
    let file: FileRef | undefined;
    let content = body ?? "";
    if (p) {
      file = await storeFromPath(p);
      if (!content) {
        const data = await readStored(file);
        content = file.mime === "application/pdf" ? (await pdfText(data)).join("\n\n") : file.mime.startsWith("text/") ? new TextDecoder().decode(data) : "";
      }
      if (content.replace(/\s/g, "").length < 200) {
        await deleteStored(file);
        throw new Error("Plik nie ma warstwy tekstowej (to skan). Odczytaj go read_scan i wywołaj import_rules z parametrem text (oraz path, żeby zachować oryginał).");
      }
    }
    try {
      const doc = await mutate((db) => ops.addRules(db, { title, kind: kind as ops.RulesInput["kind"], text: content, validFrom: valid_from, file, replaces }));
      return text(`Wczytano „${doc.title}” [${doc.id}]: ${doc.sections.length} fragmentów (${doc.sections.slice(0, 6).map((s) => s.ref).join(", ")}…).\nSprawdź, jakie terminy daje spółdzielni, i zapisz je set_deadline_rule.`);
    } catch (err) {
      if (file) await deleteStored(file);
      throw err;
    }
  },
);

tool(
  "search_rules",
  "Szuka w statucie i regulaminach (słowa kluczowe albo numer paragrafu, np. \"§ 31\").",
  { query: z.string(), limit: z.number().int().optional(), include_old: z.boolean().optional().describe("Także wersje zastąpione") },
  async ({ query, limit, include_old }) => {
    const db = await readDb();
    if (!db.rules.length) return text("Brak wczytanych regulaminów. Poproś użytkownika o statut i regulaminy (import_rules).");
    const hits = searchRules(db.rules, query, limit ?? 8, include_old);
    if (!hits.length) return text("Nic nie znaleziono. Spróbuj innych słów (np. rdzenia: „termin”, „rozpatrz”, „odwoła”).");
    return text(hits.map((h) => `### ${h.docTitle} ${h.ref} [${h.docId}]\n${h.text}`).join("\n\n"));
  },
);

tool(
  "get_rules",
  "Lista dokumentów (bez doc_id) albo wybrane paragrafy dokumentu.",
  { doc_id: z.string().optional(), refs: z.array(z.string()).optional().describe('np. ["§ 4", "§ 31"]; bez – spis paragrafów') },
  async ({ doc_id, refs }) => {
    const db = await readDb();
    if (!doc_id)
      return text(
        db.rules.map((r) => `- [${r.id}] ${r.title} (${RULES_KIND_LABEL[r.kind]}${r.validFrom ? `, od ${r.validFrom}` : ""}${r.supersededBy ? `, zastąpiony przez ${r.supersededBy}` : ""}) – ${r.sections.length} fragmentów`).join("\n") ||
          "Brak dokumentów.",
      );
    const doc = db.rules.find((r) => r.id === doc_id);
    if (!doc) throw new Error("Nie ma takiego dokumentu.");
    if (!refs?.length) return text(`${doc.title}: ${doc.sections.map((s) => s.ref).join(", ")}`);
    const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
    const want = new Set(refs.map(norm));
    return text(doc.sections.filter((s) => want.has(norm(s.ref))).map((s) => `### ${s.ref}\n${s.text}`).join("\n\n") || "Brak takich paragrafów.");
  },
);

tool(
  "set_deadline_rule",
  "Zapisuje, ile dni spółdzielnia ma na odpowiedź w danej kategorii spraw (z regulaminu). Nowe pisma tej kategorii dostaną ten termin automatycznie. days=0 usuwa regułę.",
  { category, days: z.number().int().min(0), source: z.string().describe('Paragraf, np. "Statut § 12 ust. 3"') },
  async ({ category: cat, days, source }) => {
    await mutate((db) => ops.setDeadlineRule(db, cat as ops.CaseInput["category"], days || null, source));
    return text(days ? `Reguła: ${CATEGORY_LABEL[cat as ops.CaseInput["category"]]} – ${plDays(days)} (${source}).` : "Usunięto regułę.");
  },
);

await server.connect(new StdioServerTransport());
