/** Cases as Markdown text, for the MCP server. */
import { daysBetween, formatDate, plDays } from "./dates";
import { caseStatus, deadlineState, FLAG_LABEL, type DeadlineState } from "./status";
import {
  BASIS_LABEL,
  CATEGORY_LABEL,
  EVENT_ICON,
  EVENT_LABEL,
  METHOD_LABEL,
  OUTCOME_LABEL,
  STAGE_LABEL,
  type Case,
  type Deadline,
} from "./types";

export function deadlineText(s: DeadlineState): string {
  const d = s.deadline;
  const who = d.party === "coop" ? "spółdzielnia" : "ja";
  const when =
    s.state === "done"
      ? daysBetween(d.due, d.doneAt!) > 0
        ? `spełniony ${formatDate(d.doneAt!)} – ${plDays(daysBetween(d.due, d.doneAt!))} PO TERMINIE`
        : `✓ spełniony ${formatDate(d.doneAt!)}`
      : s.state === "dropped"
        ? "– nieaktualny"
        : s.state === "late"
          ? `⚠ PO TERMINIE od ${plDays(-s.left)}`
          : s.left === 0
            ? "mija DZIŚ"
            : `zostało ${plDays(s.left)}`;
  const src = [BASIS_LABEL[d.basis], d.source].filter(Boolean).join(": ");
  return `[${d.id}] ${d.label} (${who}) – do ${formatDate(d.due)}, ${when}. Podstawa: ${src}`;
}

export function caseLine(c: Case, today: string): string {
  const st = caseStatus(c, today);
  const flags = st.flags.map((f) => FLAG_LABEL[f]).join(", ");
  const next = st.next ? ` · ${st.next.deadline.label}: ${formatDate(st.next.deadline.due)} (${st.next.left < 0 ? `${plDays(-st.next.left)} po terminie` : st.next.left === 0 ? "mija dziś" : `zostało ${plDays(st.next.left)}`})` : "";
  const outcome = c.stage === "closed" && c.outcome ? ` – ${OUTCOME_LABEL[c.outcome]}` : "";
  return `#${c.id} ${c.title} [${STAGE_LABEL[c.stage]}${outcome}] ${CATEGORY_LABEL[c.category]}${next}${flags ? ` ⚑ ${flags}` : ""}`;
}

export function caseText(c: Case, today: string): string {
  const st = caseStatus(c, today);
  const lines = [caseLine(c, today)];
  if (c.description) lines.push("", c.description);
  lines.push("", "## Oś czasu");
  if (!c.events.length) lines.push("(brak zdarzeń)");
  for (const e of c.events) {
    const meta = [e.method && METHOD_LABEL[e.method], e.reference && `sygn. ${e.reference}`].filter(Boolean).join(", ");
    lines.push(`- ${e.date} ${EVENT_ICON[e.kind]} ${EVENT_LABEL[e.kind]}: ${e.title}${meta ? ` (${meta})` : ""} [event ${e.id}]`);
    if (e.description) lines.push(`  ${e.description.replace(/\n/g, "\n  ")}`);
    for (const f of e.files) lines.push(`  📎 ${f.name} [file ${f.id}]${f.pages ? `, ${f.pages} str.` : ""}`);
    if (e.analysis) {
      lines.push(`  🤖 Analiza: ${e.analysis.summary}`);
      for (const p of e.analysis.points ?? []) lines.push(`    - ${p.answered === "yes" ? "✓" : p.answered === "partly" ? "½" : "✗"} ${p.point}${p.note ? ` – ${p.note}` : ""}`);
      for (const i of e.analysis.issues ?? []) lines.push(`    - ⚠ ${i.text}${i.source ? ` (${i.source})` : ""}`);
      if (e.analysis.nextStep) lines.push(`    → ${e.analysis.nextStep}`);
    }
  }
  lines.push("", "## Terminy");
  if (!c.deadlines.length) lines.push("(brak)");
  for (const d of [...c.deadlines].sort((a, b) => a.due.localeCompare(b.due))) lines.push(`- ${deadlineText(deadlineState(d, today))}`);
  if (st.flags.includes("no-deadline"))
    lines.push("", "⚑ Sprawa czeka na odpowiedź, ale nie ma terminu. Ustal go z regulaminu (search_rules) albo zapytaj użytkownika – nie zakładaj domyślnego.");
  if (st.toAnalyze.length) lines.push("", `⚑ Odpowiedzi do analizy (read_document): ${st.toAnalyze.join(", ")}`);
  if (c.drafts.length) {
    lines.push("", "## Projekty pism");
    for (const d of c.drafts) lines.push(`- [${d.id}] ${d.title} (${d.at.slice(0, 10)})`);
  }
  return lines.join("\n");
}

export type { Deadline };
