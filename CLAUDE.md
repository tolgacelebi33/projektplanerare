# Projektplanerare (arbetsnamn)

Personligt verktyg för projekt och roadmap (lista, board, tidslinje/gantt). Byggs för en användare först, men datamodellen ska vara redo för delade team-workspaces senare. Användaren kommunicerar på svenska och engelska. Svara på svenska.

## Arbetsregler (gäller alltid)

1. **Verifiera innan du påstår.** Säg aldrig att något fungerar utan att du har kört det. Skriv vad du körde och vad resultatet var.
2. **Osäkerhet sägs först.** Om du inte har testat något, eller inte kan testa det, säg det uttryckligen innan du bygger vidare. En osäker approach är ett alternativ att diskutera, inte en lösning.
3. **Versioner och licenser från källan, inte från minnet.** Använd `npm view <paket> version time license` och paketets LICENSE-fil. Anta ingenting om underhåll, pris eller licens.
4. **Kan du inte testa automatiskt, ge manuella teststeg** och markera uttryckligen att det är otestat av dig.
5. **Misslyckas något, rapportera det rakt.** Byt inte tyst till en annan lösning och kalla det klart.
6. **Kort och direkt.** Ingen utfyllnad. Inga emojis någonstans (kod, UI, dokument, commit-meddelanden).
7. **Stanna vid faslutet.** Börja inte nästa fas utan godkännande i chatten.

## Arkitektur

### Datamodell (gäller från dag ett)

Allt ligger under `workspace_id`. En privat workspace per användare i början. Team blir då en behörighetsfråga, inte en omskrivning.

- `workspace` { id, name, created_at }
- `membership` { workspace_id, user_id, role }, role: owner | admin | member | viewer
- `project` { id, workspace_id, name, created_at }
- `item` { id, workspace_id, project_id, parent_id | null, type: epic | milestone | task, title, start, end, status, assignee_id | null, description, priority: low | normal | high | urgent, progress (heltal 0-100, fristående från status), sort_order }
- `user` { id, name }: platshållare för medlemmar tills fas 4
- `dependency` { id, workspace_id, from_item_id, to_item_id, type: finish_to_start }

Regler (ska ha tester):
- Datum är rena datum (`YYYY-MM-DD`), ingen tidszon.
- `status`: not_started | in_progress | done | blocked. "Försenad" är härledd (slutdatum passerat och inte done) och lagras inte.
- `parent_id` och beroenden får aldrig korsa workspace eller projekt.
- Beroenden får inte bilda cykler.
- Milstolpe: start = slut (antagande, bekräfta i fas 1).
- **Namn i gränssnittet: Grupp** (beslut 2026-10-10, efter monday och Asana). Den interna typen heter `epic` och ändras inte (sparad data och exportfiler). Nya poster utan val hamnar i den aktiva gruppen.
- **Epics (grupper) datum härleds** ur innehållet (tidigaste start, senaste slut bland barnen, milstolpar och nästlade epics inräknade) och sätts av `DataStore`, aldrig direkt. En epic utan innehåll behåller sina datum. Beslut 2026-10-09.
- Bara en epic kan vara förälder. Titel högst 200 tecken, beskrivning högst 5000.
- **Beroenden och datum:** projektet har läget "shift" (standard, efterföljare flyttas framåt med bibehållen längd, och en efterföljare får inte flyttas före föregångarens slut: `before_predecessor`) eller "none". Beslut 2026-10-10.
- **Export/import:** export som JSON och CSV, import av JSON, CSV och Excel (.xlsx, `src/data/xlsx.ts`, läsaren `read-excel-file`, MIT) (`src/data/exchange.ts`, `importExport.ts`), import skapar alltid ett nytt projekt och är allt-eller-inget. Kopiera projekt använder samma väg. Beslut 2026-10-10.
- **Smart import:** bara en titelkolumn krävs, kolumner och värden känns igen på synonymer, saknade datum blir idag + en vecka, och det som saknar plats i modellen läggs i beskrivningen. Dra rader i rutnätet byter ordning och epic (`planMove`). Beslut 2026-10-10.
- **Språk:** svenska (standard) och engelska, alla texter via `src/i18n/dict-sv.ts` och `en.ts`. Lägg aldrig text direkt i komponenter eller regler: lägg den i båda ordlistorna.
- **Ångra/gör om** ligger i `MemoryStore` (snapshot per skrivning, skrivningar inom 250 ms är ett steg, projekt som skapas eller tas bort nollställer historiken). Sök och "Dölj klara" filtrerar bara vyn (`filterView`), aldrig data.

### Data-gränssnitt

UI pratar aldrig direkt med lagring. Allt går genom ett asynkront gränssnitt, t.ex. `DataStore`: listProjects, createProject, updateProject, deleteProject, listUsers, listItems(projectId), createItem, updateItem(id, patch), deleteItem, listDependencies, createDependency, deleteDependency. Implementationer: `MemoryStore` (tester, provdata med `?fixture=`) och `PersistentStore` (localStorage, standardläget). Alla anrop är `async` och UI hanterar laddning och fel från start. Lagringen byts senare utan att vyerna ändras.

### Behörighetsskiss (implementeras i fas 4, modellen får inte brytas innan)

- Användare ser en workspace endast om `membership` finns.
- viewer: läsa. member: skapa och ändra items. admin: dessutom hantera medlemmar. owner: dessutom ta bort workspace.
- Test som måste finnas i fas 4: användare A kan aldrig läsa eller skriva B:s workspace.

