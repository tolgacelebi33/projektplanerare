import type { Snapshot } from "./MemoryStore";
import type { Dependency, Item, Project, User } from "./types";

/**
 * Ändringspost mellan två lägen: bara det som skiljer. Används för ångra och gör om (en hel kopia per steg blir tungt, och kan inte sparas
 * rimligt). `[id, värde]` sätter posten till värdet, `[id, null]` tar bort den.
 */
export type Entry<T> = [id: string, value: T | null, index?: number];
export interface Patch {
  projects: Entry<Project>[];
  items: Entry<Item>[];
  dependencies: Entry<Dependency>[];
  users: Entry<User>[];
}

// Poster i lagret byts ut och ändras aldrig på plats, så texten för en post kan sparas per objekt. Annars blir varje skrivning en omskrivning av hela projektet.
const text = new WeakMap<object, string>();
const json = (x: object) => { let s = text.get(x); if (s === undefined) { s = JSON.stringify(x); text.set(x, s); } return s; };

function diffList<T extends { id: string }>(from: T[], to: T[]): Entry<T>[] {
  const before = new Map(from.map((x) => [x.id, json(x)]));
  const out: Entry<T>[] = [];
  const seen = new Set<string>();
  to.forEach((x, i) => {
    seen.add(x.id);
    const was = before.get(x.id);
    if (was === undefined) out.push([x.id, { ...x }, i]); // ny post: med sin plats i målet, så att ordningen blir densamma efteråt
    else if (was !== json(x)) out.push([x.id, { ...x }]);
  });
  for (const x of from) if (!seen.has(x.id)) out.push([x.id, null]);
  return out;
}

/** Posten som förvandlar `from` till `to`. */
export function makePatch(from: Snapshot, to: Snapshot): Patch {
  return {
    projects: diffList(from.projects, to.projects), items: diffList(from.items, to.items),
    dependencies: diffList(from.dependencies, to.dependencies), users: diffList(from.users, to.users),
  };
}

function applyList<T extends { id: string }>(list: T[], entries: Entry<T>[]): T[] {
  const out = [...list];
  for (const [id, v] of entries) if (v === null) { const i = out.findIndex((x) => x.id === id); if (i >= 0) out.splice(i, 1); }
  for (const [id, v, index] of entries) {
    if (v === null) continue;
    const i = out.findIndex((x) => x.id === id);
    if (i >= 0) out[i] = { ...v };
    else out.splice(Math.min(index ?? out.length, out.length), 0, { ...v });
  }
  return out;
}

/** Läget efter att posten tillämpats på `snap`. Id-räknaren (`seq`) går aldrig bakåt, så ett id återanvänds aldrig. */
export function applyPatch(snap: Snapshot, p: Patch): Snapshot {
  return {
    projects: applyList(snap.projects, p.projects), items: applyList(snap.items, p.items),
    dependencies: applyList(snap.dependencies, p.dependencies), users: applyList(snap.users, p.users), seq: snap.seq,
  };
}

/** Kontrollerar att något som lästs från lagring har formen av en historik (annars ignoreras den). */
export function isPatchList(x: unknown): x is Patch[] {
  return Array.isArray(x) && x.every((p) => p && typeof p === "object" && ["projects", "items", "dependencies", "users"].every((k) => Array.isArray((p as Record<string, unknown>)[k])));
}
