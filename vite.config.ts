import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Typsnitten i /fonts ingår i bygget (användaren bekräftade webblicens för project.celebi.io, 2026-10-10, se docs/beslut.md).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  // Excel-läsaren laddas först när en .xlsx väljs. Förbygg den så att utvecklingsservern inte laddar om sidan mitt i en import.
  optimizeDeps: { include: ["read-excel-file/universal"] },
});
