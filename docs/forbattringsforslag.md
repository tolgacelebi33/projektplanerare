# Förbättringsförslag, efter genomgång av Microsoft Planner, Asana och monday.com

Skrivet 2026-10-11. **Underlag och förbehåll:** jag har läst officiella sidor där de gick att hämta (Asanas sida om projektvyer, Microsofts supportsidor via sökning, monday.coms hjälpartiklar via sökning) och annars tredjepartsguider och användarforum. Jag har inte använt programmen själv och inte sett deras aktuella gränssnitt. Uppgifter om vad som ingår i vilken licens är från tredje part och kan vara inaktuella. Förslagen är mina bedömningar av vad som passar den här appen (en användare, lokalt, förvaltning och projekt), inte en kravlista.

## Vad de tre gör som vi inte gör

| Område | Planner | Asana | monday |
|---|---|---|---|
| Vyer | Tavla (bucket), Rutnät, Schema, Diagram, Tidslinje (Premium) | Lista, Tavla, Kalender, Tidslinje (Gantt) | Tabell, Kanban, Gantt, Tidslinje, Kalender, Belastning, Karta, Fil, Diagram, Dashboard, Formulär |
| Kort / rad | Förfallodatum, ikoner för framsteg och prioritet, etiketter, valbart att visa beskrivning, checklista eller bilaga på kortet | Förfallodatum, ansvarig, antal deluppgifter | Valfria kolumner (över 35 typer) |
| Egna fält | Premium | Egna fält (val, flerval, tal, text), per vy att visa eller dölja | Kolumntyper: status, person, rullista, formel, tidslinje med mera |
| Delaktiviteter | Checklista (med nästlad checklista) | Deluppgifter upp till 5 nivåer | Subitems |
| Automation | Begränsad | Regler (när något händer, gör något) | Recept (över 200) |
| Återkommande | Återkommande uppgifter | Återkommande uppgifter (användare rapporterar att beroenden och regler inte följer med) | Via automation som skapar poster enligt schema |
| Beroenden | Alla fyra typer med fördröjning (Premium) | I tidslinjen | Slut-till-start och start-till-start i Gantt, kritisk linje, baslinje |
| Kapacitet | Belastning (Premium) | Belastning (betalnivå) | Belastningsvy |
| Annat | Min dag, Mina uppgifter, kopiera plan, Copilot | Mina uppgifter, godkännanden, milstolpar som typ, portföljer, formulär | Spegel och koppla tavlor, dashboards, formulär, gästtillgång |

## Små förbättringar (information och bekvämlighet)

1. **Mer information på kort och rader, valbart.** Planner låter användaren välja vad som visas på kortet. Förslag: en inställning "Visa på kortet" för boarden (datum, ansvarig, prioritet, beskrivningens första rad, serie och nästa tillfälle, framsteg). Idag visar korten ett fast urval. Ansvarig visas som initialer.
2. **Förfallna poster tydligare.** Vi vet redan vad som är försenat (härlett). Visa det som tydlig markering i listan och som snabbfilter.
3. **Snabbfilter ovanför listan:** Försenade, Denna vecka, Utan ansvarig, Utan datum, Mina (när det finns användare). Idag finns sök, dölj klara och Filtrera.
4. **Gruppera och sortera boarden efter något annat än status:** ansvarig, prioritet eller grupp (monday grupperar Kanban efter vilket fält som helst, Planner efter bucket, ansvarig, prioritet eller etikett). Din Kategori-kolumn passar som grupperingsnyckel.
5. **Etiketter (taggar) på poster**, flera per post, med filter. Planner har 25 färgade etiketter per plan. För din data: system (M3, Qlik, Antura), typ av möte, med mera.
6. **Checklista på en post** (Planner, Asana): enkla kryssrutor med räknare "3 av 5" på kort och rad, och framsteg som kan följa checklistan. Idag finns en framstegsprocent som man skriver in.
7. **Länkfält:** en eller flera länkar per post (Teams, SharePoint, Forms, Qlik-app). Idag får man klistra in länkar i beskrivningen.
8. **Senaste uppdatering:** en liten logg per post (datum och text), som Asanas kommentarer och monday.coms updates, med den senaste raden synlig på kortet. Passar förvaltning där man vill veta "vad hände sist".
9. **Duplicera en post** (Planner kopierar uppgifter) och **mall för en serie** (spara ett möte med upprepning som mall).
10. **Nästa tillfälle på serier:** på en återkommande milstolpe visa "Nästa: 2 nov" i stället för tolv lika rader, och en vy som döljer tillfällen som passerat.
11. **Dagens datum och helg** syns redan; lägg till en markering för "denna vecka" i listan.
12. **Importen kan visa en förhandsgranskning** (kolumner som känns igen, grupper som skapas, antal poster och serier) innan den läggs in. Idag får man bara ett meddelande efteråt, och ångra.

