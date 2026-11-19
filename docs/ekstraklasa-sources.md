# Ekstraklasa — oddzielne darmowe źródło opisowe

Zweryfikowano 19 listopada 2026. Publiczne, oficjalne API [TheSportsDB](https://www.thesportsdb.com/documentation) udostępnia ligę `4422` — Polish Ekstraklasa — z identyfikatorami meczów i drużyn, czasami UTC, statusem i wynikami. Działa publiczny klucz `123` opublikowany w dokumentacji; nie utworzono konta, abonamentu ani płatnego klucza.

[Warunki API](https://www.thesportsdb.com/docs_terms_of_use.php) pozwalają korzystać z treści oficjalnych endpointów w projektach deweloperskich. Darmowy wariant nie pozwala publikować aplikacji w sklepach aplikacji; SportLab pozostaje witryną Vercel. Nie pobieramy stron WWW TheSportsDB ani zdjęć o niepotwierdzonej licencji. Źródło jest oznaczane jako TheSportsDB. Źródło ma charakter społecznościowy i nie gwarantuje kompletności ani niezmienności wyników.

## Sprawdzone odpowiedzi i granice

| Oficjalny endpoint v1, z publicznym kluczem `123` | Odczyt i ograniczenie |
| --- | --- |
| `eventsday.php?d=2026-11-21&l=4422` | Trzy rzeczywiste mecze Ekstraklasy: Zagłębie–Górnik, Cracovia–Jagiellonia, Radomiak–Wisła Kraków. Dokumentowany darmowy limit to trzy spotkania. |
| `eventsnextleague.php?id=4422` | Następny mecz Piast–Korona, 20 listopada 2026 o 17:00 UTC. Darmowy limit: jedno spotkanie. |
| `eventspastleague.php?id=4422` | Lech–Zagłębie 2:2, status `FT`, 8 listopada 2026. Darmowy limit: jedno spotkanie. |
| `eventsseason.php?id=4422&s=2026-2027` | Zwraca 15 meczów, zgodnie z dokumentowanym darmowym limitem. Nie jest pełnym sezonem. |
| `eventslast.php?id={teamId}` | Dokumentacja ogranicza darmowy odczyt do jednego domowego spotkania. Nie przedstawiamy go jako pięciu lub dziesięciu ostatnich meczów zespołu. |

Administratorzy TheSportsDB [potwierdzają stosowanie UTC](https://www.thesportsdb.com/forum_topic.php?t=5849), także gdy timestamp nie ma końcowego `Z`. Adapter dodatkowo wymaga zgodności daty, czasu i timestampu. Odrzuca przełożone spotkania, nieznany status, niespójnych uczestników, przyszły wynik końcowy, brak wyniku oraz dogrywki i karne. Prefix `tsdb-` oddziela identyfikatory od ESPN. Nie dopasowujemy uczestników po podobieństwie nazw.

Wykonano też pojedynczy test starego `eventsround.php`, który zwracał dziewięć spotkań. Nie ma go w aktualnej dokumentacji z limitami; importer nie wykorzystuje go do odtworzenia całego sezonu z ominięciem limitu endpointu sezonowego. Korzysta wyłącznie z dokumentowanych zapytań dziennych.

Oficjalny limit bezpłatny to 30 żądań na minutę. Pierwszą próbę importu zatrzymano po HTTP 429 bez dalszych żądań. Kolejny import zwolniono do maksymalnie dziesięciu żądań na minutę, z zapisem punktu wznowienia. Kod nie ponawia automatycznie odpowiedzi 429 ani nie zmienia klucza w celu obejścia limitu. Przy błędzie kompletny wcześniejszy zbiór pozostaje dostępny.

## Historia i publikacja

Osobny plik `data/supplemental/ekstraklasa.json` zawiera wyłącznie zaobserwowane, zakończone spotkania. Pole `firstObservedAt` zapisuje rzeczywisty czas pierwszego pobrania, a `resultAvailableAt` nie jest wcześniejsze niż ten czas ani niż 24 godziny od początku meczu. Ponowne potwierdzenie tego samego wyniku zachowuje wcześniejszą dostępność; korekta wyniku zapisuje poprzednią wartość i nowy czas obserwacji.

Nie dodajemy tych rekordów do zamrożonej historii ESPN, istniejących modeli ani zarejestrowanego eksperymentu. Udostępniają analizę opisową, nie niezależnie zweryfikowane prawdopodobieństwa. Darmowy limit trzech meczów dziennie może pomijać część kolejki. Liczebności i pokrycie pozostają jawne; brakujący mecz nie staje się wynikiem zerowym.

Automatyczne aktualizacje mają osobną gałąź `sportlab-ekstraklasa-data`. Manifest wskazuje niezmienny commit, rozmiar pliku i SHA-256. Runtime sprawdza te wartości oraz format i świeżość manifestu, a przy awarii korzysta z lokalnego zbioru z oznaczeniem fallbacku. Aktualizacja danych nie publikuje nowego kodu produkcji. Dane kursów, składów i statystyk graczy nie są dopisywane do historii jako zastępcze informacje.

## Sprawdzone alternatywy

ESPN `soccer/pol.1` pozostaje niedostępne pod dotychczasowym adresem. Aktualny katalog [OpenLigaDB](https://www.openligadb.de/) nie zawierał Ekstraklasy; nie tworzymy własnej ligi z wymyślonymi wynikami. Katalog `2026-27` [openfootball/football.json](https://github.com/openfootball/football.json) nie zawierał ligi polskiej. Nie korzystamy z football-data.co.uk ze względu na wcześniej opisane ograniczenia automatycznych zastosowań AI.
