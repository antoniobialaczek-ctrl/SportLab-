# SportLab 3.1

Rozbudowa istniejącego SportLab. Zachowany polski interfejs, filtry dyscyplin i lig, wyniki meczów oraz szczegóły drużyn i zawodników. Nie wymaga płatnych kluczy API, bazy danych ani nowych usług. Kod strony został odzyskany z istniejącego wdrożenia `sportlab-2-analizy` na Vercel; nie zastępuje go nowa aplikacja.

## Uruchomienie i sprawdzenie

Wymagany Node.js 24. Projekt nie ma zewnętrznych zależności npm.

```sh
npm ci --ignore-scripts
npm run check
npm run dev
```

Strona lokalna: `http://localhost:3000`. `npm run check` sprawdza składnię JavaScript, uruchamia automatyczne testy i buduje katalog `dist/`. Serwer lokalny obsługuje te same endpointy `api/` co Vercel. Pliki `src/` zawierają wspólną logikę, `public/` — zasoby dotychczasowego interfejsu, a `data/` — zbiory historyczne i raporty.

## Dane historyczne i raporty

```sh
# Uzupełnienie ostatnich siedmiu zakończonych dni UTC
npm run data:ingest

# Pierwsze pobranie wybranego okresu
npm run data:ingest -- --from 2025-10-01 --to 2026-11-17

# Wybrana dyscyplina i liga
npm run data:ingest -- --sports football --routes soccer/eng.1 --from 2025-08-01 --to 2026-05-31

# Ocena na zapisanych danych; brak pobrań sieciowych
npm run models:evaluate
npm run check
```

Zakres dat jest domknięty. Harmonogram i dane działają w UTC. Importer scala rekordy po stabilnym ID, sprawdza wynik i uczestników, ogranicza równoległe pobrania i stosuje timeouty. Przy błędzie źródła zachowuje poprzedni kompletny zbiór danej dyscypliny i kończy się kodem błędu. Nie generuje zastępczych wyników.

Źródłem wyników jest bezpłatny, nieoficjalny ESPN API. NBA, NHL i 10 dostępnych lig piłkarskich mają osobne zbiory i modele. Domyślny import obejmuje wszystkie działające ligi; `--routes` zawęża zakres. ESPN nie obsługuje Ekstraklasy pod dotychczasową trasą — ta liga pozostaje jawnie niedostępna. Tenis wymaga poprawnie oznaczonych zakończonych pojedynczych meczów. CS2 pozostaje niedostępne do czasu pozyskania wiarygodnego darmowego źródła. Ograniczenia źródeł są opisane w [docs/sources.md](docs/sources.md).

Raport `data/reports/models.json` pochodzi wyłącznie z ponownego wykonania oceny na lokalnej historii. Dawnych, ręcznie wpisanych liczb skuteczności nie uznajemy za wyniki zweryfikowanego testu. Brak historii lub zbyt mała próba skutkują jawnym statusem braku walidacji.

## Interpretacja testów

Modele działają oddzielnie dla sportów i lig. Prognoza historyczna może użyć tylko wyniku dostępnego przed początkiem danego meczu. Zbiory treningowy, kalibracyjny i końcowy test są rozdzielone chronologicznie. Kalibracja jest wybierana przed końcowym testem; wynik testu nie służy do jej dopasowania. Raport pokazuje liczebność próby, jakość prognoz, skuteczność i punkt odniesienia.

ESPN nie dostarcza dla wszystkich rekordów historycznego momentu udostępnienia wyniku. Przybliżenie `początek meczu + 24 godziny` ogranicza ryzyko użycia niezakończonego meczu, ale nie potwierdza stanu źródła w przeszłości ani braku późniejszych korekt. Raporty na takiej historii są badawcze. Bieżące prawdopodobieństwa pozostają wstrzymane, dopóki warunki publikacji i wiarygodność danych nie zostaną spełnione. Statystyki drużyn i zawodników są opisem danych, nie gwarancją przyszłego wyniku.

## Automatyzacja bez publikowania produkcji

Workflow [history.yml](.github/workflows/history.yml) działa co cztery godziny, o 00:17, 04:17, 08:17, 12:17, 16:17 i 20:17 UTC. Przywraca ostatni stan, zapisuje surowe migawki i niezmienne prognozy badawcze przed meczem, aktualizuje historię, ocenia modele i uruchamia testy. Surowe odpowiedzi i rejestr prognoz pozostają w artefaktach, poza stroną i źródłami aplikacji. Rotacja zachowuje dwie ostatnie pełne kopie wyłącznie tego workflow i gałęzi.

Po udanych kontrolach `scripts/publish-data.js` zapisuje znormalizowaną historię oraz agregaty raportów na osobnej gałęzi `sportlab-data`. Manifest wskazuje niezmienny commit i skróty SHA-256 plików. API strony pobiera te dane bez klucza, sprawdza skróty, format i aktualność, a po awarii jawnie wraca do danych wdrożenia. Zmiana danych nie uruchamia publikacji nowego kodu produkcji.

