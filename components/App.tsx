"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { caseRank, caseStatus } from "@/lib/status";
import type { Db } from "@/lib/types";
import { loadState } from "./api";
import CaseList from "./CaseList";
import CaseView from "./CaseView";
import { CaseForm } from "./forms";
import RulesView from "./RulesView";

export interface AppState {
  db: Db;
  today: string;
  reload: () => Promise<void>;
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" />
      <circle cx="8.5" cy="10" r="1" fill="currentColor" />
      <circle cx="12" cy="9" r="1" fill="currentColor" />
      <circle cx="15.5" cy="10" r="1" fill="currentColor" />
    </svg>
  );
}

function hashCase(): number | null {
  const m = /^#sprawa-(\d+)$/.exec(window.location.hash);
  return m ? Number(m[1]) : null;
}

export default function App() {
  const [state, setState] = useState<{ db: Db; today: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"cases" | "rules">("cases");
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    try {
      const s = await loadState();
      if (s) setState(s);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // Claude changes the data through MCP; the page picks it up within a few seconds.
  useEffect(() => {
    let since: string | undefined;
    let stop = false;
    const tick = async () => {
      try {
        const s = await loadState(since);
        if (s && !stop) {
          since = s.db.updatedAt;
          setState(s);
        }
        setError(null);
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
    };
    void tick();
    const id = setInterval(tick, 3000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const sync = () => setSelected(hashCase());
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const select = (id: number | null) => {
    window.location.hash = id ? `sprawa-${id}` : "";
    setSelected(id);
  };

  const counts = useMemo(() => {
    if (!state) return { overdue: 0, soon: 0, analyze: 0 };
    let overdue = 0;
    let soon = 0;
    let analyze = 0;
    for (const c of state.db.cases) {
      const s = caseStatus(c, state.today);
      if (s.flags.includes("overdue") || s.flags.includes("my-overdue")) overdue++;
      else if (s.flags.includes("soon") || s.flags.includes("my-soon")) soon++;
      if (s.flags.includes("to-analyze")) analyze++;
    }
    return { overdue, soon, analyze };
  }, [state]);

  const sorted = useMemo(() => {
    if (!state) return [];
    return state.db.cases
      .map((c) => ({ c, s: caseStatus(c, state.today) }))
      .sort((a, b) => caseRank(a.c, a.s) - caseRank(b.c, b.s) || (a.s.next?.left ?? 1e9) - (b.s.next?.left ?? 1e9) || b.c.id - a.c.id);
  }, [state]);

  if (!state) return <div className="empty">{error ? <p className="error">{error}</p> : "Ładowanie…"}</div>;
  const app: AppState = { ...state, reload };
  const current = state.db.cases.find((c) => c.id === selected);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <Logo /> Cerber
        </div>
        <nav className="tabs" role="tablist">
          <button className="tab" role="tab" aria-selected={tab === "cases"} onClick={() => setTab("cases")}>
            Sprawy
          </button>
          <button className="tab" role="tab" aria-selected={tab === "rules"} onClick={() => setTab("rules")}>
            Regulaminy {state.db.rules.length ? `(${state.db.rules.filter((r) => !r.supersededBy).length})` : ""}
          </button>
        </nav>
        <div className="counters">
          {counts.overdue > 0 && <span className="chip danger">⚠ {counts.overdue} po terminie</span>}
          {counts.soon > 0 && <span className="chip warn">⏳ {counts.soon} w ciągu 7 dni</span>}
          {counts.analyze > 0 && <span className="chip ai">📥 {counts.analyze} do analizy</span>}
        </div>
      </header>
      {error && <div className="error">{error}</div>}
      {tab === "cases" ? (
        <div className={`main${current ? " has-case" : ""}`}>
          <CaseList rows={sorted} selected={selected} onSelect={select} onNew={() => setCreating(true)} />
          <section className="detail">
            {current ? (
              <CaseView key={current.id} app={app} c={current} onBack={() => select(null)} />
            ) : (
              <div className="empty">
                <div>
                  <p>Wybierz sprawę z listy albo dodaj nową.</p>
                  <button className="btn primary" onClick={() => setCreating(true)}>
                    + Nowa sprawa
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="main">
          <RulesView app={app} />
        </div>
      )}
      {creating && (
        <CaseForm
          onClose={() => setCreating(false)}
          onSaved={async (id) => {
            setCreating(false);
            await reload();
            setTab("cases");
            select(id);
          }}
        />
      )}
    </div>
  );
}
