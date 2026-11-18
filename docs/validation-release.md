# Uruchomienie niezależnej walidacji

Sprawdzono 2026-11-18T12:04:45.674604+00:00.

Produkcja: https://sportlab-2-analizy.vercel.app — panel „Postęp niezależnego testu”.

Kod: `89e0805cec8740d265b74c5f1ca8cc3a0bf55a9f`. Podgląd `dpl_HyacVAL1wrGR4hcVrfP1s1AG2c6R` i build produkcyjny `dpl_BGtMwpqFpusHqa3VkFRfGZ4Ty5ME` przeszły build z testami przed promocją. Testy API i przeglądarki wykonano na adresie technicznym produkcji przed zmianą głównej domeny, a następnie ponownie na publicznym adresie. Nowy panel z licznikami przetestowano również po rozwinięciu na ekranie 390 px. Brak błędów JavaScript i przepełnienia strony. W przeglądzie logów tego wdrożenia z 15 minut nie znaleziono wpisów error/fatal.

[100 testów kodu](https://github.com/antoniobialaczek-ctrl/SportLab-/actions/runs/44298987463) przeszło lokalnie, w GitHub Actions i w buildzie Vercel. Obejmują m.in. brak wycieku z późniejszych wyników, odtwarzanie treningów i wszystkich rozliczeń, zmianę zapisanej temperatury lub metryk, zamknięty test, korekty po zakończeniu, przerwy w harmonogramie i odwołane mecze.

Dwa rzeczywiste uruchomienia automatyzacji zakończyły się powodzeniem:

- https://github.com/antoniobialaczek-ctrl/SportLab-/actions/runs/44299030227
- https://github.com/antoniobialaczek-ctrl/SportLab-/actions/runs/44299613122

Drugi przebieg odtworzył ten sam protokół, nie rozpoczynał nowego eksperymentu. Rejestracja: `2026-11-18T11:55:25.577Z`; skrót reguł: `adfd4f9658868362decb088b3bf2bd0a357c3b8fbec382562bd8f6231fda934f`. Obejmuje 14 niezależnych lig/cykli. Każdy ma z góry ustalone 60, 45 i 150 zapisów w kolejnych etapach. Test końcowy wymaga minimum 100 prawidłowych wyników, pokrycia, niepewności i przewagi względem bazy. Pełne reguły: [validation-plan.md](validation-plan.md).

Na moment kontroli wszystkie ligi były w etapie kalibracji. Wcześniejsze 43 zapisy pozostały poza nową próbą jako badawcze; nie wypełniano liczników danymi wstecz. Brak skończonej próby nie jest przedstawiany jako procent skuteczności. Proces jest uruchomiony, a potwierdzenie jakości modelu nadal wymaga rzeczywistych przyszłych meczów oraz końcowego przeglądu. Prawdopodobieństwa nie są automatycznie odblokowywane.

Nie dodano płatnych źródeł ani usług. Cadencja pobierania pozostaje co cztery godziny. Dodatkowe pobrania służą wyłącznie rozliczeniu zapisanych wcześniej, nierozstrzygniętych spotkań i są ograniczone do 64 na przebieg.
