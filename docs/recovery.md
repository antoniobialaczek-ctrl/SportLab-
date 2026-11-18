# Pochodzenie istniejącego projektu

Stan odczytany 18 listopada 2026 przez uwierzytelniony konektor Vercel:

- Projekt: `sportlab-2-analizy`, `prj_RwRNH4UzLmDCfdzVFyhpcq8AfXpz`.
- Wdrożenie bazowe: `dpl_3SxXb7J6wXzNpyBLe6whBd6oPoXR` (READY, production).
- Istniejący adres: `https://sportlab-2-analizy.vercel.app`.
- Źródła wdrożenia: `src/index.html`, `src/api/scores.js`, `src/api/details.js`, `src/api/model.js`.

Katalog roboczy nie zawierał kodu. Repozytorium `antoniobialaczek-ctrl/SportLab-` było puste, bez gałęzi i commitów. Nie inicjalizowano ani nie zmieniano go zdalnie.

Pełny HTML odzyskano z istniejącej strony produkcyjnej. SHA-256 bazowego HTML:

```
d25323d842a9c714c13ac35bf53c524af4480d768241802145aab161b97ad5e4
```

Zachowano bazowy układ, kolory, style, nawigację po dyscyplinach i ligach, wyszukiwanie, filtrowanie wyników i modal szczegółów. Dotychczasowe style i skrypt wydzielono do `public/`; skrypt rozbudowano o rzeczywiste raporty i analizy.

Odczyt źródeł API z Vercel zwracał ucięte treści dla `scores.js` i `details.js`. Ich kontrakty i widoczną logikę zachowano w modularnej implementacji z walidacją i testami. Stare `/api/model` zwracało ręcznie zapisane liczby (NBA i Premier League), bez kodu odtwarzającego ten test. Zastąpiono je wynikami obliczanymi z dołączonej historii; starych liczb nie przeniesiono do nowych raportów.

Nie zmieniano ustawień Vercel, domen ani wdrożenia produkcyjnego.
