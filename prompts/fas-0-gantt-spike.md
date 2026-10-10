# Fas 0: Gantt-spik

Läs `CLAUDE.md` först. Arbetsreglerna där gäller. Särskilt: verifiera innan du påstår, säg osäkerhet först, hämta versioner och licenser från källan.

## Syfte

Avgöra om ett färdigt gantt-bibliotek klarar våra krav, innan något annat byggs. Gantten är projektets största risk. Detta är en spik: kasta gärna koden efteråt, behåll rapporten.

Bygg **inte** en egen gantt som lösning. Om inget kandidatbibliotek klarar kraven, rapportera det och stanna.

## Förutsättningar

- Endast frontend. Ingen backend, ingen databas, ingen auth, ingen hosting.
- Vite + React + TypeScript (se antaganden i `CLAUDE.md`). Byt endast om ett kandidatbibliotek kräver något annat, och motivera i rapporten.
- Data kommer från fixtures bakom `DataStore`-gränssnittet i `CLAUDE.md`. Alla anrop är `async`, med laddnings- och felläge. Biblioteket får inte läsa fixturen direkt.
- `design/tokens.css` ska importeras och användas. Inga råa HEX-värden i komponenter.
- Typsnittsfiler kopieras av användaren till `fonts/` (gitignorerad). Saknas de, ska reservfonter fungera.

## Steg

### 1. Hitta och granska kandidater

Utgå från denna lista, **hämtad ur minnet och inte verifierad**, och sök efter fler om du hittar rimliga:
Frappe Gantt, gantt-task-react, SVAR React Gantt, DHTMLX Gantt, Bryntum Gantt, Syncfusion Gantt, Highcharts Gantt.

För varje kandidat, hämta från källan (registry, repo, LICENSE-fil) och skriv in i rapporten:
- version och datum för senaste release
- licens, och om den tillåter slutna, flerparts-/SaaS-användning (flagga GPL/AGPL och betalda licenser tydligt, bedöm inte juridiken, bara flagga)
- om gratisversionen innehåller de funktioner som kraven nedan ställer (många håller beroenden, hierarki eller drag bakom betalnivå)
- React-kompatibilitet och TypeScript-typer
- aktivitet i repot (senaste commits, öppna issues som rör kraven)

Stryk kandidater som redan här inte klarar licens eller funktionsnivå. Motivera varje strykning. Prototypa de 2-3 mest lovande.

### 2. Fixturdata

Skapa två fixtures som följer datamodellen i `CLAUDE.md`:
- **liten:** 1 projekt, ca 20 items, 3 nivåer av hierarki, 8 beroenden, minst en milstolpe och minst ett item i varje status.
- **stor:** ca 300 items, 4 nivåer, ca 100 beroenden.

### 3. Krav och test

Varje krav ska ha ett test eller, om det inte går att automatisera, manuella teststeg. Skriv "automatiserat" eller "manuellt, ej körbart av mig" per krav. Gör inget krav "godkänt" utan körning.

| # | Krav | Bevis |
|---|---|---|
| 1 | Hierarki visas och grupper kan fällas ihop och ut | test eller skärmbild |
| 2 | Beroenden (slut-till-start) ritas som pilar | skärmbild |
| 3 | Dra en stapel flyttar start och slut. Ändringen går genom `DataStore.updateItem` | test: efter drag är datumen i storen ändrade |
| 4 | Dra i stapelns kant ändrar bara ena datumet | test |
| 5 | Beroende uppdateras vid flytt: vad biblioteket gör (flyttar efterföljare, varnar, eller inget) dokumenteras | test + beskrivning |
| 6 | Zoomnivåer dag, vecka, månad | manuellt eller test |
| 7 | Milstolpe visas som egen symbol | skärmbild |
| 8 | Status-tokens styr stapelns färg, 1 px svart kontur, ikon eller text för status | skärmbild |
| 9 | Stor fixture: tid till första rendering och upplevd draghastighet, mätt i devtools (förslag på gräns: första rendering under 1 s lokalt, drag utan märkbar fördröjning. Gränsen är vår gissning, redovisa mätvärdet) | mätning |
| 10 | Datum är rena datum utan tidszon. Visa att drag över sommartid/vintertid inte ger fel dag (24 mars - 1 april 2026 räcker som testfall) | test |
| 11 | Titlar använder titelfonten, brödtext Söhne. Rapportera hur gemener renderas i NB Architekt om filen finns, annars "ej testat" | skärmbild |
| 12 | Tangentbord och skärmläsare: rapportera vad biblioteket stödjer. Kravet är rapport, inte godkänt/underkänt | beskrivning |

Automatiserade tester: Vitest för datalogik och `DataStore`, Playwright för drag. Om drag inte går att automatisera i ett bibliotek, säg det och ge manuella steg.

### 4. Rapport

Skriv `docs/gantt-spike-rapport.md`:
1. Tabell över alla granskade kandidater (version, licens, release-datum, funktionsnivå gratis/betald, beslut och skäl).
2. Kravtabellen per prototypad kandidat: godkänt, underkänt eller ej testat, med bevis (testnamn eller skärmbildssökväg).
3. Det som misslyckades eller var otydligt. Tydligt, utan omskrivningar.
4. Rekommendation: vilket bibliotek, eller "inget klarar kraven", med de tre största kvarvarande riskerna.
5. Lista över allt du antog men inte kunde verifiera.

## Leverans och stopp

- Fungerande prototyp för rekommenderat bibliotek, körbar med `npm install && npm run dev`, och `npm test` grönt för det som är automatiserat.
- Rapporten ovan.
- Logga beslut i `docs/beslut.md`.
- **Stanna här.** Börja inte fas 1. Sammanfatta i chatten i högst tio rader: rekommendation, vad som är bevisat, vad som är oklart.
