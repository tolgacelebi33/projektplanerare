# Fas 0: Gantt-spik, rapport

Datum: 2026-10-09. Miljö: Apple M3 Pro, macOS 26.6.2, Node 26.11.0, npm 11.20.0, Chrome Headless Shell 156.0.8078.4 (Playwright 1.64.0). Endast den webbläsaren är testad. Tidszonen i testerna är Europe/Stockholm.

Prototyper: SVAR React Gantt 2.8.0 och DHTMLX Gantt Community 10.0.3, bakom samma `DataStore`-gränssnitt. Körs med `npm install && npm run dev`, öppna `/?lib=svar` eller `/?lib=dhtmlx` (valfritt `&fixture=large`). `npm test` kör 24 enhetstester och 27 e2e-tester, alla gröna vid sista körningen. E2E kräver engångskommandot `npx playwright install chromium`.

## 1. Kandidater

Version, datum och licens är hämtade från npm-registret och LICENSE-filen i det nedladdade paketet. Repo-uppgifter från GitHub-API 2026-10-09 (`open_issues_count` räknar även pull requests). Ingen juridisk bedömning är gjord, bara flaggning.

| Kandidat | Version (release) | Licens enligt fil | Gratisnivå mot kraven | React / typer | Repo-aktivitet | Beslut |
|---|---|---|---|---|---|---|
| Frappe Gantt | 1.2.2 (2026-02-25) | MIT | Allt är gratis, men hierarki, ihopfällning och milstolpe saknas (README och källkod genomsökta) | Ingen React-wrapper i paketet. Inga typer i paketet (ingen `types`-post, inga `.d.ts`) | Senaste commit 2026-03-05, 77 öppna | Struken: kraven 1 och 7 uppfylls inte |
| gantt-task-react | 0.3.9 (2022-07-10) | MIT | Funktionsnivå ej undersökt (struken på underhåll) | Peer `react ^18` (React 19 deklareras inte) | Arkiverat repo (GitHub), senaste commit 2023-01-09, 157 öppna | Struken: arkiverat, ej underhållet |
| SVAR React Gantt | 2.8.0 (2026-10-07) | MIT | Hierarki, FS-beroenden, drag, zoom, milstolpe ingår. PRO-nivå (betald): auto-schemaläggning, kritisk linje, baslinjer, undo/redo, gruppering, WBS, export | React >=18, typer medföljer | Senaste commit 2026-10-07, 14 öppna | Prototypad |
| DHTMLX Gantt Community | 10.0.3 (2026-09-03) | MIT (LICENSE.md, "Copyright 2026 XB Software"). Se punkt 5 i avsnitt 5 | Hierarki, 4 beroendetyper, drag, zoom, milstolpe, tangentbordsplugin ingår. PRO (betald): auto-schemaläggning, kritisk linje, baslinjer, undo/redo, gruppering, arbetskalendrar, idag-linje m.m. | Ingen React-komponent i paketet (imperativ `gantt`). Typer medföljer men listar PRO-metoder som inte finns | Senaste commit 2026-09-03, 6 öppna | Prototypad |
| Bryntum Gantt | 7.3.7 (2026-09-24) | `@bryntum/gantt` är en platshållare. Provpaketet `@bryntum/gantt-trial` har licens "Commercial" | Betald | - | - | Struken: kommersiell licens |
| Syncfusion Gantt (ej2-react-gantt) | 35.1.37 (2026-09-29) | Egen licens: Community-licens (under 1 miljon USD omsättning och färre än 5 utvecklare) eller kommersiell. Annan användning tillåts inte | Villkorad | React ja | - | Struken: licensvillkor. Flaggat, ej bedömt |
| Highcharts (Gantt) | 13.1.1 (2026-09-20) | Fältet pekar på `highcharts.com/license` (kommersiell) | Betald | - | - | Struken: kommersiell licens. Gantt-modulen är inte undersökt |

Kandidater utan egen prototyp är bara granskade på papper (registry, LICENSE, README och i Frappes fall källkod). Inget av dem har körts.

## 2. Krav per prototypad kandidat

Bevis: testnamn i `e2e/requirements.spec.ts` (K1 till K12), `e2e/fonts.spec.ts`, `e2e/perf.spec.ts`, `e2e/findings.spec.ts`. Mätdata sparas i `docs/test-output/`, skärmbilder i `docs/skarmbilder/`. Alla krav utom K12 är automatiserade. K12 är en rapport.

