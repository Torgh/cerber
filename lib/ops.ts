/**
 * Every change to the data, as plain functions on the Db object. The web app and the MCP server both
 * run them inside db.mutate(), so the rules (a reply meets the open reply deadlines, a letter starts
 * one…) are the same whichever side makes the change.
 */
import { nanoid } from "nanoid";
import { deadlineFrom, isValidDate } from "./dates";
import { splitSections } from "./rules";
import {
  OUTGOING_KINDS,
  type Analysis,
  type Case,
  type CaseEvent,
  type Category,
  type Db,
  type Deadline,
  type DeadlineBasis,
  type DeadlineMove,
  type Draft,
  type EventKind,
  type FileRef,
  type Method,
  type Outcome,
  type Party,
  type Person,
  type PersonRole,
  type RulesDoc,
  type RulesKind,
  type Stage,
} from "./types";

export class OpError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const now = () => new Date().toISOString();

function checkDate(s: string, what: string) {
  if (!isValidDate(s)) throw new OpError(`${what}: nieprawidłowa data "${s}" (RRRR-MM-DD).`);
}

export function getCase(db: Db, id: number): Case {
  const c = db.cases.find((x) => x.id === id);
  if (!c) throw new OpError(`Nie ma sprawy #${id}.`, 404);
  return c;
}

export function getEvent(c: Case, eventId: string): CaseEvent {
  const e = c.events.find((x) => x.id === eventId);
  if (!e) throw new OpError(`Sprawa #${c.id} nie ma zdarzenia ${eventId}.`, 404);
  return e;
}

function touch(db: Db, c?: Case) {
  const t = now();
  if (c) c.updatedAt = t;
  db.updatedAt = t;
}

function sortEvents(c: Case) {
  c.events.sort((a, b) => a.date.localeCompare(b.date));
}

export interface CaseInput {
  title: string;
  category: Category;
  description?: string;
}

export function createCase(db: Db, input: CaseInput): Case {
  if (!input.title.trim()) throw new OpError("Sprawa musi mieć tytuł.");
  const t = now();
  const c: Case = {
    id: db.nextCaseId++,
    title: input.title.trim(),
    category: input.category,
    description: input.description?.trim() || undefined,
    stage: "draft",
    createdAt: t,
    updatedAt: t,
    events: [],
    deadlines: [],
    drafts: [],
  };
  db.cases.push(c);
  touch(db, c);
  return c;
}

export interface CasePatch {
  title?: string;
  category?: Category;
  description?: string;
  stage?: Stage;
  outcome?: Outcome | null;
}

export function updateCase(db: Db, id: number, patch: CasePatch): Case {
  const c = getCase(db, id);
  if (patch.title !== undefined) {
    if (!patch.title.trim()) throw new OpError("Sprawa musi mieć tytuł.");
    c.title = patch.title.trim();
  }
  if (patch.category !== undefined) c.category = patch.category;
  if (patch.description !== undefined) c.description = patch.description.trim() || undefined;
  if (patch.stage !== undefined) c.stage = patch.stage;
  if (patch.outcome !== undefined) c.outcome = patch.outcome ?? undefined;
  if (c.stage !== "closed") c.outcome = undefined;
  touch(db, c);
  return c;
}

export function deleteCase(db: Db, id: number): Case {
  const c = getCase(db, id);
  db.cases = db.cases.filter((x) => x.id !== id);
  for (const o of db.cases) if (o.related?.includes(id)) setRelated(o, o.related.filter((x) => x !== id));
  touch(db);
  return c;
}

function setRelated(c: Case, ids: number[]) {
  c.related = ids.length ? [...new Set(ids)].sort((a, b) => a - b) : undefined;
}

