# Niezależna walidacja prospektywna

Protokół `prospective-1` jest wykonywany przez kod, a jego rejestracja następuje przed przyjęciem pierwszej nowej prognozy do eksperymentu. Data rejestracji, reguły, odcisk kodu modeli i odcisk implementacji walidacji są zapisywane w stanie i raporcie. Zmiana tych parametrów zatrzymuje eksperyment do przeglądu; nie zeruje jego historii.

Początkowe 43 prognozy pozostają zapisami badawczymi sprzed protokołu. Nie dopisujemy im wstecz metadanych ani nie zaliczamy do niezależnej próby. Retrospektywne rekordy ESPN nadal mają oznaczenie `conservative-24h`; ich historyczna dostępność nie zostaje certyfikowana przez ten eksperyment.

## Próby ustalone z góry

Każda liga ma własne okna; NBA, NHL, ligi piłkarskie, ATP i WTA nie uzupełniają sobie próby.

| Etap | Z góry ustalona liczba zapisów | Minimum prawidłowych wyników |
| --- | ---:| ---:|
| Dopasowanie kalibracji | 60 | 40 |
| Wybór kalibracji albo modelu surowego | 45 | 30 |
| Końcowy test | 150 | 100 |

Do przyjęcia prognozy wymagamy co najmniej 100 znanych wcześniej meczów treningowych tej ligi. Rejestracja następuje co najmniej pięć minut przed początkiem konkretnego meczu, po odebraniu stanu źródła sprzed meczu. Wektor i dokładny trening są niezmienne. Stan modelu aktualizuje się wyłącznie na wynikach zaobserwowanych przed rejestracją prognozy.

Etap kończy się po rozliczeniu lub jawnym unieważnieniu **całej ustalonej próby**, a nie po pierwszych korzystnych wynikach lub osiągnięciu samego minimum. Maksymalnie 5% jego zapisów może być unieważnione. Nadmiar braków blokuje tę próbę; nie uzupełniamy jej do chwili uzyskania dobrego rezultatu.

Temperaturę dopasowuje się wyłącznie na pierwszym oknie. Na następnym pozostaje wybrana tylko przy poprawie Brier i niepogorszeniu log loss. Kolejne okno przyjmuje wyłącznie prognozy wystawione **ściśle po** zamrożeniu wcześniejszej decyzji. Każdy zapis testowy zachowuje wybraną wcześniej temperaturę.

Wyniki końcowego testu nie są pokazywane w jego trakcie, także pośrednio w agregacie całego rejestru. Widoczne są liczniki postępu. Statystyki testu ujawniamy po zamknięciu wszystkich 150 zapisów.

## Kryteria zamkniętego testu

- Co najmniej 100 prawidłowych wyników z ustalonej próby i co najmniej siedem odrębnych dni UTC.
- Dodatnia dolna granica 95% przedziału poprawy Brier względem chronologicznego modelu bazowego. Stosowany jest z góry ustalony, deterministyczny bootstrap parami, w blokach dni UTC, z 1000 powtórzeń.
- Log loss nie gorszy od bazowego oraz oczekiwany błąd kalibracji ECE nie większy niż 0,1.
- Integralność wszystkich migawek, uczestników, czasów, treningów, prognoz i wyników.

Raport zawiera trafność i przedział Wilsona, Brier, log loss, liczebności oraz porównanie z modelem bazowym. W projekcie Brier jest znormalizowany liczbą klas wyniku. Nie porównujemy bezpośrednio wartości dla dwóch i trzech klas.

Spełnienie kryteriów daje status `completed-awaiting-review`, a niespełnienie — `failed`. Sam licznik ani pozytywny test nie odblokowują automatycznie prawdopodobieństw. Przed publikacją prognoz potrzebny jest przegląd integralności i zakresu, zależności między meczami, niepewności opartej na małej liczbie dni oraz wielokrotnych porównań między ligami. Dla tenisa trzeba również ocenić zakres nawierzchni i formatów. Końcowy test nie służy do dostrajania tej samej wersji modelu.

