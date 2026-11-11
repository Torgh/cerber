"use client";
import { Fragment, useState } from "react";
import { daysBetween, formatDate, plDays } from "@/lib/dates";
import { caseStatus, deadlineState, type DeadlineState } from "@/lib/status";
import {
  BASIS_LABEL,
  CATEGORY_LABEL,
  EVENT_ICON,
  EVENT_LABEL,
  METHOD_LABEL,
  OUTGOING_KINDS,
  STAGE_LABEL,
  type Case,
  type CaseEvent,
  type Deadline,
  type EventKind,
} from "@/lib/types";
import { action, fileUrl } from "./api";
import type { AppState } from "./App";
import { StatusChips } from "./CaseList";
import { CaseForm, DeadlineForm, EventForm } from "./forms";

type Dialog =
  | { kind: "case" }
  | { kind: "event"; event?: CaseEvent; initialKind?: EventKind }
  | { kind: "deadline"; deadline?: Deadline }
  | null;

function countLabel(s: DeadlineState): string {
  if (s.state === "done") return "✓";
  if (s.state === "dropped") return "—";
  if (s.left < 0) return `+${plDays(-s.left)}`;
  if (s.left === 0) return "dziś";
  return plDays(s.left);
}

function AnalysisBox({ e }: { e: CaseEvent }) {
  const a = e.analysis!;
  return (
    <div className="analysis">
      <h4>🤖 Analiza Claude · {a.at.slice(0, 10)}</h4>
      <div style={{ whiteSpace: "pre-wrap" }}>{a.summary}</div>
      {!!a.points?.length && (
        <ul>
          {a.points.map((p, i) => (
            <li key={i}>
              {p.answered === "yes" ? "✅" : p.answered === "partly" ? "🟡" : "❌"} {p.point}
              {p.note && <span className="muted"> – {p.note}</span>}
            </li>
          ))}
        </ul>
      )}
      {!!a.issues?.length && (
        <ul>
          {a.issues.map((x, i) => (
            <li key={i}>
              ⚠ {x.text}
              {x.source && <span className="muted"> ({x.source})</span>}
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
  const st = caseStatus(c, today);
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

  const lateCoop = st.open.filter((s) => s.state === "late" && s.deadline.party === "coop");
  const lateMine = st.open.filter((s) => s.state === "late" && s.deadline.party === "me");

  // Timeline: events, open deadlines on their due date, and today.
  type Item = { date: string; order: number; key: string; node: React.ReactNode };
  const items: Item[] = c.events.map((e) => {
    const outgoing = OUTGOING_KINDS.includes(e.kind);
    const started = c.deadlines.filter((d) => d.fromEventId === e.id && d.type === "reply");
    const met = c.deadlines.filter((d) => d.doneEventId === e.id);
    return {
      date: e.date,
      order: 0,
      key: e.id,
      node: (
        <li className={`tl ${outgoing ? "out" : e.kind === "response" ? "in" : ""}`}>
          <span className="tl-dot">{EVENT_ICON[e.kind]}</span>
          <div className="tl-date">{formatDate(e.date)}</div>
          <div className="tl-card">
            <div className="head">
              <strong>{e.title}</strong>
              {e.title !== EVENT_LABEL[e.kind] && <span className="chip">{EVENT_LABEL[e.kind]}</span>}
              {e.method && <span className="chip">{METHOD_LABEL[e.method]}</span>}
              {e.reference && <span className="chip">sygn. {e.reference}</span>}
            </div>
            {e.description && <div className="body">{e.description}</div>}
            {!!e.files.length && (
              <div className="files">
                {e.files.map((f) => (
                  <a key={f.id} className="file" href={fileUrl(f.id)} target="_blank" rel="noreferrer">
                    📎 {f.name}
                    {f.pages ? ` · ${f.pages} str.` : ""}
                  </a>
                ))}
              </div>
            )}
            {started.map((d) => (
              <div key={d.id} className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                ⚖ termin odpowiedzi do {formatDate(d.due)} – {BASIS_LABEL[d.basis]}
                {d.source ? `: ${d.source}` : ""}
              </div>
            ))}
            {met.map((d) => {
              const late = daysBetween(d.due, d.doneAt!);
              return (
                <div key={d.id} style={{ marginTop: 6, fontSize: 12 }} className={late > 0 ? "" : "muted"}>
                  {late > 0 ? (
                    <span className="chip danger">odpowiedź {plDays(late)} po terminie</span>
                  ) : (
                    <span className="chip ok">✓ w terminie ({d.label})</span>
                  )}
                </div>
              );
            })}
            {e.analysis ? (
              <AnalysisBox e={e} />
            ) : (
              e.kind === "response" &&
              e.files.length > 0 && (
                <div className="analysis">
                  <h4>📥 Czeka na analizę</h4>
                  Powiedz Claude&apos;owi:{" "}
                  <button className="btn link" onClick={() => copy(`Przeanalizuj odpowiedź spółdzielni w sprawie #${c.id} (Cerber).`, `an-${e.id}`)}>
                    „Przeanalizuj odpowiedź spółdzielni w sprawie #{c.id}” {copied === `an-${e.id}` ? "✓ skopiowano" : "⧉"}
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
                style={{ color: "var(--danger)" }}
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
        <li className={`tl deadline ${s.state === "late" ? "late" : ""}`}>
          <span className="tl-dot">⏰</span>
          <div className="tl-date">{formatDate(d.due)}</div>
          <div className="tl-card">
            {d.party === "me" ? "Mój termin: " : ""}
            {d.label} –{" "}
            {s.state === "late" ? `minął, brak ${d.party === "coop" ? "odpowiedzi" : "działania"} (${plDays(-s.left)})` : s.left === 0 ? "mija dziś" : `zostało ${plDays(s.left)}`}
          </div>
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
        <li className="tl today">
          <span className="tl-dot" />
          <div className="tl-date">{formatDate(today)}</div>
          <div className="tl-card muted">dziś</div>
        </li>
      ),
    });
  items.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);

  const deadlines = [...c.deadlines].map((d) => deadlineState(d, today)).sort((a, b) => a.deadline.due.localeCompare(b.deadline.due));

  return (
    <div className="detail-inner">
      <button className="btn small back" onClick={onBack} style={{ marginBottom: 10 }}>
        ← Lista
      </button>
      <div className="case-head">
        <h1>
          <span className="muted">#{c.id}</span> {c.title}
        </h1>
        <div className="meta">
          <span className="chip">{STAGE_LABEL[c.stage]}</span>
          <StatusChips c={c} s={st} />
          <span>{CATEGORY_LABEL[c.category]}</span>
          <span>· założona {formatDate(c.createdAt.slice(0, 10))}</span>
        </div>
        {c.description && <div className="description">{c.description}</div>}
      </div>

      <div className="toolbar">
        <button className="btn primary" onClick={() => setDialog({ kind: "event" })}>
          + Zdarzenie
        </button>
        <button className="btn" onClick={() => setDialog({ kind: "event", initialKind: "response" })}>
          📥 Wgraj odpowiedź
        </button>
        <button className="btn" onClick={() => setDialog({ kind: "deadline" })}>
          ⏰ Termin
        </button>
        <button className="btn" onClick={() => setDialog({ kind: "case" })}>
          Edytuj sprawę
        </button>
        <button
          className="btn danger"
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

      {lateCoop.length > 0 && (
        <div className="banner danger">
          <span className="grow">
            ⚠ Spółdzielnia nie dotrzymała terminu: {lateCoop.map((s) => `${s.deadline.label} (do ${formatDate(s.deadline.due)}, ${plDays(-s.left)} temu)`).join("; ")}.
            Czas na ponaglenie.
          </span>
          <button className="btn small" onClick={() => copy(`Przygotuj ponaglenie w sprawie #${c.id} (Cerber).`, "remind")}>
            {copied === "remind" ? "✓ skopiowano" : "⧉ „Przygotuj ponaglenie w sprawie #" + c.id + "”"}
          </button>
          <button className="btn small" onClick={() => setDialog({ kind: "event", initialKind: "reminder" })}>
            Wysłałem ponaglenie
          </button>
        </div>
      )}
      {lateMine.length > 0 && (
        <div className="banner danger">⚠ Minął Twój termin: {lateMine.map((s) => `${s.deadline.label} (${formatDate(s.deadline.due)})`).join("; ")}.</div>
      )}
      {st.flags.includes("no-deadline") && (
        <div className="banner warn">
          <span className="grow">❔ Sprawa czeka na odpowiedź, ale nie ma terminu. Ustaw go ręcznie albo poproś Claude&apos;a o sprawdzenie regulaminu.</span>
          <button className="btn small" onClick={() => setDialog({ kind: "deadline" })}>
            Ustaw termin
          </button>
        </div>
      )}

      <div className="section-title">Oś czasu</div>
      {items.length ? (
        <ol className="timeline">
          {items.map((i) => (
            <Fragment key={i.key}>{i.node}</Fragment>
          ))}
        </ol>
      ) : (
        <p className="muted">Brak zdarzeń. Dodaj pierwsze pismo do spółdzielni („+ Zdarzenie” → Zgłoszenie).</p>
      )}

      <div className="section-title">Terminy</div>
      {deadlines.length ? (
        <div className="deadlines">
          {deadlines.map((s) => (
            <button key={s.deadline.id} className={`dl ${s.state}`} style={{ textAlign: "left", cursor: "pointer" }} onClick={() => setDialog({ kind: "deadline", deadline: s.deadline })}>
              <span className="count">{countLabel(s)}</span>
              <span>
                <div>
                  {s.deadline.party === "me" ? <span className="chip info">ja</span> : <span className="chip">spółdzielnia</span>} {s.deadline.label}
                </div>
                <div className="src">
                  do {formatDate(s.deadline.due)} · {BASIS_LABEL[s.deadline.basis]}
                  {s.deadline.source ? `: ${s.deadline.source}` : ""}
                  {s.deadline.doneAt ? ` · spełniony ${formatDate(s.deadline.doneAt)}` : ""}
                  {s.deadline.dropped ? " · nieaktualny" : ""}
                </div>
              </span>
              <span className="muted">›</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">Brak terminów.</p>
      )}

      {c.drafts.length > 0 && (
        <>
          <div className="section-title">Projekty pism</div>
          {[...c.drafts].reverse().map((d) => (
            <details key={d.id} className="draft">
              <summary>
                <strong style={{ flex: 1 }}>✎ {d.title}</strong>
                <span className="muted">{d.at.slice(0, 10)}</span>
              </summary>
              <pre>{d.body}</pre>
              <div className="event-actions" style={{ padding: "0 12px 12px" }}>
                <button className="btn small" onClick={() => copy(d.body, d.id)}>
                  {copied === d.id ? "✓ skopiowano" : "⧉ Kopiuj"}
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
        </>
      )}

      {dialog?.kind === "case" && <CaseForm c={c} onClose={() => setDialog(null)} onSaved={closeAndReload} />}
      {dialog?.kind === "event" && (
        <EventForm c={c} event={dialog.event} initialKind={dialog.initialKind} rule={rule} today={today} onClose={() => setDialog(null)} onSaved={closeAndReload} />
      )}
      {dialog?.kind === "deadline" && <DeadlineForm c={c} deadline={dialog.deadline} today={today} onClose={() => setDialog(null)} onSaved={closeAndReload} />}
    </div>
  );
}

