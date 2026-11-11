/**
 * Calendar-day deadlines the Polish way: a deadline of N days ends N days after the starting day, and
 * when it falls on a Saturday or a public holiday it moves to the next working day (Kodeks cywilny
 * art. 111 § 2 and art. 115). Dates are "YYYY-MM-DD" strings, handled in UTC so time zones never shift them.
 */

export function parseDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`Nieprawidłowa data: ${s} (oczekiwano RRRR-MM-DD)`);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCMonth() !== +m[2] - 1) throw new Error(`Nieprawidłowa data: ${s}`);
  return d;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isValidDate(s: string): boolean {
  try {
    parseDate(s);
    return true;
  } catch {
    return false;
  }
}

export function addDays(s: string, days: number): string {
  const d = parseDate(s);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000);
}

/** Today in Poland. */
export function today(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(now);
}

/** Easter Sunday (anonymous Gregorian algorithm). */
function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const holidayCache = new Map<number, Set<string>>();

/** Public holidays in Poland (ustawa o dniach wolnych od pracy), including Wigilia from 2025. */
export function holidays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const fixed = ["01-01", "01-06", "05-01", "05-03", "08-15", "11-01", "11-11", "12-25", "12-26"];
  if (year >= 2025) fixed.push("12-24");
  const set = new Set(fixed.map((md) => `${year}-${md}`));
  const e = isoDate(easter(year));
  set.add(e);
  set.add(addDays(e, 1)); // Poniedziałek Wielkanocny
  set.add(addDays(e, 49)); // Zielone Świątki
  set.add(addDays(e, 60)); // Boże Ciało
  holidayCache.set(year, set);
  return set;
}

export function isWorkingDay(s: string): boolean {
  const day = parseDate(s).getUTCDay();
  if (day === 0 || day === 6) return false;
  return !holidays(+s.slice(0, 4)).has(s);
}

/** The last day of a deadline of `days` days counted from `start`, moved past weekends and holidays. */
export function deadlineFrom(start: string, days: number): string {
  let due = addDays(start, days);
  while (!isWorkingDay(due)) due = addDays(due, 1);
  return due;
}

const MONTHS = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];

/** "02 paź 2026" */
export function formatDate(s: string): string {
  const d = parseDate(s);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "1 dzień", "2 dni", "5 dni" */
export function plDays(n: number): string {
  const a = Math.abs(n);
  return `${n} ${a === 1 ? "dzień" : "dni"}`;
}
