/** Cases as Markdown text, for the MCP server. */
import { daysBetween, formatDate, plDays } from "./dates";
import { answeredShare, caseStatus, deadlineState, FLAG_LABEL, formalIssues, promiseMoves, type DeadlineState } from "./status";
import {
  BASIS_LABEL,
  CATEGORY_LABEL,
  EVENT_ICON,
  EVENT_LABEL,
  METHOD_LABEL,
  OUTCOME_LABEL,
  ROLE_LABEL,
  SIGNER_LABEL,
  STAGE_LABEL,
  type Case,
  type CaseEvent,
  type Db,
  type Deadline,
  type Person,
} from "./types";

export function deadlineText(s: DeadlineState): string {
  const d = s.deadline;
  const who = d.party === "coop" ? "spółdzielnia" : "ja";
  const when =
    s.state === "done"
      ? daysBetween(d.due, d.doneAt!) > 0
        ? `spełniony ${formatDate(d.doneAt!)} – ${plDays(daysBetween(d.due, d.doneAt!))} PO TERMINIE${s.datedInTime ? ` (doręczenie; pismo datowane ${formatDate(s.datedInTime)}, w terminie)` : ""}`
        : s.incomplete
          ? `½ odpowiedź ${formatDate(d.doneAt!)} w terminie, ale NIEPEŁNA (większość punktów bez odpowiedzi)`
          : `✓ spełniony ${formatDate(d.doneAt!)}`
      : s.state === "dropped"
        ? "– nieaktualny"
        : s.state === "late"
          ? `⚠ PO TERMINIE od ${plDays(-s.left)}`
          : s.left === 0
            ? "mija DZIŚ"
            : `zostało ${plDays(s.left)}`;
  const src = [BASIS_LABEL[d.basis], d.source].filter(Boolean).join(": ");
  const pm = promiseMoves(d);
  const moves = pm.moved
    ? ` Przesuwany ${pm.moved}×${pm.broken ? ` (${pm.broken}× dopiero po upływie terminu)` : ""}: ${pm.dates.map(formatDate).join(" → ")}.`
    : "";
  return `[${d.id}] ${d.label} (${who}) – do ${formatDate(d.due)}, ${when}. Podstawa: ${src}.${moves}`;
}

/** "Jan Kowalski (pełnomocnik Anny Kowalskiej: sprawy lokalu)". */
export function personText(db: Pick<Db, "people">, p: Person): string {
  const of = p.proxyFor ? db.people.find((x) => x.id === p.proxyFor) : undefined;
  const role = p.role === "proxy" ? `pełnomocnik${of ? ` – ${of.name}` : ""}${p.proxyScope ? `, zakres: ${p.proxyScope}` : ""}` : ROLE_LABEL[p.role];
  return `${p.name} (${role})`;
}

/** The dates of a letter beyond `date`: when it was written, how the cooperative dates it, uncertainty. */
export function eventDates(e: CaseEvent): string[] {
  const out: string[] = [];
  if (e.letterDate) out.push(`pismo z ${formatDate(e.letterDate)}`);
  if (e.registeredDate) out.push(`spółdzielnia datuje je na ${formatDate(e.registeredDate)}`);
  if (e.dateApprox) out.push("data przybliżona");
  return out;
}

export function caseLine(c: Case, today: string): string {
  const st = caseStatus(c, today);
  const flags = st.flags.map((f) => FLAG_LABEL[f]).join(", ");
  const next = st.next ? ` · ${st.next.deadline.label}: ${formatDate(st.next.deadline.due)} (${st.next.left < 0 ? `${plDays(-st.next.left)} po terminie` : st.next.left === 0 ? "mija dziś" : `zostało ${plDays(st.next.left)}`})` : "";
  const outcome = c.stage === "closed" && c.outcome ? ` – ${OUTCOME_LABEL[c.outcome]}` : "";
  return `#${c.id} ${c.title} [${STAGE_LABEL[c.stage]}${outcome}] ${CATEGORY_LABEL[c.category]}${next}${flags ? ` ⚑ ${flags}` : ""}`;
}

