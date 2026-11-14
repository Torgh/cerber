"use client";
import { useEffect, useState } from "react";
import { deadlineFrom, formatDate, isValidDate, plDays } from "@/lib/dates";
import {
  BASIS_LABEL,
  CATEGORIES,
  CATEGORY_LABEL,
  EVENT_KINDS,
  EVENT_LABEL,
  METHOD_LABEL,
  OUTCOME_LABEL,
  OUTGOING_KINDS,
  STAGE_LABEL,
  STAGES,
  type Case,
  type CaseEvent,
  type Category,
  type Deadline,
  type DeadlineBasis,
  type DeadlineRule,
  type Draft,
  type EventKind,
  type Method,
  type Outcome,
  type Party,
  type Stage,
} from "@/lib/types";
import { action, upload } from "./api";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function CaseForm({ c, onClose, onSaved }: { c?: Case; onClose: () => void; onSaved: (id: number) => void }) {
  const [title, setTitle] = useState(c?.title ?? "");
  const [category, setCategory] = useState<Category>(c?.category ?? "defect");
  const [description, setDescription] = useState(c?.description ?? "");
  const [stage, setStage] = useState<Stage>(c?.stage ?? "draft");
  const [outcome, setOutcome] = useState<Outcome | "">(c?.outcome ?? "");
  const { busy, error, run } = useSubmit();
  const save = () =>
    run(async () => {
      if (c) {
        await action("updateCase", { caseId: c.id, patch: { title, category, description, stage, outcome: stage === "closed" && outcome ? outcome : null } });
        onSaved(c.id);
      } else {
        const created = await action<Case>("createCase", { title, category, description });
        onSaved(created.id);
      }
    });
  return (
    <Modal title={c ? `Sprawa #${c.id}` : "Nowa sprawa"} onClose={onClose}>
      <label className="field">
        <span>Tytuł</span>
        <input type="text" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} placeholder="np. Przeciek z pionu w łazience" />
      </label>
      <label className="field">
        <span>Kategoria</span>
        <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
          {CATEGORIES.map((k) => (
            <option key={k} value={k}>
              {CATEGORY_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Opis – czego dotyczy i czego żądam</span>
        <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      {c && (
        <div className="row">
          <label className="field">
            <span>Etap</span>
            <select value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          {stage === "closed" && (
            <label className="field">
              <span>Wynik</span>
              <select value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)}>
                <option value="">—</option>
                {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => (
                  <option key={o} value={o}>
                    {OUTCOME_LABEL[o]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {error && <div className="error">{error}</div>}
      <div className="actions">
        <button className="btn" onClick={onClose}>
          Anuluj
        </button>
        <button className="btn primary" disabled={busy || !title.trim()} onClick={save}>
          Zapisz
        </button>
      </div>
    </Modal>
  );
}

type DeadlineMode = "rule" | "days" | "date" | "none";

export function EventForm({
  c,
  event,
  rule,
  today,
  initialKind,
  draft,
  onClose,
  onSaved,
}: {
  c: Case;
  event?: CaseEvent;
  rule?: DeadlineRule;
  today: string;
  initialKind?: EventKind;
  /** Marking this draft as sent: the new event is my letter with its text. */
  draft?: Draft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<EventKind>(event?.kind ?? initialKind ?? (draft ? "letter" : c.events.length ? "response" : "submitted"));
  const [date, setDate] = useState(event?.date ?? today);
  const [title, setTitle] = useState(event?.title ?? draft?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [method, setMethod] = useState<Method | "">(event?.method ?? "");
  const [reference, setReference] = useState(event?.reference ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<DeadlineMode>(rule ? "rule" : "days");
  const [days, setDays] = useState("");
  const [due, setDue] = useState("");
  const [basis, setBasis] = useState<DeadlineBasis>("manual");
  const [source, setSource] = useState("");
  const { busy, error, run } = useSubmit();
  const outgoing = OUTGOING_KINDS.includes(kind);
  const validDate = isValidDate(date);
  const preview =
    !validDate || !outgoing
      ? null
      : mode === "rule" && rule
        ? deadlineFrom(date, rule.days)
        : mode === "days" && Number(days) > 0
          ? deadlineFrom(date, Number(days))
          : mode === "date" && isValidDate(due)
            ? due
            : null;

  const save = () =>
    run(async () => {
      if (event) {
        await action("updateEvent", { caseId: c.id, eventId: event.id, patch: { date, title, description, method: method || null, reference } });
        if (files.length) await upload("attachFiles", { caseId: c.id, eventId: event.id }, files);
      } else {
        const replyDeadline = !outgoing
          ? undefined
          : mode === "rule"
            ? undefined
            : mode === "none"
              ? null
              : mode === "days"
                ? Number(days) > 0
                  ? { days: Number(days), basis, source }
                  : null
                : isValidDate(due)
                  ? { due, basis, source }
                  : null;
        const ev = { date, kind, title, description, method: method || undefined, reference, replyDeadline };
        if (draft) await upload("sendDraft", { caseId: c.id, draftId: draft.id, event: ev }, files);
        else await upload("addEvent", { caseId: c.id, event: ev }, files);
      }
      onSaved();
    });

  return (
    <Modal title={event ? "Edytuj zdarzenie" : draft ? "Wysłane pismo" : "Nowe zdarzenie"} onClose={onClose}>
      {draft && <p className="muted" style={{ marginTop: 0 }}>Pismo z projektu „{draft.title}” trafi na oś czasu, a projekt zostanie oznaczony jako wysłany.</p>}
      <div className="row">
        <label className="field">
          <span>Rodzaj</span>
          <select value={kind} disabled={!!event} onChange={(e) => setKind(e.target.value as EventKind)}>
            {(draft ? OUTGOING_KINDS : EVENT_KINDS).map((k) => (
              <option key={k} value={k}>
                {EVENT_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{outgoing ? "Data złożenia / doręczenia" : kind === "response" ? "Data otrzymania" : "Data"}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>Tytuł</span>
        <input type="text" value={title} placeholder={EVENT_LABEL[kind]} onChange={(e) => setTitle(e.target.value)} />
      </label>
      {(outgoing || kind === "response") && (
        <div className="row">
          <label className="field">
            <span>Sposób</span>
            <select value={method} onChange={(e) => setMethod(e.target.value as Method)}>
              <option value="">—</option>
              {(Object.keys(METHOD_LABEL) as Method[]).map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Sygnatura / L.dz.</span>
            <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
        </div>
      )}
      <label className="field">
        <span>Treść / notatka</span>
        <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="field">
        <span>{kind === "response" ? "Skan odpowiedzi (PDF, zdjęcia)" : "Załączniki (skan pisma, potwierdzenie nadania…)"}</span>
        <input type="file" multiple accept=".pdf,image/*,.txt,.doc,.docx,.odt,.msg" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
      </label>
      {outgoing && !event && (
        <fieldset>
          <legend>Termin odpowiedzi spółdzielni</legend>
          {rule && (
            <label className="radio">
              <input type="radio" checked={mode === "rule"} onChange={() => setMode("rule")} />
              Z regulaminu: {plDays(rule.days)} ({rule.source})
            </label>
          )}
          <label className="radio">
            <input type="radio" checked={mode === "days"} onChange={() => setMode("days")} />
            Liczba dni:
            <input type="number" min={1} style={{ width: 90 }} value={days} onFocus={() => setMode("days")} onChange={(e) => setDays(e.target.value)} />
          </label>
          <label className="radio">
            <input type="radio" checked={mode === "date"} onChange={() => setMode("date")} />
            Konkretna data:
            <input type="date" style={{ width: 170 }} value={due} onFocus={() => setMode("date")} onChange={(e) => setDue(e.target.value)} />
          </label>
          <label className="radio">
            <input type="radio" checked={mode === "none"} onChange={() => setMode("none")} />
            Bez terminu (ustawię później)
          </label>
          {(mode === "days" || mode === "date") && (
            <div className="row">
              <label className="field">
                <span>Podstawa</span>
                <select value={basis} onChange={(e) => setBasis(e.target.value as DeadlineBasis)}>
                  {(Object.keys(BASIS_LABEL) as DeadlineBasis[]).map((b) => (
                    <option key={b} value={b}>
                      {BASIS_LABEL[b]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Źródło (opcjonalnie)</span>
                <input type="text" value={source} placeholder="np. Statut § 12 ust. 3" onChange={(e) => setSource(e.target.value)} />
              </label>
            </div>
          )}
          <div className="muted">
            {preview
              ? `Spółdzielnia ma czas do ${formatDate(preview)}.`
              : mode === "none" || (mode === "days" && !days) || (mode === "date" && !due)
                ? "Sprawa będzie oznaczona „bez terminu”, dopóki go nie ustawisz."
                : ""}{" "}
            Koniec w sobotę lub święto przesuwa się na następny dzień roboczy.
          </div>
        </fieldset>
      )}
      {error && <div className="error">{error}</div>}
      <div className="actions">
        <button className="btn" onClick={onClose}>
          Anuluj
        </button>
        <button className="btn primary" disabled={busy || !validDate} onClick={save}>
          {busy ? "Zapisywanie…" : "Zapisz"}
        </button>
      </div>
    </Modal>
  );
}

export function DeadlineForm({
  c,
  deadline,
  today,
  onClose,
  onSaved,
}: {
  c: Case;
  deadline?: Deadline;
  today: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const lastOutgoing = [...c.events].reverse().find((e) => OUTGOING_KINDS.includes(e.kind));
  const [party, setParty] = useState<Party>(deadline?.party ?? "coop");
  const [label, setLabel] = useState(deadline?.label ?? (lastOutgoing ? `Odpowiedź na: ${lastOutgoing.title}` : ""));
  const [fromEventId, setFromEventId] = useState(deadline?.fromEventId ?? lastOutgoing?.id ?? "");
  const [days, setDays] = useState("");
  const [due, setDue] = useState(deadline?.due ?? "");
  const [basis, setBasis] = useState<DeadlineBasis>(deadline?.basis ?? "manual");
  const [source, setSource] = useState(deadline?.source ?? "");
  const [isReply, setIsReply] = useState((deadline?.type ?? (lastOutgoing ? "reply" : "task")) === "reply");
  const { busy, error, run } = useSubmit();
  const from = c.events.find((e) => e.id === fromEventId)?.date ?? today;
  const computed = Number(days) > 0 ? deadlineFrom(from, Number(days)) : isValidDate(due) ? due : null;

  const save = () =>
    run(async () => {
      if (deadline) {
        await action("updateDeadline", { caseId: c.id, deadlineId: deadline.id, patch: { label, due: computed ?? deadline.due, basis, source } });
      } else {
        await action("addDeadline", {
          caseId: c.id,
          deadline: {
            party,
            type: party === "coop" && isReply ? "reply" : "task",
            label,
            fromEventId: fromEventId || undefined,
            ...(Number(days) > 0 ? { days: Number(days) } : { due }),
            basis,
            source,
          },
        });
      }
      onSaved();
    });
  const patch = (p: object) =>
    run(async () => {
      await action("updateDeadline", { caseId: c.id, deadlineId: deadline!.id, patch: p });
      onSaved();
    });

  return (
    <Modal title={deadline ? "Termin" : "Nowy termin"} onClose={onClose}>
      {!deadline && (
        <div className="row">
          <label className="field">
            <span>Kto ma działać</span>
            <select value={party} onChange={(e) => setParty(e.target.value as Party)}>
              <option value="coop">Spółdzielnia</option>
              <option value="me">Ja</option>
            </select>
          </label>
          <label className="field">
            <span>Liczony od zdarzenia</span>
            <select value={fromEventId} onChange={(e) => setFromEventId(e.target.value)}>
              <option value="">— od dziś —</option>
              {c.events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.date} {e.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <label className="field">
        <span>Opis</span>
        <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="np. Odpowiedź na zgłoszenie" />
      </label>
      <div className="row">
        <label className="field">
          <span>Liczba dni od {formatDate(from)}</span>
          <input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
        <label className="field">
          <span>albo data</span>
          <input type="date" value={due} onChange={(e) => (setDue(e.target.value), setDays(""))} />
        </label>
      </div>
      <div className="row">
        <label className="field">
          <span>Podstawa</span>
          <select value={basis} onChange={(e) => setBasis(e.target.value as DeadlineBasis)}>
            {(Object.keys(BASIS_LABEL) as DeadlineBasis[]).map((b) => (
              <option key={b} value={b}>
                {BASIS_LABEL[b]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Źródło</span>
          <input type="text" value={source} placeholder="np. Regulamin § 4" onChange={(e) => setSource(e.target.value)} />
        </label>
      </div>
      {!deadline && party === "coop" && (
        <label className="radio">
          <input type="checkbox" checked={isReply} onChange={(e) => setIsReply(e.target.checked)} />
          To termin odpowiedzi na pismo (spełni go następna odpowiedź spółdzielni)
        </label>
      )}
      {computed && <div className="muted">Termin: {formatDate(computed)}</div>}
      {error && <div className="error">{error}</div>}
      <div className="actions">
        {deadline && (
          <>
            <button
              className="btn danger spacer"
              onClick={() =>
                confirm("Usunąć ten termin?") &&
                run(async () => {
                  await action("deleteDeadline", { caseId: c.id, deadlineId: deadline.id });
                  onSaved();
                })
              }
            >
              Usuń
            </button>
            {deadline.doneAt || deadline.dropped ? (
              <button className="btn" onClick={() => patch({ doneAt: null, dropped: false })}>
                Otwórz ponownie
              </button>
            ) : (
              <>
                <button className="btn" onClick={() => patch({ dropped: true })}>
                  Nieaktualny
                </button>
                <button className="btn" onClick={() => patch({ doneAt: today })}>
                  ✓ Spełniony dziś
                </button>
              </>
            )}
          </>
        )}
        <button className="btn" onClick={onClose}>
          Anuluj
        </button>
        <button className="btn primary" disabled={busy || !label.trim() || (!deadline && !computed)} onClick={save}>
          Zapisz
        </button>
      </div>
    </Modal>
  );
}