| # | Krav | SVAR | DHTMLX |
|---|---|---|---|
| 1 | Hierarki, fäll ihop och ut | Godkänt (automatiserat, 1 klick). Se fynd F4 | Godkänt (automatiserat, 1 klick) |
| 2 | Beroenden som pilar | Godkänt: 8 länkelement, bild `svar-k2-beroenden.png` | Godkänt: 8 länkelement, bild `dhtmlx-k2-beroenden.png` |
| 3 | Drag flyttar start och slut via `updateItem` | Godkänt: 16-20 mars blev 23-27 mars, skrivning loggad i storen | Godkänt, samma |
| 4 | Kantdrag ändrar ett datum | Godkänt: patch `{end}` respektive `{start}` | Godkänt, samma |
| 5 | Beroende vid flytt (dokumentation) | Se nedan | Se nedan |
| 6 | Zoom dag/vecka/månad | Godkänt (skalrubriker och bilder) | Godkänt |
| 7 | Milstolpe egen symbol | Godkänt: romb. Se F5 | Godkänt: romb |
| 8 | Statustokens, 1 px svart kontur, ikon och text | Godkänt: beräknad bakgrund = token, kontur 1 px solid svart, glyf i stapeln | Godkänt, samma |
| 9 | Prestanda stor fixture | Se tabell nedan | Se tabell nedan |
| 10 | Sommartid 24 mars - 1 april 2026 | Godkänt (drag -7 och +7 dagar, samt en stapel över 29 mars) | Godkänt, samma. Se F6 |
| 11 | Typsnitt | Se avsnitt K11 | Se avsnitt K11 |
| 12 | Tangentbord och skärmläsare | Rapport nedan | Rapport nedan |

### K5: vad biblioteken gör med efterföljare

Test: i6 (16-20 mars) dras 14 dagar framåt så att den slutar efter efterföljaren i9 (start 24 mars). Uppmätt i båda: i9 flyttas inte, inga skrivningar för i9, ingen varning (inga element med klass som matchar violat/conflict/warn/invalid, inga `alert`/`dialog`-roller). Beroendet blir alltså brutet utan signal. Auto-schemaläggning finns i respektive PRO-nivå. Jag har inte provat PRO. `findings`-testet asserterar detta uppmätta beteende, det är inget önskat beteende.

### K9: mätvärden, stor fixture (318 items, 96 beroenden)

Dev-server med StrictMode och produktionsbygge (`vite preview`) gav nästan samma värden. Mått i headless Chromium, latens i `DataStore` satt till 0. Gränserna i spiken är gissningar och jag har inte dragit slutsats av dem.

| Mått | SVAR prod | DHTMLX prod |
|---|---|---|
| Första stapel från sidstart, median (min-max), 7 laddningar | 473 ms (461-494) | 399 ms (386-447) |
| Från "data klar" till första stapel, stor fixture | 440 ms | 371 ms |
| Samma med liten fixture (20 items) | 342 ms | 355 ms |
| Alltså växer med antal items | cirka 98 ms | cirka 16 ms |
| Staplar i DOM | 318 | 28 (virtualiserat) |
| Bildrutor under drag, median / p95 / max | 16,7 / 16,8 / 83,4 ms | 16,7 / 16,7 / 16,8 ms |
| Bildrutor över 50 ms under drag (40 musrörelser) | 2 | 0 |
| Tid för 40 musrörelser (16 ms paus) | 2057 ms | 1327 ms |
| Från mouseup till skrivning i storen | 32 ms | 1,6 ms |

Cirka 340-355 ms är fast overhead (laddning av bibliotekets kodpaket med mera, mätt med liten fixture). Upplevd draghastighet är inte bedömd av en människa. Siffrorna är bildruteintervall i headless Chromium på en M3 Pro. Större mängder än 318 items är inte mätta.

### K11: typsnitt

- NB Architekt Pro R (400) och Söhne (400 och 500) laddas (`document.fonts`, status loaded). Titeln (`h1`) använder titelfonten, brödtext Söhne, `text-transform` är `none`.
- **Gemener renderas som versaler i NB Architekt.** En sträng med gemener (inklusive å, ä, ö) och motsvarande versalsträng ger pixelidentiska bilder. Samma test med Söhne ger olika bilder, så kontrollen fungerar. Bild: `k11-typsnitt-prov.png`. Följd: rubriken "Projektplanerare" visas som versaler utan att något `text-transform` används.
- Biblioteken använde egna typsnitt i gantt-ytan (SVAR: Open Sans, DHTMLX: Inter). Efter överskrivning av bibliotekens typsnittsvariabler används Söhne i båda.
- Typsnittsfilerna är kopierade till `fonts/` (gitignorerad). Jag döpte om `NB Architekt Pro R Regular.otf` till `NB_Architekt_Pro_R_Regular.otf` så att det matchar `tokens.css`.
- Produktionsbygget kopierade först typsnittsfilerna till `dist/assets/`. Det bryter mot regeln i `CLAUDE.md`. En Vite-plugin tar nu bort dem ur bygget, och `tests/build-no-fonts.test.ts` bevisar att `dist` saknar typsnittsfiler.

