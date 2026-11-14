"use client";
import { useMemo, useState } from "react";
import { formatDate, plDays } from "@/lib/dates";
import { personText } from "@/lib/format";
import { stats, type Summary } from "@/lib/stats";
import type { Person } from "@/lib/types";
import type { AppState } from "./App";
import { PersonForm } from "./forms";

function Tile({ n, label, tone }: { n: string; label: string; tone?: "late" | "ok" | "soon" }) {
  return (
    <div className="stat-tile">
      <div className={`n${tone ? ` tone-${tone}` : ""}`}>{n}</div>
      <div className="muted">{label}</div>
    </div>
  );
}

function Row({ name, s }: { name: string; s: Summary }) {
  return (
    <tr>
      <td>{name}</td>
      <td className="num">{s.letters}</td>
      <td className="num">{s.onTime}</td>
      <td className="num">{s.late || ""}</td>
      <td className="num">{s.pendingLate || ""}</td>
      <td className="num">{s.medianDays ?? "—"}</td>
      <td className="num">{s.incomplete || ""}</td>
      <td className="num">{s.formal || ""}</td>
    </tr>
  );
}

function Table({ title, rows }: { title: string; rows: { name: string; s: Summary }[] }) {
  if (!rows.length) return null;
  return (
    <div className="card">
      <h3>{title}</h3>
      <div style={{ overflowX: "auto" }}>
        <table className="stats">
          <thead>
            <tr>
              <th></th>
              <th>Pisma</th>
              <th>W terminie</th>
              <th>Po terminie</th>
              <th>Bez odp. po terminie</th>
              <th>Mediana dni</th>
              <th>Niepełne</th>
              <th>Braki formalne</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row key={r.name} name={r.name} s={r.s} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function StatsView({ app }: { app: AppState }) {
  const { db, today, reload } = app;
  const s = useMemo(() => stats(db, today), [db, today]);
  const [person, setPerson] = useState<Person | "new" | null>(null);
  const t = s.total;
  return (
    <section className="rules">
      <div className="detail-inner">
        <h2 className="label" style={{ margin: 0 }}>
          Jak odpowiada spółdzielnia
        </h2>
        {!s.records.length ? (
          <p className="muted">Nie ma jeszcze pism z terminem odpowiedzi.</p>
        ) : (
          <>
            <div className="stat-tiles">
              <Tile n={`${t.onTime}/${t.answered}`} label="odpowiedzi w terminie" tone={t.answered && t.onTime / t.answered >= 0.8 ? "ok" : "soon"} />
              <Tile n={t.medianDays !== undefined ? String(t.medianDays) : "—"} label="dni do odpowiedzi (mediana)" />
              <Tile n={String(t.pendingLate)} label="pism bez odpowiedzi po terminie" tone={t.pendingLate ? "late" : undefined} />
              <Tile n={String(t.incomplete)} label="niepełnych odpowiedzi" tone={t.incomplete ? "soon" : undefined} />
              <Tile n={String(s.promises.moved)} label={`przesunięć obietnic${s.promises.broken ? `, ${s.promises.broken} po terminie` : ""}`} tone={s.promises.broken ? "late" : undefined} />
            </div>
            {t.maxLate && (
              <p className="muted">
                Najdłużej: {plDays(t.maxLate.days)} po terminie – <a href={`#sprawa-${t.maxLate.caseId}`}>#{t.maxLate.caseId}</a>, pismo z {formatDate(t.maxLate.letterDate)}.
              </p>
            )}
            <Table title="Według lat (data mojego pisma)" rows={s.byYear.map((y) => ({ name: y.year, s: y.s }))} />
            <Table title="Według sygnatury (inicjały prowadzącego)" rows={s.byHandler.map((h) => ({ name: h.handler, s: h.s }))} />
            {s.promises.items.length > 0 && (
              <div className="card">
                <h3>Przesuwane obietnice</h3>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {s.promises.items.map((p, i) => (
                    <li key={i}>
                      <a href={`#sprawa-${p.caseId}`}>#{p.caseId}</a> {p.label}: {p.dates.map((d) => formatDate(d)).join(" → ")}
                      {p.broken ? <span className="tone-late"> ({p.broken}× po terminie)</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="card">
              <h3>Pisma</h3>
              <div style={{ overflowX: "auto" }}>
                <table className="stats">
                  <thead>
                    <tr>
                      <th>Sprawa</th>
                      <th>Moje pismo</th>
                      <th>Termin</th>
                      <th>Odpowiedź</th>
                      <th>Wynik</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...s.records].reverse().map((r) => (
                      <tr key={`${r.caseId}-${r.letter.id}`}>
                        <td>
                          <a href={`#sprawa-${r.caseId}`}>#{r.caseId}</a>
                        </td>
                        <td>
                          {formatDate(r.letter.date)} {r.letter.title}
                        </td>
                        <td>{formatDate(r.due)}</td>
                        <td>{r.reply ? `${formatDate(r.reply.date)}${r.reply.reference ? ` · ${r.reply.reference}` : ""}` : "—"}</td>
                        <td className={r.late ? "tone-late" : r.pending ? "muted" : "tone-ok"}>
                          {r.pending ? (r.late ? `brak, ${plDays(r.late)} po terminie` : "czeka") : r.late ? `${plDays(r.late)} po terminie` : "w terminie"}
                          {r.incomplete ? " · niepełna" : ""}
                          {r.formal.length ? ` · ${r.formal.join(", ")}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted" style={{ marginBottom: 0 }}>
                Liczone od daty złożenia lub doręczenia mojego pisma do otrzymania odpowiedzi. Sprawy demo pomijane, gdy są własne.
              </p>
            </div>
          </>
        )}

        <div className="row" style={{ alignItems: "center", marginTop: 8 }}>
          <h2 className="label" style={{ margin: 0, flex: 1 }}>
            Osoby
          </h2>
          <button className="btn small" style={{ flex: "0 0 auto" }} onClick={() => setPerson("new")}>
            + Osoba
          </button>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Kto pisze do spółdzielni. Niektóre wnioski (np. o kopie dokumentów) może złożyć tylko członek – przy piśmie widać, kto je wysłał.
        </p>
        {db.people.map((p) => (
          <button key={p.id} className="card person" onClick={() => setPerson(p)}>
            <strong>{personText(db, p)}</strong>
            {p.note && <div className="muted">{p.note}</div>}
          </button>
        ))}
      </div>
      {person && (
        <PersonForm
          person={person === "new" ? undefined : person}
          people={db.people}
          onClose={() => setPerson(null)}
          onSaved={async () => {
            setPerson(null);
            await reload();
          }}
        />
      )}
    </section>
  );
}
