/** Splitting the cooperative's statute and rules into paragraphs, and searching them. */
import type { RulesDoc, RulesSection } from "./types";

const HEAD = /^[ \t]*(§[ \t]*\d+[a-z]?|Art\.[ \t]*\d+[a-z¹²³⁴⁵⁶⁷⁸⁹⁰]*)[ \t.]*/gim;

/** "§ 12" → "§ 12"; "§12." → "§ 12"; "Art.8¹" → "Art. 8¹". */
function cleanRef(raw: string): string {
  const s = raw.trim().replace(/\.$/, "");
  if (s.startsWith("§")) return `§ ${s.slice(1).trim()}`;
  return s.replace(/^Art\.\s*/i, "Art. ");
}

export function splitSections(text: string): RulesSection[] {
  const t = text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (!t) return [];
  const heads = [...t.matchAll(HEAD)];
  if (heads.length < 2) return chunk(t);
  const out: RulesSection[] = [];
  const pre = t.slice(0, heads[0].index).trim();
  if (pre) out.push({ ref: "Wstęp", text: pre });
  heads.forEach((m, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index : t.length;
    const body = t.slice(m.index + m[0].length, end).trim();
    out.push({ ref: cleanRef(m[1]), text: body });
  });
  return out;
}

/** A text without paragraphs: pieces of about 1500 characters, cut at blank lines. */
function chunk(t: string): RulesSection[] {
  const parts = t.split(/\n\s*\n/);
  const out: RulesSection[] = [];
  let cur = "";
  for (const p of parts) {
    if (cur && cur.length + p.length > 1500) {
      out.push({ ref: `fragment ${out.length + 1}`, text: cur.trim() });
      cur = "";
    }
    cur += (cur ? "\n\n" : "") + p;
  }
  if (cur.trim()) out.push({ ref: `fragment ${out.length + 1}`, text: cur.trim() });
  return out;
}

export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Polish words change their endings; matching on the start of each word finds "terminu" for "termin". */
function stem(w: string): string {
  return w.length > 6 ? w.slice(0, Math.max(5, w.length - 3)) : w;
}

export interface RulesHit {
  docId: string;
  docTitle: string;
  ref: string;
  text: string;
  score: number;
}

export function searchRules(docs: RulesDoc[], query: string, limit = 8, includeOld = false): RulesHit[] {
  const terms = [...new Set(fold(query).split(/[^a-z0-9§]+/).filter((w) => w.length >= 3).map(stem))];
  const refQuery = /§\s*(\d+[a-z]?)/i.exec(query)?.[1];
  const hits: RulesHit[] = [];
  for (const doc of docs) {
    if (doc.supersededBy && !includeOld) continue;
    for (const s of doc.sections) {
      const hay = fold(s.text);
      let score = 0;
      for (const term of terms) {
        const n = hay.split(term).length - 1;
        if (n) score += 1 + Math.min(n, 5) * 0.2;
      }
      if (refQuery && s.ref === `§ ${refQuery}`) score += 10;
      if (score > 0) hits.push({ docId: doc.id, docTitle: doc.title, ref: s.ref, text: s.text, score });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
