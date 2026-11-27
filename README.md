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

Źródłem wyników jest bezpłatny, nieoficjalny ESPN API. NBA, NHL i 10 dostępnych lig piłkarskich mają osobne zbiory i modele. Domyślny import obejmuje wszystkie działające ligi; `--routes` zawęża zakres. ESPN nie obsługuje Ekstraklasy pod dotychczasową trasą. Jej terminarz, wyniki i opisowa forma drużyn pochodzą teraz z oddzielnego darmowego TheSportsDB; nie trafiają do zamrożonego eksperymentu modeli. Tenis wymaga poprawnie oznaczonych zakończonych pojedynczych meczów. CS2 pozostaje niedostępne do czasu pozyskania wiarygodnego darmowego źródła. Ograniczenia źródeł są opisane w [docs/sources.md](docs/sources.md).

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

Kod i workflow są przygotowane do pracy w repozytorium `antoniobialaczek-ctrl/SportLab-`. Historia obejmuje 30 364 zakończone mecze, w tym 5 998 meczów 10 lig piłkarskich, oraz trzy jawne wykluczenia tenisowe. Weryfikacja obejmuje automatyczne testy, build i sprawdzenie pełnego przepływu w przeglądarce. Weryfikacja wdrożenia i identyfikatory publikacji są zapisywane w [raporcie](docs/release.md). Początkowy proces odzyskania aplikacji opisano w [docs/recovery.md](docs/recovery.md).

Bieżące prawdopodobieństwa nadal są wstrzymane. Ani rozpoczęcie zbierania migawek, ani dodatni wynik badawczego testu retrospektywnego nie zastępują niezależnej walidacji przedmeczowej. CS2 pozostaje wyłączone z powodów opisanych w [audycie źródeł](docs/cs2-sources.md).

## Niezależny protokół walidacji

Nowe prognozy są badane w odrębnych, zamrożonych próbach każdej ligi: 60 zapisów do kalibracji, 45 do wyboru i 150 do końcowego testu (minimum 100 prawidłowych wyników testowych). Postęp widać w panelu „Postęp niezależnego testu”. Starsze zapisy badawcze nie są dopisywane wstecz do tego eksperymentu. Kontrole odtwarzają model i sprawdzają wszystkie dowody wyników, a workflow chroni archiwa także przy przerwie lub błędzie. Szczegóły: [protokół](docs/validation-plan.md).

Bieżące potwierdzenie uruchomienia niezależnego protokołu i testów: [docs/validation-release.md](docs/validation-release.md).

## Widoczne analizy meczów

Na kartach meczów automatycznie pojawia się podsumowanie ostatnich wyników obu stron. „Otwórz analizę meczu” pokazuje średnie zdobyte i stracone punkty/gole/sety, serię wyników, podział dom/wyjazd i ostatnie bezpośrednie spotkania. Dla sportów drużynowych widoczna jest także forma dostępnych zawodników z maksymalnie dziesięciu wcześniejszych boxscore, z liczebnością każdej próby. Dane nie potwierdzają przyszłego składu.

Jeżeli wybranego dnia nie ma meczów, strona pokazuje osobno podpisane analizy ostatnich zakończonych spotkań, z ich rzeczywistymi datami. Archiwum można otworzyć również przyciskiem. Raport modeli jest dostępny pod rozwijaną sekcją, a dostępne analizy opisowe działają podczas dalszej walidacji prognoz.

Nowe endpointy: `/api/match-analysis`, `/api/player-form`, `/api/analysis-catalog`. Dotychczasowe adresy API pozostają obsługiwane.

## Typy statystyczne na zawodników

Główna sekcja pokazuje konkretne linie analityczne na punkty, asysty i zbiórki NBA, strzały na bramkę NHL oraz strzały w piłce. To przesiew rzeczywistych wcześniejszych wyników, nie oferta bukmachera ani zweryfikowane prawdopodobieństwo przyszłego zdarzenia. Wspólne wyjaśnienie zastępuje powtarzany na każdej karcie werdykt „odpuść”. Typy na wynik meczu są dostępne w oddzielnej rozwijanej sekcji.

