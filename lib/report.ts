/**
 * The chronology of one case, for a complaint to the Supervisory Board or a lawyer: every letter with
 * its dates and reference, every deadline with how it ended, moved promises, unanswered points and
 * formal shortcomings. As Markdown (for Claude, to quote in a letter) and as a printable HTML page.
 */
import { daysBetween, formatDate, plDays } from "./dates";
import { eventDates, personText } from "./format";
import { deadlineState, formalIssues, promiseMoves } from "./status";
import { CATEGORY_LABEL, EVENT_LABEL, METHOD_LABEL, OUTCOME_LABEL, OUTGOING_KINDS, STAGE_LABEL, type Case, type Db } from "./types";

type Block = { h: string } | { p: string } | { list: string[] } | { table: { head: string[]; rows: string[][] } };

function blocks(c: Case, db: Db, today: string): Block[] {
  const out: Block[] = [];
  const outcome = c.stage === "closed" && c.outcome ? ` – ${OUTCOME_LABEL[c.outcome]}` : "";
  out.push({ p: `${CATEGORY_LABEL[c.category]} · ${STAGE_LABEL[c.stage]}${outcome} · stan na ${formatDate(today)}` });
  if (c.description) out.push({ p: c.description });
  if (c.related?.length) {
    const rel = c.related.map((id) => db.cases.find((x) => x.id === id)).filter(Boolean).map((o) => `#${o!.id} ${o!.title}`);
    if (rel.length) out.push({ p: `Powiązane sprawy: ${rel.join("; ")}` });
  }

  out.push({ h: "Chronologia" });
  out.push({
    table: {
      head: ["Data", "Strona", "Pismo / zdarzenie", "Sygnatura", "Uwagi"],
      rows: c.events.map((e) => {
        const sender = e.senderId ? db.people.find((p) => p.id === e.senderId) : undefined;
        const who = e.kind === "response" ? "spółdzielnia" : OUTGOING_KINDS.includes(e.kind) ? (sender ? personText(db, sender) : "ja") : "";
        const notes = [EVENT_LABEL[e.kind], e.method && METHOD_LABEL[e.method], ...eventDates(e), e.files.length ? `załączniki: ${e.files.length}` : ""].filter(Boolean);
        return [formatDate(e.date), who, e.title, e.reference ?? "", notes.join(", ")];
      }),
    },
  });

  const replies = c.deadlines.filter((d) => d.party === "coop" && d.type === "reply");
  if (replies.length) {
    out.push({ h: "Terminy odpowiedzi" });
    out.push({
      table: {
        head: ["Moje pismo", "Termin", "Podstawa", "Odpowiedź", "Wynik"],
        rows: replies.map((d) => {
          const s = deadlineState(d, today, c);
          const letter = c.events.find((e) => e.id === d.fromEventId);
          const reply = d.doneEventId ? c.events.find((e) => e.id === d.doneEventId) : undefined;
          const result =
            s.state === "dropped"
              ? "nieaktualny"
              : d.doneAt
                ? [
                    daysBetween(d.due, d.doneAt) > 0 ? `${plDays(daysBetween(d.due, d.doneAt))} po terminie` : "w terminie",
                    s.datedInTime && `pismo datowane ${formatDate(s.datedInTime)}`,
                    s.incomplete && "odpowiedź niepełna",
                  ]
                    .filter(Boolean)
                    .join("; ")
                : s.state === "late"
                  ? `BRAK ODPOWIEDZI – ${plDays(-s.left)} po terminie`
                  : `czeka, zostało ${plDays(s.left)}`;
          return [
            letter ? `${formatDate(letter.date)} ${letter.title}` : d.label,
            formatDate(d.due),
            d.source ?? "",
            reply ? `${formatDate(reply.date)}${reply.reference ? ` (${reply.reference})` : ""}` : "—",
            result,
          ];
        }),
      },
    });
  }

  const tasks = c.deadlines.filter((d) => d.type === "task");
  if (tasks.length) {
    out.push({ h: "Zobowiązania i terminy" });
    out.push({
      list: tasks.map((d) => {
        const s = deadlineState(d, today, c);
        const pm = promiseMoves(d);
        const state = s.state === "done" ? `spełnione ${formatDate(d.doneAt!)}` : s.state === "dropped" ? "nieaktualne" : s.state === "late" ? `NIESPEŁNIONE – ${plDays(-s.left)} po terminie` : `do ${formatDate(d.due)}`;
        const who = d.party === "coop" ? "Spółdzielnia" : "Ja";
        const moves = pm.moved ? ` Termin przesuwany ${pm.moved}×${pm.broken ? `, ${pm.broken}× dopiero po jego upływie` : ""}: ${pm.dates.map(formatDate).join(" → ")}.` : "";
        return `${who}: ${d.label} – ${state}${d.source ? ` (${d.source})` : ""}.${moves}`;
      }),
    });
  }

  const unanswered = c.events.flatMap((e) =>
    (e.analysis?.points ?? []).filter((p) => p.answered !== "yes").map((p) => `${formatDate(e.date)}${e.reference ? ` (${e.reference})` : ""}: ${p.answered === "no" ? "bez odpowiedzi" : "częściowo"} – ${p.point}${p.note ? ` (${p.note})` : ""}`),
  );
  if (unanswered.length) out.push({ h: "Punkty bez pełnej odpowiedzi" }, { list: unanswered });

  const formal = c.events.filter((e) => formalIssues(e.analysis).length).map((e) => `${formatDate(e.date)}${e.reference ? ` (${e.reference})` : ""}: ${formalIssues(e.analysis).join(", ")}`);
  if (formal.length) out.push({ h: "Braki formalne odpowiedzi" }, { list: formal });

  const issues = c.events.flatMap((e) => (e.analysis?.issues ?? []).map((i) => `${formatDate(e.date)}: ${i.text}${i.source ? ` (${i.source})` : ""}`));
  if (issues.length) out.push({ h: "Zastrzeżenia" }, { list: issues });

  out.push({ p: "Zestawienie przygotowane w Cerberze na podstawie zapisanych pism. Daty odpowiedzi to daty otrzymania, chyba że podano datę pisma." });
  return out;
}

