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
import { caseLine, caseText, personText } from "../lib/format";
import * as ops from "../lib/ops";
import { reportMarkdown } from "../lib/report";
import { searchRules } from "../lib/rules";
import { stats } from "../lib/stats";
import { mutate, readDb, dataDir } from "../lib/server/db";
import { deleteStored, mimeOf, readStored, storeFromPath } from "../lib/server/files";
import { parseMsg, msgText } from "../lib/server/msg";
import { imageForClaude, pdfPageImages, pdfText, type PageImage } from "../lib/server/pdf";
import { caseRank, caseStatus, promiseMoves } from "../lib/status";
import { CATEGORIES, CATEGORY_LABEL, EVENT_KINDS, ROLE_LABEL, RULES_KIND_LABEL, SIGNER_LABEL, type FileRef } from "../lib/types";

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
  Projekty pism zapisuj save_draft – użytkownik sam je wysyła. Gdy powie, że wysłał, zapisz to send_draft.
- Odpowiedź w terminie, ale niepełna (większość punktów bez odpowiedzi) albo sprawa bez ruchu i bez terminu:
  get_overview pokaże je osobno – zaproponuj ponaglenie o brakujące punkty albo zapytaj, czy zamknąć sprawę.
- E-maile Outlooka (.msg) read_document czyta same: nagłówki (od, do, DW, data wysłania), treść i załączniki.
  Datę zdarzenia sprawdzaj z nagłówka „Data”.
- Daty pisma: date to data złożenia / doręczenia (od niej liczy się termin) albo otrzymania odpowiedzi. Data na piśmie
  spółdzielni („pismo z 11.09”) to letter_date; data, którą spółdzielnia nadała pismu użytkownika („Pana pismo z 08.09”),
  to registered_date; datę niepewną oznacz date_approx. Nie zgaduj dat.
- Obietnice: gdy spółdzielnia znów przesuwa to samo („ankieta do końca roku” po „ankieta w sierpniu”), w save_analysis
  podaj commitments.replaces = id starego terminu – historia przesunięć to argument w skardze.
- Forma odpowiedzi (save_analysis formal): kto podpisał (organ: Zarząd / Rada Nadzorcza, czy administracja), czy jest
  uzasadnienie i pouczenie o odwołaniu. Tylko to, co widać na piśmie.
- Osoby: jeśli pisma wysyła pełnomocnik, a nie członek, zapisz osoby (save_person) i nadawcę pisma (sender_id).
  Gdy regulamin wymaga wniosku członka, zwróć na to uwagę.
- Jedno pismo w kilku sprawach: share_event (albo link_events dla dodanych dwa razy), link_cases dla spraw powiązanych.
- Skarga do Rady Nadzorczej / prawnik: export_case daje chronologię sprawy, get_stats – jak spółdzielnia odpowiada.
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

/** Dates and sender of a letter, for add_event / send_draft. */
const letterFields = {
  letter_date: date.optional().describe("Data na piśmie, gdy inna niż data zdarzenia (np. pismo z 11.09 otrzymane 17.09)"),
  registered_date: date.optional().describe("Pismo użytkownika: data, którą nadała mu spółdzielnia (rejestracja), gdy inna niż jego"),
  date_approx: z.boolean().optional().describe("Data niepewna, np. pisma brak, a datę znamy z odpowiedzi"),
  sender_id: z.string().optional().describe("Pismo użytkownika: kto je wysłał (id osoby z get_people)"),
};

function letterInput(a: { letter_date?: string; registered_date?: string; date_approx?: boolean; sender_id?: string }) {
  return { letterDate: a.letter_date, registeredDate: a.registered_date, dateApprox: a.date_approx, senderId: a.sender_id };
}

