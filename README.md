# Cerber

**Cerber pilnuje spraw, które zgłaszasz jako lokator do spółdzielni mieszkaniowej.** Każda sprawa ma oś czasu
(pisma, odpowiedzi, telefony, oględziny), terminy odpowiedzi liczone zgodnie z regulaminem spółdzielni i wyraźne
oznaczenie, gdy spółdzielnia termin przekroczyła. Odpowiedzi spółdzielni – zwykle skany – czyta i analizuje
Claude przez serwer MCP: sprawdza, czy odpowiedź dotyczy wszystkich punktów pisma, czy powołane paragrafy
mówią to, co twierdzi spółdzielnia, i wyłapuje zobowiązania z datami.

*Cerber keeps track of the issues a tenant raises with their Polish housing cooperative: a timeline per case,
reply deadlines from the cooperative's own rules, overdue flags, and scan analysis by Claude over MCP.*

## Jak to działa

```
 SZKIC ──► CZEKA NA ODPOWIEDŹ ──► ODPOWIEDŹ ──► ZAMKNIĘTA
                 │                    │
                 ▼                    ▼
           ⚠ PO TERMINIE         ESKALACJA (ponaglenie → odwołanie do Rady Nadzorczej → …)
```

- **Sprawy z osią czasu** – lista spraw po lewej (najpierw te po terminie), oś czasu wybranej sprawy po prawej.
- **Terminy** – liczone od daty złożenia/doręczenia pisma; koniec w sobotę lub święto przesuwa się na następny
  dzień roboczy. Termin może wynikać z regulaminu (reguła dla kategorii spraw) albo być **ustawiony ręcznie**,
  gdy regulamin nic nie mówi. Sprawa bez terminu jest oznaczona „bez terminu”.
- **Terminy w obie strony** – zobowiązania spółdzielni z jej pism („wymiana pionu do 30.11”) i Twoje terminy
  (np. na odwołanie) są pilnowane tak samo.
- **Regulaminy** – statut i regulaminy dzielone na paragrafy, z wyszukiwarką; starsze wersje zostają dla spraw
  ocenianych według nich.
- **Projekty pism** – Claude przygotowuje ponaglenia i odwołania, Ty je wysyłasz.

## Demo

Przycisk **🧪 Wczytaj demo** (w górnym pasku albo na pustej liście) dodaje fikcyjną spółdzielnię: regulamin
usterek, wyciąg ze statutu, reguły terminów i sześć spraw na każdym etapie. Daty liczone są od dzisiaj, więc
zawsze jest sprawa po terminie (z projektem ponaglenia), sprawa z terminem za kilka dni, sprawa bez terminu,
eskalacja do Rady Nadzorczej z gotową analizą i sprawa zamknięta. Sprawa z domofonem ma wygenerowany skan
odpowiedzi spółdzielni do przetestowania analizy przez MCP („przeanalizuj odpowiedź w sprawie #5”). Skan
powołuje się na nieistniejący § 9, więc Claude powinien to wyłapać.

**🧹 Usuń demo** usuwa tylko dane demo, czyli sprawy, regulaminy, reguły terminów i skan. Twoje sprawy zostają.

## Dane i prywatność

Wszystko jest lokalnie, w jednym pliku JSON: `~/.cerber/cerber.json` (sprawy, regulaminy, terminy), skany
w `~/.cerber/files/`, codzienna kopia w `~/.cerber/backups/`. Inny katalog: zmienna `CERBER_DATA_DIR`.
Aplikacja nasłuchuje tylko na `127.0.0.1`. Repozytorium zawiera wyłącznie kod.

## Uruchomienie

Wymaga [Bun](https://bun.sh) (i Node.js ≥ 20.9).

```sh
bun install
bun run build && bun run start     # http://127.0.0.1:3200
# albo w trybie deweloperskim: bun run dev
```

### Serwer MCP (Claude Code / Claude Desktop)

```sh
claude mcp add --scope user cerber -- bun /ścieżka/do/cerber/mcp/server.ts
```

Potem wystarczy napisać do Claude'a, np.:

- „Co nowego w Cerberze?” – przegląd: po terminie, zbliżające się terminy, odpowiedzi do analizy.
- „Wczytaj do Cerbera statut z `C:\Dokumenty\statut.pdf`” – także zeskanowany, Claude go odczyta.
- „Dodaj odpowiedź spółdzielni do sprawy #7, skan: `C:\Skany\odp.pdf`, otrzymana 20.10, i przeanalizuj ją.”
- „Przygotuj ponaglenie w sprawie #7.”

| Narzędzie | Co robi |
|---|---|
| `get_overview`, `list_cases`, `get_case` | przegląd i szczegóły spraw |
| `create_case`, `update_case` | nowa sprawa, etap, wynik |
| `add_event`, `update_event`, `attach_document` | zdarzenia na osi czasu, pliki z dysku |
| `read_document`, `read_scan` | strony skanu jako obrazy + warstwa tekstowa, z kontekstem sprawy |
| `save_analysis` | analiza odpowiedzi; zobowiązania i terminy trafiają do sprawy |
| `set_deadline` | dodanie / zmiana / spełnienie terminu |
| `save_draft` | projekt pisma |
| `import_rules`, `search_rules`, `get_rules`, `set_deadline_rule` | statut i regulaminy, reguły terminów |

## Rozwój

```sh
bun run check    # typecheck + lint + testy + build
```

Cerber nie jest poradą prawną. W sporach o pieniądze lub prawa do lokalu warto skonsultować się z prawnikiem
(np. w punkcie nieodpłatnej pomocy prawnej).

## Licencja

[GNU Affero General Public License v3.0 lub nowsza](LICENSE).