## Medelstora förbättringar

13. **Kalendervy** (Asana, monday): månad och vecka med poster och milstolpar. Passar dina återkommande möten och styrgrupper bättre än en tidslinje. Dra för att flytta datum.
14. **Min vecka:** en lista över det som är försenat, idag och denna vecka över alla projekt (Plannerns Min dag och Asanas Mina uppgifter). Särskilt när du har flera projekt.
15. **Egna fält:** användardefinierade kolumner (text, tal, datum, rullista) per projekt, som visas som kolumner i listan och på kort (Asana, monday). Importen lägger idag okända kolumner i beskrivningen. Med egna fält kan de i stället bli riktiga kolumner som går att filtrera och gruppera på.
16. **Sparade vyer och filter:** spara en kombination av vy, filter, gruppering och kolumner under ett namn (Asana har flera egna vyer per projekt, monday har vyer per tavla).
17. **Enkla regler** (monday-recept, Asanas regler), som fasta val i Inställningar i stället för ett eget språk: "när status blir Klar, sätt framsteg 100", "när ett tillfälle i en serie blir klart, skapa nästa efter det sista". Asana-användare rapporterar att återkommande uppgifter och regler inte alltid samverkar, så reglerna bör vara få och tydliga.
18. **Fler beroendetyper och fördröjning** (Planner Premium har alla fyra typerna med fördröjning, monday har slut-till-start och start-till-start). Idag finns bara slut-till-start utan fördröjning.
19. **Baslinje** (monday): spara planen vid en tidpunkt och visa den som en tunn stapel under den verkliga, för att se glidning i projekt.
20. **Belastning per person:** en vy över ansvariga mot veckor (antal poster eller summa av en uppskattning). Planner, Asana och monday har den. Mest nytta när fler än du själv har uppgifter, så den hör ihop med konton.

## Stora förbättringar

21. **Exportera till kalender (.ics)** för milstolpar och möten, eller en prenumerationslänk senare. Mycket användbart för återkommande möten: de hamnar i Outlook. Går att göra helt lokalt som filexport.
22. **Rapport och utskrift:** en sida med antal per status, försenade, kommande milstolpar och projektets period, och utskrift eller export av Gantt som bild eller PDF att visa för andra (monday har dashboards, Asana rapportering).
23. **Portföljvy:** en rad per projekt (period, framsteg, status, antal försenade), som Asanas portföljer. Du har flera projekt och kan få fler.
24. **Formulär för inkommande behov** (monday Form, Asana Forms). I din data nämns Forms som kanal för Qlik-behov. En enkel väg är import från ett Forms-export, som redan går att läsa som CSV eller Excel; ett eget formulär kräver en server och hör ihop med konton.
25. **Konton, delning och synk** (väntar enligt dig). Det som i Planner, Asana och monday gör mest för team: ansvarig som riktig person, notiser, delade projekt och kapacitet.
26. **Säkerhetskopia och återställning:** schemalagd påminnelse, en knapp som sparar allt som en fil, och återställ från en fil. Inte med i de tre programmen (de ligger hos leverantören), men viktig här eftersom allt ligger i webbläsaren.

## Min rekommenderade ordning för den här appen

1. Små saker som ger mest för din användning: 1 (valbart på kort), 2 och 3 (förfallna och snabbfilter), 10 (nästa tillfälle) och 7 (länkar).
2. 13 (kalender) tillsammans med 21 (.ics), eftersom du just har fått återkommande möten.
3. 15 (egna fält) och 4 (gruppera boarden), eftersom din import redan har kolumner som inte passar modellen.
4. 6 (checklista) och 8 (senaste uppdatering) för förvaltningsdelen.
5. 14 (Min vecka) när du har fler projekt, och 26 (säkerhetskopia) när som helst: den är liten och skyddar mot det enda som kan förstöra data.
6. Beroenden, baslinje, belastning, portfölj och konton sist: de ger mest vid flera användare och större projekt.
