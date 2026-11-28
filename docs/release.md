# Uruchomienie SportLab 3.1

Sprawdzono: 2026-11-18T10:48:29.220679+00:00.

- Produkcja: https://sportlab-2-analizy.vercel.app
- Repozytorium: https://github.com/antoniobialaczek-ctrl/SportLab-
- Przetestowany commit kodu: `fa96741f757b710ea1528b3639b69700f7c08ca1`.
- Wdrożenie produkcyjne: `dpl_CHWy5chmZYGUnYhAyis7gssdxNDE`.
- Wdrożenie podglądowe: `dpl_DJWr4a776ccW1vJXdrW1ft2oQd6S`.

## Wykonane kontrole

73 testy, kontrola składni i build przeszły lokalnie, w GitHub Actions i podczas budowania na Vercel. Testy są izolowane od źródeł sieciowych również w środowisku Vercel; transport i integralność aktualizacji mają oddzielne testy.

[CI kodu](https://github.com/antoniobialaczek-ctrl/SportLab-/actions/runs/44287594475) zakończyło się powodzeniem. [Drugie uruchomienie harmonogramu](https://github.com/antoniobialaczek-ctrl/SportLab-/actions/runs/44287649677) również przeszło: odtworzyło wcześniejszy stan, pobrało migawki i historię, oceniło modele, wykonało testy, zachowało archiwum i opublikowało dane. Workflow jest aktywny co cztery godziny (`17 */4 * * *`). Zachowuje dwie ostatnie pełne kopie własnego archiwum; drugie archiwum miało około 2,4 MB.

Podgląd sprawdzono z uwierzytelnionego konektora Vercel, bez wyłączania ochrony. Następnie przygotowano build produkcyjny z wyłączonym automatycznym przypisaniem domen. Jego adres techniczny przeszedł pełny test HTTP i przeglądarkowy przed promocją. Potwierdzono, że główna domena nadal wskazywała poprzednią wersję podczas testów. Dopiero potem promowano sprawdzony build i przywrócono zwykłe ustawienie przypisywania domen.

Publiczny adres po promocji przeszedł ponownie testy: 8 meczów NBA dla 2025-11-17, szczegóły 27 zawodników, 10 wcześniejszych meczów w analizie, 10 lig piłkarskich w raportach, poprawna odpowiedź 400 dla błędnej daty i 405 dla błędnej metody. Przeglądarka potwierdziła filtry, modal, statystyki i widok mobilny bez przepełnienia oraz bez błędów JavaScript. W przeglądzie logów tego wdrożenia z 15 minut nie znaleziono wpisów error/fatal. Brak wpisów nie zastępuje wykonanych testów HTTP.

Przeglądarka testowa korzystała z zarządzanego proxy i ignorowała jego niezaufany certyfikat w kontekście automatyzacji. Produkcyjnego TLS i ustawień bezpieczeństwa aplikacji nie zmieniano; testy HTTP korzystały z normalnej weryfikacji certyfikatów.

## Dane i ograniczenia

Zapisano 30 364 zakończone mecze, w tym 5 998 z 10 lig piłkarskich. Trzy niespójne rekordy tenisowe mają jawne wykluczenia. Raporty są odświeżane przez osobną gałąź `sportlab-data`; manifest wskazuje niezmienny commit i SHA-256 plików. API używa aktualnych, zweryfikowanych plików GitHub, a w razie awarii jawnie oznacza powrót do danych wdrożenia. Nie publikuje przy tym nowego kodu produkcji.

Rozpoczęto rzeczywiste zbieranie archiwalnych migawek i niezmiennych prognoz badawczych przed meczami: pierwszy zapis obejmował 42 migawki, 26 zaobserwowanych wyników i 43 prognozy oczekujące na późniejsze wyniki. Nie ma jeszcze dostatecznej rozliczonej próby do potwierdzenia końcowej walidacji. Prawdopodobieństwa pozostają ukryte.

CS2 oraz Ekstraklasa pozostają niedostępne po sprawdzeniu źródeł. Szczegóły CS2: [audyt](cs2-sources.md). Trasa ESPN `soccer/pol.1` zwraca HTTP 400; alternatywa football-data.co.uk ogranicza automatyczne zastosowania AI w swoich warunkach, a sprawdzone publiczne katalogi OpenFootball nie miały aktualnego archiwum polskiej ligi. Nie obchodzono ograniczeń i nie zastępowano braków danymi losowymi.

Nie włączono płatnych usług, planów ani dostawców danych. Potwierdzenie działania systemu nie oznacza potwierdzenia przyszłej skuteczności modeli; dalsza walidacja wymaga rzeczywistych przyszłych spotkań.


## Piłkarskie typy dnia i zdjęcia — 25 listopada 2026

Opublikowano wynik po 90 minutach, sumy goli z dokładnymi kursami, wykresy ostatnich wyników oraz cztery zweryfikowane zdjęcia piłkarzy. Wszystkie 354 testy i build przeszły lokalnie oraz w CI; publiczny przepływ sprawdzono na rzeczywistych danych, osobno od kontrolowanych dodatnich przypadków listy dnia. Szczegóły, zakres i ograniczenia: [dowody wydania](football-daily-picks-release.json).


## Widoczne kierunki piłkarskie bez blokowania kursem — 25 listopada 2026

Karty piłkarskie na początku strony pokazują kierunek z formy, argumenty przeciw, wynik/gole/BTTS, ostatnie występy oraz dom/wyjazd także bez kursu. Publiczny test rzeczywistych danych potwierdził cztery różne widoczne kierunki oraz brak podmieniania ceny X2 kursem zwycięzcy. Testy: 366/366, kompilacja i CI poprawne. [Dowody wydania i ograniczenia](deep-football-analysis-release.json).


## Analiza NBA i uzasadnienia typów — 27 listopada 2026

Opublikowano osobne porównanie drużyn NBA i uzasadnienia dla punktów, asyst i zbiórek. Zwycięzca, suma punktów i linie zawodników mają konkretne argumenty oraz kontrargumenty. Zachowano widok zawodników na początku strony, wykresy, własne linie i ścisłe dopasowanie kursów. 384 testy i kompilacja poprawne; publiczna wersja sprawdzona na rzeczywistych danych oraz oddzielnych kontrolowanych przypadkach. [Dowody i ograniczenia](deep-nba-analysis-release.json).


## Głębsza analiza NHL — 28 listopada 2026

Opublikowano analizę drużyn NHL oraz uzasadnienia typów na strzały na bramkę. Wynik i sumy goli mają jawny zakres z dogrywką i karnymi, a statystyki zawodników wykluczają serię karnych. Potwierdzone zasady dostawcy pozwalają wyświetlać standardowe kursy meczowe. 400 testów i kompilacja poprawne; rzeczywiste publiczne dane, kursy, wykresy, ręczna linia oraz regresja NBA sprawdzone. [Dowody i ograniczenia](deep-nhl-analysis-release.json).


## Piłka: rożne, żółte kartki i strzały — 28 listopada 2026

Opublikowano dodatkowe porównania sum rożnych, żółtych kartek, strzałów i strzałów celnych po 90 minutach, z argumentami za i przeciw, wykresami oraz własną linią. 418 testów i kompilacja przeszły lokalnie, w CI i podczas budowania na Vercel. Publiczna strona potwierdziła po osiem wcześniejszych meczów obu drużyn dla każdej z czterech statystyk Leeds–Coventry, zgodność wykresów z odpowiedzią źródła, niezależne ręczne linie i widok mobilny bez błędów JavaScript. Kursów dla nowych rynków ani reguł rozliczania kartek nie zgadywano. [Dowody wydania i ograniczenia](football-extra-analysis-release.json).