/** Marks two cases as related (both ways), or unlinks them. */
export function linkCases(db: Db, caseId: number, otherId: number, unlink = false) {
  const a = getCase(db, caseId);
  const b = getCase(db, otherId);
  if (a.id === b.id) throw new OpError("Sprawa nie może być powiązana sama ze sobą.");
  if (unlink) {
    setRelated(a, (a.related ?? []).filter((x) => x !== b.id));
    setRelated(b, (b.related ?? []).filter((x) => x !== a.id));
  } else {
    setRelated(a, [...(a.related ?? []), b.id]);
    setRelated(b, [...(b.related ?? []), a.id]);
  }
  touch(db, a);
  touch(db, b);
}

/** Files of `files` that no event and no rules document uses any more – safe to delete from disk. */
export function unreferenced(db: Db, files: FileRef[]): FileRef[] {
  const used = new Set<string>();
  for (const c of db.cases) for (const e of c.events) for (const f of e.files) used.add(f.id);
  for (const r of db.rules) if (r.file) used.add(r.file.id);
  return files.filter((f) => !used.has(f.id));
}

/** How long the cooperative has: a number of days from the event, or a fixed date. */
export interface DeadlineInput {
  days?: number;
  due?: string;
  basis: DeadlineBasis;
  source?: string;
  label?: string;
}

export interface EventInput {
  date: string;
  kind: EventKind;
  title?: string;
  description?: string;
  method?: Method;
  reference?: string;
  letterDate?: string;
  registeredDate?: string;
  dateApprox?: boolean;
  senderId?: string;
  files?: FileRef[];
  /**
   * For my letters: the deadline for the reply. Leave it out to use the deadline rule of the case's
   * category (from the rules); null for no deadline (the case then shows "set a deadline").
   */
  replyDeadline?: DeadlineInput | null;
}

function checkPerson(db: Db, id: string | undefined) {
  if (id && !db.people.some((p) => p.id === id)) throw new OpError(`Nie ma osoby ${id}.`, 404);
}

function resolveDue(start: string, d: DeadlineInput): string {
  if (d.due) {
    checkDate(d.due, "Termin");
    return d.due;
  }
  if (d.days === undefined || !Number.isFinite(d.days) || d.days < 0) throw new OpError("Termin: podaj liczbę dni albo datę.");
  return deadlineFrom(start, Math.round(d.days));
}

export function addEvent(db: Db, caseId: number, input: EventInput): { event: CaseEvent; deadline?: Deadline } {
  const c = getCase(db, caseId);
  checkDate(input.date, "Data zdarzenia");
  if (input.letterDate) checkDate(input.letterDate, "Data na piśmie");
  if (input.registeredDate) checkDate(input.registeredDate, "Data rejestracji");
  checkPerson(db, input.senderId);
  const event: CaseEvent = {
    id: nanoid(10),
    date: input.date,
    kind: input.kind,
    title: input.title?.trim() || defaultTitle(input.kind),
    description: input.description?.trim() || undefined,
    method: input.method,
    reference: input.reference?.trim() || undefined,
    letterDate: input.letterDate && input.letterDate !== input.date ? input.letterDate : undefined,
    registeredDate: input.registeredDate && input.registeredDate !== input.date ? input.registeredDate : undefined,
    dateApprox: input.dateApprox || undefined,
    senderId: input.senderId || undefined,
    files: input.files ?? [],
  };
  c.events.push(event);
  sortEvents(c);

  let deadline: Deadline | undefined;
  if (OUTGOING_KINDS.includes(input.kind)) {
    if (c.stage !== "closed") c.stage = input.kind === "appeal" || c.stage === "escalated" ? "escalated" : "waiting";
    let d = input.replyDeadline;
    if (d === undefined) {
      const rule = db.deadlineRules.find((r) => r.category === c.category);
      d = rule ? { days: rule.days, basis: "rules", source: rule.source } : null;
    }
    if (d) {
      deadline = {
        id: nanoid(10),
        party: "coop",
        type: "reply",
        label: d.label?.trim() || `Odpowiedź na: ${event.title}`,
        due: resolveDue(event.date, d),
        basis: d.basis,
        source: d.source?.trim() || undefined,
        fromEventId: event.id,
      };
      c.deadlines.push(deadline);
    }
  } else if (input.kind === "response") {
    if (c.stage !== "closed") c.stage = "answered";
    for (const d of c.deadlines) {
      if (d.party === "coop" && d.type === "reply" && !d.doneAt && !d.dropped) {
        d.doneAt = event.date;
        d.doneEventId = event.id;
      }
    }
  }
  touch(db, c);
  return { event, deadline };
}

