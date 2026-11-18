# Plan walidacji prospektywnej SportLab

Obecne testy historii służą badaniom. Wynik pobrany dzisiaj z ESPN nie dowodzi,
że identyczne dane były dostępne przed dawnym spotkaniem. Przyjęcie
`resultAvailableAt = startTime + 24h` ogranicza przeciek między nakładającymi się
meczami, ale nie odtwarza czasu publikacji wyniku ani późniejszych korekt.
Takie rekordy zachowują oznaczenie `conservative-24h`; nie wolno zmieniać go na
zweryfikowane po ponownym pobraniu ani na podstawie samego hasha.

Publiczne prognozy pozostają wstrzymane. Zbieranie migawek rozpoczyna nowy,
obserwowany na bieżąco eksperyment. Nie weryfikuje dawnych procentów i nie
odblokowuje prognoz po jednym uruchomieniu. Zebranie niezależnych okien może
wymagać wielu miesięcy, szczególnie w ligach z krótkim sezonem.

## Rejestracja rzeczywistych obserwacji

Narzędzie uruchamia się z katalogu projektu, w Node.js, bez płatnych bibliotek:

```sh
node scripts/capture-snapshots.js \
  --from 2026-11-17 \
  --to 2026-11-19 \
  --sports nba,football,nhl,tennis \
  --routes basketball/nba,soccer/eng.1,hockey/nhl,tennis/atp,tennis/wta \
  --concurrency 2
```

Daty są dniami UTC. Domyślny zakres to wczoraj–jutro względem dnia uruchomienia.
Wybór wcześniejszej daty w żądaniu pobiera dane dostępne teraz; nie cofa czasu
obserwacji. Trasy muszą należeć do obsługiwanej dyscypliny. CS2 pozostaje
niedostępne do czasu sprawdzenia wiarygodnego, darmowego źródła wyników, map i
składów.

Przy każdej odpowiedzi należy zachować rzeczywistą zawartość odpowiedzi ESPN,
adres źródła i czas jej odebrania. `observedAt` jest czasem po zakończonym
pobraniu, nie datą zapisaną w wyniku ani zaplanowaną godziną meczu. Hash SHA-256
wiąże zapis z utrwaloną treścią; sam hash bez zachowanego pliku nie jest dowodem
dostępności danych. Błąd HTTP, timeout lub brak danych tworzy informację o
błędzie i lukę pokrycia, nigdy zastępczy wynik.

Artefakty eksperymentu:

| Ścieżka | Przeznaczenie |
| --- | --- |
| `data/snapshots/raw/<sha>.json` | Utrwalona odpowiedź źródła powiązana z rzeczywistą obserwacją i hashem. |
| `data/snapshots/training/<sha>.json` | Dokładny zbiór wejściowy danej rejestracji modelu; hash umożliwia sprawdzenie jego niezmienności. |
| `data/forward/state.json` | Stan eksperymentu, rejestracje sprzed meczów i późniejsze rozliczenia wyników. |
| `data/reports/forward.json` | Raport pokrycia i badawczych wyników, wraz z ograniczeniami oraz przyczynami wykluczeń. |

Te ścieżki są prywatnymi artefaktami, objętymi `.gitignore`. Nie należy dodawać
ich do publicznego katalogu statycznego ani publikować surowych wektorów przez
API. Do odtworzenia eksperymentu trzeba zachować razem stan, raport i wszystkie
wskazane przez nie migawki.

## Rejestracja prognozy przed spotkaniem

Każda prognoza badawcza musi zostać trwale zapisana przed początkiem meczu i
przed pierwszą obserwacją jego wyniku. Zapis obejmuje co najmniej identyfikator
meczu, uczestników, ligę, znaną wówczas godzinę rozpoczęcia, czas rejestracji,
`modelVersion`, fingerprint historii treningowej i wektor prawdopodobieństw
obliczony przez zamrożony kod. Wektory pozostają danymi wewnętrznymi, a nie
zweryfikowanymi prognozami dla użytkownika.

Do stanu modelu wolno włączyć wyłącznie wyniki rzeczywiście zaobserwowane przed
czasem rejestracji. Aktualne bilanse, rankingi, składy, kontuzje i poprawione
później statystyki nie mogą uzupełniać dawnych wejść. Uczenie stanu drużyn na
kolejnych obserwowanych wynikach jest dopuszczalne tylko wtedy, gdy zostało
ustalone przed eksperymentem i każdy zapis zachowuje własny fingerprint.

Ponowne uruchomienie nie może nadpisać wcześniejszego wektora ani stworzyć
prognozy wstecz. Zmiana modelu rozpoczyna nową wersję eksperymentu; nie wolno
wybierać wersji po porównaniu jej wyników na końcowym teście.

## Rozliczanie oraz konflikty

Rejestrację rozlicza się dopiero po późniejszym pobraniu zakończonego meczu.
Dostępność wyniku oznacza najwcześniejszą zachowaną, prawidłową obserwację
wyniku, a nie założone opóźnienie 24 godzin. Trzeba zachować powiązanie
rozliczenia z migawką źródłową.