API zawodników domyślnie analizuje 10 wcześniejszych meczów. Wskazanie wymaga co najmniej 8 różnych występów z porównywalną statystyką oraz udziału w ostatnim dostępnym meczu drużyny. Jawna reguła wybiera najwyższą z analizowanych linii połówkowych przekroczoną w co najmniej 70% tej wcześniejszej próby, przy medianie i średniej ostatnich pięciu występów powyżej linii. Interfejs pokazuje liczby występów, średnią, medianę i poszczególne wyniki; nie przedstawia tej częstości jako prawdopodobieństwa. Użytkownik może porównać własną linię połówkową powyżej lub poniżej z tą samą historią.

Bieżący raport źródła wyklucza oznaczonych jako Out, Doubtful, Inactive lub Suspended; źródło i potwierdzony skład nadal trzeba sprawdzić przed decyzją. Braki statystyk, DNP i sprzeczne grupy źródłowe nie stają się zerami ani występami. Publiczne obserwacje wymagają dokładnego potwierdzenia zakończonego meczu i uczestników w odpowiedzi ESPN. Mecze rozpoczęte i archiwalne nie otrzymują aktywnych typów.

Pierwsze dwa nadchodzące mecze wczytują formę zawodników automatycznie; przycisk wczytuje kolejne. Główny widok filtruje punkty, asysty, zbiórki i strzały. Pobrania są ograniczone do dwóch równoległych żądań API i trzech równoległych pobrań boxscore; udane dane mają 15-minutowy cache. Pełna forma pozostaje dostępna w analizie, a krótsze historie są oddzielnie rozwijane. Modele i protokół walidacji nie zostały zmienione.

## Kursy, własny dziennik i kontekst

„Twój kurs i własny typ” w szczegółach nadchodzącego meczu pozwala wpisać kurs dziesiętny i stawkę w umownych jednostkach. Kalkulator pokazuje matematyczny próg rentowności `1 / kurs`; nie utożsamia go z prognozą. Porównanie z modelem pozostaje niedostępne do niezależnego zatwierdzenia publikacji. `/api/forecast` nie ujawnia badawczych prawdopodobieństw.

Dziennik działa lokalnie w tej przeglądarce, z importem i eksportem JSON. Nie ma wpłat ani wysyłania typów do bukmachera. Własne zapisy nie są niezależnie potwierdzonym rejestrem modeli. Automatyczne sprawdzenie przy wejściu i co pięć minut oraz przycisk „Sprawdź wyniki” korzystają z `/api/journal-results` i istniejącej historii. Czekają na potwierdzony wynik; brak danych nie oznacza przegranej. Korekta źródła oznacza konflikt i wyłączenie wpisu ze statystyk. Zysk, ROI i trafność odnoszą się wyłącznie do rozliczonych własnych typów, bez podatków i opłat. Anulowania i zmiany terminu wymagają dodatkowego dowodu — przy jego braku wpis pozostaje oczekujący.

Kurs jest widoczny przy konkretnym typie, jeżeli odczyt ESPN odpowiada dokładnie temu samemu meczowi, rynkowi, kierunkowi, zasadom rozliczenia i linii. `/api/details` współdzieli odczyt z analizą meczu; dotychczasowy `/api/odds` pozostaje obsługiwany. Dane nadchodzących spotkań są pobierane automatycznie z ograniczoną równoległością. Oferta źródła może być pokazana osobno także bez zgodnego sygnału w historii. Przycisk „Porównaj typ dla tej linii” przenosi odczytaną linię NBA do istniejącego porównania i wykresu. Cena z innej linii, rynku lub zawodnika nie jest podstawiana.

