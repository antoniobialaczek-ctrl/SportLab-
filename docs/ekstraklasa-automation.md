# Oddzielna aktualizacja Ekstraklasy

Workflow [ekstraklasa.yml](../.github/workflows/ekstraklasa.yml) działa codziennie o 06:47 UTC i może być uruchomiony ręcznie. Nie zmienia zarejestrowanego eksperymentu ESPN, jego źródeł, modeli ani dotychczasowych workflow. Publikuje wyłącznie opisowe dane na gałęzi `sportlab-ekstraklasa-data`; nie wdraża aplikacji na Vercel.

Źródłem jest darmowy, udokumentowany dzienny endpoint TheSportsDB dla ligi 4422. Odczyt obejmuje ostatnie siedem zakończonych dni UTC i startuje najwyżej raz na sześć sekund, bez automatycznych ponowień. Odpowiedź 429 lub inna awaria zatrzymuje proces. Poprzedni kompletny plik pozostaje bez zmian. Darmowy endpoint zwraca do trzech spotkań dziennie, więc zbiór ma jawnie niepełne pokrycie.

Wcześniejsze obserwacje i najwcześniejszy moment zaobserwowania wyniku są zachowywane. Niezmieniony wynik zachowuje swoją dostępność; korekta uzyskuje nowy moment dostępności i zapis poprzedniej wartości. Nie rekonstruujemy rzekomego momentu publikacji w przeszłości. Wynik nie staje się dostępny wcześniej niż po 24 godzinach od rozpoczęcia spotkania.

Publikacja wymaga przejścia testów i walidacji całego nowego zbioru. Gałąź danych zawiera tylko `ekstraklasa.json` i `manifest.json`. Manifest wskazuje niezmienny commit z plikiem, jego rozmiar i SHA-256. Kod strony ponownie sprawdza tożsamość, integralność i świeżość aktualizacji. Publikacja korzysta z wbudowanego tokenu workflow GitHub; nie wymaga nowych sekretów ani płatnej usługi. Zwykły push bez wymuszania chroni przed nadpisaniem równoległej aktualizacji.

Ręczne polecenia dla przygotowanego checkoutu:

```sh
# Przywrócenie poprzednich obserwacji (GH_TOKEN w środowisku workflow)
node scripts/publish-ekstraklasa.js restore
# Atomowa aktualizacja ostatnich siedmiu zakończonych dni
node scripts/refresh-ekstraklasa.js
npm run check
# Wyłącznie publikacja danych, po testach
node scripts/publish-ekstraklasa.js publish
```

Przy pierwszej publikacji brak gałęzi danych wymaga poprawnego lokalnego zbioru startowego. Po przerwie przywrócenie może odczytać stary poprawny zbiór, aby zachować wcześniejsze obserwacje; nie przedstawia tego stanu jako świeżej aktualizacji. Do nowej publikacji potrzebny jest udany odczyt i aktualny plik.