function defaultTitle(kind: EventKind): string {
  return {
    submitted: "Zgłoszenie",
    reminder: "Ponaglenie",
    appeal: "Odwołanie",
    letter: "Pismo",
    response: "Odpowiedź spółdzielni",
    call: "Rozmowa telefoniczna",
    visit: "Wizyta",
    inspection: "Oględziny",
    note: "Notatka",
  }[kind];
}

export interface EventPatch {
  date?: string;
  title?: string;
  description?: string;
  method?: Method | null;
  reference?: string;
  /** null clears it. */
  letterDate?: string | null;
  registeredDate?: string | null;
  dateApprox?: boolean;
  senderId?: string | null;
}

/** The same letter in the other cases it is linked to (see shareEvent). */
function linkedCopies(db: Db, e: CaseEvent): { c: Case; e: CaseEvent }[] {
  if (!e.linkId) return [];
  const out: { c: Case; e: CaseEvent }[] = [];
  for (const c of db.cases) for (const x of c.events) if (x.linkId === e.linkId && x !== e) out.push({ c, e: x });
  return out;
}

function applyEventPatch(db: Db, c: Case, e: CaseEvent, patch: EventPatch) {
  if (patch.date !== undefined) {
    e.date = patch.date;
    sortEvents(c);
  }
  if (patch.title !== undefined) e.title = patch.title.trim() || defaultTitle(e.kind);
  if (patch.description !== undefined) e.description = patch.description.trim() || undefined;
  if (patch.method !== undefined) e.method = patch.method ?? undefined;
  if (patch.reference !== undefined) e.reference = patch.reference.trim() || undefined;
  if (patch.letterDate !== undefined) e.letterDate = patch.letterDate && patch.letterDate !== e.date ? patch.letterDate : undefined;
  if (patch.registeredDate !== undefined) e.registeredDate = patch.registeredDate && patch.registeredDate !== e.date ? patch.registeredDate : undefined;
  if (patch.dateApprox !== undefined) e.dateApprox = patch.dateApprox || undefined;
  if (patch.senderId !== undefined) e.senderId = patch.senderId || undefined;
  touch(db, c);
}

/** Changes an event – and its copies in linked cases, since it is the same letter. */
export function updateEvent(db: Db, caseId: number, eventId: string, patch: EventPatch): CaseEvent {
  const c = getCase(db, caseId);
  const e = getEvent(c, eventId);
  if (patch.date !== undefined) checkDate(patch.date, "Data zdarzenia");
  if (patch.letterDate) checkDate(patch.letterDate, "Data na piśmie");
  if (patch.registeredDate) checkDate(patch.registeredDate, "Data rejestracji");
  checkPerson(db, patch.senderId ?? undefined);
  applyEventPatch(db, c, e, patch);
  for (const x of linkedCopies(db, e)) applyEventPatch(db, x.c, x.e, patch);
  return e;
}

/**
 * Puts the same letter into another case (one letter answering two cases, or my e-mail about both):
 * a copy with the same files and details, linked so that edits reach both. The analysis stays per
 * case – the letter answers different points in each. In the other case it starts or meets
 * deadlines like any letter (addEvent).
 */
export function shareEvent(db: Db, caseId: number, eventId: string, otherCaseId: number, replyDeadline?: DeadlineInput | null): { event: CaseEvent; deadline?: Deadline } {
  const c = getCase(db, caseId);
  const e = getEvent(c, eventId);
  const other = getCase(db, otherCaseId);
  if (other.id === c.id) throw new OpError("To ta sama sprawa.");
  if (e.linkId && other.events.some((x) => x.linkId === e.linkId)) throw new OpError(`To pismo jest już w sprawie #${other.id}.`);
  e.linkId ??= nanoid(10);
  const res = addEvent(db, other.id, {
    date: e.date,
    kind: e.kind,
    title: e.title,
    description: e.description,
    method: e.method,
    reference: e.reference,
    letterDate: e.letterDate,
    registeredDate: e.registeredDate,
    dateApprox: e.dateApprox,
    senderId: e.senderId,
    files: e.files.map((f) => ({ ...f })),
    replyDeadline,
  });
  res.event.linkId = e.linkId;
  linkCases(db, c.id, other.id);
  return res;
}