Przy cenie widnieje dostawca i oznaczenie „odczyt”; szczegóły wyjaśniają brak potwierdzonego czasu aktualizacji źródła. Odczyt wygasa po pięciu minutach lub przy rozpoczęciu meczu. Nie oznacza potwierdzonej aktualnej oferty i nie trafia automatycznie do EV ani dziennika. Brak dopasowania jest pokazany jako „Kurs niedostępny”. Dodatkowy odczyt ESPN core udostępnia jawne progi N+ na punkty, asysty i zbiórki NBA, strzały na bramkę NHL oraz strzały piłkarzy. Tożsamość zawodnika jest wiązana z aktualnym rosterem po ID. Próg 20+ oznacza powyżej 19,5; nie tworzymy przeciwnej ceny ani nie zgadujemy kolejności nieoznaczonych par. Najwyższa oferowana linia spełniająca dotychczasowe kryteria historii jest preferowana przed linią analityczną. Karty z dopasowaną ceną są pokazywane wcześniej. Brak ceny nadal pozostaje jawny. `lastUpdated` opisuje rekord ESPN, a nie potwierdzoną zmianę ceny u bukmachera: zachowujemy ten czas oddzielnie, nie deklarujemy świeżości oferty i odrzucamy przyszłe, błędne lub starsze niż 24 godziny rekordy. Nie dodano płatnej usługi ani klucza. Zakres i ograniczenia: [kursy zawodników](docs/player-odds-sources.md).

Kontekst spotkania obejmuje znane obciążenie terminarza, czas od ostatniego meczu oraz wcześniejsze bilanse przeciwników mierzone przed każdym wcześniejszym spotkaniem. Kontuzje i zgłoszeni starterzy są powiązani z danym meczem; brak raportu nie oznacza zdrowego składu. Bieżące raporty są ukryte w analizach archiwalnych. Historia nie zawiera zweryfikowanych nawierzchni tenisa — nie tworzymy zastępczych oznaczeń.

`/api/readiness` i panel „Gotowość prognoz i aktualność danych” pokazują rzeczywiste etapy i liczebności prób oraz aktualność raportów. Nie ujawniają przedwcześnie testu końcowego. Zarejestrowany eksperyment, modele i workflow pozostają niezmienione; zakończenie niezależnej walidacji wymaga kolejnych rzeczywistych spotkań i późniejszego przeglądu dowodów.

Potwierdzenie publikacji i testów tej rozbudowy: [docs/journal-release.json](docs/journal-release.json).

Potwierdzenie widocznych typów zawodników i sprawdzenia produkcji: [docs/player-picks-release.json](docs/player-picks-release.json).


## Wynik czy suma punktów i wykresy

Główna zakładka porównuje rynek wyniku z sumą punktów NBA i wyróżnia najmocniejszy zgodny sygnał w zapisanej historii. Dotychczasowe typy zawodników są w sąsiedniej zakładce. Wybór nie jest porównaniem opłacalności ani zweryfikowaną prognozą szans.

Suma punktów korzysta z po 8–10 wcześniejszych meczów każdej drużyny, znanych przed punktem odcięcia. Wspólne spotkania są liczone raz przy wyznaczaniu średniej i łącznych liczników. Linia analityczna to najbliższa połówka średniej unikalnych sum; nie przeszukujemy linii, aby uzyskać wyższą historyczną trafność. Kierunek powyżej/poniżej wymaga zgodności obu historii, większości łącznych wyników i zgodnej średniej ostatnich pięciu spotkań. Rynek wyniku zachowuje dotychczasowe kryteria formy. Wyróżnienie porównuje słabszy bilans poparcia obu drużyn, a następnie oba bilanse łącznie. Historia nie gwarantuje przyszłego wyniku.