Workflow używa wbudowanego tokenu GitHub. Nie włączono płatnej usługi ani planu. Dane testowe nigdy nie trafiają do raportów. Prospektywny rejestr rozlicza wyłącznie spotkania z prognozą zapisaną przed rozpoczęciem i wynikiem zaobserwowanym później; na początku nie ma rozliczonej próby. Więcej: [plan walidacji](docs/validation-plan.md).

## Vercel

Pozostają adresy `/api/scores`, `/api/details` i `/api/model`. Funkcje są natywnymi funkcjami Node.js Vercel, a pliki strony są budowane do `dist/`. `vercel.json` wymusza `npm run check` jako polecenie budowania i dołącza dane do funkcji. Gdy testy zawodzą, build kończy się błędem.

Nie dodano automatycznego wdrażania produkcji. Przed publikacją trzeba przetestować konkretny build oraz pełny przepływ w podglądzie. Przy podłączaniu integracji Git nie włączaj automatycznej promocji niesprawdzonej gałęzi produkcyjnej. Projekt nie zmienia istniejących ustawień konta Vercel ani domen.

Więcej: [architektura](docs/architecture.md), [kontrakt danych](docs/data-contract.md).

## Stan przygotowanej wersji

Kod i workflow są przygotowane do pracy w repozytorium `antoniobialaczek-ctrl/SportLab-`. Historia obejmuje 30 364 zakończone mecze, w tym 5 998 meczów 10 lig piłkarskich, oraz trzy jawne wykluczenia tenisowe. Przeszło 130 testów i build. Weryfikacja wdrożenia i identyfikatory publikacji są zapisywane w [raporcie](docs/release.md). Początkowy proces odzyskania aplikacji opisano w [docs/recovery.md](docs/recovery.md).

Bieżące prawdopodobieństwa nadal są wstrzymane. Ani rozpoczęcie zbierania migawek, ani dodatni wynik badawczego testu retrospektywnego nie zastępują niezależnej walidacji przedmeczowej. CS2 pozostaje wyłączone z powodów opisanych w [audycie źródeł](docs/cs2-sources.md).

## Niezależny protokół walidacji

Nowe prognozy są badane w odrębnych, zamrożonych próbach każdej ligi: 60 zapisów do kalibracji, 45 do wyboru i 150 do końcowego testu (minimum 100 prawidłowych wyników testowych). Postęp widać w panelu „Postęp niezależnego testu”. Starsze zapisy badawcze nie są dopisywane wstecz do tego eksperymentu. Kontrole odtwarzają model i sprawdzają wszystkie dowody wyników, a workflow chroni archiwa także przy przerwie lub błędzie. Szczegóły: [protokół](docs/validation-plan.md).

Bieżące potwierdzenie uruchomienia niezależnego protokołu i testów: [docs/validation-release.md](docs/validation-release.md).

## Widoczne analizy meczów

Na kartach meczów automatycznie pojawia się podsumowanie ostatnich wyników obu stron. „Otwórz analizę meczu” pokazuje średnie zdobyte i stracone punkty/gole/sety, serię wyników, podział dom/wyjazd i ostatnie bezpośrednie spotkania. Dla sportów drużynowych widoczna jest także forma dostępnych zawodników z maksymalnie dwóch wcześniejszych boxscore, z liczebnością każdej próby. Dane nie potwierdzają przyszłego składu.

Jeżeli wybranego dnia nie ma meczów, strona pokazuje osobno podpisane analizy ostatnich zakończonych spotkań, z ich rzeczywistymi datami. Archiwum można otworzyć również przyciskiem. Raport modeli jest dostępny pod rozwijaną sekcją, a dostępne analizy opisowe działają podczas dalszej walidacji prognoz.

Nowe endpointy: `/api/match-analysis`, `/api/player-form`, `/api/analysis-catalog`. Dotychczasowe adresy API pozostają obsługiwane.

## Co warto obstawić

Sekcja nad meczami i na każdej karcie pokazuje decyzję oraz uzasadnienie. Do czasu niezależnej walidacji prognoz i podłączenia aktualnych kursów werdykt pozostaje „Odpuść zakład — brak potwierdzonej przewagi”. Nie wyliczamy prawdopodobieństwa z liczby zwycięstw ani nie udajemy, że znamy opłacalny kurs.

Osobno działa jawna, opisowa lista rynków do sprawdzenia dla NBA, NHL i piłki. Wymaga po 10 wcześniejszych meczów, różnicy minimum 3 zwycięstw, zgodnych średnich różnic wyniku, prób dom/wyjazd po minimum 3 mecze i świeżych danych. Rynki mają określony zakres rozliczenia: NBA z dogrywką, NHL z dogrywką i karnymi, piłka 1X/X2 w 90 minutach. To niezweryfikowana reguła obserwacyjna, nie rekomendacja zakładu. Tenis wymaga dodatkowego kontekstu nawierzchni. Mecze rozpoczęte i archiwalne nie otrzymują kierunku; interfejs odświeża tę ocenę co 30 sekund. Zamrożone modele i protokół walidacji pozostają niezależne.