/**
 * Links two events that are already the same letter in two cases (added twice before). Files with
 * the same name and size become one; returns the duplicates no longer used, to delete from disk.
 */
export function linkEvents(db: Db, caseId: number, eventId: string, otherCaseId: number, otherEventId: string): FileRef[] {
  const c = getCase(db, caseId);
  const e = getEvent(c, eventId);
  const other = getCase(db, otherCaseId);
  const o = getEvent(other, otherEventId);
  if (e === o) throw new OpError("To to samo zdarzenie.");
  if (e.kind !== o.kind) throw new OpError("Połączyć można tylko zdarzenia tego samego rodzaju (to samo pismo).");
  const id = e.linkId ?? o.linkId ?? nanoid(10);
  for (const x of [e, o, ...linkedCopies(db, e).map((l) => l.e), ...linkedCopies(db, o).map((l) => l.e)]) x.linkId = id;
  const replaced: FileRef[] = [];
  const files: FileRef[] = [];
  for (const f of o.files) {
    const same = e.files.find((x) => x.name === f.name && x.size === f.size);
    if (same) {
      if (same.id !== f.id) replaced.push(f);
      files.push({ ...same });
    } else files.push(f);
  }
  o.files = files;
  // The first event gets the files only the other one had.
  for (const f of o.files) if (!e.files.some((x) => x.id === f.id)) e.files.push({ ...f });
  linkCases(db, c.id, other.id);
  return unreferenced(db, replaced);
}

/** Removes an event, the deadlines it started, and reopens the deadlines it met. Returns its files. */
export function deleteEvent(db: Db, caseId: number, eventId: string): FileRef[] {
  const c = getCase(db, caseId);
  const e = getEvent(c, eventId);
  c.events = c.events.filter((x) => x.id !== eventId);
  c.deadlines = c.deadlines.filter((d) => d.fromEventId !== eventId);
  for (const d of c.deadlines) {
    if (d.doneEventId === eventId) {
      d.doneAt = undefined;
      d.doneEventId = undefined;
    }
  }
  // The draft it was sent from is unsent again.
  for (const d of c.drafts) {
    if (d.sentEventId === eventId) {
      d.sentAt = undefined;
      d.sentEventId = undefined;
    }
  }
  touch(db, c);
  return e.files;
}

export function attachFiles(db: Db, caseId: number, eventId: string, files: FileRef[]): CaseEvent {
  const c = getCase(db, caseId);
  const e = getEvent(c, eventId);
  e.files.push(...files);
  for (const x of linkedCopies(db, e)) {
    x.e.files.push(...files.map((f) => ({ ...f })));
    touch(db, x.c);
  }
  touch(db, c);
  return e;
}

/** Removes a file from the event (and its linked copies). Delete it from disk only if unreferenced. */
export function removeFile(db: Db, caseId: number, eventId: string, fileId: string): FileRef {
  const c = getCase(db, caseId);
  const e = getEvent(c, eventId);
  const f = e.files.find((x) => x.id === fileId);
  if (!f) throw new OpError("Nie ma takiego pliku.", 404);
  e.files = e.files.filter((x) => x.id !== fileId);
  for (const x of linkedCopies(db, e)) {
    x.e.files = x.e.files.filter((y) => y.id !== fileId);
    touch(db, x.c);
  }
  touch(db, c);
  return f;
}

export interface NewDeadline extends DeadlineInput {
  party: Party;
  type?: "reply" | "task";
  label: string;
  /** Counted from this date when `days` is given; defaults to the event's date, or today. */
  from?: string;
  fromEventId?: string;
}

