import type { Counters } from "./codes";
import type { Comment, Dependency, Item, Project, StatusUpdate } from "./types";

/** Papperskorgen: det som tas bort ligger kvar så här länge och så här många borttagningar (äldre rensas bort av sig själva). */
export const TRASH_LIMITS = { days: 30, entries: 50 } as const;

/** En borttagning: ett helt projekt, eller poster som togs bort tillsammans (en post med allt under den, eller en serie). */
export interface TrashEntry {
  id: string;
  kind: "project" | "items";
  deleted_at: string;
  project_id: string;
  /** Bara för projekt. */
  project?: Project;
  counters?: Counters;
  status_updates?: StatusUpdate[];
  items: Item[];
  deps: Dependency[];
  comments: Comment[];
}

export interface TrashView { id: string; kind: "project" | "items"; label: string; deleted_at: string; count: number; project_id: string }

/** Rubriken: projektets namn, eller titeln på den post som inte ligger under någon annan i samma borttagning. */
export function trashLabel(e: TrashEntry): string {
  if (e.kind === "project") return e.project?.name ?? "";
  const ids = new Set(e.items.map((i) => i.id));
  return (e.items.find((i) => !i.parent_id || !ids.has(i.parent_id)) ?? e.items[0])?.title ?? "";
}

/** Tar bort det som är för gammalt eller för många (de äldsta först). */
export function purgeTrash(list: TrashEntry[], now: Date): TrashEntry[] {
  const cutoff = now.getTime() - TRASH_LIMITS.days * 86_400_000;
  return list.filter((e) => new Date(e.deleted_at).getTime() >= cutoff).slice(-TRASH_LIMITS.entries);
}
