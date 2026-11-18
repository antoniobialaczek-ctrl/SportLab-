# Struktura i granice odpowiedzialności

```text
index.html                    dotychczasowy układ SportLab 3.1
public/                       skrypt i style interfejsu
api/                          endpointy zgodne z Vercel
src/data/                     pobieranie, normalizacja i walidacja źródeł
src/models/                   odrębne modele, testy chronologiczne i bramki publikacji
src/server/                   bezpieczny odczyt raportów i analizy opisowe
scripts/                      import historii, ocena, build, lokalny serwer
tests/                        testy automatyczne na jawnie sztucznych danych testowych
data/history/                 znormalizowane, rzeczywiste zakończone mecze
data/reports/                 odtwarzalne raporty oceny
.github/workflows/            kontrole i cykliczne pobieranie; bez wdrożeń
dist/                         wynik builda, pomijany w repozytorium
```

## Przepływy

1. Interfejs pobiera wyniki z `/api/scores`; szczegóły meczu pobiera z `/api/details`. Błędy części źródeł są widoczne. Brak źródła nie oznacza wyprodukowania meczu ani procentu.
2. Importer odpytuje wyłącznie dozwolone trasy źródła. Zakończone mecze po walidacji trafiają do historii. Opisowy bieżący boxscore nie jest cechą historycznego modelu.
3. Ocena sortuje historię po czasie i separuje ligi. Wynik może wpłynąć na model dopiero po `resultAvailableAt`, ściśle wcześniejszym od kolejnego prognozowanego meczu. Mecze równoczesne nie przekazują sobie wyników.
4. Kalibracja wykorzystuje wcześniejszą próbę. Końcowy test pozostaje niezależny od dopasowania i wyboru kalibracji. Weryfikacja raportuje rzeczywistą liczebność i błędy; próbki demonstracyjne pozostają tylko w testach.
5. `/api/model` odczytuje zapisany raport. Raport niepowstały z walidacji, przestarzały lub niezgodny z historią nie uprawnia do publikowania prognoz. Statusy braku danych i ograniczenia pochodzenia są częścią odpowiedzi.

## Trwałość i koszt

Nie zapisujemy zbiorów w pamięci funkcji Vercel jako trwałej bazy. Historia jest lokalnym/repozytoryjnym artefaktem, a zadanie GitHub Actions zachowuje kolejne zbiory w artefaktach do przeglądu. Aktualizacja publicznego raportu następuje dopiero przez kolejne przetestowane wdrożenie. Nie dodajemy płatnych baz, schedulerów ani dostawców danych.

Dane z publicznego API mają ograniczenia dostępności i mogą zostać później poprawione. Gdy źródło nie podaje dokładnego historycznego momentu publikacji, wynik otrzymuje jawne przybliżenie `conservative-24h`. Taki zbiór nie stanowi certyfikowanej migawki historycznej i blokuje bieżące prognozy do czasu potwierdzenia pochodzenia danych.

## Wdrożenie

Node ESM bez bibliotek runtime. Vercel buduje statyczne `dist/` oraz natywne funkcje `api/*.js`, do których dołączane są `src/` i `data/`. Build uruchamia testy; workflow nie wydaje polecenia wdrożenia ani promocji. Obecne ustawienia konta i wdrożenie produkcyjne pozostają poza zmianami kodu.
