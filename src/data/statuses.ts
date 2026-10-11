import { sv } from "../i18n/sv";
import type { Item, Project, Status, StatusDef } from "./types";

/** Statusar: de fyra grundkategorierna styr logiken, projektets egna statusar är namn som hör till en kategori. */
export const CATEGORIES: Status[] = ["not_started", "in_progress", "done", "blocked"];

/** Grundstatusarna (på det språk som är valt). Används när projektet inte har några egna. */
export const defaultStatusDefs = (): StatusDef[] => CATEGORIES.map((c) => ({ id: c, name: sv.status[c], category: c }));
export const statusDefs = (project?: Pick<Project, "statuses"> | null): StatusDef[] => (project?.statuses?.length ? project.statuses : defaultStatusDefs());
export const isBuiltin = (d: StatusDef): boolean => d.id === d.category;

/** Postens status som namn: den egna om den finns i projektet och har postens kategori, annars projektets första status i kategorin. */
export function defOf(item: Pick<Item, "status" | "custom_status">, defs: StatusDef[]): StatusDef {
  const custom = item.custom_status ? defs.find((d) => d.id === item.custom_status && d.category === item.status) : undefined;
  return custom ?? defs.find((d) => d.category === item.status) ?? { id: item.status, name: sv.status[item.status], category: item.status };
}
/** Det som skrivs på en post när man väljer en status: kategorin, och id för en egen status (null för grundstatusen, så fältet tas bort). */
export function statusPatch(d: StatusDef, item?: Pick<Item, "custom_status">): { status: Status; custom_status?: string | null } {
  if (!isBuiltin(d)) return { status: d.category, custom_status: d.id };
  return item && !item.custom_status ? { status: d.category } : { status: d.category, custom_status: null }; // grundstatusen: den egna tas bort (utan att skriva fältet i onödan)
}
export const newStatusId = (): string => `s_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
