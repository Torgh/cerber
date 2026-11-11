"use client";
import { useMemo, useState } from "react";
import { formatDate, plDays } from "@/lib/dates";
import { searchRules } from "@/lib/rules";
import { CATEGORIES, CATEGORY_LABEL, RULES_KIND_LABEL, type Category, type RulesDoc, type RulesKind } from "@/lib/types";
import { action, fileUrl, upload } from "./api";
import type { AppState } from "./App";
import { Modal } from "./forms";

function ImportForm({ docs, onClose, onSaved }: { docs: RulesDoc[]; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<RulesKind>("rules");
  const [validFrom, setValidFrom] = useState("");
  const [replaces, setReplaces] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await upload("addRules", { title, kind, validFrom: validFrom || undefined, replaces: replaces || undefined, text: text || undefined }, file ? [file] : []);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Wczytaj dokument" onClose={onClose}>
      <label className="field">
        <span>Tytuł</span>
        <input type="text" value={title} autoFocus placeholder="np. Statut Spółdzielni" onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="row">
        <label className="field">
          <span>Rodzaj</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as RulesKind)}>
            {(Object.keys(RULES_KIND_LABEL) as RulesKind[]).map((k) => (
              <option key={k} value={k}>
                {RULES_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Obowiązuje od</span>
          <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </label>
      </div>
      {docs.length > 0 && (
        <label className="field">
          <span>Zastępuje starszą wersję</span>
          <select value={replaces} onChange={(e) => setReplaces(e.target.value)}>
            <option value="">— nowy dokument —</option>
            {docs
              .filter((d) => !d.supersededBy)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>Plik (PDF z tekstem, TXT)</span>
        <input type="file" accept=".pdf,.txt,.md" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <label className="field">
        <span>…albo wklej tekst</span>
        <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="§ 1. …" />
      </label>
      <p className="muted" style={{ margin: 0 }}>
        Zeskanowany regulamin (bez warstwy tekstowej)? Powiedz Claude&apos;owi: „wczytaj do Cerbera regulamin z pliku C:\…\regulamin.pdf” – przeczyta skan przez MCP.
      </p>
      {error && <div className="error">{error}</div>}
      <div className="actions">
        <button className="btn" onClick={onClose}>
          Anuluj
        </button>
        <button className="btn primary" disabled={busy || !title.trim() || (!file && !text.trim())} onClick={save}>
          {busy ? "Wczytywanie…" : "Wczytaj"}
        </button>
      </div>
    </Modal>
  );
}

function DeadlineRules({ app }: { app: AppState }) {
  const [editing, setEditing] = useState<Category | null>(null);
  const [days, setDays] = useState("");
  const [source, setSource] = useState("");
  const start = (c: Category) => {
    const r = app.db.deadlineRules.find((x) => x.category === c);
    setEditing(c);
    setDays(r ? String(r.days) : "");
    setSource(r?.source ?? "");
  };
  const save = async (c: Category, d: number | null) => {
    await action("setDeadlineRule", { category: c, days: d, source });
    setEditing(null);
    await app.reload();
  };
  return (
    <div className="card">
      <h3>Terminy odpowiedzi według regulaminu</h3>
      <p className="muted" style={{ marginTop: 4 }}>
        Ile dni spółdzielnia ma na odpowiedź w danej kategorii spraw. Nowe pisma dostaną ten termin same. Gdzie regulamin nic nie mówi – zostaw puste i ustawiaj termin ręcznie przy piśmie.
      </p>
      <table className="rules-table">
        <thead>
          <tr>
            <th>Kategoria</th>
            <th>Termin</th>
            <th>Podstawa</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {CATEGORIES.map((c) => {
            const r = app.db.deadlineRules.find((x) => x.category === c);
            return editing === c ? (
              <tr key={c}>
                <td>{CATEGORY_LABEL[c]}</td>
                <td>
                  <input type="number" min={1} style={{ width: 80 }} value={days} onChange={(e) => setDays(e.target.value)} /> dni
                </td>
                <td>
                  <input type="text" value={source} placeholder="Statut § 12 ust. 3" onChange={(e) => setSource(e.target.value)} />
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn small primary" disabled={!(Number(days) > 0)} onClick={() => save(c, Number(days))}>
                    Zapisz
                  </button>{" "}
                  {r && (
                    <button className="btn small" onClick={() => save(c, null)}>
                      Usuń
                    </button>
                  )}{" "}
                  <button className="btn small" onClick={() => setEditing(null)}>
                    ✕
                  </button>
                </td>
              </tr>
            ) : (
              <tr key={c}>
                <td>{CATEGORY_LABEL[c]}</td>
                <td>{r ? plDays(r.days) : <span className="muted">ręcznie</span>}</td>
                <td className="muted">{r?.source}</td>
                <td>
                  <button className="btn small" onClick={() => start(c)}>
                    Zmień
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function RulesView({ app }: { app: AppState }) {
  const docs = app.db.rules;
  const [importing, setImporting] = useState(false);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const hits = useMemo(() => (q.trim().length >= 3 ? searchRules(docs, q, 20) : []), [docs, q]);
  return (
    <section className="rules">
      <div className="detail-inner">
        <div className="toolbar" style={{ marginTop: 0 }}>
          <input type="search" placeholder="Szukaj w statucie i regulaminach (np. „termin rozpatrzenia”, „§ 31”)…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
          <button className="btn primary" onClick={() => setImporting(true)}>
            + Wczytaj dokument
          </button>
        </div>
        {q.trim().length >= 3 && (
          <div className="card">
            <h3>Wyniki: {hits.length}</h3>
            {hits.map((h, i) => (
              <div key={i} className="rule-hit">
                <strong>
                  {h.docTitle} {h.ref}
                </strong>
                <div className="section-text">{h.text}</div>
              </div>
            ))}
          </div>
        )}
        <DeadlineRules app={app} />
        <div className="section-title">Dokumenty</div>
        {!docs.length && <p className="muted">Nie wczytano jeszcze żadnego dokumentu. Zacznij od statutu spółdzielni.</p>}
        {docs.map((d) => (
          <div key={d.id} className="card" style={d.supersededBy ? { opacity: 0.6 } : undefined}>
            <div className="row" style={{ alignItems: "center" }}>
              <h3 style={{ flex: "1 1 auto" }}>
                {d.title} <span className="chip">{RULES_KIND_LABEL[d.kind]}</span> {d.supersededBy && <span className="chip warn">zastąpiony</span>}
              </h3>
              <span style={{ flex: "0 0 auto", display: "flex", gap: 6 }}>
                {d.file && (
                  <a className="btn small" href={fileUrl(d.file.id)} target="_blank" rel="noreferrer">
                    📎 Oryginał
                  </a>
                )}
                <button className="btn small" onClick={() => setOpen(open === d.id ? null : d.id)}>
                  {open === d.id ? "Zwiń" : `Pokaż (${d.sections.length})`}
                </button>
                <button
                  className="btn small danger"
                  onClick={async () => {
                    if (!confirm(`Usunąć „${d.title}”?`)) return;
                    await action("deleteRules", { id: d.id });
                    await app.reload();
                  }}
                >
                  Usuń
                </button>
              </span>
            </div>
            <div className="muted">
              {d.validFrom ? `obowiązuje od ${formatDate(d.validFrom)} · ` : ""}wczytany {formatDate(d.importedAt.slice(0, 10))}
            </div>
            {open === d.id &&
              d.sections.map((s, i) => (
                <div key={i}>
                  <strong>{s.ref}</strong>
                  <div className="section-text">{s.text}</div>
                </div>
              ))}
          </div>
        ))}
      </div>
      {importing && (
        <ImportForm
          docs={docs}
          onClose={() => setImporting(false)}
          onSaved={async () => {
            setImporting(false);
            await app.reload();
          }}
        />
      )}
    </section>
  );
}