export function addDeadline(db: Db, caseId: number, input: NewDeadline, todayIso: string): Deadline {
  const c = getCase(db, caseId);
  if (!input.label.trim()) throw new OpError("Termin musi mieć opis.");
  const ev = input.fromEventId ? getEvent(c, input.fromEventId) : undefined;
  const start = input.from ?? ev?.date ?? todayIso;
  checkDate(start, "Początek terminu");
  const d: Deadline = {
    id: nanoid(10),
    party: input.party,
    type: input.type ?? "task",
    label: input.label.trim(),
    due: resolveDue(start, input),
    basis: input.basis,
    source: input.source?.trim() || undefined,
    fromEventId: ev?.id,
  };
  c.deadlines.push(d);
  touch(db, c);
  return d;
}

export interface DeadlinePatch {
  label?: string;
  due?: string;
  basis?: DeadlineBasis;
  source?: string;
  doneAt?: string | null;
  dropped?: boolean;
  /**
   * The cooperative moved its promise on this date: the old due date goes to the history (a broken
   * promise when it had already passed). Without it a new `due` is a correction.
   */
  movedOn?: string;
  /** Earlier dates of this promise to record (e.g. from old letters), each with when it was replaced. */
  earlier?: DeadlineMove[];
}

function recordMove(d: Deadline, m: DeadlineMove) {
  const h = [...(d.history ?? []), m].sort((a, b) => a.movedOn.localeCompare(b.movedOn) || a.due.localeCompare(b.due));
  d.history = h.filter((x, i) => !i || x.due !== h[i - 1].due || x.movedOn !== h[i - 1].movedOn);
}

export function updateDeadline(db: Db, caseId: number, deadlineId: string, patch: DeadlinePatch): Deadline {
  const c = getCase(db, caseId);
  const d = c.deadlines.find((x) => x.id === deadlineId);
  if (!d) throw new OpError("Nie ma takiego terminu.", 404);
  if (patch.label !== undefined && patch.label.trim()) d.label = patch.label.trim();
  for (const m of patch.earlier ?? []) {
    checkDate(m.due, "Wcześniejszy termin");
    checkDate(m.movedOn, "Data przesunięcia");
    recordMove(d, { due: m.due, movedOn: m.movedOn, source: m.source?.trim() || undefined });
  }
  if (patch.due !== undefined) {
    checkDate(patch.due, "Termin");
    if (patch.movedOn && patch.due !== d.due) {
      checkDate(patch.movedOn, "Data przesunięcia");
      recordMove(d, { due: d.due, movedOn: patch.movedOn, source: d.source });
    }
    d.due = patch.due;
  }
  if (patch.basis !== undefined) d.basis = patch.basis;
  if (patch.source !== undefined) d.source = patch.source.trim() || undefined;
  if (patch.doneAt !== undefined) {
    if (patch.doneAt) checkDate(patch.doneAt, "Data spełnienia");
    d.doneAt = patch.doneAt ?? undefined;
    if (!patch.doneAt) d.doneEventId = undefined;
  }
  if (patch.dropped !== undefined) d.dropped = patch.dropped || undefined;
  touch(db, c);
  return d;
}

export function deleteDeadline(db: Db, caseId: number, deadlineId: string) {
  const c = getCase(db, caseId);
  c.deadlines = c.deadlines.filter((x) => x.id !== deadlineId);
  touch(db, c);
}

export interface AnalysisInput extends Omit<Analysis, "at"> {
  /**
   * What the cooperative promises to do and by when ("wymiana pionu do 30.06"). `replaces`: the id of
   * an earlier deadline for the same promise – it is moved to the new date and keeps its history.
   */
  commitments?: { label: string; due: string; source?: string; replaces?: string }[];
  /** What I have to do and by when (an appeal within 14 days…). */
  myDeadlines?: { label: string; due: string; source?: string }[];
}

