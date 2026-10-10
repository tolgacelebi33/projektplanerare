import { ImportError, parseRows, trimToHeader, type ParsedProject } from "./exchange";
import { sv } from "../i18n/sv";

type Cell = string | number | boolean | Date | null | undefined;

/** Excel-cell till text som CSV-läsaren förstår: datum som ÅÅÅÅ-MM-DD (biblioteket ger dem som UTC-midnatt), tal utan onödiga decimaler. */
export function cellText(c: Cell): string {
  if (c === null || c === undefined) return "";
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? "" : c.toISOString().slice(0, 10);
  if (typeof c === "number") return Number.isFinite(c) ? String(c) : "";
  if (typeof c === "boolean") return c ? "true" : "false";
  return String(c);
}

/** Bladen i en Excel-fil till text. Första bladet med minst en rubrikrad och en datarad används, tomma rader hoppas över. */
export function sheetsToRows(sheets: { sheet: string; data: Cell[][] }[]): { sheet: string; rows: string[][]; skipped: string[] } {
  const skipped: string[] = [];
  for (const s of sheets) {
    const rows = trimToHeader(s.data.map((r) => r.map(cellText)).filter((r) => r.some((c) => c.trim() !== "")));
    if (rows.length >= 2) return { sheet: s.sheet, rows, skipped: sheets.filter((x) => x !== s).map((x) => x.sheet) };
    skipped.push(s.sheet);
  }
  throw new ImportError(sv.ex.xlsxEmpty);
}

export async function parseXlsx(file: Blob, name: string): Promise<ParsedProject> {
  const { default: readExcelFile } = await import("read-excel-file/universal");
  let sheets: { sheet: string; data: Cell[][] }[];
  try { sheets = (await readExcelFile(file)) as { sheet: string; data: Cell[][] }[]; }
  catch { throw new ImportError(sv.ex.xlsxBroken); }
  const { sheet, rows, skipped } = sheetsToRows(sheets);
  const parsed = parseRows(rows, name, undefined, { fractionProgress: true });
  if (sheets.length > 1) parsed.warnings.unshift(sv.ex.xlsxSheet(sheet, sheets.length - 1, skipped.length ? skipped.join(", ") : ""));
  return parsed;
}
