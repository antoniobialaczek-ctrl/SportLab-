# Weryfikacja SportLab 3.1

Data: 2026-11-18T10:06:55.640Z

Kod przygotowano lokalnie. Nie wykonano wdrożenia ani promocji produkcyjnej.

## Dane rzeczywiste

Zapisano 25038 zakończonych meczów z ESPN dla zakresu zapytań 2025-01-01–2026-11-17. Amerykański dzień terminarza może obejmować początek kolejnego dnia UTC.

| Zbiór | Zapisane mecze |
|---|---:|
| nba | 2513 |
| football | 672 |
| tennis | 19142 |
| nhl | 2711 |

W tenisie wykluczono 3 niespójne rekordy. Identyfikatory, adresy źródeł i powody znajdują się w `data/history/tennis.json` (`exclusions`). Nie poprawiano ich przez zgadywanie.

## Końcowy test chronologiczny

| Liga | Test | Trafność | Brier modelu | Brier bazowy | Kalibracja wybrana wcześniej |
|---|---:|---:|---:|---:|---|
| nba | 489 | 67.1% | 0.2119 | 0.2474 | nie |
| eng.1 | 135 | 41.5% | 0.2106 | 0.2205 | tak |
| nhl | 492 | 57.9% | 0.2423 | 0.2485 | tak |
| wta | 2323 | 61.8% | 0.2287 | 0.2500 | nie |
| atp | 1424 | 61.1% | 0.2290 | 0.2499 | nie |

To wyniki badawcze na retrospektywnych danych. Nie stanowią potwierdzenia jakości przyszłych typów. Modele nie używają w kolejnych prognozach wyniku przed `resultAvailableAt`; dla ESPN jest to jawne przybliżenie początku meczu + 24h. Brakuje archiwalnych migawek pozwalających certyfikować faktyczną dostępność wyników w przeszłości. Wszystkie prognozy pozostają wstrzymane; CS2 jest niedostępne.

Najnowsze wyniki z buforem dostępności późniejszym niż chwila oceny nie wchodzą do testu. Rekordy przy granicach kalibracji/wyboru mogą zostać objęte przerwą chroniącą przed wyciekiem; suma partycji może być mniejsza od całej historii.

## Kontrole

- `npm run check`: składnia, 4 pliki testowe i build — przeszły.
- Bezpośrednie uruchomienie testów: API/analizy 17, dane 25, metryki 7, modele 11 — łącznie 60 testów przeszło.
- Przeglądarka Chromium/Playwright: rzeczywiste zapytanie NBA dla 2025-11-17 zwróciło 8 kart; modal pokazał 10 wcześniejszych wyników oraz statystyki i liderów zawodników.
- Wyszukiwanie, przełączanie dyscyplin, zamykanie modala Escape oraz brak danych/prognoz CS2 — przeszły.
- Tenis wyświetla indywidualne mecze, a nie turnieje jako mecze.
- Widoki 1280×900 i 390×844: brak błędów JavaScript i poziomego przepełnienia całej strony.
- Style CSS zachowano z bazowego HTML bez zmiany reguł.

## Granice sprawdzenia

Build lokalny i przepływ aplikacji zostały sprawdzone. Nie uruchamiano zdalnego builda Vercel ani testów we wdrożeniu podglądowym. Nie włączono zdalnego harmonogramu: workflow jest przygotowany w plikach, ale istniejące repozytorium GitHub było puste i nie zostało zmienione. Po umieszczeniu kodu w repozytorium workflow tworzy artefakty danych, a nie publikuje strony. Dostępność nieoficjalnego ESPN i kompletność archiwum nie mają gwarancji.
