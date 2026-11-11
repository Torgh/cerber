/** The one number each case shows: days late, days left, or what is missing instead. */
import { daysBetween, formatDate, plDays } from "@/lib/dates";
import type { CaseStatus, DeadlineState } from "@/lib/status";
import { OUTCOME_LABEL, type Case, type Deadline } from "@/lib/types";

export type Tone = "late" | "soon" | "info" | "ok" | "muted";

export interface Countdown {
  num: string;
  what: string;
  tone: Tone;
  /** Share of the deadline already used, 0–1 (for the bar under the title); undefined: no bar. */
  used?: number;
  barTone?: Tone;
}

/** When a deadline's clock started: the event it counts from, else the case's creation. */
export function deadlineStart(c: Case, d: Deadline): string {
  return c.events.find((e) => e.id === d.fromEventId)?.date ?? c.createdAt.slice(0, 10);
}

function used(c: Case, s: DeadlineState, today: string): number {
  const start = deadlineStart(c, s.deadline);
  const total = Math.max(1, daysBetween(start, s.deadline.due));
  return Math.min(1, Math.max(0, daysBetween(start, today) / total));
}

export function countdownOf(c: Case, st: CaseStatus, today: string): Countdown {
  if (c.stage === "closed") return { num: "✓", what: c.outcome ? OUTCOME_LABEL[c.outcome] : "zamknięta", tone: "ok" };
  const n = st.next;
  if (n?.state === "late")
    return { num: `+${-n.left}`, what: n.deadline.party === "me" ? "mój termin minął" : "dni po terminie", tone: "late", used: 1, barTone: "late" };
  if (st.flags.includes("to-analyze")) return { num: "skan", what: "do analizy", tone: "info" };
  if (st.flags.includes("no-deadline")) return { num: "?", what: "ustaw termin", tone: "soon" };
  if (n) {
    const mine = n.deadline.party === "me";
    return {
      num: n.left === 0 ? "0" : String(n.left),
      what: n.left === 0 ? "termin dziś" : mine ? "mój termin" : "dni zostało",
      tone: n.state === "soon" ? "soon" : "muted",
      used: used(c, n, today),
      barTone: n.state === "soon" ? "soon" : "info",
    };
  }
  if (c.stage === "draft") return { num: "—", what: "szkic", tone: "muted" };
  return { num: "—", what: "bez terminów", tone: "muted" };
}

/** "do 16 paź · 14 dni od 02 paź" */
export function deadlineLine(c: Case, d: Deadline): string {
  return `${formatDate(deadlineStart(c, d))} → ${formatDate(d.due)} (${plDays(daysBetween(deadlineStart(c, d), d.due))})`;
}
