import { diffDays } from "./dates";
import type { ISODate, Item, Priority, Status } from "./types";

/**
 * Egna regler: "när X, gör Y". En regel har en utlösare, ett valfritt villkor (typ av post, prioritet), en handling och ett projekt den gäller (alla eller ett).
 * Regler utlösta av en ändring (status blir X, post skapas) körs direkt i lagret. Regler utlösta av tid (försenad, slutar inom N dagar) körs bara medan appen är öppen,
 * och kan därför bara ha handlingar som går att upprepa utan skada (inte en kommentar). Det en regel ändrar loggas som automatiskt.
 */
export type RuleTrigger = { kind: "status"; to: Status } | { kind: "created" } | { kind: "overdue" } | { kind: "due_in"; days: number };
export type RuleAction =
  | { kind: "priority"; value: Priority } | { kind: "status"; value: Status } | { kind: "assignee"; value: string | null }
  | { kind: "progress"; value: number } | { kind: "label"; value: string } | { kind: "comment"; value: string };
export interface CustomRule { id: string; name: string; enabled: boolean; project: string | null; when: RuleTrigger; type?: "task" | "milestone"; priority?: Priority; then: RuleAction }

export const RULE_LIMITS = { count: 30, name: 80, text: 500, label: 40, days: 365, depth: 3 } as const;
const STATUSES: Status[] = ["not_started", "in_progress", "done", "blocked"];
const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];

export const isTimeTrigger = (t: RuleTrigger): boolean => t.kind === "overdue" || t.kind === "due_in";
export const newRuleId = (): string => `r_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

const trigger = (v: unknown): RuleTrigger | null => {
  if (!v || typeof v !== "object") return null;
  const t = v as Record<string, unknown>;
  if (t.kind === "status" && STATUSES.includes(t.to as Status)) return { kind: "status", to: t.to as Status };
  if (t.kind === "created") return { kind: "created" };
  if (t.kind === "overdue") return { kind: "overdue" };
  if (t.kind === "due_in" && Number.isInteger(t.days) && (t.days as number) >= 0 && (t.days as number) <= RULE_LIMITS.days) return { kind: "due_in", days: t.days as number };
  return null;
};
const action = (v: unknown): RuleAction | null => {
  if (!v || typeof v !== "object") return null;
  const a = v as Record<string, unknown>;
  if (a.kind === "priority" && PRIORITIES.includes(a.value as Priority)) return { kind: "priority", value: a.value as Priority };
  if (a.kind === "status" && STATUSES.includes(a.value as Status)) return { kind: "status", value: a.value as Status };
  if (a.kind === "assignee" && (a.value === null || (typeof a.value === "string" && a.value.length > 0 && a.value.length <= 100))) return { kind: "assignee", value: a.value as string | null };
  if (a.kind === "progress" && Number.isInteger(a.value) && (a.value as number) >= 0 && (a.value as number) <= 100) return { kind: "progress", value: a.value as number };
  if (a.kind === "label" && typeof a.value === "string" && a.value.trim() && a.value.trim().length <= RULE_LIMITS.label) return { kind: "label", value: a.value.trim() };
  if (a.kind === "comment" && typeof a.value === "string" && a.value.trim() && a.value.trim().length <= RULE_LIMITS.text) return { kind: "comment", value: a.value.trim() };
  return null;
};

/** En ogiltig regel (okänd utlösare, handling eller värde, en tidsregel med kommentar, dubblett-id) tas bort, och högst `RULE_LIMITS.count` behålls. */
export function normalizeCustomRules(raw: unknown): CustomRule[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomRule[] = [], seen = new Set<string>();
  for (const r of raw) {
    if (out.length >= RULE_LIMITS.count || !r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const when = trigger(o.when), then = action(o.then);
    if (!when || !then || typeof o.id !== "string" || !o.id || o.id.length > 60 || seen.has(o.id)) continue;
    if (isTimeTrigger(when) && then.kind === "comment") continue;
    const name = typeof o.name === "string" ? o.name.trim().slice(0, RULE_LIMITS.name) : "";
    const rule: CustomRule = { id: o.id, name, enabled: o.enabled !== false, project: typeof o.project === "string" && o.project ? o.project : null, when, then };
    if (o.type === "task" || o.type === "milestone") rule.type = o.type;
    if (PRIORITIES.includes(o.priority as Priority)) rule.priority = o.priority as Priority;
    seen.add(o.id); out.push(rule);
  }
  return out;
}

/** Gäller regeln den här posten (påslagen, rätt projekt, typ och prioritet)? Grupper omfattas aldrig: deras värden räknas ur innehållet. */
export function ruleApplies(r: CustomRule, item: Item): boolean {
  if (!r.enabled || item.type === "epic") return false;
  if (r.project && r.project !== item.project_id) return false;
  if (r.type && r.type !== item.type) return false;
  if (r.priority && r.priority !== item.priority) return false;
  return true;
}

/** Tidsutlösare: försenad (slutet passerat, inte klar) eller slutar inom N dagar (idag till och med N dagar fram, inte klar). Poster utan riktigt datum utlöser inte. */
export function timeTriggered(r: CustomRule, item: Item, today: ISODate): boolean {
  if (!isTimeTrigger(r.when) || item.status === "done" || item.undated) return false;
  if (r.when.kind === "overdue") return item.end < today;
  const left = diffDays(today, item.end);
  return left >= 0 && left <= (r.when as { days: number }).days;
}

/** Ändringen en handling ger på posten, eller null om posten redan är som handlingen vill ha den (och för en kommentar, som inte ändrar posten). */
export function actionPatch(a: RuleAction, item: Item): Partial<Item> | null {
  switch (a.kind) {
    case "priority": return item.priority === a.value ? null : { priority: a.value };
    case "status": return item.status === a.value && !item.custom_status ? null : { status: a.value, custom_status: null };
    case "assignee": return (item.assignee_id ?? null) === a.value ? null : { assignee_id: a.value };
    case "progress": return item.progress === a.value ? null : { progress: a.value };
    case "label": return (item.labels ?? []).some((l) => l.toLowerCase() === a.value.toLowerCase()) ? null : { labels: [...(item.labels ?? []), a.value] };
    case "comment": return null;
  }
}