### K12: tangentbord och skärmläsare (rapport, ej godkänt/underkänt)

Skärmläsare är inte körd av mig (kan inte). Det som är mätt:

- **SVAR:** gridden har roller (`row`, `gridcell`) och `aria-expanded` på rader. Staplarna har `tabindex="-1"` och ingen `role` eller `aria-label` från biblioteket. Statustext för skärmläsare ligger i vår egen mall. Tab når gridden. Efter klick på en rad flyttar pil ned markeringen (i2 till i4 efter två tryck).
- **DHTMLX:** staplarna har `role="img"` och en `aria-label` på engelska ("Task: ... Start date: ... End date: ..."), ingen `tabindex`. Tab når inte staplarna. Tangentbordsplugin är aktiverat, men pil ned ändrade inte markeringen i mitt test (fokus hamnade på `div[i2]`). Mer är inte undersökt.

Manuella steg som ingen har körts: stäng av musen och försök fälla en grupp, flytta en stapel och skapa ett beroende med tangentbordet; kör VoiceOver över gridden och en stapel.

## 3. Det som misslyckades eller var otydligt

- **F1, föräldrars datum.** Båda biblioteken räknar om en epics datum från barnen när ett barn dras. SVAR skriver detta via `update-task`: i testet fick i5 `{start}` och i4 `{start, end}` skrivna, och i4:s slut ändrades från 10 april till 9 april fast inget barn flyttades i änden, eftersom milstolpen som ligger på sista dagen inte räknas in. DHTMLX skriver ingenting för föräldrarna, så vyn visar nytt datum (23 mars) medan lagrade datumet är oförändrat (16 mars). Test: `findings.spec.ts`, F1. Vår datamodell lagrar epic-datum explicit. Detta måste avgöras före fas 1.
- **F2, externa anrop.** SVAR hämtar sitt ikontypsnitt från `cdn.svar.dev`. Med `Willow fonts={false}` försvinner fällpilarna helt (upptäcktes på skärmbild, mitt första test missade det). Jag hittade inget npm-paket med ikontypsnittet. Självhosting är inte löst. DHTMLX gör inga externa anrop efter att typsnittsvariabeln skrivits över (utan överskrivning hämtades Inter från `fonts.gstatic.com`). Test: `findings.spec.ts`, F2.
- **F3, slutdatum är exklusivt.** SVAR:s `inclusiveEnd: true` ändrar inte stapelns bredd (uppmätt: 2-13 mars gav 11 dagars bredd). Båda biblioteken behandlar slutdatum som exklusivt. Adaptern lägger till en dag vid läsning och drar bort en vid skrivning (`src/proto/persist.ts`).
- **F4, SVAR och första klicket (oförklarat).** Vid fönsterstorlek 1280x800 gav första klicket på fällpilen ingen händelse alls, andra klicket fällde. Vid 1800x900 räcker ett klick. Orsaken är inte isolerad. Hover före klick hjälpte inte. Samma beteende i en minimal SVAR utan mina mallar. Den slutliga sviten kör 1800x900, så testet K1 döljer detta. Det måste undersökas vid vanliga fönsterstorlekar.
- **F5, SVAR-stil.** Fyra överskrivningar behövdes: typsnittsvariabeln sätts på ett inre temaelement (min yttre överskrivning förlorade), yttre `.wx-bar` har egen blå fyllning som lyste fram runt min stapel, milstolpen var lila, progressmarkören visas. Överskrivningarna beror på interna klassnamn. DHTMLX behövde en överskrivning för milstolpen (vit romb på vit yta).
- **F6, DHTMLX och drag.** Två artefakter som gav fel dag i mina första körningar och som jag felsökte innan jag drog slutsats: (1) draget slutade nära fönstrets högerkant och DHTMLX autoskrollade tidslinjen (+9 dagar i stället för +7), (2) musrörelser utan paus kastades (förlusten växte med dragets längd). Efter paus mellan musrörelserna blev alla avstånd exakta, även över sommartidsbytet. Det visar att sommartid hanteras rätt, men även att autoskroll finns och att drag med mycket snabba musrörelser inte är provat med riktig mus.
- **F7, SVAR och veckor.** Ingen svensk locale levereras och veckan började på söndag. Jag gjorde en egen locale (`src/proto/svarLocale.ts`, måndag som veckostart, svenska månadsnamn). DHTMLX har måndag som standard. Månadsnamn skrev jag in manuellt. Bibliotekens egna texter (formulär, tips) är engelska i båda.
- **F8, mina testers svagheter.** Mina första K1, K7 och K8 passerade trots att fällpilar saknades, milstolpen var lila och staplarna hade blå kant. Jag fångade det på skärmbilder och skärpte testerna (ikonen måste skilja sig från tom platshållare, bara vår romb får ha fyllning, yttre stapel måste vara transparent).
- **F9, DHTMLX handtag.** Kanthandtagen för resize är dolda tills man hovrar stapeln.
- **F10, staplar som inte ritas.** DHTMLX ritar bara synliga staplar, så en stapel utanför bild finns inte i DOM. Tester som drar måste först scrolla dit.