W analizie można wpisać własną linię połówkową, np. 224,5. Liczniki, wyróżnienie i poziom na wykresie przeliczają się dla tej linii. Zakres sum NBA obejmuje wynik końcowy z dogrywką; nie dodano sum goli NHL o niejednoznacznych zasadach rozliczenia.

Wykresy pokazują rzeczywiste sumy obu drużyn w ich wcześniejszych spotkaniach, z datami, rywalem, wynikiem, średnią i ostatnimi pięcioma meczami. Mają wspólną skalę od zera i nie łączą różnych spotkań w jedną fikcyjną serię. Błędne i sprzeczne wyniki są pomijane, a brak danych nie staje się zerem. Widok mobilny układa wykresy pionowo. Wskazanie jest usuwane także w otwartym oknie po utracie aktualności analizy lub rozpoczęciu meczu. Zamrożone źródła i protokół nie zostały zmienione.

Potwierdzenie publikacji porównania rynków i wykresów: [docs/match-markets-release.json](docs/match-markets-release.json).

Potwierdzenie publikacji kursów przy dokładnych typach, porównania linii źródłowej i sprawdzenia publicznej strony: [docs/pick-odds-release.json](docs/pick-odds-release.json).

## Zdjęcia i nowe źródło Ekstraklasy

Przy typach, pełnej formie i boxscore są zdjęcia udostępnione przez ESPN dla dokładnego ID zawodnika. Nie zgadujemy URL ani nie podstawiamy twarzy innej osoby. Brak lub błąd zdjęcia zostawia inicjały. Obrazy są ładowane leniwie i mają opisy dostępności.

Ekstraklasa ma oddzielny zbiór opisowy: 95 rzeczywistych zakończonych meczów, 18 drużyn i 100 sprawdzonych dni w pierwszym pobraniu. Darmowy TheSportsDB zwraca do trzech spotkań na dzień, więc pokrycie jest jawnie niepełne. Daty i tożsamości są sprawdzane w osobnej przestrzeni `tsdb-…`. Forma wykorzystuje wyłącznie wyniki rzeczywiście zaobserwowane przed punktem odcięcia; nie udajemy, że dzisiejszy odczyt był dostępny przed dawnym meczem. Wynik i suma goli są porównywane dla 90 minut. Domyślna linia 2,5 gola jest stała, bez optymalizacji do historii; własne linie obejmują 0,5–15,5. Kryteria wskazania są takie same jak wcześniej: dostateczna spójna historia, zgodność obu stron i ostatnich pięciu wyników. TheSportsDB nie podaje w tym odczycie kursów, boxscore ani kontuzji zawodników tej ligi.

Oddzielny workflow pobiera ostatnie siedem zakończonych dni raz dziennie, o 06:47 UTC. Publikuje wyłącznie sprawdzone dane i manifest SHA-256 na gałęzi `sportlab-ekstraklasa-data`. Kod produkcji nie jest automatycznie wdrażany. Dokumentacja: [źródło Ekstraklasy](docs/ekstraklasa-sources.md), [automatyzacja](docs/ekstraklasa-automation.md).

Zakładka CS2 odróżnia brak podłączonego źródła od braku meczów i daje link do zewnętrznego terminarza. Nie znaleziono źródła z potwierdzonym darmowym dostępem i prawem do tego zastosowania; nie pokazujemy fikcyjnych meczów, kursów ani wskazań CS2. [Ponowny audyt](docs/cs2-sources.md) opisuje wymagany dostęp i ograniczenia usług.

Potwierdzenie publikacji zdjęć, kursów zawodników, Ekstraklasy i pierwszego udanego uruchomienia jej automatyzacji: [docs/player-portraits-ekstraklasa-release.json](docs/player-portraits-ekstraklasa-release.json).

## Dziennik linii i aktualność otwartej analizy

