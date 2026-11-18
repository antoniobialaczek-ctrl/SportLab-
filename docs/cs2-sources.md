# Weryfikacja darmowych źródeł CS2

Sprawdzono 18 listopada 2026. **CS2 pozostaje niedostępne**: nie potwierdziliśmy bezpłatnego, dostępnego dla tego projektu źródła historii profesjonalnych meczów z tożsamością uczestników, wynikiem serii i czasami pozwalającymi badać prognozy przedmeczowe. Nie zastępujemy brakujących danych statystykami CS:GO, rankingami ani losowymi wynikami. Ten dokument opisuje sprawdzone źródła; nie dowodzi, że żadne odpowiednie źródło nie istnieje.

## Wyniki sprawdzenia

| Źródło | Dostęp i zakres | Decyzja dla SportLab |
| --- | --- | --- |
| [GRID Open Access: dokumentacja](https://grid.helpjuice.com/client-help/open-access-quickstart) | Central Data pozwala znaleźć serie po czasie i uczestnikach; Series State zwraca zakończenie i wynik. Wymagany klucz. [Zakres OA](https://grid.helpjuice.com/client-help/what-apis-does-an-open-access-developer-have-access-to) nie obejmuje Series Events ani File Download. | Kandydat po uzyskaniu rzeczywistego bezpłatnego dostępu i sprawdzeniu praw do danego zastosowania. Nie zakładamy dostępu do płatnych interfejsów. |
| [GRID: bieżące plany](https://grid.gg/plans/) | Dawny adres `https://grid.gg/open-access/` przekierowuje na stronę planów komercyjnych. Odrębne bezpłatne uprawnienia wspomniane na tej stronie dotyczą profesjonalnych drużyn LoL/VALORANT, nie SportLab. | Starszy poradnik OA nie potwierdza aktualnego prawa tego projektu do bezpłatnych danych CS2. Nie zamawiamy planu. |
| [FACEIT Data API](https://docs.faceit.com/docs/data-api/) i [specyfikacja](https://docs.faceit.com/api/data/) | Oficjalne dane FACEIT; wymaga [klucza aplikacji](https://docs.faceit.com/getting-started/authentication/api-keys/). Specyfikacja ma `game`, `started_at`, `finished_at`, wynik oraz identyfikatory uczestników. Nie jest to archiwum wszystkich profesjonalnych rozgrywek CS2. | Potencjalne oddzielne badanie rozgrywek FACEIT po uzyskaniu klucza i zweryfikowaniu pokrycia. Nie mieszamy drużyn matchmakingowych z profesjonalnymi ani bieżącego Elo z historycznymi cechami. |
| [Cito/CS2 API: plany](https://cs2-api.org/pricing/) i [historia](https://cs2-api.org/historical-data/) | Darmowy plan: 500 zapytań miesięcznie, historia do 30 dni, brak zastosowań komercyjnych. Pełne archiwum wymaga planu płatnego. Dane historyczne obejmują również CS:GO. | Nie jest darmowym pełnym archiwum. Klucza nie ma; nie uruchamiamy płatnego planu ani nie traktujemy wyników CS:GO jako CS2. |
| [Liquipedia API](https://liquipedia.net/api) i [warunki](https://liquipedia.net/api-terms-of-use) | Istnieją drogi API z ograniczeniami zastosowania i dostępu; nie uzyskaliśmy danych LPDB ani potwierdzenia uprawnień projektu. Próba odczytu strony API zwróciła blokadę 403. | Nie implementujemy parsera stron ani obchodzenia ochrony. Brak odpowiedzi API nie jest pustą historią. |
| [PureSkill.gg](https://docs.pureskill.gg/datascience/) | Dane CS2 z matchmakingu/FACEIT, licencja CC BY-NC-SA 4.0. Subskrypcja jest bezpłatna, ale eksport wymaga usług AWS z opłatami za storage/transfer. Nazwy i identyfikatory graczy są usuwane lub zastępowane. | Nie spełnia wymagania wyłącznie darmowych usług; ponadto nie zapewnia mapowania profesjonalnych uczestników SportLab. Nie uruchamiamy eksportu AWS. |
| [Valve Regional Standings: katalog danych](https://github.com/ValveSoftware/counter-strike_regional_standings/tree/main/data) | Sprawdzony katalog zawiera tylko `matchdata_sample_20230829.json`. Bieżące publikacje w innych katalogach to rankingi, nie pełny dziennik wyników meczów. | Próbka z sierpnia 2023 poprzedza premierę CS2. Nie importujemy jej do modelu CS2 ani nie wyprowadzamy wyników z dzisiejszych rankingów. |
| [CS2RB: karta zbioru](https://github.com/williambishop-research/cs2rb/blob/main/DATASET_CARD.md) | Publiczny badawczy zbiór CC BY 4.0: 5725 meczów ze stycznia–sierpnia 2026 i osobny późniejszy holdout. Celem jest zwycięzca rundy z bieżącego stanu gry. Identyfikatory meczów są wewnętrzne; brak nazw drużyn i tożsamości zawodników. | Nadaje się do innego zadania badawczego. Nie pozwala powiązać historii drużyn z terminarzem SportLab. Stany z trwającej rundy byłyby przyszłą informacją dla prognozy przedmeczowej. |
| [HLTV: warunki, punkt 2.2](https://www.hltv.org/terms) | Warunki zabraniają data mining i web scrapingu strony oraz jej zawartości. | Nie dodajemy scrapera, obchodzenia blokad ani automatycznej zależności od nieoficjalnej biblioteki nazywanej „HLTV API”. Publiczny plik społecznościowy z etykietą CC0 nie potwierdza samodzielnie prawa do danych źródłowych ani jakości czasów. |

## Rzeczywiste próby dostępu

Wykonano pojedyncze, nieuwierzytelnione zapytania przez skonfigurowany proxy środowiska. Nie tworzono kont, kluczy ani subskrypcji. Odpowiedzi z 18 listopada 2026:

| Zapytanie | Odpowiedź |
| --- | --- |
| `POST https://api-op.grid.gg/central-data/graphql`, treść `{ "query": "{ allSeries { totalCount } }" }` | HTTP 200, ale GraphQL `errors[].extensions.errorType: UNAUTHENTICATED`, `data: null`. Nie traktujemy 200 jako powodzenia pobrania. |
| `GET https://open.faceit.com/data/v4/games/cs2` | HTTP 403, JSON z błędem autoryzacji `err_f0`. |
| `GET https://api.citoapi.com/api/v1/cs2/matches/recent?limit=1` | HTTP 401, `MISSING_API_KEY`. |
| `GET https://liquipedia.net/api` | HTTP 403, strona ochrony Cloudflare. |
| GitHub Contents API: `ValveSoftware/counter-strike_regional_standings/contents/data` | Prawidłowa lista jednego pliku `matchdata_sample_20230829.json`; nie pobierano starej próbki do historii CS2. |

Bezpośredni Node `fetch` początkowo nie korzystał z proxy i zgłaszał błędy DNS/połączenia. Powyższe statusy pochodzą z ponowionych zapytań Python `urllib.request` przez proxy, a nie z interpretacji awarii sieci jako braku danych u wydawcy.

## Warunki podłączenia źródła

Źródło można włączyć po potwierdzeniu bezpłatnego dostępu zgodnego z zastosowaniem SportLab i sprawdzeniu rzeczywistych odpowiedzi. Adapter musi rozróżnić CS2 i CS:GO, serie i pojedyncze mapy, walkowery i normalne wyniki, zapewnić stabilne identyfikatory uczestników oraz walidować paginację, daty UTC, zakończenie, korekty i błędy. Bieżący ranking, skład lub agregat kariery nie może stać się cechą dawnych prognoz.

Sam `finished_at` oznacza koniec meczu, a nie czas opublikowania danej wersji wyniku. Pobranie historii dzisiaj nie odtwarza jej dawnych korekt. Dopóki nie ma wiarygodnego archiwalnego stanu albo zebranych na bieżąco, niezmiennych obserwacji i dostatecznego niezależnego testu, prognozy pozostają wstrzymane. Pozostałe dyscypliny i testy aplikacji mogą działać bez CS2; nie należy czekać na brakujący klucz, by dokończyć ich wdrożenie.
