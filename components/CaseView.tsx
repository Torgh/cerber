"use client";
import { Fragment, useState } from "react";
import { daysBetween, formatDate, plDays } from "@/lib/dates";
import { caseStatus, deadlineState, type CaseStatus, type DeadlineState } from "@/lib/status";
import {
  BASIS_LABEL,
  CATEGORY_LABEL,
  EVENT_LABEL,
  METHOD_LABEL,
  STAGE_LABEL,
  type Case,
  type CaseEvent,
  type Deadline,
  type EventKind,
} from "@/lib/types";
import { action, fileUrl } from "./api";
import type { AppState } from "./App";
import { countdownOf, deadlineStart } from "./countdown";
import { CaseForm, DeadlineForm, EventForm } from "./forms";
import * as I from "./icons";

type Dialog =
  | { kind: "case" }
  | { kind: "event"; event?: CaseEvent; initialKind?: EventKind }
  | { kind: "deadline"; deadline?: Deadline }
  | null;

const EVENT_ICON: Record<EventKind, (p: { size?: number }) => React.ReactNode> = {
  submitted: I.Send,
  reminder: I.Clock,
  appeal: I.Scale,
  letter: I.Send,
  response: I.Inbox,
  call: I.Phone,
  visit: I.People,
  inspection: I.Wrench,
  note: I.Note,
};

const short = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

function DateCell({ date }: { date: string }) {
  return (
    <span className="date">
      {short(date)}
      <small>{date.slice(0, 4)}</small>
    </span>
  );
}

/** The bar from my letter to the deadline and on to today. */
function Track({ c, s, today }: { c: Case; s: DeadlineState; today: string }) {
  const d = s.deadline;
  const start = deadlineStart(c, d);
  const allowed = Math.max(1, daysBetween(start, d.due));
  const late = s.state === "late" ? -s.left : 0;
  const elapsed = Math.max(0, daysBetween(start, today));
  const okShare = late ? allowed / (allowed + late) : 1;
  const nowAt = late ? 1 : Math.min(1, elapsed / allowed);
  const startLabel = c.events.find((e) => e.id === d.fromEventId)?.title ?? "Start";
  return (
    <section className="panel track" aria-label="Oś terminu">
      <div className="ends">
        <span>
          {startLabel} {short(start)}
        </span>
        <span>
          Termin {short(d.due)}
          {d.source ? ` · ${d.source}` : ` · ${BASIS_LABEL[d.basis]}`}
        </span>
        <span style={{ color: "var(--text)", fontWeight: 600 }}>Dziś {short(today)}</span>
      </div>
      <div className="rail-bar">
        {late ? (
          <>
            <span className="ok-part" style={{ width: `${okShare * 100}%` }} />
            <span className="late-part" style={{ flex: 1 }} />
          </>
        ) : (
          <>
            <span className="ok-part" style={{ width: `${nowAt * 100}%`, background: s.state === "soon" ? "var(--soon-fill)" : undefined }} />
            <span className="now" style={{ left: `calc(${nowAt * 100}% - 1px)` }} />
          </>
        )}
      </div>
      <div className="legend">
        <span style={{ color: "var(--info-text)" }}>
          {plDays(allowed)} na {d.party === "coop" ? "odpowiedź" : "działanie"}
        </span>
        {late ? (
          <span style={{ color: "var(--late-text)", fontWeight: 600 }}>{plDays(late)} zwłoki</span>
        ) : (
          <span className={s.state === "soon" ? "tone-soon" : "muted"} style={{ fontWeight: 600 }}>
            {s.left === 0 ? "termin mija dziś" : `zostało ${plDays(s.left)}`}
          </span>
        )}
      </div>
    </section>
  );
}

interface Step {
  tone: "late" | "normal";
  kicker: string;
  title: string;
  text: string;
  primary?: { label: string; run: () => void };
  secondary?: { label: string; run: () => void };
}

