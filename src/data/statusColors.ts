import type { Status, StatusDef } from "./types";

/**
 * Färger för statusar. Varje status har en egen färg ur Svedbergs palett (grafiska riktlinjer). De fyra grundstatusarna har sina vanliga färger som standard,
 * en ny status får första färgen som inte redan används i projektet. Färgerna är valda så att vit text (eller svart där färgen är ljus) har kontrast minst 4,5.
 */
export const STATUS_COLOR_IDS = ["brons", "ockra", "gron", "rod", "koppar", "stal", "bla", "guld", "svart"] as const;
export type StatusColorId = (typeof STATUS_COLOR_IDS)[number];

export const DEFAULT_STATUS_COLOR: Record<Status, StatusColorId> = { not_started: "brons", in_progress: "ockra", done: "gron", blocked: "rod" };

export const isStatusColor = (v: unknown): v is StatusColorId => typeof v === "string" && (STATUS_COLOR_IDS as readonly string[]).includes(v);

/** Statusens färg: den valda, annars kategorins vanliga. */
export const colorOf = (d: Pick<StatusDef, "category" | "color">): StatusColorId => (isStatusColor(d.color) ? d.color : DEFAULT_STATUS_COLOR[d.category]);

/** Första färgen som ingen status i projektet använder (är alla använda: kategorins vanliga). */
export function nextFreeColor(defs: Pick<StatusDef, "category" | "color">[], category: Status): StatusColorId {
  const used = new Set(defs.map(colorOf));
  return STATUS_COLOR_IDS.find((c) => !used.has(c)) ?? DEFAULT_STATUS_COLOR[category];
}
