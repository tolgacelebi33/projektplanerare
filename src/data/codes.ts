import type { Item, ItemType } from "./types";
import { RuleError } from "./rules";

/**
 * Läsbara koder: projekt `PRJ0001`, grupp `GRP0001-003`, milstolpe `MIL0001-0041`, uppgift `TSK0001-0123`.
 * Projektets nummer delas ut en gång per arbetsyta och återanvänds aldrig, och varje posttyp räknar sin egen följd inom projektet.
 * Därför kan två koder aldrig vara lika. En post kan inte byta projekt, så koden är stabil. Siffrorna har en lägsta bredd men växer vid behov
 * (aldrig avklippta), och ett räkneverk som skulle nå största exakta heltal ger ett fel i stället för att börja om.
 */
export type Counters = { epic: number; milestone: number; task: number };
const PREFIX: Record<ItemType, string> = { epic: "GRP", milestone: "MIL", task: "TSK" };
const WIDTH: Record<ItemType, number> = { epic: 3, milestone: 4, task: 4 };
const PROJECT_WIDTH = 4;
const pad = (n: number, w: number) => String(n).padStart(w, "0");

export const projectCode = (n: number): string => `PRJ${pad(n, PROJECT_WIDTH)}`;
export const itemCode = (type: ItemType, projectNo: number, n: number): string => `${PREFIX[type]}${pad(projectNo, PROJECT_WIDTH)}-${pad(n, WIDTH[type])}`;

export function parseProjectCode(code: string | undefined): number | null {
  const m = /^PRJ(\d{4,})$/.exec(code ?? "");
  const n = m ? Number(m[1]) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
export function parseItemCode(code: string | undefined): { type: ItemType; project: number; n: number } | null {
  const m = /^(GRP|MIL|TSK)(\d{4,})-(\d+)$/.exec(code ?? "");
  if (!m) return null;
  const type = (Object.keys(PREFIX) as ItemType[]).find((t) => PREFIX[t] === m[1])!;
  const project = Number(m[2]), n = Number(m[3]);
  return Number.isSafeInteger(project) && Number.isSafeInteger(n) && n > 0 ? { type, project, n } : null;
}

/** Nästa nummer efter `cur`. Fel (aldrig omstart) om största exakta heltal nåtts. */
export function nextNumber(cur: number): number {
  if (!Number.isSafeInteger(cur) || cur >= Number.MAX_SAFE_INTEGER) throw new RuleError("code_exhausted", "Räkneverket för koder är slut");
  return cur + 1;
}

export const emptyCounters = (): Counters => ({ epic: 0, milestone: 0, task: 0 });
export const validCounters = (c: unknown): c is Counters => !!c && typeof c === "object" && (["epic", "milestone", "task"] as const).every((k) => Number.isSafeInteger((c as Record<string, unknown>)[k]) && (c as Record<string, number>)[k] >= 0);

/** Räkneverken som gäller: det sparade, men aldrig lägre än något nummer som redan används (skydd mot en trasig eller handgjord post). */
export function countersFor(saved: unknown, items: Pick<Item, "code" | "type">[], projectNo: number): Counters {
  const c = validCounters(saved) ? { ...saved } : emptyCounters();
  for (const i of items) { const p = parseItemCode(i.code); if (p && p.project === projectNo && p.type === i.type && p.n > c[i.type]) c[i.type] = p.n; }
  return c;
}
