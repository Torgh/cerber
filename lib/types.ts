/** Cerber's data model. Everything lives in one JSON file (see lib/server/db.ts). Dates are "YYYY-MM-DD". */

export type Stage = "draft" | "waiting" | "answered" | "escalated" | "closed";

export const STAGE_LABEL: Record<Stage, string> = {
  draft: "Szkic",
  waiting: "Czeka na odpowiedź",
  answered: "Odpowiedź",
  escalated: "Eskalacja",
  closed: "Zamknięta",
};

export const STAGES = Object.keys(STAGE_LABEL) as Stage[];

export type Outcome = "resolved" | "partly" | "refused" | "withdrawn";

export const OUTCOME_LABEL: Record<Outcome, string> = {
  resolved: "załatwiona",
  partly: "załatwiona częściowo",
  refused: "odmowa",
  withdrawn: "wycofana",
};

export type Category = "defect" | "billing" | "documents" | "complaint" | "membership" | "other";

export const CATEGORY_LABEL: Record<Category, string> = {
  defect: "Usterka / remont",
  billing: "Opłaty i rozliczenia",
  documents: "Wgląd / kopie dokumentów",
  complaint: "Skarga / reklamacja",
  membership: "Członkostwo / lokal",
  other: "Inne",
};

export const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];

export type EventKind =
  | "submitted" // my letter starting the case
  | "reminder" // ponaglenie
  | "appeal" // odwołanie (Rada Nadzorcza, Walne, lustracja…)
  | "letter" // any other letter from me
  | "response" // a letter from the cooperative
  | "call"
  | "visit"
  | "inspection"
  | "note";

export const EVENT_LABEL: Record<EventKind, string> = {
  submitted: "Zgłoszenie",
  reminder: "Ponaglenie",
  appeal: "Odwołanie",
  letter: "Pismo ode mnie",
  response: "Odpowiedź spółdzielni",
  call: "Telefon",
  visit: "Wizyta / rozmowa",
  inspection: "Oględziny / prace",
  note: "Notatka",
};

export const EVENT_ICON: Record<EventKind, string> = {
  submitted: "📤",
  reminder: "⏰",
  appeal: "⚖️",
  letter: "✉️",
  response: "📥",
  call: "📞",
  visit: "🗣️",
  inspection: "🔧",
  note: "📝",
};

export const EVENT_KINDS = Object.keys(EVENT_LABEL) as EventKind[];

/** Letters I send that the cooperative has to answer. */
export const OUTGOING_KINDS: EventKind[] = ["submitted", "reminder", "appeal", "letter"];

export type Method = "in_person" | "registered" | "email" | "epuap" | "mailbox" | "other";

export const METHOD_LABEL: Record<Method, string> = {
  in_person: "osobiście (pieczątka na kopii)",
  registered: "list polecony",
  email: "e-mail",
  epuap: "ePUAP",
  mailbox: "skrzynka podawcza",
  other: "inaczej",
};

export interface FileRef {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** Pages, for a PDF. */
  pages?: number;
}

export interface Analysis {
  at: string;
  summary: string;
  /** Points of my letter and whether the reply answers them. */
  points?: { point: string; answered: "yes" | "partly" | "no"; note?: string }[];
  /** Problems: rules quoted wrongly, missing legal instruction, contradictions… each with its source. */
  issues?: { text: string; source?: string }[];
  nextStep?: string;
}

export interface CaseEvent {
  id: string;
  date: string;
  kind: EventKind;
  title: string;
  description?: string;
  method?: Method;
  /** Reference number on a letter (sygnatura, L.dz.). */
  reference?: string;
  files: FileRef[];
  analysis?: Analysis;
}

export type Party = "coop" | "me";

export type DeadlineBasis = "rules" | "law" | "letter" | "manual";

export const BASIS_LABEL: Record<DeadlineBasis, string> = {
  rules: "regulamin / statut",
  law: "ustawa",
  letter: "z pisma",
  manual: "ustawiony ręcznie",
};

export interface Deadline {
  id: string;
  /** Who has to act: the cooperative (answer, commitment) or me (appeal…). */
  party: Party;
  /** "reply": the cooperative must answer a letter of mine – met by its next reply. "task": anything else. */
  type: "reply" | "task";
  label: string;
  due: string;
  basis: DeadlineBasis;
  /** "Statut § 31 ust. 2", "pismo z 20.10.2026". */
  source?: string;
  /** The event that started it (my letter, or the reply with a commitment). */
  fromEventId?: string;
  /** Met on this date (the reply arrived, the work was done, I sent the appeal). */
  doneAt?: string;
  doneEventId?: string;
  /** Not relevant any more (e.g. I decided not to appeal). */
  dropped?: boolean;
}

export interface Draft {
  id: string;
  at: string;
  title: string;
  body: string;
}

export interface Case {
  id: number;
  title: string;
  category: Category;
  description?: string;
  stage: Stage;
  outcome?: Outcome;
  createdAt: string;
  updatedAt: string;
  events: CaseEvent[];
  deadlines: Deadline[];
  drafts: Draft[];
  /** Example data (Demo button); removed together by "Usuń demo". */
  demo?: boolean;
}

export type RulesKind = "statute" | "rules" | "law" | "other";

export const RULES_KIND_LABEL: Record<RulesKind, string> = {
  statute: "Statut",
  rules: "Regulamin",
  law: "Ustawa",
  other: "Inny dokument",
};

export interface RulesSection {
  /** "§ 12", "Art. 8¹", or "1" when the text has no paragraphs. */
  ref: string;
  text: string;
}

export interface RulesDoc {
  id: string;
  title: string;
  kind: RulesKind;
  /** In force from; an older version stays for cases judged by it. */
  validFrom?: string;
  /** Replaced by a newer version (its id). */
  supersededBy?: string;
  importedAt: string;
  file?: FileRef;
  sections: RulesSection[];
  demo?: boolean;
}

/** "Rules say the cooperative answers a defect report within 14 days" – used to fill in new deadlines. */
export interface DeadlineRule {
  category: Category;
  days: number;
  source: string;
  demo?: boolean;
}

export interface Db {
  version: number;
  updatedAt: string;
  nextCaseId: number;
  cases: Case[];
  rules: RulesDoc[];
  deadlineRules: DeadlineRule[];
}

export function emptyDb(): Db {
  return { version: 1, updatedAt: new Date(0).toISOString(), nextCaseId: 1, cases: [], rules: [], deadlineRules: [] };
}