## Design

Svedbergs grafiska riktlinjer. Källa: `Svedbergs_BrandPlatform_Grafiska_riktlinjer.pdf`, sid 16-30.

- Tokens ligger i `design/tokens.css` och importeras globalt. **Använd aldrig rå HEX i komponenter.** Bas: Aluminiumgrå `#ABA699`. Svarta detaljer och svart text (`--sv-svart`, #2C2724).
- Titlar: NB Architekt Pro R. Allt annat: Söhne (Buch 400, Kräftig 500). Typsnittsfilerna ligger i `/fonts` och ingår i bygget och i det publika arkivet: användaren bekräftade 2026-10-10 att webblicensen gäller för project.celebi.io. Reservfonter finns i tokens. Om licensen visar sig inte räcka: ta bort `fonts/` ur arkivet och bygget och publicera om (historiken i ett publikt arkiv behåller filerna, så den måste skrivas om).
- Verifiera i fas 0 hur NB Architekt renderar gemener (i riktlinjerna visas titlar som versaler). Lägg inte till `text-transform` på gissning.
- Gantt-staplar: fyllning enligt status-tokens, alltid 1 px kontur (svart, vit i Mörkt). All text i staplar är vit, 13 px, vikt 500. Pågår är Ockra (Guld blandad 55 % mot Svart, härledd för att ge 4,6 i kontrast mot vit text), Ej påbörjad är Bronsbrun i alla teman.
- Status får aldrig signaleras enbart med färg. Lägg alltid ikon eller text.
- Text: svart på ljus yta, vit på Marmorgrön, Rubinröd, Bronsbrun och Ockra. Guld, Aluminiumgrå och Glasblå får inte användas som textfärg på vit bakgrund (kontrast 1,2-2,4). Textskala via tokens `--fs-sm/md/lg` (12/13/14 px).
- Ikoner: Feather Icons enligt riktlinjerna. Kontrollera licensen i paketet innan användning.
- Grafiska element: tunna linjer (1 px), konturknappar i pillform (`--radius-pill`), etiketter i titelfonten.
- Teman: Standard (Aluminiumgrå bas, grundläge), Ljust och Mörkt. Riktlinjerna definierar inget mörkt läge, så Mörkt och Ljust är våra egna val (beställda av användaren 2026-10-09). Alla färger går via semantiska tokens per tema i `design/tokens.css` (`data-theme` på `<html>`). Statusfärger är lika i alla teman. Stapelkontur: svart i Standard och Ljust, vit i Mörkt (svart syns inte mot mörk yta).
- Logotyp: **ej beslutad** (klassisk eller kommersiell). Skapa inte en egen version av logotypen. Lämna en tom plats i headern. Regler när den kommer: fri yta minst lika stor som bokstaven S, svart logotyp inte på mörk bakgrund, vit inte på ljus.

## Faser

Varje fas har ett körbart test. Fas 0 är en spik och ska ta bort risk, inte producera produkt.

| Fas | Innehåll | Klar när |
|---|---|---|
| 0 | Gantt-spik, endast frontend med fixturdata | Rapport och fungerande prototyp, se `prompts/fas-0-gantt-spike.md` |
| 1 | Kärna i UI: projekt, items, lista, board, tidslinje. Lokal lagring bakom `DataStore` | Datamodellens regler har tester, vyerna använder bara `DataStore` |
| 2 | Riktig databas (Postgres, lokalt först), schema som migrationsfiler, ny implementation av `DataStore` | Samma tester går mot båda implementationerna |
| 3 | Import från CSV/Excel | Två riktiga gantt-ark importeras utan dataförlust |
| 4 | Auth, inbjudningar, roller, hosting, behörighetstester | A ser aldrig B:s data, bevisat av test |

Hosting, auth-leverantör, domän och e-post väljs först efter fas 1. Fas 2 kan bli större än den ser ut: lokal lagring döljer latens, konflikter vid samtidig redigering och behörigheter.

## Repo

- Tester körs med ett kommando (`npm test`) och är en del av varje fas.
- Publicering: GitHub Pages via `.github/workflows/pages.yml` på `project.celebi.io` (`public/CNAME`), `robots.txt` stänger av indexering. Genererade skärmdumpar och testloggar i `docs/` ligger i `.gitignore`.
- Beslut och avvikelser loggas i `docs/beslut.md` (datum, beslut, skäl, vad som är overifierat).

## Antaganden att bekräfta med användaren

Satta i planeringen, inte verifierade:
- UI-språk: svenska (standard) och engelska, all text via ordlistorna.
- Vite + React + TypeScript. Gantt-bibliotek: **DHTMLX Gantt Community** (MIT enligt paketets LICENSE.md, ej juridiskt bedömt). SVAR är borttaget ur appen, jämförelsen finns i `docs/gantt-spike-rapport.md`. Slutligt ramverk för fas 2 och framåt väljs senare.
- Statusfärgerna i tokens är vårt förslag, inte Svedbergs.
- Typografisidorna (sid 20-22) i riktlinjerna har inte lästs. Att NB Architekt är för titlar är användarens besked. Att Söhne gäller övrig text är ett antagande.
- Grå bas är #ABA699 (palettens Aluminiumgrå). Omslaget i PDF:en mättes som #9D998E vid rendering. Skillnaden är oförklarad.
