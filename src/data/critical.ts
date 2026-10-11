import { addDays, diffDays } from "./dates";
import { earliestStart } from "./rules";
import type { Dependency, Item } from "./types";

/**
 * Kritisk linje: de poster som inte kan bli senare utan att projektets slut (eller en efterföljare) blir senare. Räknas på de datum posterna har nu:
 * projektets slut är den senaste slutdagen bland poster som inte är klara (grupper räknas inte), och en baklängesräkning ger hur sent varje post
 * får sluta (högst projektets slut, och så sent som beroendena till efterföljarna tillåter, med typ och fördröjning). Marginalen är det antal dagar posten får
 * bli senare. Marginal noll eller mindre är kritisk. Klara poster och poster utan riktigt datum ingår inte.
 */
export interface CriticalResult { ids: Set<string>; links: Set<string>; slack: Map<string, number>; end: string | null }

export function criticalPath(items: Item[], deps: Dependency[]): CriticalResult {
  const live = items.filter((i) => i.type !== "epic" && i.status !== "done" && !i.undated);
  const byId = new Map(live.map((i) => [i.id, i]));
  const out: CriticalResult = { ids: new Set(), links: new Set(), slack: new Map(), end: null };
  if (!live.length) return out;
  const end = live.reduce((m, i) => (i.end > m ? i.end : m), live[0].end);
  out.end = end;
  const edges = deps.filter((d) => byId.has(d.from_item_id) && byId.has(d.to_item_id));
  const succ = new Map<string, Dependency[]>();
  const left = new Map<string, number>();
  for (const d of edges) {
    succ.set(d.from_item_id, [...(succ.get(d.from_item_id) ?? []), d]);
    left.set(d.to_item_id, (left.get(d.to_item_id) ?? 0) + 1);
  }
  // Ordning: föregångare före efterföljare. Beroenden är aldrig cykliska i lagret, men en trasig fil skyddas ändå: det som inte hunnit med läggs sist.
  const order: string[] = [];
  const seen = new Set<string>();
  const queue = live.filter((i) => !(left.get(i.id) ?? 0)).map((i) => i.id);
  for (let guard = 0; queue.length && guard < 1_000_000; guard++) {
    const id = queue.shift()!;
    order.push(id); seen.add(id);
    for (const d of succ.get(id) ?? []) {
      left.set(d.to_item_id, (left.get(d.to_item_id) ?? 1) - 1);
      if ((left.get(d.to_item_id) ?? 0) <= 0 && !seen.has(d.to_item_id)) queue.push(d.to_item_id);
    }
  }
  for (const i of live) if (!seen.has(i.id)) order.push(i.id);
  // lat = senaste tillåtna slutdag per post, baklänges: högst projektets slut, och så sent som varje efterföljare tillåter
  const lat = new Map<string, string>(live.map((i) => [i.id, end]));
  for (const id of [...order].reverse()) {
    const p = byId.get(id)!;
    const lenP = diffDays(p.start, p.end);
    for (const d of succ.get(id) ?? []) {
      const s = byId.get(d.to_item_id)!;
      const lfS = lat.get(s.id)!, lsS = addDays(lfS, -diffDays(s.start, s.end)), lag = d.lag ?? 0;
      let limit: string;
      switch (d.type) {
        case "start_to_start": limit = addDays(addDays(lsS, -lag), lenP); break;
        case "finish_to_finish": limit = addDays(lfS, -lag); break;
        case "start_to_finish": limit = addDays(addDays(lfS, -lag), lenP); break;
        default: limit = addDays(lsS, -1 - lag);
      }
      if (limit < lat.get(id)!) lat.set(id, limit);
    }
  }
  for (const i of live) {
    const slack = diffDays(i.end, lat.get(i.id)!);
    out.slack.set(i.id, slack);
    if (slack <= 0) out.ids.add(i.id);
  }
  // En länk är kritisk när båda ändarna är det och efterföljaren ligger precis så tidigt som beroendet tillåter
  for (const d of edges) {
    if (!out.ids.has(d.from_item_id) || !out.ids.has(d.to_item_id)) continue;
    const p = byId.get(d.from_item_id)!, s = byId.get(d.to_item_id)!;
    if (earliestStart(p, s, d) >= s.start) out.links.add(d.id);
  }
  return out;
}