Przycisk „Zapisz własny typ” przenosi dokładny rynek, zawodnika, kierunek, linię i zakres rozliczenia do lokalnego formularza. Dziennik obejmuje teraz wynik meczu, sumę punktów NBA, sumę goli Ekstraklasy oraz obsługiwane statystyki zawodników NBA, NHL i piłki. Odczyt ceny może wypełnić pole po kliknięciu; zapis wymaga potwierdzenia własnego kursu i stawki. Starsze wpisy v1 są zachowywane i migrowane do v2, z tym samym identyfikatorem i rozliczeniem.

Sprawdzenie wysyła tylko identyfikatory rozpoczętych meczów, w partiach po dwa i maksymalnie dziesięć spotkań na cykl. Korzysta ze zweryfikowanych zakończonych wyników i boxscore; brak statystyki lub występu nie jest zerem ani przegraną. Rzeczywista zmiana rozliczanej wartości tworzy konflikt także wtedy, gdy kierunek nadal byłby wygrany. Starsze spotkania są sprawdzane rotacyjnie. Kurs, stawka i wybór pozostają na urządzeniu; to osobisty dziennik, nie niezależna skuteczność modeli.

Otwarta analiza odnawia punkt odcięcia i dane. Typy zawodników wymagają odczytu nie starszego niż 15 minut i punktu odcięcia nie starszego niż 30 minut. Aktualizacja ceny zachowuje wpisaną linię i kierunek; wynik własnego porównania po aktualizacji wymaga ponownego sprawdzenia. Znane wykluczenie kontuzjowanego zawodnika pozostaje do nowej, jawnej informacji, a brak raportu nie oznacza zdrowego składu. Piłkarska forma obsługuje również nazwane statystyki rosterów ESPN, z potwierdzeniem występu; niewykorzystana ławka nie jest liczona jako mecz.

## MLS i ikona aplikacji

MLS (`soccer/usa.1`) ma terminarz, formę drużyn, bezpośrednie spotkania i dostępne statystyki zawodników. Oddzielna historia opisowa obejmuje 1 039 potwierdzonych wyników 90 minut z sezonów 2025–2026 dla 30 klubów; 42 rekordy wykluczono, w tym dogrywki, karne, All-Star i niepoprawne czasy. Źródło nie potwierdza kompletności całych sezonów. Wyniki są dostępne od rzeczywistej pierwszej obserwacji, z zachowaniem bufora 24h od rozpoczęcia; nie tworzymy wstecz dowodów dostępności. Jedno ograniczone zapytanie ESPN odświeża bieżący sezon na żądanie, z cache 10 minut i jawnym powrotem do ostatniego sprawdzonego zbioru. Dane pozostają poza zamrożonym eksperymentem modeli.

Wynik i suma goli MLS używają 90 minut oraz tych samych opisowych kryteriów formy. Domyślna linia goli to stałe 2,5; można sprawdzić własną linię. Kurs jest pokazywany tylko dla dokładnie dopasowanego rynku i wyboru, jeżeli źródło go udostępnia. Dziennik obsługuje również MLS. Brak zweryfikowanego modelu tej ligi nie blokuje analiz opisowych, ale pozostawia prawdopodobieństwa wstrzymane.

Ikony przeglądarki i skrótu aplikacji pochodzą z grafiki przesłanej przez użytkownika (SHA-256 oryginału `1344ea1eb48abde48fa1f7812c2f4fcd35957dd55dd491f583984375501afd55`). Przygotowano wyłącznie wersje rozmiarowe, bez zmiany kompozycji. Manifest i nazwy plików ikon obsługują aktualizację cache.

## Widoczna analiza zawodników

Zakładka „Zawodnicy i typy” oraz szczegóły meczu pokazują profile obu drużyn także bez aktywnych typów. Wybór gracza i statystyki zmienia zdjęcie, średnią, medianę, średnią ostatnich pięciu występów i wykres do dziesięciu rzeczywistych wyników z datami. Zmiana wyboru wykorzystuje już pobrane dane. Słupki mają skalę od zera; brak statystyki nie jest zerem, a sprzeczne lub przyszłe obserwacje blokują wykres. Historia opisuje wcześniejsze występy i nie potwierdza przyszłego składu ani prawdopodobieństwa zakładu.