/** Deletes stored files that nothing uses any more (after a letter was linked or removed). */
async function dropFiles(files: FileRef[]) {
  for (const f of files) await deleteStored(f);
}

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
  group("✉ Projekty pism do wysłania", (s) => s.flags.includes("draft-unsent"));
  group("½ Niepełne odpowiedzi (nic dalej nie zaplanowano)", (s) => s.flags.includes("incomplete"));
  group("💤 Bez następnego kroku", (s) => s.flags.includes("stalled"));
  group("⏳ Terminy w ciągu 7 dni", (s) => s.flags.includes("soon") || s.flags.includes("my-soon"));
  const rest = rows.filter((r) => !r.s.flags.length);
  if (rest.length) lines.push("## Pozostałe", ...rest.map((r) => `- ${caseLine(r.c, t)}`), "");
  const st = stats(db, t).total;
  if (st.letters)
    lines.push(
      `Odpowiedzi spółdzielni: ${st.onTime}/${st.answered} w terminie${st.medianDays !== undefined ? `, mediana ${plDays(st.medianDays)}` : ""}${st.pendingLate ? `, ${st.pendingLate} pism bez odpowiedzi po terminie` : ""} (szczegóły: get_stats).`,
    );
  lines.push(
    `Osoby: ${db.people.map((p) => `${personText(db, p)} [${p.id}]`).join("; ") || "brak – gdy pisma wysyła pełnomocnik albo ktoś inny niż członek, dodaj osoby save_person"}.`,
  );
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
  return text(caseText(ops.getCase(db, case_id), today(), db));
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
    ...letterFields,
    files: z.array(z.string()).optional().describe("Pełne ścieżki plików na dysku użytkownika (skany, PDF, zdjęcia, e-maile .msg)"),
    reply_deadline: deadlineInput.optional(),
    no_deadline: z.boolean().optional().describe("true: pismo bez terminu odpowiedzi (nie używaj reguły kategorii)"),
  },
  async ({ case_id, files, reply_deadline, no_deadline, letter_date, registered_date, date_approx, sender_id, ...rest }) => {
    const refs = await storePaths(files);
    try {
      const { event, deadline } = await mutate((db) =>
        ops.addEvent(db, case_id, {
          ...(rest as Omit<ops.EventInput, "files" | "replyDeadline">),
          ...letterInput({ letter_date, registered_date, date_approx, sender_id }),
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
  "Poprawia zdarzenie (data, tytuł, opis, sposób, sygnatura, daty pisma, nadawca). Pismo połączone z innymi sprawami zmienia się we wszystkich. Pusty tekst (\"\") czyści pole.",
  {
    case_id: z.number().int(),
    event_id: z.string(),
    date: date.optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    method: z.enum(["in_person", "registered", "email", "epuap", "mailbox", "other"]).optional(),
    reference: z.string().optional(),
    letter_date: z.union([date, z.literal("")]).optional().describe("Data na piśmie, gdy inna niż data zdarzenia"),
    registered_date: z.union([date, z.literal("")]).optional().describe("Data, którą spółdzielnia nadała pismu użytkownika"),
    date_approx: z.boolean().optional(),
    sender_id: z.string().optional().describe("id osoby; \"\" usuwa nadawcę"),
  },
  async ({ case_id, event_id, letter_date, registered_date, date_approx, sender_id, ...patch }) => {
    const clear = (v: string | undefined) => (v === undefined ? undefined : v || null);
    const e = await mutate((db) =>
      ops.updateEvent(db, case_id, event_id, {
        ...(patch as ops.EventPatch),
        letterDate: clear(letter_date),
        registeredDate: clear(registered_date),
        dateApprox: date_approx,
        senderId: clear(sender_id),
      }),
    );
    return text(`Zapisano zdarzenie ${e.id}: ${e.date} ${e.title}.`);
  },
);

tool(
  "link_cases",
  "Oznacza dwie sprawy jako powiązane (dotyczą tego samego, odpowiedzi przychodzą w jednym piśmie) albo je rozłącza.",
  { case_id: z.number().int(), other_case_id: z.number().int(), unlink: z.boolean().optional() },
  async ({ case_id, other_case_id, unlink }) => {
    await mutate((db) => ops.linkCases(db, case_id, other_case_id, unlink));
    return text(unlink ? `Rozłączono #${case_id} i #${other_case_id}.` : `Powiązano #${case_id} i #${other_case_id}.`);
  },
);

tool(
  "share_event",
  "To samo pismo dotyczy też innej sprawy (np. jedna odpowiedź spółdzielni na dwie sprawy): dodaje je tam z tymi samymi plikami, połączone. Analizę zapisz osobno w każdej sprawie – pismo odpowiada w nich na inne punkty. W drugiej sprawie pismo zakłada lub spełnia terminy jak add_event.",
  {
    case_id: z.number().int(),
    event_id: z.string(),
    other_case_id: z.number().int(),
    reply_deadline: deadlineInput.optional().describe("Pismo użytkownika: termin odpowiedzi w drugiej sprawie (domyślnie reguła kategorii)"),
    no_deadline: z.boolean().optional(),
  },
  async ({ case_id, event_id, other_case_id, reply_deadline, no_deadline }) => {
    const { event, deadline } = await mutate((db) =>
      ops.shareEvent(db, case_id, event_id, other_case_id, no_deadline ? null : (reply_deadline as ops.DeadlineInput | undefined)),
    );
    const lines = [`Pismo dodane do sprawy #${other_case_id} jako zdarzenie ${event.id} (połączone z ${event_id}).`];
    if (deadline) lines.push(`Termin odpowiedzi w #${other_case_id}: ${formatDate(deadline.due)} [${deadline.id}].`);
    if (event.kind === "response" && event.files.length) lines.push(`Przeanalizuj je w kontekście #${other_case_id}: read_document(case_id=${other_case_id}, event_id="${event.id}").`);
    return text(lines.join("\n"));
  },
);

tool(
  "link_events",
  "Łączy dwa zdarzenia, które już są tym samym pismem w dwóch sprawach (dodane wcześniej dwa razy). Te same pliki (nazwa i rozmiar) zostają jednym plikiem; duplikaty są usuwane z dysku.",
  { case_id: z.number().int(), event_id: z.string(), other_case_id: z.number().int(), other_event_id: z.string() },
  async ({ case_id, event_id, other_case_id, other_event_id }) => {
    const gone = await mutate((db) => ops.linkEvents(db, case_id, event_id, other_case_id, other_event_id));
    await dropFiles(gone);
    return text(`Połączono ${event_id} (#${case_id}) i ${other_event_id} (#${other_case_id}).${gone.length ? ` Usunięte duplikaty plików: ${gone.map((f) => f.name).join(", ")}.` : ""}`);
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

/** Pictures in a mail smaller than this are logos in the signature, not photos of the problem. */
const MIN_INLINE_IMAGE = 20 * 1024;
/** A mail shows at most this many attachments as images (a PDF counts each page). */
const MAX_MAIL_IMAGES = 8;

/** An Outlook e-mail: headers and body as text, then its attachments (for `pages`: attachment numbers). */
async function mailContent(data: Uint8Array, pages?: number[]): Promise<Content[]> {
  const m = parseMsg(data);
  const out: Content[] = [{ type: "text", text: `E-mail (.msg):\n${msgText(m)}` }];
  const readable = m.attachments
    .map((a, i) => ({ a, n: i + 1, mime: a.mime && a.mime !== "application/octet-stream" ? a.mime : mimeOf(a.name) }))
    .filter((x) => x.a.data && (x.mime === "application/pdf" || x.mime.startsWith("image/") || x.mime.startsWith("text/")))
    .filter((x) => !(x.a.inline && x.a.data!.byteLength < MIN_INLINE_IMAGE));
  const want = pages?.length ? readable.filter((x) => pages.includes(x.n)) : readable;
  let shown = 0;
  const skipped: string[] = [];
  for (const x of want) {
    if (shown >= MAX_MAIL_IMAGES && !x.mime.startsWith("text/")) {
      skipped.push(`${x.n}. ${x.a.name}`);
      continue;
    }
    out.push({ type: "text", text: `## Załącznik ${x.n}: ${x.a.name}` });
    const r = await renderFile(x.a.data!, x.mime, x.mime === "application/pdf" ? [1, 2, 3].slice(0, Math.max(1, MAX_MAIL_IMAGES - shown)) : undefined);
    shown += r.images.length;
    out.push(...pageContent(r));
  }
  if (skipped.length) out.push({ type: "text", text: `Nie pokazano załączników: ${skipped.join(", ")} – odczytasz je z parametrem pages (numery załączników).` });
  return out;
}

async function fileContent(data: Uint8Array, mime: string, pages?: number[]): Promise<Content[]> {
  if (mime === "application/vnd.ms-outlook") return mailContent(data, pages);
  return pageContent(await renderFile(data, mime, pages));
}

tool(
  "read_document",
  "Zwraca skan / dokument ze zdarzenia (obrazy stron + warstwa tekstowa; e-mail .msg: nagłówki, treść i załączniki) razem z kontekstem sprawy, do analizy. Po analizie wywołaj save_analysis.",
  {
    case_id: z.number().int(),
    event_id: z.string(),
    file_id: z.string().optional().describe("Domyślnie wszystkie pliki zdarzenia"),
    pages: z.array(z.number().int()).optional().describe("Strony PDF (domyślnie pierwsze 10); dla e-maila .msg – numery załączników"),
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
        text: `# Kontekst sprawy\n${caseText(c, today(), db)}\n\n# Analizowany dokument: ${e.title} (${e.date}) [event ${e.id}]\n` +
          (e.kind === "response"
            ? "Sprawdź: na które punkty pism użytkownika odpowiada; czy powołane przepisy istnieją i mówią to samo (search_rules / get_rules); zobowiązania z datami (czy to przesunięcie wcześniejszej obietnicy – replaces); kto podpisał, czy jest uzasadnienie i pouczenie o odwołaniu (formal); datę na piśmie, gdy inna niż data otrzymania (update_event letter_date); następny krok. Zapisz save_analysis."
            : "Przeczytaj dokument i zapisz najważniejsze ustalenia save_analysis."),
      },
    ];
    for (const f of files) {
      content.push({ type: "text", text: `## Plik ${f.name} [${f.id}]` });
      content.push(...(await fileContent(await readStored(f), f.mime, pages)));
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
    return { content: [{ type: "text", text: `Plik ${abs}` }, ...(await fileContent(data, mimeOf(abs), pages))] };
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
    formal: z
      .object({
        signer: z.enum(["board", "admin", "council", "other"]).optional().describe(Object.entries(SIGNER_LABEL).map(([k, v]) => `${k} = ${v}`).join("; ")),
        signed_by: z.string().optional().describe("Podpis jak na piśmie, np. „Kierownik Administracji Osiedla”"),
        appeal_instruction: z.boolean().optional().describe("Czy jest pouczenie, gdzie i w jakim terminie się odwołać"),
        justification: z.boolean().optional().describe("Czy odmowa / stanowisko ma uzasadnienie"),
      })
      .optional()
      .describe("Forma odpowiedzi – tylko to, co widać na piśmie; pomiń, czego nie da się ustalić"),
    next_step: z.string().optional(),
    commitments: z
      .array(
        z.object({
          label: z.string(),
          due: date,
          source: z.string().optional(),
          replaces: z.string().optional().describe("id wcześniejszego terminu tej samej obietnicy – zostanie przesunięty, z historią"),
        }),
      )
      .optional()
      .describe("Co spółdzielnia obiecuje i do kiedy"),
    my_deadlines: z.array(z.object({ label: z.string(), due: date, source: z.string().optional() })).optional().describe("Terminy użytkownika, np. na odwołanie"),
  },
  async ({ case_id, event_id, next_step, my_deadlines, formal, ...rest }) => {
    const { added, moved } = await mutate((db) =>
      ops.saveAnalysis(db, case_id, event_id, {
        ...(rest as Omit<ops.AnalysisInput, "nextStep" | "myDeadlines" | "formal">),
        formal: formal && { signer: formal.signer, signedBy: formal.signed_by, appealInstruction: formal.appeal_instruction, justification: formal.justification },
        nextStep: next_step,
        myDeadlines: my_deadlines,
      }),
    );
    const parts = ["Zapisano analizę."];
    if (added.length) parts.push(`Nowe terminy: ${added.map((d) => `${d.label} – ${formatDate(d.due)}`).join("; ")}.`);
    if (moved.length) parts.push(`Przesunięte obietnice: ${moved.map((d) => `${d.label} – ${promiseMoves(d).dates.map(formatDate).join(" → ")}`).join("; ")}.`);
    return text(parts.join(" "));
  },
);

tool(
  "set_deadline",
  "Dodaje termin (bez deadline_id) albo zmienia istniejący: data, podstawa, spełnienie (done_at), nieaktualny (dropped). Gdy spółdzielnia PRZESUWA obietnicę, podaj nowe due z moved_on – stara data trafi do historii (zwykła zmiana due bez moved_on to poprawka). Wcześniejsze obietnice ze starych pism dopisz earlier.",
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
    moved_on: date.optional().describe("Data pisma / zdarzenia, w którym spółdzielnia przesunęła termin na nowe due"),
    earlier: z
      .array(z.object({ due: date.describe("Wcześniej obiecana data"), moved_on: date.describe("Kiedy ją zastąpiono"), source: z.string().optional() }))
      .optional()
      .describe("Wcześniejsze daty tej obietnicy, np. z pism sprzed lat"),
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
          movedOn: a.moved_on,
          earlier: a.earlier?.map((m) => ({ due: m.due, movedOn: m.moved_on, source: m.source })),
        }),
      );
      const pm = promiseMoves(d);
      return text(`Zapisano termin ${d.id}: ${d.label} – ${formatDate(d.due)}.${pm.moved ? ` Historia: ${pm.dates.map(formatDate).join(" → ")} (przesuwany ${pm.moved}×, ${pm.broken}× po upływie).` : ""}`);
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
    return text(`Zapisano projekt „${d.title}” [${d.id}]. Gdy użytkownik go wyśle, zapisz to send_draft z datą złożenia lub doręczenia.`);
  },
);

tool(
  "send_draft",
  "Użytkownik wysłał projekt pisma: dodaje je na oś czasu jako jego pismo (jak add_event, z terminem odpowiedzi) i oznacza projekt jako wysłany.",
  {
    case_id: z.number().int(),
    draft_id: z.string(),
    date: date.describe("Data złożenia lub doręczenia (od niej liczy się termin)"),
    kind: z.enum(["submitted", "reminder", "appeal", "letter"]).optional().describe("Domyślnie letter"),
    title: z.string().optional().describe("Domyślnie tytuł projektu"),
    description: z.string().optional().describe("Krótkie streszczenie (pełna treść zostaje w projekcie)"),
    method: z.enum(["in_person", "registered", "email", "epuap", "mailbox", "other"]).optional(),
    reference: z.string().optional(),
    ...letterFields,
    files: z.array(z.string()).optional().describe("Np. skan z pieczątką, potwierdzenie nadania, wysłany mail .msg"),
    reply_deadline: deadlineInput.optional(),
    no_deadline: z.boolean().optional(),
  },
  async ({ case_id, draft_id, files, reply_deadline, no_deadline, letter_date, registered_date, date_approx, sender_id, ...rest }) => {
    const refs = await storePaths(files);
    try {
      const { event, deadline } = await mutate((db) =>
        ops.sendDraft(db, case_id, draft_id, {
          ...(rest as Omit<ops.EventInput, "files" | "replyDeadline" | "kind">),
          ...letterInput({ letter_date, registered_date, date_approx, sender_id }),
          kind: rest.kind as ops.EventInput["kind"] | undefined,
          files: refs,
          replyDeadline: no_deadline ? null : (reply_deadline as ops.DeadlineInput | undefined),
        }),
      );
      const lines = [`Projekt wysłany: zdarzenie ${event.id} (${event.date}) w sprawie #${case_id}.`];
      if (deadline) lines.push(`Termin odpowiedzi: ${formatDate(deadline.due)} [${deadline.id}] (${deadline.source ?? deadline.basis}).`);
      else if (!no_deadline) lines.push("Brak terminu odpowiedzi: kategoria nie ma reguły z regulaminu. Sprawdź search_rules albo zapytaj użytkownika i ustaw set_deadline.");
      return text(lines.join("\n"));
    } catch (err) {
      for (const f of refs) await deleteStored(f);
      throw err;
    }
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

tool("get_people", "Osoby, które piszą do spółdzielni: członek, pełnomocnik (z zakresem pełnomocnictwa), inni.", {}, async () => {
  const db = await readDb();
  return text(db.people.map((p) => `- [${p.id}] ${personText(db, p)}${p.note ? ` – ${p.note}` : ""}`).join("\n") || "Brak osób.");
});

tool(
  "save_person",
  "Dodaje osobę (bez person_id) albo ją zmienia; delete=true usuwa. Pełnomocnik: role proxy, proxy_for = id członka, proxy_scope = zakres pełnomocnictwa jak w dokumencie.",
  {
    person_id: z.string().optional(),
    name: z.string().optional(),
    role: z.enum(["member", "proxy", "other"]).optional().describe(Object.entries(ROLE_LABEL).map(([k, v]) => `${k} = ${v}`).join("; ")),
    proxy_for: z.string().optional().describe("id członka, którego reprezentuje (\"\" czyści)"),
    proxy_scope: z.string().optional().describe("Zakres pełnomocnictwa, np. „czynności administracyjne dot. lokalu nr 3”"),
    note: z.string().optional(),
    delete: z.boolean().optional(),
  },
  async (a) => {
    if (a.delete) {
      if (!a.person_id) throw new Error("Podaj person_id.");
      const p = await mutate((db) => ops.deletePerson(db, a.person_id!));
      return text(`Usunięto ${p.name}.`);
    }
    const p = await mutate((db) =>
      ops.savePerson(db, {
        id: a.person_id,
        name: a.name,
        role: a.role,
        proxyFor: a.proxy_for === undefined ? undefined : a.proxy_for || null,
        proxyScope: a.proxy_scope,
        note: a.note,
      }),
    );
    const db = await readDb();
    return text(`Zapisano [${p.id}] ${personText(db, p)}. Nadawcę pisma ustawisz sender_id w add_event / update_event.`);
  },
);

tool("get_stats", "Jak spółdzielnia odpowiada: czas odpowiedzi, ile w terminie, po terminie, bez odpowiedzi, niepełne, z brakami formalnymi; według lat i osób prowadzących (inicjały z sygnatury); przesuwane obietnice.", {}, async () => {
  const db = await readDb();
  const s = stats(db, today());
  if (!s.records.length) return text("Brak pism z terminem odpowiedzi.");
  const line = (x: (typeof s)["total"]) =>
    `${x.answered}/${x.letters} odpowiedzi, ${x.onTime} w terminie, ${x.late} po terminie` +
    (x.pending ? `, ${x.pending} czeka (${x.pendingLate} po terminie)` : "") +
    (x.medianDays !== undefined ? `; mediana ${plDays(x.medianDays)}, średnio ${plDays(x.avgDays!)}` : "") +
    (x.maxLate ? `; najdłużej ${plDays(x.maxLate.days)} po terminie (#${x.maxLate.caseId}, pismo z ${formatDate(x.maxLate.letterDate)})` : "") +
    (x.incomplete ? `; niepełne: ${x.incomplete}` : "") +
    (x.formal ? `; z brakami formalnymi: ${x.formal}` : "");
  const lines = [`## Razem\n${line(s.total)}`, "", "## Według lat (data mojego pisma)", ...s.byYear.map((y) => `- ${y.year}: ${line(y.s)}`)];
  if (s.byHandler.length) lines.push("", "## Według sygnatury (inicjały prowadzącego)", ...s.byHandler.map((h) => `- ${h.handler}: ${line(h.s)}`));
  lines.push("", `## Obietnice spółdzielni\n${s.promises.count} zobowiązań, przesunięcia: ${s.promises.moved}, w tym po upływie terminu: ${s.promises.broken}.`);
  for (const p of s.promises.items) lines.push(`- #${p.caseId} ${p.label}: ${p.dates.map(formatDate).join(" → ")}`);
  lines.push("", "## Pisma", ...s.records.map((r) => `- #${r.caseId} ${formatDate(r.letter.date)} ${r.letter.title}: ${r.pending ? (r.late ? `BRAK odpowiedzi, ${plDays(r.late)} po terminie` : "czeka") : `odpowiedź po ${plDays(r.days!)}${r.late ? `, ${plDays(r.late)} po terminie` : ", w terminie"}${r.incomplete ? ", niepełna" : ""}${r.formal.length ? `, ${r.formal.join(", ")}` : ""}`}`));
  return text(lines.join("\n"));
});

tool(
  "export_case",
  "Zestawienie sprawy do skargi (np. do Rady Nadzorczej) albo dla prawnika: chronologia pism z sygnaturami, terminy i jak się skończyły, przesuwane obietnice, punkty bez odpowiedzi, braki formalne. Markdown; wersja do druku: http://127.0.0.1:3200/api/export/<case_id>.",
  { case_id: z.number().int() },
  async ({ case_id }) => {
    const db = await readDb();
    return text(reportMarkdown(ops.getCase(db, case_id), db, today()));
  },
);

await server.connect(new StdioServerTransport());