## 4. Rekommendation

**SVAR React Gantt.** Det är en bedömning. Båda bibliotek klarar kraven 1-8, 10 och 11 i testet.

För SVAR: det är en React-komponent som tar `tasks` och `links` som props och rapporterar ändringar som händelser, vilket passar att vyerna bara ska prata med `DataStore`. DHTMLX är ett imperativt globalt objekt som jag fick slå in själv, med omladdning (`clearAll` och `parse`) vid varje dataändring. SVAR har aktivare repo (senaste commit 2026-10-07).

Mot SVAR: mer av den uppmätta friktionen ligger där (F2, F4, F5, F7), sämre mätvärden vid drag och rendering (alla 318 staplar i DOM, två bildrutor över 50 ms), och beroende av ett externt ikontypsnitt. DHTMLX var snabbare och hade inga externa anrop. Om risk 2 eller 3 nedan slår till är DHTMLX reservalternativet.

De tre största kvarvarande riskerna:

1. **Betalda funktioner.** Auto-schemaläggning, kritisk linje, baslinjer, undo/redo och gruppering ligger i PRO i båda biblioteken. Priser och villkor är inte undersökta. Utan dem blir beroenden obevakade (K5) och vi måste bygga eventuell logik själva.
2. **Modell mot bibliotek.** Biblioteken räknar om och skriver epic-datum (F1) och slutdatum är exklusivt (F3). Fas 1 måste bestämma om epics datum härleds ur barnen eller lagras. Prestanda över 318 items är inte mätt, och SVAR ritar alla staplar i DOM.
3. **Extern och skör integration.** Ikontypsnittet från `cdn.svar.dev` måste självhostas före produktion (olöst), överskrivningarna beror på interna klassnamn (F5), och klickproblemet vid 1280 px (F4) är oförklarat.

## 5. Antaganden som inte är verifierade

1. Allt är testat i en enda webbläsare (Chrome Headless Shell 156) på en maskin. Safari, Firefox, riktig Chrome och pekskärm är inte testade.
2. Skärmläsare är inte körd. K12 är en mätning av attribut och tangenter, inte en användarupplevelse.
3. Drag är testat med syntetiska Playwright-musrörelser med pauser. Riktig mus och riktig användares hastighet är inte provade. "Upplevd draghastighet" är bara uppmätt som bildruteintervall.
4. Prestandagränserna i spiken är gissningar och jag har inte bedömt mot dem. Mätningen gäller 318 items.
5. DHTMLX-licensen: `LICENSE.md` i paketet och GitHub-API säger MIT (Community Edition, "Copyright 2026 XB Software"). Det avviker från vad jag trodde i förväg (GPL med betald standardnivå). Hur DHTMLX och XB Software (som också står bakom SVAR) hänger ihop är inte undersökt. Ingen juridisk bedömning är gjord.
6. Priser, villkor och SaaS-tillåtlighet för PRO-nivåerna är inte undersökta.
7. Statusfärgerna i `tokens.css` är vårt förslag. Kontrastsiffrorna i kommentarerna där är inte omräknade av mig. Jag har inte läst om Svedbergs PDF i den här fasen.
8. Statusikonerna i staplarna är enkla Unicode-former (cirkel, halv cirkel, fylld cirkel, kvadrat), inte Feather Icons. Feather-licensen är inte kontrollerad eftersom paketet inte användes. De ska bytas i fas 1.
9. Bibliotekens egna texter är engelska. Sidans egna texter ligger i `src/i18n/sv.ts`.
10. Milstolpe: start = slut är antaget och bekräftas i fas 1 (som `CLAUDE.md` säger). Datamodellen tillåter ingen annan.
11. `window.__store` exponeras för tester och ska inte finnas i produktkod.
12. Provmiljön har ingen Git-repo. `.gitignore` med `fonts/` finns, men inget `git init` är gjort.