export function saveAnalysis(db: Db, caseId: number, eventId: string, input: AnalysisInput): { event: CaseEvent; added: Deadline[]; moved: Deadline[] } {
  const c = getCase(db, caseId);
  const e = getEvent(c, eventId);
  const { commitments, myDeadlines, ...analysis } = input;
  if (analysis.formal) {
    const f = analysis.formal;
    analysis.formal = { signer: f.signer, signedBy: f.signedBy?.trim() || undefined, appealInstruction: f.appealInstruction, justification: f.justification };
  }
  e.analysis = { ...analysis, at: now() };
  const added: Deadline[] = [];
  const moved: Deadline[] = [];
  const add = (party: Party, list: AnalysisInput["commitments"]) => {
    for (const x of list ?? []) {
      checkDate(x.due, `Termin "${x.label}"`);
      // The same promise again, with a later date: move the old deadline instead of adding one.
      if (x.replaces) {
        const old = c.deadlines.find((d) => d.id === x.replaces);
        if (!old) throw new OpError(`Nie ma terminu ${x.replaces} do przesunięcia.`, 404);
        if (old.fromEventId !== e.id) {
          if (old.due !== x.due) recordMove(old, { due: old.due, movedOn: e.letterDate ?? e.date, source: old.source });
          old.fromEventId = e.id;
          old.doneAt = undefined;
          old.doneEventId = undefined;
          old.dropped = undefined;
          moved.push(old);
        }
        old.label = x.label;
        old.due = x.due;
        old.source = x.source ?? `${e.title}, ${e.date}`;
        continue;
      }
      // Saving the analysis again must not duplicate its deadlines.
      const same = c.deadlines.find((d) => d.fromEventId === e.id && d.party === party && d.label === x.label);
      if (same) {
        same.due = x.due;
        same.source = x.source ?? same.source;
        continue;
      }
      const d: Deadline = {
        id: nanoid(10),
        party,
        type: "task",
        label: x.label,
        due: x.due,
        basis: "letter",
        source: x.source ?? `${e.title}, ${e.date}`,
        fromEventId: e.id,
      };
      c.deadlines.push(d);
      added.push(d);
    }
  };
  add("coop", commitments);
  add("me", myDeadlines);
  touch(db, c);
  return { event: e, added, moved };
}

export function addDraft(db: Db, caseId: number, title: string, body: string): Draft {
  const c = getCase(db, caseId);
  const d: Draft = { id: nanoid(10), at: now(), title: title.trim() || "Projekt pisma", body };
  c.drafts.push(d);
  touch(db, c);
  return d;
}

export function deleteDraft(db: Db, caseId: number, draftId: string) {
  const c = getCase(db, caseId);
  c.drafts = c.drafts.filter((d) => d.id !== draftId);
  for (const e of c.events) if (e.draftId === draftId) e.draftId = undefined;
  touch(db, c);
}

/**
 * I sent a draft: it goes on the timeline as my letter (by default "letter", with the reply deadline
 * of addEvent) and the draft is marked as sent, so the case stops asking for it.
 */
export function sendDraft(db: Db, caseId: number, draftId: string, input: Omit<EventInput, "kind"> & { kind?: EventKind }): { event: CaseEvent; deadline?: Deadline } {
  const c = getCase(db, caseId);
  const draft = c.drafts.find((d) => d.id === draftId);
  if (!draft) throw new OpError("Nie ma takiego projektu pisma.", 404);
  if (draft.sentAt) throw new OpError(`Projekt „${draft.title}” jest już oznaczony jako wysłany ${draft.sentAt}.`);
  const kind = input.kind ?? "letter";
  if (!OUTGOING_KINDS.includes(kind)) throw new OpError("Wysłany projekt to pismo ode mnie (zgłoszenie, ponaglenie, odwołanie albo pismo).");
  const res = addEvent(db, caseId, { ...input, kind, title: input.title?.trim() || draft.title });
  res.event.draftId = draft.id;
  draft.sentAt = res.event.date;
  draft.sentEventId = res.event.id;
  return res;
}

