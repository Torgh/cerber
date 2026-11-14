/**
 * Example data for trying Cerber out: a fictional cooperative, its rules and six cases in every stage.
 * Dates are relative to today, so there is always something overdue, something due soon, a case without
 * a deadline and a reply waiting for analysis. Everything is marked `demo` and removeDemo() takes out
 * exactly that, leaving the user's own data alone.
 */
import { addDays } from "./dates";
import * as ops from "./ops";
import type { Case, Db, FileRef } from "./types";

export const DEMO_COOP = "Spółdzielnia Mieszkaniowa „Przykładowa” (DEMO)";

const RULES_DEFECTS = `Regulamin zgłaszania i usuwania usterek w lokalach i częściach wspólnych
§ 1. Regulamin określa tryb zgłaszania usterek przez członków i lokatorów Spółdzielni.
§ 2. Usterki zgłasza się pisemnie w biurze Spółdzielni, listem poleconym lub pocztą elektroniczną na adres biura.
§ 3. Zgłoszenie powinno zawierać opis usterki, adres lokalu oraz dane kontaktowe zgłaszającego.
§ 4. Spółdzielnia rozpatruje zgłoszenie i udziela pisemnej odpowiedzi w terminie 14 dni od dnia jego doręczenia. W odpowiedzi wskazuje sposób i przewidywany termin usunięcia usterki.
§ 5. Awarie zagrażające zdrowiu, życiu lub mieniu (zalanie, brak ogrzewania, awaria instalacji gazowej) usuwa się niezwłocznie, nie później niż w ciągu 24 godzin od zgłoszenia.
§ 6. Naprawy instalacji domofonowej w częściach wspólnych budynku wykonuje Spółdzielnia na swój koszt, w terminie nie dłuższym niż 30 dni od dnia zgłoszenia.
§ 7. Szkody w lokalu powstałe wskutek awarii instalacji, za które odpowiada Spółdzielnia, Spółdzielnia naprawia lub pokrywa ich koszt po przeprowadzeniu oględzin z udziałem lokatora.
§ 8. Od stanowiska Zarządu w sprawie zgłoszenia przysługuje odwołanie do Rady Nadzorczej w terminie 14 dni od dnia doręczenia odpowiedzi.`;

const RULES_STATUTE = `Statut Spółdzielni (wyciąg)
§ 12. Członek ma prawo otrzymać kopie uchwał organów Spółdzielni i protokołów obrad organów Spółdzielni, protokołów lustracji oraz rocznych sprawozdań finansowych. Koszty sporządzenia kopii pokrywa członek, z wyjątkiem statutu i regulaminów.
§ 14. 1. Członek ma prawo składać do organów Spółdzielni wnioski i skargi w sprawach związanych z działalnością Spółdzielni.
2. Zarząd rozpatruje skargę i udziela odpowiedzi w terminie 30 dni od dnia jej złożenia.
3. Od odmownej odpowiedzi Zarządu członkowi przysługuje odwołanie do Rady Nadzorczej w terminie 30 dni od dnia jej doręczenia.
§ 15. Rada Nadzorcza rozpatruje odwołanie w terminie 30 dni od dnia jego wniesienia. Stanowisko Rady Nadzorczej jest ostateczne w postępowaniu wewnątrzspółdzielczym.
§ 21. Spółdzielnia rozlicza koszty zużycia wody według wskazań wodomierzy indywidualnych, a różnicę między wskazaniem wodomierza głównego a sumą wskazań wodomierzy indywidualnych rozlicza proporcjonalnie do liczby osób zamieszkałych w lokalach.
§ 22. Lokator może zgłosić zastrzeżenia do rozliczenia w terminie 14 dni od dnia jego doręczenia.`;

/** The text of the demo scan: the cooperative's reply about the intercom. */
export function demoScanLines(today: string): string[] {
  const sent = addDays(today, -3);
  const fixBy = addDays(today, 20);
  const pl = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
  return [
    "Spółdzielnia Mieszkaniowa „Przykładowa”",
    "ul. Przykładowa 1, 00-000 Miasto (DANE DEMONSTRACYJNE)",
    "",
    `Miasto, dnia ${pl(sent)}`,
    "L.dz. TE/0412/2026",
    "",
    "Pan/Pani",
    "Lokator lokalu nr 12, ul. Przykładowa 5",
    "",
    "Dotyczy: zgłoszenia niedziałającego domofonu na klatce B",
    "",
    `W odpowiedzi na zgłoszenie z dnia ${pl(addDays(today, -18))} uprzejmie informujemy,`,
    "że usterka instalacji domofonowej na klatce B została potwierdzona podczas",
    "przeglądu technicznego. Naprawa wymaga wymiany kasety zewnętrznej,",
    "która została zamówiona u dostawcy.",
    "",
    `Przewidywany termin naprawy: do dnia ${pl(fixBy)}.`,
    "",
    "Jednocześnie informujemy, że zgodnie z § 9 Regulaminu usuwania usterek koszt",
    "wymiany słuchawki domofonowej w lokalu ponosi lokator.",
    "",
    "Z poważaniem",
    "Kierownik Działu Technicznego",
    "",
    "Odpowiedź wygenerowana jako przykład – dane fikcyjne.",
  ];
}