Profile zawodników pokazują bieżącą formę w wybranej lidze także po otwarciu starszego spotkania. Widoczna data ostatniego dostępnego występu i ostrzeżenie o nowszym meczu drużyny odróżniają brak statystyki od zera. Widok `view=latest` uzupełnia historię bezpłatnym terminarzem drużyny i potwierdza zakończenie oraz tożsamość każdego meczu w szczegółach ESPN. Ma cache 5 minut, a awaria sprawdzenia nowszych meczów jest jawna. Bieżący profil nie czeka na konserwatywny bufor 24h używany w eksperymencie modeli. Domyślne API historyczne i testy zachowują swój punkt odcięcia; ich dane oraz protokół pozostają bez zmian.

## NHL: wynik i gole

NHL ma porównanie zwycięzcy z sumą goli, domyślną stałą linię analityczną 5,5 oraz własną linię połówkową 0,5–25,5. Wykresy pokazują sumy obu drużyn w ich wcześniejszych meczach; obok są średnie goli zdobytych i straconych oraz pięć ostatnich wyników od najnowszego. Zakres to oficjalny wynik końcowy z dogrywką i jednym golem przypisanym zwycięzcy serii karnych, bez sumowania trafionych karnych. Nie jest to suma po 60 minutach ani suma bez karnych. Dopasowany kurs wymaga tej samej linii i jednoznacznie potwierdzonego zakresu źródła. Własny typ można zapisać i rozliczyć w dzienniku dla tego zakresu. Liczniki opisują historię, bez prawdopodobieństw i obietnic opłacalności. Dane i protokół eksperymentu modeli pozostają bez zmian.

## Filtr kursów i brak niepotwierdzonych etykiet ryzyka

Automatyczne pozycje drużyn i zawodników wymagają dopasowanego odczytu kursu; domyślne minimum to 1,50. Użytkownik może zmienić minimum i wybrać zakres poniżej 2,00 albo od 2,00. Preferencje są zapisane lokalnie i zmiana filtra korzysta z już pobranych danych. Dopasowanie obejmuje właściwy mecz, gracza, rynek, linię, kierunek i zakres rozliczenia; wygasłe odczyty nie przechodzą filtra. Źródłowy czas aktualizacji ceny, jeżeli nie jest potwierdzony, pozostaje jawnie niepotwierdzony. Grupy określają cenę, bez prognozy szans, oceny bezpieczeństwa ani opłacalności. Usunięto wyróżnienie „najmocniejszy sygnał”. Brak dopasowanego kursu nie blokuje profili, wykresów ani własnych porównań i dziennika. Niezależna walidacja pozostaje warunkiem oceny ryzyka; filtr nie odblokowuje modeli i nie zmienia ich eksperymentu.

## Prosty widok dnia

Domyślna zakładka „Typy dnia” łączy dostępne pozycje drużyn i zawodników dla wybranego sportu i zestawu dnia. Pokazuje do pięciu pozycji, najwyżej jedną na mecz: konkretny rynek, pasujący odczyt kursu, pełną datę i godzinę w Polsce oraz krótkie uzasadnienie liczbami historycznymi. Kolejność opisuje zgodność w dostępnych obserwacjach, bez zweryfikowanego prawdopodobieństwa czy oceny opłacalności. Widoczny licznik pokazuje zakres sprawdzonych analiz; kolejne formy zawodników można pobrać w ograniczonych partiach. Filtry kursów są rozwijane. Pełne wykresy, profile i własne porównania pozostają w szczegółach meczu i pozostałych zakładkach. Zakończone mecze i pozycje bez dopasowanej ceny nie trafiają na listę dnia.