Sprzeczność uczestników, godziny rozpoczęcia wpływająca na poprawność
rejestracji, odmienne wyniki, walkower, przerwanie, brak jednoznacznego wyniku
lub utrata migawki wymagają wyłączenia i jawnej przyczyny. Korekta wyniku
pozostawia ślad; nie wolno bez śladu zastąpić pierwotnej obserwacji. Raport
podaje liczbę wszystkich rejestracji, rozliczonych meczów, oczekujących,
błędów i wykluczeń, aby nie przedstawiać wybranej podpróby jako całego sezonu.

## Oddzielne przyszłe okna oceny

Przed rozpoczęciem oceny należy zapisać granice dat i reguły liczebności osobno
dla każdej ligi. NBA, NHL, poszczególne ligi piłkarskie oraz ATP i WTA nie
uzupełniają sobie brakującej próby. W piłce nożnej ocenia się trzy wyniki
1/X/2; w pozostałych dyscyplinach dwa rozstrzygnięcia zgodne z definicją meczu.

1. Wcześniejsza historia służy do inicjalizacji modelu i badania jakości danych.
   Retrospektywne rekordy pozostają oznaczone zgodnie z pochodzeniem.
2. Pierwsze przyszłe okno z zapisanymi przed meczami wektorami służy do
   dopasowania kalibracji. Wyniki muszą być znane przed następnym oknem.
3. Późniejsze, oddzielne okno wybiera kalibrację albo pozostawienie modelu
   surowego. Nie może jednocześnie służyć do dopasowania temperatury.
4. Dopiero kolejne, wcześniej niewidziane okno jest końcowym testem zamrożonej
   wersji, kalibracji i reguł. Nie wolno używać jego wyników do strojenia,
   zmiany granic ani decyzji o usuwaniu niekorzystnych spotkań.

Końcowy test musi obejmować co najmniej **100 prawidłowo rozliczonych meczów
danej ligi**. Wcześniejsze okna również muszą mieć dostateczną, niezależną
próbę; bieżące bramki badawczego silnika to minimum 100 meczów treningowych,
40 kalibracyjnych i 30 do wyboru kalibracji, przy minimum 400 łącznie. Te minima
nie zastępują ustalenia granic przed oceną ani analizy niepewności. Przy
podziale 50/20/10/20% potrzeba co najmniej 500 meczów, aby sam test osiągnął
100 obserwacji. Nie należy wydłużać testu po obejrzeniu wyniku tylko do chwili,
gdy model zacznie wyglądać korzystnie.

Raport powinien podawać Brier, log loss, trafność z przedziałem Wilsona,
przedziały kalibracji, próbę i porównanie z chronologicznym modelem bazowym.
Znormalizowany Brier w tym projekcie to suma kwadratów błędów podzielona przez
liczbę klas; przy porównywaniu raportów trzeba używać tej samej definicji.
Ocena z tego samego okna, na którym dopasowano model lub kalibrację, nie jest
skutecznością poza próbą.

Raport prospektywny pozostaje obecnie ze statusem `research`. Osiągnięcie progu
liczebności nie zmienia go automatycznie na `validated`. Niezależny późniejszy
przegląd musi sprawdzić integralność zapisów, chronologię, wykluczenia,
świeżość, wiarygodność danych i wyniki każdego modelu. Dla tenisa dodatkowo
potrzebna jest weryfikacja nawierzchni i formatu spotkań. Dopiero osobna,
uzasadniona zmiana bramki publikacji może umożliwić publiczne prognozy.

## Darmowe źródła i utrzymanie

ESPN jest nieoficjalnym, bezpłatnie dostępnym źródłem bez gwarancji dostępności
lub stałego schematu. Pobieranie ma być oszczędne: ograniczony zakres dni,
obsługiwane trasy, domyślnie dwa równoległe żądania, timeout i ograniczone
ponowienia. Nie należy obchodzić blokad źródła ani zastępować go płatną usługą.

Lokalne uruchomienie nie wymaga płatnych zależności. Automatyzację GitHub
Actions i przechowywanie artefaktów należy utrzymać w dostępnych darmowych
limitach konta. Operator ustala częstotliwość, zakres lig, budżet minut i
retencję przed aktywowaniem harmonogramu; nie należy automatycznie kupować
dodatkowego limitu. Ograniczenie częstotliwości oznacza mniej obserwowanych
meczów, a nie zgodę na dopisanie brakujących prognoz.

Retencja musi obejmować wszystkie okna potrzebne do końcowej oceny. Przed
wygaśnięciem artefaktów trzeba przenieść je do trwałego, bezpłatnego archiwum
operatora lub zmniejszyć zakres eksperymentu. Brak pełnego archiwum wyklucza
potwierdzenie integralności. Harmonogram pobierania nie publikuje produkcji;
każde późniejsze wdrożenie nadal wymaga przejścia testów projektu.
