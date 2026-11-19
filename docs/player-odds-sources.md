# Kursy na statystyki zawodników — sprawdzenie źródła

Sprawdzenie: 19 listopada 2026. Wykorzystano istniejące darmowe, nieoficjalne ESPN API, bez klucza i bez bezpośredniego odpytywania bukmachera.

Kolekcja jest dostępna pod `https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/events/{id}/competitions/{id}/odds/100/propBets?limit=1000`. Jest również wskazywana przez `propBets.$ref` w źródłowej odpowiedzi kursów danego meczu. Kolekcję należy stronicować i porównać jej licznik. Pełny aktualny roster obu drużyn pochodzi z `https://site.api.espn.com/apis/site/v2/sports/{route}/teams/{teamId}/roster`.

Użyte rynki mają jednoznaczny próg `N+`: NBA Points Milestones (218), Assists Milestones (219), Rebounds Milestones (220); NHL Shots on Goal Milestones (231); piłka Shots Milestones (266). Przy całkowitej statystyce `20+` odpowiada zdarzeniu powyżej 19,5. Cena dotyczy wyłącznie tego progu, zawodnika, drużyny i meczu. Nie tworzymy ceny przeciwnej strony.

W niektórych odczytach zwykłe Total Points, Total Assists i Total Rebounds występują w parach bez oznaczenia kierunku. Ich kolejność nie dowodzi powyżej/poniżej, dlatego takie pary są odrzucane. W rekordach z jawnym `current.over` używana jest bieżąca cena tego pola; ceny otwarcia nie uzupełniają braków.

Tożsamość DraftKings jest potwierdzana w istniejącym `pickcenter` tego samego meczu, a przynależność zawodnika wyłącznie przez numeryczne ID w rosterach. Przypisania po nazwie nie są stosowane. To nie potwierdza przyszłego występu ani składu.

Zakres rozliczenia wynika z [DraftKings Kansas House Rules](https://boothillcasino.com/wp-content/uploads/2026/10/KS-DKE-House-Rules-v13.0-EN-CLEAN-9.2.26.pdf): NBA z dogrywką (str. 47); indywidualne statystyki NHL z dogrywką i bez serii karnych (str. 115–116); piłka w czasie podstawowym i doliczonym, bez dogrywki i serii karnych (str. 138). Sprawdzenie tych zasad wygasa po 30 dniach. Zasady uczestnictwa zawodnika i lokalna dostępność bukmachera wymagają osobnego sprawdzenia.

`lastUpdated` jest zachowywane jako `sourceRecordUpdatedAt`, czyli czas aktualizacji rekordu ESPN. Nie ma potwierdzenia, że oznacza czas zmiany ceny u bukmachera: `quotedAt` pozostaje puste, a `freshness` ma wartość `unverified`. Interfejs powinien pokazać czas rekordu oraz oznaczenie „odczyt”, bez deklarowania aktualnej oferty.

Przyszłe lub niepoprawne daty i brak daty są odrzucane. Dodatkowa reguła prezentacji odrzuca rekordy starsze niż 24 godziny; ten limit nie dowodzi świeżości ceny. Statyczny rekord sprzed 18 minut może być pokazany po nowym odczycie z zachowanym rzeczywistym czasem rekordu i niepotwierdzoną świeżością kursu. Czas faktycznej obserwacji jest zapisywany po pobraniu danych, a odczyt wygasa najpóźniej po pięciu minutach lub przy rozpoczęciu meczu. Ponowne pobranie nie zmienia zapisanego czasu rekordu.

W rzeczywistym sprawdzeniu o 09:53 UTC 19 listopada 2026 trzy nadchodzące mecze NBA (401910019, 401910020, 401910021) zawierały przyszłe czasy `12:xxZ`; ich ceny zostały odrzucone. NHL 401892742 zwrócił 18 poprawnych cen progów strzałów z aktualizacją 09:46Z. To dowód działania odczytu w danym momencie, nie gwarancja dostępności przy każdym odświeżeniu.

Cena pozostaje informacyjnym odczytem źródła. Nie jest prawdopodobieństwem, dowodem opłacalności ani niezależnie zweryfikowanym wskazaniem modelu. Nie trafia automatycznie do dziennika.