Pod listą dnia są również widoczne karty zawodników: konkretny rynek i linia, dopasowany odczyt kursu, średnia/mediana/ostatnie pięć oraz datowane wyniki ostatnich występów od najnowszego. Karty korzystają z tych samych kryteriów historii i ceny, bez stałego wpisywania przykładowego zawodnika czy progu. Brak występu nie jest zerem. Po odczytaniu pasującego cenowo rynku zawodnika aplikacja priorytetowo pobiera jego drużynową historię, korzystając z istniejącej ograniczonej kolejki i cache. Uproszczona lista dnia i pełne szczegóły pozostają dostępne.

Karty analiz zawodników są niezależne od dostępności ceny: kwalifikująca się aktualna historia może pokazać automatyczną linię analityczną i ostatnie występy także bez pasującego kursu. Takie karty mają jawne oznaczenie analizy historycznej i brak kursu zamiast wymyślonej ceny. Filtr minimum i zakresu ceny nadal obowiązuje przy liście „Typy dnia”; nie jest warunkiem dostępu do statystyk. Na start w ograniczonej kolejce pobierana jest forma pierwszych dwunastu meczów, a stan pusty lub błąd pobierania nie ukrywa całej sekcji zawodników.

Analizy zawodników znajdują się przed listą cenową. Widoczne wybory zawodnika i statystyki pozwalają znaleźć gracza pominiętego w skróconej liście; „Pokaż pozostałe karty” rozwija do 12 analiz. Wstępne wczytywanie obejmuje maksymalnie 12 meczów w istniejącej kolejce z dwoma pracownikami i bez nowych źródeł.

## Piłkarskie typy dnia: wynik i gole

Dla obsługiwanych lig piłkarskich „Typy dnia” porównują wynik po 90 minutach i sumę goli, z dokładnie dopasowanym odczytem kursu. Piłka wyświetla tę listę przed analizami zawodników. Zachowano minimalny kurs 1,50 i jedną pozycję na mecz. Ranking opisuje zgodność wcześniejszych wyników; nie jest zweryfikowaną prognozą ani deklaracją zysku.

Przed przyszłym meczem `GET /api/match-analysis?view=current` pobiera potwierdzone wyniki 90 minut obu drużyn w tej samej lidze. W razie krótkiej historii sprawdza najwyżej jeden poprzedni sezon na drużynę. Rzeczywisty czas obserwacji pozostaje jawny; ten widok nie odtwarza dawnego stanu wiedzy i nie trafia do testów modeli. Domyślne historyczne odcięcie nadal wymaga ścisłej dostępności danych przed punktem odcięcia. Dogrywki i karne są wykluczane. W szczegółach są wykresy sum goli, średnie zdobytych i straconych goli, ostatnie wyniki oraz własna linia połówkowa. Dziennik obsługuje sumy goli we wszystkich obsługiwanych ligach.

