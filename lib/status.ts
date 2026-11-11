/** What needs attention in a case: overdue answers, deadlines coming up, missing deadlines, unread replies. */
import { daysBetween } from "./dates";
import type { Case, Deadline } from "./types";

/** "Coming up" means within this many days. */
export const SOON_DAYS = 7;

export type Flag = "overdue" | "my-overdue" | "no-deadline" | "to-analyze" | "my-soon" | "soon";

export const FLAG_LABEL: Record<Flag, string> = {
  overdue: "po terminie",
  "my-overdue": "mój termin minął",
  "no-deadline": "bez terminu – ustaw",
  "to-analyze": "odpowiedź do analizy",
  "my-soon": "mój termin się zbliża",
  soon: "termin się zbliża",
};

export interface DeadlineState {
  deadline: Deadline;
  /** Days left (negative: days late). */
  left: number;
  state: "done" | "dropped" | "late" | "soon" | "open";
}

export function deadlineState(d: Deadline, today: string): DeadlineState {
  const left = daysBetween(today, d.due);
  if (d.dropped) return { deadline: d, left, state: "dropped" };
  if (d.doneAt) return { deadline: d, left: daysBetween(d.doneAt, d.due), state: "done" };
  if (left < 0) return { deadline: d, left, state: "late" };
  if (left <= SOON_DAYS) return { deadline: d, left, state: "soon" };
  return { deadline: d, left, state: "open" };
}

export interface CaseStatus {
  flags: Flag[];
  /** The open deadline that matters most: the most overdue, else the nearest. */
  next?: DeadlineState;
  open: DeadlineState[];
  /** Replies with a scan that Claude has not analysed yet. */
  toAnalyze: string[];
}

export function caseStatus(c: Case, today: string): CaseStatus {
  const open = c.stage === "closed"
    ? []
    : c.deadlines
        .map((d) => deadlineState(d, today))
        .filter((s) => s.state === "late" || s.state === "soon" || s.state === "open")
        .sort((a, b) => a.left - b.left);
  const flags: Flag[] = [];
  if (open.some((s) => s.state === "late" && s.deadline.party === "coop")) flags.push("overdue");
  if (open.some((s) => s.state === "late" && s.deadline.party === "me")) flags.push("my-overdue");
  if (
    (c.stage === "waiting" || c.stage === "escalated") &&
    !c.deadlines.some((d) => d.party === "coop" && d.type === "reply" && !d.doneAt && !d.dropped)
  )
    flags.push("no-deadline");
  const toAnalyze = c.stage === "closed" ? [] : c.events.filter((e) => e.kind === "response" && e.files.length && !e.analysis).map((e) => e.id);
  if (toAnalyze.length) flags.push("to-analyze");
  if (open.some((s) => s.state === "soon" && s.deadline.party === "me")) flags.push("my-soon");
  if (open.some((s) => s.state === "soon" && s.deadline.party === "coop")) flags.push("soon");
  return { flags, next: open[0], open, toAnalyze };
}

/** Order of the case list: what needs action first, closed cases last. */
export function caseRank(c: Case, s: CaseStatus): number {
  if (c.stage === "closed") return 9;
  const f = s.flags;
  if (f.includes("overdue") || f.includes("my-overdue")) return 0;
  if (f.includes("to-analyze") || f.includes("no-deadline")) return 1;
  if (f.includes("my-soon") || f.includes("soon")) return 2;
  if (c.stage === "draft") return 4;
  return 3;
}
