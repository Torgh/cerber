"use client";
import { useState } from "react";
import { formatDate, plDays } from "@/lib/dates";
import { fold } from "@/lib/rules";
import type { CaseStatus } from "@/lib/status";
import { CATEGORY_LABEL, OUTCOME_LABEL, STAGE_LABEL, type Case } from "@/lib/types";

export function StatusChips({ c, s }: { c: Case; s: CaseStatus }) {
  const chips: React.ReactNode[] = [];
  const n = s.next;
  if (c.stage === "closed") {
    chips.push(
      <span key="closed" className="chip ok">
        ✓ {c.outcome ? OUTCOME_LABEL[c.outcome] : "zamknięta"}
      </span>,
    );
    return <>{chips}</>;
  }
  if (n) {
    const mine = n.deadline.party === "me" ? "mój termin: " : "";
    if (n.state === "late")
      chips.push(
        <span key="next" className="chip danger">
          ⚠ {mine}+{plDays(-n.left)} po terminie
        </span>,
      );
    else
      chips.push(
        <span key="next" className={`chip ${n.state === "soon" ? "warn" : "info"}`}>
          ⏳ {mine}
          {n.left === 0 ? "termin dziś" : `zostało ${plDays(n.left)}`}
        </span>,
      );
  }
  if (s.flags.includes("no-deadline"))
    chips.push(
      <span key="nd" className="chip warn">
        ❔ bez terminu
      </span>,
    );
  if (s.flags.includes("to-analyze"))
    chips.push(
      <span key="an" className="chip ai">
        📥 do analizy
      </span>,
    );
  return <>{chips}</>;
}

export default function CaseList({
  rows,
  selected,
  onSelect,
  onNew,
}: {
  rows: { c: Case; s: CaseStatus }[];
  selected: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
}) {
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"open" | "all" | "closed">("open");
  const fq = fold(q.trim());
  const visible = rows.filter(
    ({ c }) =>
      (show === "all" || (show === "open") === (c.stage !== "closed")) &&
      (!fq || fold(`${c.id} ${c.title} ${c.description ?? ""} ${c.events.map((e) => `${e.title} ${e.reference ?? ""}`).join(" ")}`).includes(fq)),
  );
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="row">
          <input type="search" placeholder="Szukaj…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Szukaj spraw" />
          <button className="btn primary" style={{ flex: "0 0 auto" }} onClick={onNew}>
            + Nowa
          </button>
        </div>
        <select value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label="Które sprawy">
          <option value="open">Otwarte</option>
          <option value="closed">Zamknięte</option>
          <option value="all">Wszystkie</option>
        </select>
      </div>
      <ul className="case-list">
        {visible.map(({ c, s }) => (
          <li key={c.id}>
            <button className={`case-item${c.stage === "closed" ? " closed" : ""}`} aria-current={c.id === selected} onClick={() => onSelect(c.id)}>
              <div className="title">
                <span className="num">#{c.id}</span>
                <span>{c.title}</span>
              </div>
              <div className="meta">
                <span className="chip">{STAGE_LABEL[c.stage]}</span>
                <StatusChips c={c} s={s} />
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {CATEGORY_LABEL[c.category]}
                {c.events.length ? ` · ostatnio ${formatDate(c.events[c.events.length - 1].date)}` : ""}
              </div>
            </button>
          </li>
        ))}
        {!visible.length && <li className="muted" style={{ padding: 12 }}>{rows.length ? "Brak spraw dla tego filtra." : "Nie ma jeszcze żadnych spraw."}</li>}
      </ul>
    </aside>
  );
}