function AnalysisBox({ e }: { e: CaseEvent }) {
  const a = e.analysis!;
  return (
    <div className="analysis">
      <h4>
        <I.Spark size={14} /> Analiza Claude · {a.at.slice(0, 10)}
      </h4>
      <div style={{ whiteSpace: "pre-wrap" }}>{a.summary}</div>
      {(!!a.points?.length || !!a.issues?.length) && (
        <ul>
          {a.points?.map((p, i) => (
            <li key={`p${i}`}>
              <span className={`mark-${p.answered}`} aria-label={p.answered === "yes" ? "tak" : p.answered === "partly" ? "częściowo" : "nie"}>
                {p.answered === "yes" ? "✓" : p.answered === "partly" ? "½" : "✗"}
              </span>
              <span>
                {p.point}
                {p.note && <span className="muted"> – {p.note}</span>}
              </span>
            </li>
          ))}
          {a.issues?.map((x, i) => (
            <li key={`i${i}`}>
              <span className="mark-no" aria-label="zastrzeżenie">
                !
              </span>
              <span>
                {x.text}
                {x.source && <span className="muted"> ({x.source})</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {a.nextStep && (
        <div style={{ marginTop: 6 }}>
          <strong>Następny krok:</strong> {a.nextStep}
        </div>
      )}
    </div>
  );
}

export default function CaseView({ app, c, onBack }: { app: AppState; c: Case; onBack: () => void }) {
  const { db, today, reload } = app;
  const [dialog, setDialog] = useState<Dialog>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [openDraft, setOpenDraft] = useState<string | null>(null);
  const st: CaseStatus = caseStatus(c, today);
  const cd = countdownOf(c, st, today);
  const rule = db.deadlineRules.find((r) => r.category === c.category);
  const closeAndReload = async () => {
    setDialog(null);
    await reload();
  };
  const copy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };
  const lastDraft = c.drafts[c.drafts.length - 1];
  const showDraft = (id: string) => {
    setOpenDraft(id);
    setTimeout(() => document.getElementById(`draft-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };

  // What to do now – one card instead of several banners.
  const step = ((): Step | null => {
    if (c.stage === "closed") return null;
    const lateCoop = st.open.find((s) => s.state === "late" && s.deadline.party === "coop");
    const lateMine = st.open.find((s) => s.state === "late" && s.deadline.party === "me");
    const soonMine = st.open.find((s) => s.state === "soon" && s.deadline.party === "me");
    const ask = (cmd: string, id: string) => ({ label: copied === id ? "Skopiowano ✓" : "Kopiuj polecenie dla Claude", run: () => copy(cmd, id) });
    if (lateCoop)
      return {
        tone: "late",
        kicker: "Następny krok",
        title: "Wyślij ponaglenie",
        text: `Spółdzielnia miała czas do ${formatDate(lateCoop.deadline.due)}${lateCoop.deadline.source ? ` (${lateCoop.deadline.source})` : ""}. ${lastDraft ? "Projekt pisma jest gotowy." : "Claude przygotuje projekt ponaglenia."}`,
        primary: lastDraft ? { label: "Otwórz projekt", run: () => showDraft(lastDraft.id) } : ask(`Przygotuj ponaglenie w sprawie #${c.id} (Cerber).`, "remind"),
        secondary: { label: "Wysłane", run: () => setDialog({ kind: "event", initialKind: "reminder" }) },
      };
    if (lateMine || soonMine) {
      const s = (lateMine ?? soonMine)!;
      return {
        tone: lateMine ? "late" : "normal",
        kicker: "Twój termin",
        title: s.deadline.label,
        text: `${lateMine ? "Minął" : "Mija"} ${formatDate(s.deadline.due)}${s.deadline.source ? ` · ${s.deadline.source}` : ""}.`,
        primary: { label: "Zrobione", run: () => action("updateDeadline", { caseId: c.id, deadlineId: s.deadline.id, patch: { doneAt: today } }).then(reload) },
        secondary: { label: "Szczegóły", run: () => setDialog({ kind: "deadline", deadline: s.deadline }) },
      };
    }
    if (st.toAnalyze.length)
      return {
        tone: "normal",
        kicker: "Następny krok",
        title: "Przeanalizuj odpowiedź",
        text: "Claude przeczyta skan, sprawdzi go z regulaminem i wyłapie zobowiązania z datami.",
        primary: ask(`Przeanalizuj odpowiedź spółdzielni w sprawie #${c.id} (Cerber).`, "analyze"),
      };
    if (st.flags.includes("no-deadline"))
      return {
        tone: "normal",
        kicker: "Brakuje terminu",
        title: "Ustaw termin odpowiedzi",
        text: rule ? `Regulamin: ${plDays(rule.days)} (${rule.source}).` : "Regulamin nie podaje terminu dla tej kategorii – ustaw go ręcznie albo poproś Claude o sprawdzenie.",
        primary: { label: "Ustaw termin", run: () => setDialog({ kind: "deadline" }) },
      };
    if (c.stage === "draft")
      return {
        tone: "normal",
        kicker: "Następny krok",
        title: "Złóż pismo",
        text: "Dodaj zgłoszenie z datą złożenia lub doręczenia – od niej liczy się termin odpowiedzi.",
        primary: { label: "Dodaj zgłoszenie", run: () => setDialog({ kind: "event", initialKind: "submitted" }) },
      };
    const lastAnalysis = [...c.events].reverse().find((e) => e.analysis?.nextStep)?.analysis;
    if (c.stage === "answered")
      return {
        tone: "normal",
        kicker: "Po odpowiedzi",
        title: lastAnalysis?.nextStep ? "Zdecyduj o dalszym kroku" : "Sprawa załatwiona?",
        text: lastAnalysis?.nextStep ?? "Zamknij sprawę albo dodaj kolejne pismo.",
        primary: { label: "Zamknij sprawę", run: () => setDialog({ kind: "case" }) },
        secondary: { label: "Nowe pismo", run: () => setDialog({ kind: "event", initialKind: "letter" }) },
      };
    if (st.next)
      return {
        tone: "normal",
        kicker: "Czekamy",
        title: st.next.left === 0 ? "Termin mija dziś" : `Zostało ${plDays(st.next.left)}`,
        text: `${st.next.deadline.label} – do ${formatDate(st.next.deadline.due)}.`,
        primary: { label: "Wgraj odpowiedź", run: () => setDialog({ kind: "event", initialKind: "response" }) },
      };
    return null;
  })();

  // Timeline: events, open deadlines on their day, today.
  type Item = { date: string; order: number; key: string; node: React.ReactNode };
  const items: Item[] = c.events.map((e) => {
    const Icon = EVENT_ICON[e.kind];
    const started = c.deadlines.filter((d) => d.fromEventId === e.id && d.type === "reply");
    const met = c.deadlines.filter((d) => d.doneEventId === e.id && d.party === "coop");
    return {
      date: e.date,
      order: 0,
      key: e.id,
      node: (
        <li className="ev">
          <DateCell date={e.date} />
          <div style={{ minWidth: 0 }}>
            <div className="head">
              <strong>{e.title}</strong>
              <span className="kind">
                <Icon size={14} />
                {e.title !== EVENT_LABEL[e.kind] ? EVENT_LABEL[e.kind] : ""}
                {e.method ? ` · ${METHOD_LABEL[e.method]}` : ""}
                {e.reference ? ` · ${e.reference}` : ""}
              </span>
            </div>
            {e.description && <div className="body">{e.description}</div>}
            {!!e.files.length && (
              <div className="files">
                {e.files.map((f) => (
                  <a key={f.id} className="file" href={fileUrl(f.id)} target="_blank" rel="noreferrer">
                    <I.Clip size={14} />
                    {f.name}
                    {f.pages ? ` · ${f.pages} str.` : ""}
                  </a>
                ))}
              </div>
            )}
            {started.map((d) => (
              <div key={d.id} className="sub">
                Termin odpowiedzi do {formatDate(d.due)} · {d.source ?? BASIS_LABEL[d.basis]}
              </div>
            ))}
            {met.map((d) => {
              const late = daysBetween(d.due, d.doneAt!);
              return (
                <div key={d.id} style={{ marginTop: 8 }}>
                  {late > 0 ? <span className="chip late">odpowiedź {plDays(late)} po terminie</span> : <span className="chip ok">w terminie</span>}
                </div>
              );
            })}
            {e.analysis ? (
              <AnalysisBox e={e} />
            ) : (
              e.kind === "response" &&
              e.files.length > 0 && (
                <div className="analysis">
                  <h4>
                    <I.Spark size={14} /> Czeka na analizę
                  </h4>
                  <button className="btn link" onClick={() => copy(`Przeanalizuj odpowiedź spółdzielni w sprawie #${c.id} (Cerber).`, `an-${e.id}`)}>
                    {copied === `an-${e.id}` ? "Skopiowano ✓" : `Kopiuj: „Przeanalizuj odpowiedź spółdzielni w sprawie #${c.id}”`}
                  </button>
                </div>
              )
            )}
            <div className="event-actions">
              <button className="btn link" onClick={() => setDialog({ kind: "event", event: e })}>
                Edytuj / dołącz plik
              </button>
              <button
                className="btn link"
                style={{ color: "var(--late-text)" }}
                onClick={async () => {
                  if (!confirm(`Usunąć zdarzenie „${e.title}” razem z plikami?`)) return;
                  await action("deleteEvent", { caseId: c.id, eventId: e.id });
                  await reload();
                }}
              >
                Usuń
              </button>
            </div>
          </div>
        </li>
      ),
    };
  });
  for (const s of st.open) {
    const d = s.deadline;
    items.push({
      date: d.due,
      order: 1,
      key: d.id,
      node: (
        <li className={`ev marker${s.state === "late" ? " late" : ""}`}>
          <DateCell date={d.due} />
          <span>
            {d.party === "me" ? "Mój termin: " : ""}
            {d.label} –{" "}
            {s.state === "late" ? `minął, brak ${d.party === "coop" ? "odpowiedzi" : "działania"}` : s.left === 0 ? "mija dziś" : `zostało ${plDays(s.left)}`}
          </span>
        </li>
      ),
    });
  }
  if (c.stage !== "closed")
    items.push({
      date: today,
      order: 2,
      key: "today",
      node: (
        <li className="ev today">
          <DateCell date={today} />
          <span>dziś</span>
        </li>
      ),
    });
  items.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);

  const deadlines = c.deadlines.map((d) => deadlineState(d, today)).sort((a, b) => a.deadline.due.localeCompare(b.deadline.due));
  const lastEvent = c.events[c.events.length - 1];

  return (
    <div className="detail-inner">
      <div>
        <button className="btn small back" onClick={onBack}>
          <I.Back size={16} /> Lista
        </button>
      </div>

      <header className="case-head">
        <div className="info">
          <div className="kicker">
            #{c.id} · {CATEGORY_LABEL[c.category]} · {STAGE_LABEL[c.stage]}
            {c.demo ? " · demo" : ""}
          </div>
          <h1>{c.title}</h1>
          {c.description && <p className="desc">{c.description}</p>}
        </div>
        {c.stage !== "draft" && (
          <div className={`big-count${cd.tone === "late" ? " late" : cd.tone === "soon" ? " soon" : ""}`}>
            <div className={`num tone-${cd.tone}`} style={cd.num.length > 3 ? { fontSize: 32 } : undefined}>
              {cd.num}
            </div>
            <div className="what">{cd.what}</div>
            <div className="sub">
              {st.next
                ? `${st.next.state === "late" ? "termin minął" : "termin"} ${formatDate(st.next.deadline.due)}`
                : lastEvent
                  ? `ostatnio ${formatDate(lastEvent.date)}`
                  : ""}
            </div>
          </div>
        )}
      </header>

      {st.next && <Track c={c} s={st.next} today={today} />}

      <div className="cols">
        <section aria-label="Oś czasu" style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <h2 className="label" style={{ margin: 0 }}>
              Oś czasu
            </h2>
            <div className="toolbar">
              <button className="btn small" onClick={() => setDialog({ kind: "event" })}>
                <I.Plus size={16} /> Zdarzenie
              </button>
              <button className="btn small" onClick={() => setDialog({ kind: "event", initialKind: "response" })}>
                <I.Inbox size={16} /> Wgraj odpowiedź
              </button>
            </div>
          </div>
          {items.length ? (
            <ol className="timeline">
              {items.map((i) => (
                <Fragment key={i.key}>{i.node}</Fragment>
              ))}
            </ol>
          ) : (
            <p className="muted">Brak zdarzeń.</p>
          )}
        </section>

        <aside className="side">
          {step && (
            <div className={`panel next-step${step.tone === "late" ? " late" : ""}`}>
              <div className="label" style={{ color: step.tone === "late" ? "var(--late-text)" : "var(--soon)" }}>
                {step.kicker}
              </div>
              <h2>{step.title}</h2>
              <p>{step.text}</p>
              <div className="actions">
                {step.primary && (
                  <button className="btn primary" onClick={step.primary.run}>
                    {step.primary.label}
                  </button>
                )}
                {step.secondary && (
                  <button className="btn" onClick={step.secondary.run}>
                    {step.secondary.label}
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 className="label" style={{ margin: 0 }}>
                Terminy
              </h2>
              <button className="btn link" style={{ fontSize: 13 }} onClick={() => setDialog({ kind: "deadline" })}>
                + Dodaj
              </button>
            </div>
            {deadlines.length ? (
              <div style={{ marginTop: 6 }}>
                {deadlines.map((s) => (
                  <button key={s.deadline.id} className={`dl-row ${s.state}`} onClick={() => setDialog({ kind: "deadline", deadline: s.deadline })}>
                    <span className="lbl">
                      {s.deadline.party === "me" ? "Ja: " : ""}
                      {s.deadline.label}
                    </span>
                    <span className={`n tone-${s.state === "late" ? "late" : s.state === "soon" ? "soon" : s.state === "done" ? "ok" : "muted"}`}>
                      {s.state === "done" ? "✓" : s.state === "dropped" ? "—" : s.left < 0 ? `+${-s.left}` : s.left}
                    </span>
                    <span className="src">
                      do {formatDate(s.deadline.due)} · {s.deadline.source ?? BASIS_LABEL[s.deadline.basis]}
                      {s.deadline.doneAt ? ` · spełniony ${formatDate(s.deadline.doneAt)}` : ""}
                      {s.deadline.dropped ? " · nieaktualny" : ""}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
                Brak terminów.
              </p>
            )}
          </div>

          {c.drafts.length > 0 && (
            <div className="panel">
              <h2 className="label" style={{ margin: 0 }}>
                Projekty pism
              </h2>
              <div style={{ marginTop: 6 }}>
                {[...c.drafts].reverse().map((d) => (
                  <details
                    key={d.id}
                    id={`draft-${d.id}`}
                    className="draft"
                    open={openDraft === d.id}
                    onToggle={(e) => {
                      const isOpen = (e.currentTarget as HTMLDetailsElement).open;
                      if (isOpen !== (openDraft === d.id)) setOpenDraft(isOpen ? d.id : null);
                    }}
                  >
                    <summary>
                      <strong style={{ flex: 1 }}>{d.title}</strong>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {formatDate(d.at.slice(0, 10))}
                      </span>
                    </summary>
                    <pre>{d.body}</pre>
                    <div className="toolbar" style={{ marginBottom: 10 }}>
                      <button className="btn small" onClick={() => copy(d.body, d.id)}>
                        <I.Copy size={14} /> {copied === d.id ? "Skopiowano" : "Kopiuj"}
                      </button>
                      <button
                        className="btn small danger"
                        onClick={async () => {
                          if (!confirm("Usunąć projekt?")) return;
                          await action("deleteDraft", { caseId: c.id, draftId: d.id });
                          await reload();
                        }}
                      >
                        Usuń
                      </button>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}

          <div className="panel">
            <h2 className="label" style={{ margin: 0 }}>
              Sprawa
            </h2>
            <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
              Założona {formatDate(c.createdAt.slice(0, 10))}
              {rule ? ` · reguła: ${plDays(rule.days)} (${rule.source})` : ""}
            </div>
            <div className="toolbar" style={{ marginTop: 10 }}>
              <button className="btn small" onClick={() => setDialog({ kind: "case" })}>
                Edytuj / zamknij
              </button>
              <button
                className="btn small danger"
                onClick={async () => {
                  if (!confirm(`Usunąć całą sprawę #${c.id} razem ze skanami? Tego nie da się cofnąć.`)) return;
                  await action("deleteCase", { caseId: c.id });
                  onBack();
                  await reload();
                }}
              >
                Usuń
              </button>
            </div>
          </div>
        </aside>
      </div>

      {dialog?.kind === "case" && <CaseForm c={c} onClose={() => setDialog(null)} onSaved={closeAndReload} />}
      {dialog?.kind === "event" && (
        <EventForm
          c={c}
          event={dialog.event}
          initialKind={dialog.initialKind}
          rule={rule}
          today={today}
          onClose={() => setDialog(null)}
          onSaved={closeAndReload}
        />
      )}
      {dialog?.kind === "deadline" && <DeadlineForm c={c} deadline={dialog.deadline} today={today} onClose={() => setDialog(null)} onSaved={closeAndReload} />}
    </div>
  );
}
