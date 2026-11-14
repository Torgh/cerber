/** What needs attention in a case: overdue answers, deadlines coming up, missing deadlines, unread replies. */
import { daysBetween } from "./dates";
import type { Analysis, Case, Deadline, Draft } from "./types";

/** "Coming up" means within this many days. */
export const SOON_DAYS = 7;

/** A case that got its answer and has had no event and no deadline for this long has stalled. */
export const STALL_DAYS = 14;

/** A reply that settles less than this share of my points is incomplete (yes = 1, partly = ½). */
export const COMPLETE_SHARE = 0.5;

export type Flag =
  | "overdue"
  | "my-overdue"
  | "no-deadline"
  | "to-analyze"
  | "draft-unsent"
  | "incomplete"
  | "stalled"
  | "my-soon"
  | "soon";

export const FLAG_LABEL: Record<Flag, string> = {
  overdue: "po terminie",
  "my-overdue": "mój termin minął",
  "no-deadline": "bez terminu – ustaw",
  "to-analyze": "odpowiedź do analizy",
  "draft-unsent": "projekt pisma do wysłania",
  incomplete: "niepełna odpowiedź",
  stalled: "brak następnego kroku",
  "my-soon": "mój termin się zbliża",
  soon: "termin się zbliża",
};

/** Flags that put a case under "Wymaga działania". */
export const ACTION_FLAGS: Flag[] = ["overdue", "my-overdue", "to-analyze", "no-deadline", "draft-unsent", "incomplete", "stalled"];

/** How much of my letter the reply settles, from its analysis. Undefined without points. */
export function answeredShare(a?: Analysis): { share: number; answered: number; total: number; missing: string[] } | undefined {
  const points = a?.points;
  if (!points?.length) return undefined;
  const score = points.reduce((s, p) => s + (p.answered === "yes" ? 1 : p.answered === "partly" ? 0.5 : 0), 0);
  return {
    share: score / points.length,
    answered: points.filter((p) => p.answered === "yes").length,
    total: points.length,
    missing: points.filter((p) => p.answered === "no").map((p) => p.point),
  };
}

export function isIncomplete(a?: Analysis): boolean {
  const s = answeredShare(a);
  return !!s && s.share < COMPLETE_SHARE;
}

export interface DeadlineState {
  deadline: Deadline;
  /** Days left (negative: days late). */
  left: number;
  state: "done" | "dropped" | "late" | "soon" | "open";
  /** Met only formally: the reply that met it leaves most of my letter unanswered. */
  incomplete?: boolean;
}

/** Pass the case to find out whether the reply that met a deadline was incomplete. */
export function deadlineState(d: Deadline, today: string, c?: Case): DeadlineState {
  const left = daysBetween(today, d.due);
  if (d.dropped) return { deadline: d, left, state: "dropped" };
  if (d.doneAt) {
    const by = d.doneEventId ? c?.events.find((e) => e.id === d.doneEventId) : undefined;
    const s: DeadlineState = { deadline: d, left: daysBetween(d.doneAt, d.due), state: "done" };
    if (d.type === "reply" && isIncomplete(by?.analysis)) s.incomplete = true;
    return s;
  }
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
  /** Drafts not marked as sent. */
  unsent: Draft[];
  /** Days since the last event, when the case has stalled. */
  idleDays?: number;
}

export function caseStatus(c: Case, today: string): CaseStatus {
  const closed = c.stage === "closed";
  const open = closed
    ? []
    : c.deadlines
        .map((d) => deadlineState(d, today, c))
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
  const toAnalyze = closed ? [] : c.events.filter((e) => e.kind === "response" && e.files.length && !e.analysis).map((e) => e.id);
  if (toAnalyze.length) flags.push("to-analyze");
  const unsent = closed ? [] : c.drafts.filter((d) => !d.sentAt);
  if (unsent.length) flags.push("draft-unsent");

  // Answered, nothing to wait for: either the reply dodged my points, or the case just sits there.
  let idleDays: number | undefined;
  if (c.stage === "answered" && !open.length && !unsent.length && !toAnalyze.length) {
    const lastReply = [...c.events].reverse().find((e) => e.kind === "response");
    const last = c.events[c.events.length - 1];
    if (lastReply && isIncomplete(lastReply.analysis)) flags.push("incomplete");
    else if (last && daysBetween(last.date, today) >= STALL_DAYS) {
      idleDays = daysBetween(last.date, today);
      flags.push("stalled");
    }
  }
  if (open.some((s) => s.state === "soon" && s.deadline.party === "me")) flags.push("my-soon");
  if (open.some((s) => s.state === "soon" && s.deadline.party === "coop")) flags.push("soon");
  return { flags, next: open[0], open, toAnalyze, unsent, idleDays };
}

/** Order of the case list: what needs action first, closed cases last. */
export function caseRank(c: Case, s: CaseStatus): number {
  if (c.stage === "closed") return 9;
  const f = s.flags;
  if (f.includes("overdue") || f.includes("my-overdue")) return 0;
  if (f.includes("to-analyze") || f.includes("no-deadline")) return 1;
  if (f.includes("draft-unsent") || f.includes("incomplete") || f.includes("stalled")) return 2;
  if (f.includes("my-soon") || f.includes("soon")) return 3;
  if (c.stage === "draft") return 5;
  return 4;
}