## Dowody i odtwarzanie

| Artefakt | Zawartość |
| --- | --- |
| `data/snapshots/raw/<sha>.json` | Dokładna odpowiedź ESPN ze skrótem SHA-256 i czasem odebrania całej odpowiedzi. |
| `data/snapshots/training/<sha>.json` | Dokładny trening, wersja i odcisk kodu danej rejestracji. |
| `data/forward/state.json` | Niezmienne rejestracje, wyniki, konflikty, unieważnienia i protokół. |
| `data/forward/checkpoint.json` | Potwierdzenie audytu i skróty spójnego stanu oraz raportu. |
| `data/reports/forward.json` | Publiczne agregaty i postęp bez wektorów prognoz. |

Surowe dane, treningi i stan pozostają w artefaktach GitHub Actions, poza produkcyjnym API oraz repozytorium kodu. Publiczny raport trafia na osobną gałąź danych. Hash bez odpowiadającej mu zachowanej treści nie jest dowodem.

Audyt sprawdza nie tylko skróty. Ponownie odczytuje stan sprzed meczu, porównuje uczestników, godziny i kategorię tenisa, odtwarza model z treningu oraz sprawdza jego wektor i bazę. Każdy wynik rozliczenia jest porównywany z surową odpowiedzią, także gdy nie posłużył do żadnej późniejszej prognozy. Parametry kalibracji, wybór oraz metryki zamrożonych etapów są ponownie wyliczane na dowodach znanych w zapisanym czasie zamrożenia.

Korekta wcześniejszego wyniku pozostawia dowód konfliktu. Jeżeli zmienia zamrożoną próbę, jej status przechodzi w `invalidated`, a wcześniejsze metryki testu są ukrywane. Nie przeliczamy po cichu korzystniejszej kalibracji. Raportu z przyszłym stanem etapów nie wolno przedstawić jako wcześniejszej oceny.

## Przerwy, przełożenia i brak wyniku

Harmonogram co cztery godziny odpytywał dotąd tylko wczoraj–jutro. Teraz dodatkowo pobiera dni źródłowe zapisanych, nierozliczonych spotkań: maksymalnie 64 dodatkowe zapytania w jednym uruchomieniu. Niewykonane dodatkowe pobrania są jawnie liczone.

Odwołanie, walkower, krecz lub sprzeczny zapis zakończonego meczu tworzą jawne unieważnienie powiązane z surowym dowodem. Po 14 dniach od zapisanego terminu niezaobserwowany wynik jest wykluczany z ustalonym wcześniej powodem braku danych. Późniejsza obserwacja wyniku nie zmienia tego wykluczenia wstecz ani nie poprawia skuteczności. Ograniczenie unieważnień do 5% nadal obowiązuje.

Awaria sieci pozostawia lukę, nie wynik zastępczy. Błąd integralności nie pozwala utworzyć nowego punktu kontrolnego. Workflow może zachować i rotować archiwa wyłącznie po potwierdzeniu spójnego punktu; uszkodzony stan nie wypiera dwóch ostatnich kopii. Jeżeli wszystkie artefakty wygasną, a opublikowany rejestr już istnieje, workflow zatrzymuje się zamiast po cichu wyzerować eksperyment. Potrzebne dowody trzeba zachować przez cały okres testu.

## Uruchomienie i granice

`npm run data:capture` zapisuje rzeczywiste obserwacje. Opcje `--from`, `--to`, `--sports`, `--routes`, `--concurrency` zawężają pobieranie; żądanie starszej daty nigdy nie cofa czasu obserwacji. `node scripts/check-checkpoint.js` sprawdza spójność ostatniego punktu. `npm run check` uruchamia testy i build.

Nie włączono płatnych usług ani źródeł. ESPN pozostaje nieoficjalnym API bez gwarancji kompletności. Walidacja wymaga rzeczywistych przyszłych meczów; jej zakończenia nie można zastąpić symulacją, czekaniem w procesie ani zmianą daty zegara. Zmiany kodu produkcji nadal przechodzą osobny build i test wdrożenia.
