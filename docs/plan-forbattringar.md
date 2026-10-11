# Plan: förbättringar efter genomgång av Planner, Asana och monday

Beslutad av användaren 2026-10-11. Siffrorna är numren i `docs/forbattringsforslag.md`.

**Gör:** 1 till 19 och 22. **Väntar:** 20 (.ics), 21 (rapport), 23 (formulär), 24 (konton), 25 (säkerhetskopia).

## Principer

- **Allt är valfritt.** Varje funktion kan slås av eller på under Inställningar (nya grupper: Kort, Listan, Boarden, Funktioner). Standardvärdena väljs så att appen ser ut ungefär som idag för den som inte rör något, utom det som löser ett fel.
- **Data bara läggs till.** Nya fält på poster och projekt är valfria, följer med i JSON-export, import och kopia, och en gammal fil eller sparad data fungerar oförändrad (schemaversionen är kvar, med test).
- **Varje fas är klar när:** enhetstester, e2e i Chromium, WebKit och Firefox, och slumptesterna är gröna, beslutet är loggat i `docs/beslut.md`, och fasen är committad och pushad (CI grön).
- **Inget byggs som kräver server.** Allt är lokalt, som idag.

## Faser (i den ordning jag tar dem)

**Fas A: information och snabbhet** (1, 2, 3, 4)
- Inställningar: `cardFields` (datum, ansvarig, prioritet, beskrivning, serie, framsteg), markera förfallna, snabbfilter på/av, boardens gruppering.
- Kort och rader visar valda fält. Förfallna märks i listan (understruket och fetstil, inte bara färg).
- Snabbfilter: Försenade, Denna vecka, Utan ansvarig, Utan datum (i `filterView`, med tester).
- Boarden grupperar på status, ansvarig, prioritet eller grupp. Att dra ett kort ändrar rätt fält. Ordningen (`board_rank`) gäller i alla grupperingar.

**Fas B: mer på varje post** (5, 6, 7, 8, 9, 10)
- Nya valfria fält på posten: `labels` (etiketter, flera), `checklist` (punkter med klar), `links` (länkar), `log` (uppdateringslogg med datum). Panelen får avsnitt, korten och raderna visar räknare, filter finns för etiketter.
- Duplicera en post, och en serie kan sparas som mall. Nästa tillfälle visas på serier ("Nästa: 2 nov") och en inställning döljer tillfällen som passerat.
- Import förstår kolumnerna Etiketter, Länk och Checklista.

**Fas C: egna fält och sparade vyer** (14, 15)
- Projektet får fältdefinitioner (text, tal, datum, rullista) och posterna värden. Fälten visas som kolumner och kort, går att filtrera och gruppera på. Import kan mappa okända kolumner till fält i stället för beskrivning.
- Sparade vyer: namn, vy, filter, gruppering, kolumner.

**Fas D: nya vyer** (12, 13, 19, 22)
- Kalender (månad och vecka, dra för att flytta datum). Min vecka (försenat, idag, denna vecka, över alla projekt). Belastning (ansvariga mot veckor). Portfölj (en rad per projekt).
- Var och en är ett val i vyväljaren och kan döljas under Inställningar (Funktioner).

**Fas E: beroenden och plan** (17, 18)
- Beroendetyper (slut-start, start-start, slut-slut, start-slut) med fördröjning i dagar, i modellen, lagret, panelen och Gantt. Baslinje: spara planen och visa den som tunn stapel.
- Det här rör kärnan (flytt av efterföljare, cykelkontroll, import och export), så det tas efter de andra och med extra tester.

**Fas F: regler och import** (16, 11)
- Några fasta regler som val i Inställningar (inget eget regelspråk): status Klar sätter framsteg 100, ett klart tillfälle i en serie skapar nästa efter det sista, med mera.
- Förhandsgranskning vid import: vilka kolumner som känns igen, vilka grupper och serier som skapas, antal poster, innan det läggs in.

## Risker och hur jag möter dem

- **Datamodellen växer.** Alla nya fält är valfria och valideras i `validateItemShape`. Ett test läser en gammal exportfil och en gammal sparad post.
- **Verktygsfältet blir fullt.** Nya vyer och snabbfilter läggs i vyväljaren och inställningar; telefonbredd testas för varje fas.
- **Beroendena (fas E).** Egen testmatris för varje typ och läge, och slumptesterna körs med de nya typerna.
- **För mycket på en gång.** Varje fas committas för sig, så att det går att stanna eller backa efter vilken som helst.

## Frågor som kan påverka planen

- Vilka etiketter, egna fält och regler vill användaren ha som standard? (Jag föreslår tomt från start.)
- Ska Min vecka och Portföljvyn vara synliga från start, eller bara efter att man slagit på dem? (Jag föreslår på.)
