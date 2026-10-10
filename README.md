# Projektplanerare

Personligt verktyg för projekt och roadmap: tidslinje (Gantt) och årshjul, med grupper, uppgifter och milstolpar, beroenden, ångra/gör om, sök, export (JSON och CSV) och import (JSON, CSV och Excel .xlsx). Svenska och engelska. Data sparas i webbläsaren (localStorage), det finns ingen server och ingen inloggning.

Live: https://project.celebi.io

## Köra lokalt

```bash
npm install
npm run dev        # http://localhost:5173
npm run test:unit  # enhetstester
npm test           # enhetstester och end-to-end (Playwright)
npm run build      # bygger till dist
```

`?fixture=small` eller `?fixture=large` ger provdata i minnet (sparas inte).

## Publicering

Varje push till `main` kör `.github/workflows/pages.yml`: enhetstester, bygge och publicering via GitHub Pages. Adressen kommer från `public/CNAME`.

## Dokument

- `CLAUDE.md`: arbetsregler, datamodell och designregler.
- `docs/beslut.md`: beslut, avvikelser och vad som är overifierat.
- `docs/gantt-spike-rapport.md`: jämförelsen som ledde till valet av Gantt-bibliotek.

## Licenser

- Gantt-biblioteket är DHTMLX Gantt (MIT enligt paketets LICENSE-fil, inte juridiskt bedömt).
- Typsnitten (Söhne, NB Architekt Pro) är licensierade och ägs av sina upphovsmän. De ligger i `fonts/` med användarens bekräftelse av webblicens för `project.celebi.io`. Återanvänd dem inte utan egen licens.