export interface RulesInput {
  title: string;
  kind: RulesKind;
  text: string;
  validFrom?: string;
  file?: FileRef;
  /** The id of the older version this one replaces. */
  replaces?: string;
}

export function addRules(db: Db, input: RulesInput): RulesDoc {
  if (!input.title.trim()) throw new OpError("Dokument musi mieć tytuł.");
  if (input.validFrom) checkDate(input.validFrom, "Obowiązuje od");
  const sections = splitSections(input.text);
  if (!sections.length) throw new OpError("Dokument nie zawiera tekstu. Skan bez warstwy tekstowej: poproś Claude'a o odczytanie go (MCP import_rules).");
  const doc: RulesDoc = {
    id: nanoid(10),
    title: input.title.trim(),
    kind: input.kind,
    validFrom: input.validFrom,
    importedAt: now(),
    file: input.file,
    sections,
  };
  if (input.replaces) {
    const old = db.rules.find((r) => r.id === input.replaces);
    if (!old) throw new OpError("Nie ma dokumentu, który ma zostać zastąpiony.", 404);
    old.supersededBy = doc.id;
  }
  db.rules.push(doc);
  touch(db);
  return doc;
}

export function deleteRules(db: Db, id: string): RulesDoc {
  const doc = db.rules.find((r) => r.id === id);
  if (!doc) throw new OpError("Nie ma takiego dokumentu.", 404);
  db.rules = db.rules.filter((r) => r.id !== id);
  for (const r of db.rules) if (r.supersededBy === id) r.supersededBy = undefined;
  touch(db);
  return doc;
}

export function setDeadlineRule(db: Db, category: Category, days: number | null, source = "") {
  db.deadlineRules = db.deadlineRules.filter((r) => r.category !== category);
  if (days !== null) {
    if (!Number.isFinite(days) || days <= 0) throw new OpError("Liczba dni musi być dodatnia.");
    db.deadlineRules.push({ category, days: Math.round(days), source: source.trim() });
  }
  touch(db);
}

export interface PersonInput {
  name?: string;
  role?: PersonRole;
  /** null clears it. */
  proxyFor?: string | null;
  proxyScope?: string | null;
  note?: string | null;
}

/** Adds a person (without id) or changes one. */
export function savePerson(db: Db, input: PersonInput & { id?: string }): Person {
  let p = input.id ? db.people.find((x) => x.id === input.id) : undefined;
  if (input.id && !p) throw new OpError(`Nie ma osoby ${input.id}.`, 404);
  if (!p) {
    if (!input.name?.trim()) throw new OpError("Osoba musi mieć imię i nazwisko.");
    p = { id: nanoid(8), name: input.name.trim(), role: input.role ?? "other" };
    db.people.push(p);
  }
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new OpError("Osoba musi mieć imię i nazwisko.");
    p.name = input.name.trim();
  }
  if (input.role !== undefined) p.role = input.role;
  if (input.proxyFor !== undefined) {
    if (input.proxyFor === p.id) throw new OpError("Osoba nie może być własnym pełnomocnikiem.");
    checkPerson(db, input.proxyFor ?? undefined);
    p.proxyFor = input.proxyFor || undefined;
  }
  if (input.proxyScope !== undefined) p.proxyScope = input.proxyScope?.trim() || undefined;
  if (input.note !== undefined) p.note = input.note?.trim() || undefined;
  if (p.role !== "proxy") {
    p.proxyFor = undefined;
    p.proxyScope = undefined;
  }
  touch(db);
  return p;
}

/** Removes a person; letters they sent keep no sender. */
export function deletePerson(db: Db, id: string): Person {
  const p = db.people.find((x) => x.id === id);
  if (!p) throw new OpError(`Nie ma osoby ${id}.`, 404);
  db.people = db.people.filter((x) => x.id !== id);
  for (const o of db.people) if (o.proxyFor === id) o.proxyFor = undefined;
  for (const c of db.cases) for (const e of c.events) if (e.senderId === id) e.senderId = undefined;
  touch(db);
  return p;
}
