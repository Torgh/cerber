"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { caseRank, caseStatus } from "@/lib/status";
import type { Db } from "@/lib/types";
import { demo, loadState } from "./api";
import CaseList from "./CaseList";
import CaseView from "./CaseView";
import { CaseForm } from "./forms";
import { Auto, Book, List, Moon, Shield, Sun } from "./icons";
import RulesView from "./RulesView";
import { useTheme } from "./useTheme";

export interface AppState {
  db: Db;
  today: string;
  reload: () => Promise<void>;
}

function hashCase(): number | null {
  const m = /^#sprawa-(\d+)$/.exec(window.location.hash);
  return m ? Number(m[1]) : null;
}

const THEME_LABEL = { system: "Motyw: jak w systemie", light: "Motyw: jasny", dark: "Motyw: ciemny" } as const;

export default function App() {
  const [state, setState] = useState<{ db: Db; today: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"cases" | "rules">("cases");
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [theme, cycleTheme] = useTheme();

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

  const rows = useMemo(() => {
    if (!state) return [];
    return state.db.cases
      .map((c) => ({ c, s: caseStatus(c, state.today) }))
      .sort((a, b) => caseRank(a.c, a.s) - caseRank(b.c, b.s) || (a.s.next?.left ?? 1e9) - (b.s.next?.left ?? 1e9) || b.c.id - a.c.id);
  }, [state]);

  const runDemo = async (load: boolean) => {
    if (!load && !confirm("Usunąć dane demo? Twoje własne sprawy i regulaminy zostaną.")) return;
    setDemoBusy(true);
    try {
      const r = await demo(load);
      await reload();
      setTab("cases");
      select(load ? (r.first ?? null) : null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDemoBusy(false);
    }
  };

  if (!state) return <div className="empty">{error ? <p className="error">{error}</p> : "Ładowanie…"}</div>;
  const app: AppState = { ...state, reload };
  const current = state.db.cases.find((c) => c.id === selected);
  const hasDemo = state.db.cases.some((c) => c.demo) || state.db.rules.some((r) => r.demo);
  const overdue = rows.filter((r) => r.s.flags.includes("overdue") || r.s.flags.includes("my-overdue")).length;

  return (
    <div className="shell">
      <nav className="rail" aria-label="Główna">
        <span className="logo" title="Cerber">
          <Shield size={28} />
        </span>
        <button className="rail-btn" aria-label="Sprawy" title="Sprawy" aria-current={tab === "cases" ? "page" : undefined} onClick={() => setTab("cases")}>
          <List />
          {overdue > 0 && <span className="badge">{overdue}</span>}
        </button>
        <button className="rail-btn" aria-label="Regulaminy" title="Regulaminy" aria-current={tab === "rules" ? "page" : undefined} onClick={() => setTab("rules")}>
          <Book />
        </button>
        <span className="spacer" />
        <button className="rail-btn" aria-label={THEME_LABEL[theme]} title={THEME_LABEL[theme]} onClick={cycleTheme}>
          {theme === "light" ? <Sun /> : theme === "dark" ? <Moon /> : <Auto />}
        </button>
      </nav>

      {tab === "cases" ? (
        <div className={`main${current ? " has-case" : ""}`}>
          <CaseList
            rows={rows}
            today={state.today}
            selected={selected}
            onSelect={select}
            onNew={() => setCreating(true)}
            demo={{ has: hasDemo, busy: demoBusy, run: runDemo }}
          />
          <section className="detail">
            {error && <div className="error">{error}</div>}
            {current ? (
              <CaseView key={current.id} app={app} c={current} onBack={() => select(null)} />
            ) : (
              <div className="empty">
                <div>
                  <p>{state.db.cases.length ? "Wybierz sprawę z listy albo dodaj nową." : "Nie ma jeszcze żadnych spraw."}</p>
                  <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                    <button className="btn primary" onClick={() => setCreating(true)}>
                      Nowa sprawa
                    </button>
                    {!hasDemo && (
                      <button className="btn" disabled={demoBusy} onClick={() => runDemo(true)}>
                        Wczytaj dane demo
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="main single">
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