/** Pass the database to name senders and related cases. */
export function caseText(c: Case, today: string, db?: Db): string {
  const st = caseStatus(c, today);
  const lines = [caseLine(c, today)];
  if (c.description) lines.push("", c.description);
  if (c.related?.length) {
    const rel = c.related.map((id) => {
      const o = db?.cases.find((x) => x.id === id);
      return o ? `#${o.id} ${o.title}` : `#${id}`;
    });
    lines.push("", `Powiązane sprawy: ${rel.join("; ")}`);
  }
  lines.push("", "## Oś czasu");
  if (!c.events.length) lines.push("(brak zdarzeń)");
  for (const e of c.events) {
    const sender = e.senderId ? db?.people.find((p) => p.id === e.senderId) : undefined;
    const meta = [e.method && METHOD_LABEL[e.method], e.reference && `sygn. ${e.reference}`, ...eventDates(e), sender && `nadawca: ${personText(db!, sender)}`]
      .filter(Boolean)
      .join(", ");
    lines.push(`- ${e.date} ${EVENT_ICON[e.kind]} ${EVENT_LABEL[e.kind]}: ${e.title}${meta ? ` (${meta})` : ""} [event ${e.id}]`);
    if (e.linkId && db) {
      const also = db.cases.filter((o) => o.id !== c.id && o.events.some((x) => x.linkId === e.linkId)).map((o) => `#${o.id}`);
      if (also.length) lines.push(`  🔗 To samo pismo także w: ${also.join(", ")}`);
    }
    if (e.description) lines.push(`  ${e.description.replace(/\n/g, "\n  ")}`);
    if (e.draftId) lines.push(`  📝 Treść: projekt [${e.draftId}]`);
    for (const f of e.files) lines.push(`  📎 ${f.name} [file ${f.id}]${f.pages ? `, ${f.pages} str.` : ""}`);
    if (e.analysis) {
      lines.push(`  🤖 Analiza: ${e.analysis.summary}`);
      for (const p of e.analysis.points ?? []) lines.push(`    - ${p.answered === "yes" ? "✓" : p.answered === "partly" ? "½" : "✗"} ${p.point}${p.note ? ` – ${p.note}` : ""}`);
      for (const i of e.analysis.issues ?? []) lines.push(`    - ⚠ ${i.text}${i.source ? ` (${i.source})` : ""}`);
      const f = e.analysis.formal;
      if (f) {
        const parts = [
          f.signer && `podpis: ${f.signedBy ?? SIGNER_LABEL[f.signer]} (${SIGNER_LABEL[f.signer]})`,
          f.appealInstruction !== undefined && (f.appealInstruction ? "z pouczeniem o odwołaniu" : "BEZ pouczenia o odwołaniu"),
          f.justification !== undefined && (f.justification ? "z uzasadnieniem" : "BEZ uzasadnienia"),
        ].filter(Boolean);
        if (parts.length) lines.push(`    - Forma: ${parts.join(" · ")}`);
      }
      if (e.analysis.nextStep) lines.push(`    → ${e.analysis.nextStep}`);
    }
  }
  lines.push("", "## Terminy");
  if (!c.deadlines.length) lines.push("(brak)");
  for (const d of [...c.deadlines].sort((a, b) => a.due.localeCompare(b.due))) lines.push(`- ${deadlineText(deadlineState(d, today, c))}`);
  if (st.flags.includes("no-deadline"))
    lines.push("", "⚑ Sprawa czeka na odpowiedź, ale nie ma terminu. Ustal go z regulaminu (search_rules) albo zapytaj użytkownika – nie zakładaj domyślnego.");
  if (st.toAnalyze.length) lines.push("", `⚑ Odpowiedzi do analizy (read_document): ${st.toAnalyze.join(", ")}`);
  if (st.flags.includes("draft-unsent"))
    lines.push("", "⚑ Projekt pisma czeka na wysłanie. Gdy użytkownik go wyśle, zapisz to send_draft (data złożenia / doręczenia) – powstanie pismo i termin odpowiedzi.");
  if (st.flags.includes("incomplete")) {
    const reply = [...c.events].reverse().find((e) => e.kind === "response");
    const sh = answeredShare(reply?.analysis)!;
    lines.push(
      "",
      `⚑ Ostatnia odpowiedź (${reply!.date}) jest niepełna: załatwia ${sh.answered} z ${sh.total} punktów${sh.missing.length ? `, bez odpowiedzi: ${sh.missing.join("; ")}` : ""}. ` +
        "Zaproponuj ponaglenie o brakujące punkty (save_draft) albo, jeśli użytkownik uzna sprawę za załatwioną, zamknięcie.",
    );
  }
  if (st.flags.includes("stalled"))
    lines.push("", `⚑ Od ${plDays(st.idleDays!)} nic się nie dzieje, a sprawa nie ma terminu. Zapytaj użytkownika: zamknąć ją, czy ustalić następny krok (pismo, termin własny)?`);
  const formal = c.events.filter((e) => e.kind === "response" && formalIssues(e.analysis).length);
  if (formal.length)
    lines.push("", `⚑ Braki formalne odpowiedzi: ${formal.map((e) => `${e.date}${e.reference ? ` (${e.reference})` : ""}: ${formalIssues(e.analysis).join(", ")}`).join("; ")}.`);
  if (c.drafts.length) {
    lines.push("", "## Projekty pism");
    for (const d of c.drafts) lines.push(`- [${d.id}] ${d.title} (${d.at.slice(0, 10)})${d.sentAt ? ` – wysłany ${d.sentAt} [event ${d.sentEventId}]` : " – NIEWYSŁANY"}`);
  }
  return lines.join("\n");
}

export type { Deadline };