const at = (date: string) => `${date}T09:00:00.000Z`;

export function hasDemo(db: Db): boolean {
  return db.cases.some((c) => c.demo) || db.rules.some((r) => r.demo);
}

/** Adds the demo; `scan` is the stored image of the intercom reply (demoScanLines). */
export function addDemo(db: Db, today: string, scan?: FileRef): Case[] {
  if (hasDemo(db)) throw new ops.OpError("Dane demo są już wczytane.");
  const d = (n: number) => addDays(today, n);

  for (const [title, kind, text] of [
    ["Regulamin usuwania usterek (DEMO)", "rules", RULES_DEFECTS],
    ["Statut – wyciąg (DEMO)", "statute", RULES_STATUTE],
  ] as const) {
    ops.addRules(db, { title, kind, text, validFrom: "2024-01-01" }).demo = true;
  }
  for (const [category, days, source] of [
    ["defect", 14, "Regulamin usuwania usterek § 4 (DEMO)"],
    ["complaint", 30, "Statut § 14 ust. 2 (DEMO)"],
  ] as const) {
    if (!db.deadlineRules.some((r) => r.category === category)) db.deadlineRules.push({ category, days, source, demo: true });
  }

  const cases: Case[] = [];
  const make = (title: string, category: Case["category"], description: string, start: string) => {
    const c = ops.createCase(db, { title, category, description });
    c.demo = true;
    c.createdAt = at(start);
    cases.push(c);
    return c;
  };

  // 1. Overdue: no reply long after the 14 days, with a draft reminder.
  const leak = make(
    "Przeciek z pionu kanalizacyjnego w łazience",
    "defect",
    "Z pionu kanalizacyjnego w łazience sączy się woda, zaciek na suficie ok. 1 m². Żądam naprawy pionu i odmalowania sufitu na koszt Spółdzielni (Regulamin § 7).",
    d(-40),
  );
  ops.addEvent(db, leak.id, {
    date: d(-40),
    kind: "submitted",
    title: "Zgłoszenie przecieku",
    method: "in_person",
    description: "Złożone w biurze, kopia z pieczątką wpływu.",
  });
  ops.addEvent(db, leak.id, {
    date: d(-25),
    kind: "call",
    title: "Telefon do administracji",
    description: "Pani z administracji: „hydraulik przyjdzie w przyszłym tygodniu”. Nikt nie przyszedł.",
  });
  ops.addDraft(
    db,
    leak.id,
    "Ponaglenie – przeciek z pionu",
    `${DEMO_COOP}
Zarząd

PONAGLENIE

Dotyczy: mojego zgłoszenia z dnia ${d(-40)} w sprawie przecieku z pionu kanalizacyjnego w łazience lokalu nr 12.

Zgodnie z § 4 Regulaminu usuwania usterek Spółdzielnia miała obowiązek udzielić pisemnej odpowiedzi w terminie 14 dni od dnia doręczenia zgłoszenia. Termin ten upłynął, a odpowiedzi nie otrzymałem/am. Usterka nie została usunięta.

Wzywam do udzielenia odpowiedzi i usunięcia usterki w terminie 7 dni od dnia doręczenia niniejszego pisma, a także do przeprowadzenia oględzin szkód w lokalu (§ 7 Regulaminu).

Z poważaniem
(podpis)`,
  );

  // 2. Due soon: deadline set by hand (the statute's 14 days are for my objections, not for the reply).
  const water = make(
    "Zawyżone rozliczenie wody za I półrocze",
    "billing",
    "Rozliczenie nalicza dopłatę 412 zł za różnicę wodomierza głównego, choć zużycie wg wodomierzy w lokalu się nie zmieniło. Proszę o korektę i wyjaśnienie sposobu podziału różnicy (Statut § 21).",
    d(-26),
  );
  ops.addEvent(db, water.id, {
    date: d(-26),
    kind: "submitted",
    title: "Zastrzeżenia do rozliczenia wody",
    method: "registered",
    reference: "RR 1234 5678 9",
    description: "List polecony za potwierdzeniem odbioru; data z potwierdzenia odbioru.",
    replyDeadline: { days: 30, basis: "manual", source: "regulamin nie określa – ustawione ręcznie" },
  });

  // 3. Waiting without a deadline.
  const docs = make(
    "Kopie uchwał Zarządu z 2026 r.",
    "documents",
    "Wniosek o kopie uchwał Zarządu dotyczących remontu dachu (Statut § 12).",
    d(-6),
  );
  ops.addEvent(db, docs.id, { date: d(-6), kind: "submitted", title: "Wniosek o kopie uchwał", method: "email", replyDeadline: null });

  // 4. A reply with a scan waiting for Claude's analysis.
  const intercom = make(
    "Niedziałający domofon na klatce B",
    "defect",
    "Domofon na klatce B nie otwiera drzwi od dwóch tygodni. Żądam naprawy instalacji w częściach wspólnych (Regulamin § 6).",
    d(-18),
  );
  ops.addEvent(db, intercom.id, { date: d(-18), kind: "submitted", title: "Zgłoszenie awarii domofonu", method: "email" });
  ops.addEvent(db, intercom.id, {
    date: d(-1),
    kind: "response",
    title: "Odpowiedź Działu Technicznego",
    reference: "TE/0412/2026",
    method: "mailbox",
    files: scan ? [scan] : [],
  });

  // 5. Escalated: complaint refused, analysis done, appeal sent to the Supervisory Board.
  const noise = make(
    "Hałas z lokalu usługowego – skarga",
    "complaint",
    "Lokal usługowy na parterze (siłownia) pracuje do 23:00, hałas i drgania w mieszkaniu. Proszę o egzekwowanie regulaminu porządku domowego wobec najemcy.",
    d(-70),
  );
  ops.addEvent(db, noise.id, { date: d(-70), kind: "submitted", title: "Skarga na hałas", method: "in_person" });
  const refusal = ops.addEvent(db, noise.id, {
    date: d(-45),
    kind: "response",
    title: "Odpowiedź Zarządu – odmowa",
    reference: "ZA/0233/2026",
    description: "Zarząd uznaje, że najemca nie narusza umowy najmu, i odmawia podjęcia działań.",
  }).event;
  ops.saveAnalysis(db, noise.id, refusal.id, {
    summary:
      "Zarząd odmawia działań, powołując się wyłącznie na umowę najmu. Nie odnosi się do pomiaru hałasu ani do godzin ciszy nocnej. Odpowiedź przyszła w terminie (30 dni, Statut § 14 ust. 2). Przysługuje odwołanie do Rady Nadzorczej w 30 dni.",
    points: [
      { point: "Egzekwowanie regulaminu porządku domowego", answered: "no", note: "pominięte – odpowiedź dotyczy tylko umowy najmu" },
      { point: "Godziny pracy lokalu", answered: "partly", note: "„zgodne z umową”, bez podania godzin" },
    ],
    issues: [{ text: "Brak pouczenia o prawie do odwołania do Rady Nadzorczej", source: "Statut § 14 ust. 3 (DEMO)" }],
    nextStep: "Odwołanie do Rady Nadzorczej, z prośbą o pomiar hałasu i wskazanie godzin ciszy nocnej.",
    myDeadlines: [{ label: "Odwołanie do Rady Nadzorczej", due: d(-15), source: "Statut § 14 ust. 3 (DEMO)" }],
  });
  const appeal = ops.addEvent(db, noise.id, {
    date: d(-20),
    kind: "appeal",
    title: "Odwołanie do Rady Nadzorczej",
    method: "in_person",
    replyDeadline: { days: 30, basis: "rules", source: "Statut § 15 (DEMO)" },
  }).event;
  for (const dl of noise.deadlines) {
    if (dl.party === "me" && !dl.doneAt) {
      dl.doneAt = appeal.date;
      dl.doneEventId = appeal.id;
    }
  }

  // 6. Closed, resolved.
  const win = make("Wymiana nieszczelnego okna w kuchni", "defect", "Okno w kuchni nie domyka się, przewiew. Wniosek o wymianę w ramach planu remontów.", d(-200));
  ops.addEvent(db, win.id, { date: d(-200), kind: "submitted", title: "Wniosek o wymianę okna", method: "in_person" });
  ops.addEvent(db, win.id, {
    date: d(-190),
    kind: "response",
    title: "Odpowiedź – wymiana w planie remontów",
    description: "Wymiana okna ujęta w planie na II kwartał.",
  });
  ops.addEvent(db, win.id, { date: d(-120), kind: "inspection", title: "Wymiana okna wykonana", description: "Okno wymienione, protokół odbioru podpisany." });
  ops.updateCase(db, win.id, { stage: "closed", outcome: "resolved" });

  return cases;
}

/** Removes everything marked demo. Returns the files to delete from disk. */
export function removeDemo(db: Db): FileRef[] {
  const files: FileRef[] = [];
  for (const c of db.cases.filter((x) => x.demo)) for (const e of c.events) files.push(...e.files);
  for (const r of db.rules.filter((x) => x.demo)) if (r.file) files.push(r.file);
  const gone = new Set(db.cases.filter((c) => c.demo).map((c) => c.id));
  db.cases = db.cases.filter((c) => !c.demo);
  for (const c of db.cases) if (c.related?.some((id) => gone.has(id))) c.related = c.related.filter((id) => !gone.has(id)).length ? c.related.filter((id) => !gone.has(id)) : undefined;
  for (const p of db.people.filter((x) => x.demo)) ops.deletePerson(db, p.id);
  const removed = new Set(db.rules.filter((r) => r.demo).map((r) => r.id));
  db.rules = db.rules.filter((r) => !r.demo);
  for (const r of db.rules) if (r.supersededBy && removed.has(r.supersededBy)) r.supersededBy = undefined;
  db.deadlineRules = db.deadlineRules.filter((r) => !r.demo);
  db.nextCaseId = db.cases.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  db.updatedAt = new Date().toISOString();
  return files;
}