export function reportTitle(c: Case): string {
  return `Sprawa #${c.id}: ${c.title}`;
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n+/g, " ");

export function reportMarkdown(c: Case, db: Db, today: string): string {
  const lines = [`# ${reportTitle(c)}`, ""];
  for (const b of blocks(c, db, today)) {
    if ("h" in b) lines.push(`## ${b.h}`, "");
    else if ("p" in b) lines.push(b.p, "");
    else if ("list" in b) lines.push(...b.list.map((x) => `- ${x}`), "");
    else lines.push(`| ${b.table.head.join(" | ")} |`, `|${b.table.head.map(() => "---").join("|")}|`, ...b.table.rows.map((r) => `| ${r.map(cell).join(" | ")} |`), "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

/** A standalone page to print or save as PDF. All text is escaped. */
export function reportHtml(c: Case, db: Db, today: string): string {
  const body = blocks(c, db, today)
    .map((b) => {
      if ("h" in b) return `<h2>${escapeHtml(b.h)}</h2>`;
      if ("p" in b) return `<p>${escapeHtml(b.p).replace(/\n/g, "<br>")}</p>`;
      if ("list" in b) return `<ul>${b.list.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`;
      return `<table><thead><tr>${b.table.head.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${b.table.rows
        .map((r) => `<tr>${r.map((x) => `<td>${escapeHtml(x)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(reportTitle(c))}</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; color: #1b1b1b; background: #fff; max-width: 980px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 24px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; }
  .no-print { margin: 16px 0; }
  @media print { .no-print { display: none; } body { margin: 0; } }
</style>
</head>
<body>
<p class="no-print">Ctrl+P – wydrukuj albo zapisz jako PDF.</p>
<h1>${escapeHtml(reportTitle(c))}</h1>
${body}
</body>
</html>
`;
}