Domyślne zakresy standardowych rynków DraftKings „Game Odds” są przypisane wyłącznie do właściwego dostawcy, pełnego rynku i aktualnie sprawdzonych [zasad rozliczania piłki](https://support.draftkings.com/dk/en-us/how-are-soccer-bets-settled?id=kb_article_view&sysparm_article=KB0010834). Trzy ceny wyniku oraz obie ceny sumy muszą być kompletne. Wyjątki, okresy gry, sprzeczne linie i niepotwierdzone zakresy nie dają automatycznego typu. Dowód zasad wygasa po 30 dniach. Brak źródłowego czasu aktualizacji nadal oznacza świeżość niepotwierdzoną.

Wybrane zdjęcia piłkarzy uzupełnia statyczny katalog darmowego TheSportsDB: Yamal, Raphinha, Dani Olmo i Haaland. Powiązanie ESPN ID z nazwą, datą urodzenia i klubem oraz odczyty HTTP obrazów zapisano w [dowodach źródłowych](docs/football-portraits-sources.json). Nie zgadujemy adresów ani zdjęć innych osób. Zdjęcia wskazują dostawcę, a brak potwierdzonego obrazu zachowuje inicjały. Katalog nie wykonuje dodatkowych zapytań do wyszukiwarki zdjęć podczas korzystania z aplikacji.

## Widoczna analiza piłkarska niezależnie od kursu

Na stronie dnia i w widoku drużyn karty meczów piłkarskich pokazują główny kierunek z formy, argumenty za i przeciw oraz statystyki obu zespołów. Analiza pozostaje widoczna bez ceny lub przy wysokim filtrze kursu. Oddzielna lista pozycji z dopasowanym kursem zachowuje dotychczasowe filtry.

Porównanie obejmuje zwycięstwa, remis, 1X/X2, sumę goli oraz „obie drużyny strzelą”. Pokazuje ostatnie maksymalnie 10 wyników, ostatnie 5, rzeczywisty podział dom/wyjazd, gole zdobyte i stracone, czyste konta i mecze bez strzelonego gola. Linia sumy pochodzi z dokładnie dopasowanego odczytu źródła, własnego wpisu lub stałego porównania 2,5 — nie wyszukujemy łatwiejszej linii dla poprawy liczników. Rynki z rozbieżną ostatnią formą lub przeciwnym obrazem dom/wyjazd dostają kontrargumenty. Brak kursu X2 lub BTTS nie jest zastępowany ceną zwycięzcy.

Główny kierunek wymaga co najmniej 8 spójnych wyników 90 minut każdej strony i zgodności jawnych reguł historycznych. Przy 3–7 meczach pozostają dostępne fakty i odrębny wstępny kierunek na zwycięstwo, jeśli punkty na mecz, różnica goli i ostatnia forma zgodnie wskazują jedną drużynę. Krótka próba jest wyraźnie oznaczona; główne porównanie rynków zachowuje próg 8 spotkań. Nieaktualna, sprzeczna, przyszła lub niepotwierdzona historia nie daje wskazania. Liczniki nie są prawdopodobieństwami ani zweryfikowaną skutecznością prognoz; analiza nie wyznacza wartości zakładu i nie udaje korekty na składy, kontuzje, siłę rywali lub xG. Dane i zamrożone testy modeli pozostały bez zmian.

## Głębsza analiza NBA i uzasadnienia typów zawodników

NBA ma osobne porównanie drużyn: faworyta z formy, zwycięzcę i sumę punktów z dogrywką, średnie zdobyczy i strat, różnicę wyniku, ostatnie 5/10 meczów, dom/wyjazd, medianę i rozrzut sum. Każdy kierunek ma konkretne argumenty oraz kontrargumenty. Linie punktowe pochodzą z dokładnie dopasowanych kursów, własnego wpisu lub jawnej średniej referencyjnej unikalnych historycznych sum; nie dobieramy łatwiejszego progu do liczników. Suma punktów nie jest nazywana tempem ani liczbą posiadań.

Karty zawodników pozostają na początku strony NBA. Przy punktach, asystach i zbiórkach sekcje „Co wspiera typ?” oraz „Co może przeszkodzić?” obliczają liczniki dla dokładnej linii, najnowszych 5 wyników, mediany i zakresu wcześniejszych obserwacji. Minuty pokazują się wyłącznie z tych samych potwierdzonych meczów. Są to historyczne minuty, a nie przewidywany czas gry. Uzasadnienia są też dostępne przy pozycjach z kursami, w szczegółach i po porównaniu własnej linii.

Analizy drużyn i zawodników nie znikają bez ceny ani przy wysokim filtrze kursu; lista pozycji z dopasowaną ceną nadal przestrzega filtra. Prawdopodobieństwa i opłacalność pozostają niewyliczane bez odpowiedniej walidacji. Nie dodano płatnych usług, estymacji kontuzji ani zmian do zamrożonych danych i testów modeli.
