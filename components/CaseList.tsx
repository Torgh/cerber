"use client";
import { useState } from "react";
import { formatDate } from "@/lib/dates";
import { fold } from "@/lib/rules";
import type { CaseStatus } from "@/lib/status";
import { CATEGORY_LABEL, STAGE_LABEL, type Case } from "@/lib/types";
import { countdownOf } from "./countdown";
import { Flask } from "./icons";

interface Row {
  c: Case;
  s: CaseStatus;
}

function group(r: Row): "act" | "open" | "closed" {
  if (r.c.stage === "closed") return "closed";
  const f = r.s.flags;
  return f.includes("overdue") || f.includes("my-overdue") || f.includes("to-analyze") || f.includes("no-deadline") ? "act" : "open";
}

const GROUP_LABEL = { act: "Wymaga działania", open: "W toku", closed: "Zamknięte" };

function Item({ r, today, current, onSelect }: { r: Row; today: string; current: boolean; onSelect: () => void }) {
  const { c, s } = r;
  const cd = countdownOf(c, s, today);
  const last = c.events[c.events.length - 1];
  return (
    <li>
      <button className={`case-item${c.stage === "closed" ? " closed" : ""}`} aria-current={current} onClick={onSelect}>
        <span style={{ minWidth: 0 }}>
          <span className="title">{c.title}</span>
          <span className="meta" style={{ display: "block" }}>
            #{c.id} · {CATEGORY_LABEL[c.category]}
            {c.stage === "draft" ? ` · ${STAGE_LABEL.draft.toLowerCase()}` : last ? ` · ${formatDate(last.date).slice(0, 6)}` : ""}
          </span>
          {cd.used !== undefined && (
            <span className="bar" style={{ display: "block" }}>
              <span className={`fill-${cd.barTone}`} style={{ width: `${Math.max(4, cd.used * 100)}%` }} />
            </span>
          )}
        </span>
        <span className="count">
          <span className={`num tone-${cd.tone}`} style={{ display: "block", fontSize: cd.num.length > 3 ? 15 : undefined, paddingTop: cd.num.length > 3 ? 6 : 0 }}>
            {cd.num}
          </span>
          <span className="what" style={{ display: "block" }}>
            {cd.what}
          </span>
        </span>
      </button>
    </li>
  );
}

export default function CaseList({
  rows,
  today,
  selected,
  onSelect,
  onNew,
  demo,
}: {
  rows: Row[];
  today: string;
  selected: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
  demo: { has: boolean; busy: boolean; run: (load: boolean) => void };
}) {
  const [q, setQ] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const fq = fold(q.trim());
  const visible = rows.filter(
    ({ c }) => !fq || fold(`${c.id} ${c.title} ${c.description ?? ""} ${c.events.map((e) => `${e.title} ${e.reference ?? ""}`).join(" ")}`).includes(fq),
  );
  const open = rows.filter((r) => r.c.stage !== "closed");
  const late = open.filter((r) => r.s.flags.includes("overdue")).length;
  const groups = (["act", "open", "closed"] as const).map((g) => ({ g, items: visible.filter((r) => group(r) === g) })).filter((x) => x.items.length);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="top">
          <div>
            <h1>Sprawy</h1>
            <div className="muted" style={{ fontSize: 12 }}>
              {open.length} {open.length === 1 ? "otwarta" : "otwartych"}
              {late ? ` · ${late} po terminie` : ""}
            </div>
          </div>
          <button className="btn primary" onClick={onNew}>
            Nowa
          </button>
        </div>
        <input type="search" placeholder="Szukaj w sprawach i pismach" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Szukaj spraw" />
      </div>
      <ul className="case-list">
        {groups.map(({ g, items }) => (
          <li key={g}>
            <div className="label group-label">
              {g === "closed" ? (
                <button className="btn link" style={{ color: "inherit", font: "inherit", letterSpacing: "inherit" }} onClick={() => setShowClosed((v) => !v)} aria-expanded={showClosed || !!fq}>
                  {GROUP_LABEL[g]} · {items.length} {showClosed || fq ? "▾" : "▸"}
                </button>
              ) : (
                `${GROUP_LABEL[g]} · ${items.length}`
              )}
            </div>
            {(g !== "closed" || showClosed || fq) && (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {items.map((r) => (
                  <Item key={r.c.id} r={r} today={today} current={r.c.id === selected} onSelect={() => onSelect(r.c.id)} />
                ))}
              </ul>
            )}
          </li>
        ))}
        {!visible.length && (
          <li className="muted" style={{ padding: 12 }}>
            {rows.length ? "Nic nie znaleziono." : "Nie ma jeszcze żadnych spraw."}
          </li>
        )}
      </ul>
      <div className="sidebar-foot">
        <span>Dane lokalne · ~/.cerber</span>
        <button className="btn small ghost" disabled={demo.busy} onClick={() => demo.run(!demo.has)} title={demo.has ? "Usuwa tylko dane demo" : "Przykładowe sprawy, regulamin i skan do analizy"}>
          <Flask size={16} /> {demo.busy ? "…" : demo.has ? "Usuń demo" : "Wczytaj demo"}
        </button>
      </div>
    </aside>
  );
}
