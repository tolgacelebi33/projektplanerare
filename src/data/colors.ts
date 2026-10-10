import { GROUP_COLORS, type GroupColor, type Item } from "./types";

/**
 * Färgen som visas för varje post. En toppgrupp utan eget val får en färg efter sin plats bland toppgrupperna (så att befintliga projekt får färger
 * utan migrering), en undergrupp utan eget val ärver sin förälders, och uppgifter och milstolpar ärver sin grupps. Poster utan grupp har ingen färg.
 * "none" på en grupp betyder ingen färg för gruppen och det som ärver från den.
 */
export function effectiveColors(items: Item[]): Map<string, GroupColor | "none"> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const tops = items.filter((i) => i.type === "epic" && i.parent_id === null).sort((a, b) => a.sort_order - b.sort_order);
  const auto = new Map(tops.map((g, idx) => [g.id, GROUP_COLORS[idx % GROUP_COLORS.length]] as const));
  const out = new Map<string, GroupColor | "none">();
  const colorOf = (id: string, depth = 0): GroupColor | "none" => {
    const hit = out.get(id);
    if (hit) return hit;
    const it = byId.get(id);
    if (!it || depth > 50) return "none";
    let c: GroupColor | "none";
    if (it.type === "epic") {
      if (it.color) c = it.color;
      else if (it.parent_id === null) c = auto.get(it.id) ?? "none";
      else c = colorOf(it.parent_id, depth + 1);
    } else c = it.parent_id ? colorOf(it.parent_id, depth + 1) : "none";
    out.set(id, c);
    return c;
  };
  for (const i of items) colorOf(i.id);
  return out;
}
