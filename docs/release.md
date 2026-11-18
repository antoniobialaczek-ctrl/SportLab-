# Uruchomienie SportLab 3.1

Przygotowano 18 listopada 2026. Kod rozwija istniejącą stronę SportLab, zachowując jej układ i adresy API.

- Repozytorium: https://github.com/antoniobialaczek-ctrl/SportLab-
- Produkcja docelowa: https://sportlab-2-analizy.vercel.app
- Automatyzacja: `.github/workflows/history.yml`, co cztery godziny.
- Aktualne dane: osobna gałąź `sportlab-data`, manifest ze skrótami plików i niezmiennym commitem danych.
- 30 364 zapisane mecze; 10 dostępnych lig piłkarskich. Ekstraklasa i CS2 pozostają niedostępne po weryfikacji źródeł.
- 73 testy automatyczne, kontrola składni i build przeszły przed przygotowaniem publikacji.
- Pierwszy rzeczywisty zapis prospektywny: 42 migawki odpowiedzi, 26 zaobserwowanych wyników i 43 prognozy badawcze zapamiętane przed meczami. Brak rozliczonej próby nie jest przedstawiany jako skuteczność.

Wdrożenie jest sprawdzane oddzielnym testem HTTP i w przeglądarce. Identyfikatory zdalnych uruchomień, wdrożenia i wynik końcowy będą zapisane po zakończeniu tych operacji. Nie deklarujemy ukończenia walidacji modeli, która wymaga przyszłych, rzeczywiście rozegranych i rozliczonych meczów.
