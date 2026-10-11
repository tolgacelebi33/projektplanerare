import type { Item, Project } from "./types";

/** Global sökning över alla projekt: poster (titel, kod, hänvisning, etiketter, beskrivning), projekt (namn, kod) och kommandon. Ren logik, utan gränssnitt. */
export interface ProjectData { project: Project; items: Item[] }
export type Hit =
  | { kind: "item"; project: Project; item: Item; score: number; where: "code" | "title" | "label" | "description" }
  | { kind: "project"; project: Project; score: number };

export const MAX_ITEM_HITS = 30;
const norm = (s: string) => s.toLowerCase().normalize("NFKC");

/** Alla ord i frågan ska finnas i texten (i valfri ordning). Poängen är högre ju tidigare och ju mer exakt träffen är. */
export function textScore(text: string, query: string): number {
  const t = norm(text), words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  let score = 0;
  for (const w of words) {
    const at = t.indexOf(w);
    if (at < 0) return 0;
    const wordStart = at === 0 || /[^\p{L}\p{N}]/u.test(t[at - 1]);
    score += (at === 0 ? 40 : wordStart ? 25 : 10) + (t === w ? 60 : 0);
  }
  return score;
}

export function searchAll(query: string, data: ProjectData[], max = MAX_ITEM_HITS): Hit[] {
  const q = query.trim();
  if (!q) return [];
  const hits: Hit[] = [];
  for (const { project, items } of data) {
    const ps = Math.max(textScore(project.name, q), textScore(project.code ?? "", q));
    if (ps > 0) hits.push({ kind: "project", project, score: ps + 5 });
    for (const item of items) {
      const code = Math.max(textScore(item.code ?? "", q), textScore(item.ref ?? "", q));
      const title = textScore(item.title, q);
      const label = Math.max(0, ...(item.labels ?? []).map((l) => textScore(l, q)));
      const desc = textScore(item.description, q);
      const best = Math.max(code * 2, title * 1.5, label, desc * 0.5);
      if (best <= 0) continue;
      const where = best === code * 2 ? "code" : best === title * 1.5 ? "title" : best === label ? "label" : "description";
      // Poster som är klara kommer efter dem som inte är det (lika träff), grupper före uppgifter
      hits.push({ kind: "item", project, item, where, score: best - (item.status === "done" ? 3 : 0) + (item.type === "epic" ? 1 : 0) });
    }
  }
  const projects = hits.filter((h) => h.kind === "project");
  const items = hits.filter((h) => h.kind === "item").sort((a, b) => b.score - a.score || (a.kind === "item" && b.kind === "item" ? a.item.title.localeCompare(b.item.title) : 0)).slice(0, max);
  return [...projects.sort((a, b) => b.score - a.score).slice(0, 5), ...items];
}

/** Kommandon som matchar frågan (alla ord i etiketten). Tom fråga: alla, i ordning. */
export function matchCommands<T extends { label: string }>(query: string, cmds: T[]): T[] {
  const q = query.trim();
  return q ? cmds.filter((c) => textScore(c.label, q) > 0).sort((a, b) => textScore(b.label, q) - textScore(a.label, q)) : cmds;
}
