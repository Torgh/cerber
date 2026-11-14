/** How the cooperative answers: response times, lateness, incomplete and formally flawed replies, moved promises. */
import { daysBetween } from "./dates";
import { formalIssues, isIncomplete, promiseMoves } from "./status";
import type { Case, CaseEvent, Db } from "./types";

/** One of my letters the cooperative had to answer. */
export interface ReplyRecord {
  caseId: number;
  caseTitle: string;
  letter: CaseEvent;
  due: string;
  reply?: CaseEvent;
  /** From my letter to the reply (received). */
  days?: number;
  /** Days after the deadline: of the reply, or – still unanswered – until today. */
  late: number;
  pending: boolean;
  incomplete: boolean;
  formal: string[];
  /** Initials at the end of the reply's reference ("OS-4653/AG" → "AG"): who handled it. */
  handler?: string;
}

const HANDLER = /\/\s*([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{1,4})\s*$/;

export function handlerOf(reference?: string): string | undefined {
  return reference ? HANDLER.exec(reference)?.[1].toUpperCase() : undefined;
}

/** Example data counts only while there is nothing else. */
function realCases(db: Db): Case[] {
  const real = db.cases.filter((c) => !c.demo);
  return real.length ? real : db.cases;
}

export function replyRecords(db: Db, today: string): ReplyRecord[] {
  const out: ReplyRecord[] = [];
  for (const c of realCases(db)) {
    for (const d of c.deadlines) {
      if (d.party !== "coop" || d.type !== "reply" || d.dropped) continue;
      const letter = c.events.find((e) => e.id === d.fromEventId);
      if (!letter) continue;
      const reply = d.doneEventId ? c.events.find((e) => e.id === d.doneEventId) : undefined;
      if (!d.doneAt && c.stage === "closed") continue; // closed without an answer: not waiting any more
      const end = d.doneAt ?? today;
      out.push({
        caseId: c.id,
        caseTitle: c.title,
        letter,
        due: d.due,
        reply,
        days: d.doneAt ? daysBetween(letter.date, d.doneAt) : undefined,
        late: Math.max(0, daysBetween(d.due, end)),
        pending: !d.doneAt,
        incomplete: !!reply && isIncomplete(reply.analysis),
        formal: reply ? formalIssues(reply.analysis) : [],
        handler: handlerOf(reply?.reference),
      });
    }
  }
  return out.sort((a, b) => a.letter.date.localeCompare(b.letter.date));
}

export interface Summary {
  letters: number;
  answered: number;
  onTime: number;
  late: number;
  pending: number;
  pendingLate: number;
  avgDays?: number;
  medianDays?: number;
  /** The longest delay, of a reply or of a letter still waiting. */
  maxLate?: { days: number; caseId: number; letterDate: string };
  incomplete: number;
  formal: number;
}

function summarize(rs: ReplyRecord[]): Summary {
  const answered = rs.filter((r) => !r.pending);
  const days = answered.map((r) => r.days!).sort((a, b) => a - b);
  const worst = [...rs].sort((a, b) => b.late - a.late)[0];
  return {
    letters: rs.length,
    answered: answered.length,
    onTime: answered.filter((r) => r.late === 0).length,
    late: answered.filter((r) => r.late > 0).length,
    pending: rs.filter((r) => r.pending).length,
    pendingLate: rs.filter((r) => r.pending && r.late > 0).length,
    avgDays: days.length ? Math.round(days.reduce((s, d) => s + d, 0) / days.length) : undefined,
    medianDays: days.length ? (days.length % 2 ? days[(days.length - 1) / 2] : Math.round((days[days.length / 2 - 1] + days[days.length / 2]) / 2)) : undefined,
    maxLate: worst && worst.late > 0 ? { days: worst.late, caseId: worst.caseId, letterDate: worst.letter.date } : undefined,
    incomplete: answered.filter((r) => r.incomplete).length,
    formal: answered.filter((r) => r.formal.length).length,
  };
}

export interface Stats {
  total: Summary;
  byYear: { year: string; s: Summary }[];
  byHandler: { handler: string; s: Summary }[];
  promises: { count: number; moved: number; broken: number; items: { caseId: number; label: string; moved: number; broken: number; dates: string[] }[] };
  records: ReplyRecord[];
}

export function stats(db: Db, today: string): Stats {
  const records = replyRecords(db, today);
  const group = (key: (r: ReplyRecord) => string | undefined) => {
    const m = new Map<string, ReplyRecord[]>();
    for (const r of records) {
      const k = key(r);
      if (k) m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()].map(([k, rs]) => ({ k, s: summarize(rs) }));
  };
  const items = realCases(db).flatMap((c) =>
    c.deadlines
      .filter((d) => d.party === "coop" && d.type === "task")
      .map((d) => ({ caseId: c.id, label: d.label, ...promiseMoves(d) })),
  );
  return {
    total: summarize(records),
    byYear: group((r) => r.letter.date.slice(0, 4))
      .map(({ k, s }) => ({ year: k, s }))
      .sort((a, b) => a.year.localeCompare(b.year)),
    byHandler: group((r) => r.handler)
      .map(({ k, s }) => ({ handler: k, s }))
      .sort((a, b) => b.s.answered - a.s.answered || a.handler.localeCompare(b.handler)),
    promises: {
      count: items.length,
      moved: items.reduce((s, x) => s + x.moved, 0),
      broken: items.reduce((s, x) => s + x.broken, 0),
      items: items.filter((x) => x.moved),
    },
    records,
  };
}
