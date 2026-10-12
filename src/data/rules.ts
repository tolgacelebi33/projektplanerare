import { STATUS_COLOR_IDS } from "./statusColors";
import { isISODate, dayNumber, addDays, diffDays } from "./dates";
import { ESTIMATE_MAX, MAX_CO_ASSIGNEES, COMMENT_LIMITS, STATUS_LIMITS, type StatusDef, type Baseline, MAX_BASELINE_ITEMS, DEPENDENCY_TYPES, FIELD_LIMITS, FIELD_TYPES, GROUP_COLORS, LIMITS, MAX_LAG, RECURRENCES, type FieldDef, type SavedView, type Dependency, type Item, type Status } from "./types";

export class RuleError extends Error {
  constructor(public code: string, message: string, public data?: Record<string, string>) {
    super(message);
    this.name = "RuleError";
  }
}

const STATUSES: Status[] = ["not_started", "in_progress", "done", "blocked"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
export const MAX_DESCRIPTION = 5000;
export const MAX_TITLE = 200;

/** Härledd, lagras aldrig. Slutdatum passerat och inte klar. */
export function isOverdue(item: Pick<Item, "end" | "status">, today: string): boolean {
  return item.status !== "done" && dayNumber(item.end) < dayNumber(today);
}

export function validateItemShape(item: Item): void {
  if (!item.title.trim()) throw new RuleError("empty_title", "Titel saknas");
  if (!isISODate(item.start)) throw new RuleError("bad_date", `Ogiltigt startdatum: ${item.start}`);
  if (!isISODate(item.end)) throw new RuleError("bad_date", `Ogiltigt slutdatum: ${item.end}`);
  if (dayNumber(item.end) < dayNumber(item.start)) throw new RuleError("end_before_start", "Slut före start");
  if (item.type === "milestone" && item.start !== item.end)
    throw new RuleError("milestone_dates", "Milstolpe måste ha start = slut");
  if (!STATUSES.includes(item.status)) throw new RuleError("bad_status", `Ogiltig status: ${item.status}`);
  if (item.title.length > MAX_TITLE) throw new RuleError("title_too_long", `Titeln är längre än ${MAX_TITLE} tecken`);
  if (!PRIORITIES.includes(item.priority)) throw new RuleError("bad_priority", `Ogiltig prioritet: ${item.priority}`);
  if (!Number.isInteger(item.progress) || item.progress < 0 || item.progress > 100)
    throw new RuleError("bad_progress", `Framsteg måste vara ett heltal 0-100: ${item.progress}`);
  if (item.color !== undefined && item.color !== null && item.color !== "none" && !GROUP_COLORS.includes(item.color)) throw new RuleError("bad_color", `Ogiltig färg: ${String(item.color)}`);
  if (item.board_rank !== undefined && item.board_rank !== null && !Number.isFinite(item.board_rank)) throw new RuleError("bad_rank", `Ogiltig plats i boarden: ${String(item.board_rank)}`);
  for (const k of ["code", "ref"] as const) if (item[k] !== undefined && (typeof item[k] !== "string" || (item[k] as string).length > 60)) throw new RuleError("bad_code", `Ogiltig ${k}`);
  validateExtras(item);
  if (item.assignees !== undefined && (!Array.isArray(item.assignees) || item.assignees.length > MAX_CO_ASSIGNEES || item.assignees.some((a) => typeof a !== "string" || !a) || new Set(item.assignees).size !== item.assignees.length || (item.assignee_id !== null && item.assignees.includes(item.assignee_id)))) throw new RuleError("bad_assignees", `Högst ${MAX_CO_ASSIGNEES} fler ansvariga, och samma person bara en gång`);
  if (item.estimate !== undefined && item.estimate !== null && (typeof item.estimate !== "number" || !Number.isFinite(item.estimate) || item.estimate < 0 || item.estimate > ESTIMATE_MAX)) throw new RuleError("bad_estimate", `Uppskattningen ska vara 0 till ${ESTIMATE_MAX} timmar`);
  if (item.custom_status !== undefined && item.custom_status !== null && (typeof item.custom_status !== "string" || !item.custom_status || item.custom_status.length > 40)) throw new RuleError("bad_custom_status", "Ogiltig egen status");
  if (item.undated !== undefined && typeof item.undated !== "boolean") throw new RuleError("bad_undated", "Ogiltigt värde för ej schemalagd");
  if (item.recur !== undefined && item.recur !== null && !RECURRENCES.includes(item.recur)) throw new RuleError("bad_recur", `Ogiltig upprepning: ${String(item.recur)}`);
  if (item.series !== undefined && item.series !== null && (typeof item.series !== "string" || !item.series)) throw new RuleError("bad_series", "Ogiltigt serie-id");
  if (item.description.length > MAX_DESCRIPTION) throw new RuleError("description_too_long", `Beskrivningen är längre än ${MAX_DESCRIPTION} tecken`);
}

/** parent_id får inte korsa workspace eller projekt, och inte bilda cykel. */
export function validateParent(item: Item, all: Map<string, Item>): void {
  if (item.parent_id === null) return;
  const parent = all.get(item.parent_id);
  if (!parent) throw new RuleError("parent_missing", "Förälder finns inte");
  if (parent.workspace_id !== item.workspace_id) throw new RuleError("cross_workspace", "Förälder i annan workspace");
  if (parent.project_id !== item.project_id) throw new RuleError("cross_project", "Förälder i annat projekt");
  if (parent.type === "milestone") throw new RuleError("parent_not_container", "En milstolpe kan inte innehålla andra poster");
  if (parent.type === "task" && item.type === "epic") throw new RuleError("epic_in_task", "En grupp kan inte ligga i en uppgift");
  const seen = new Set<string>([item.id]);
  let cur: Item | undefined = parent;
  let taskAbove = 0; // uppgifter ovanför posten (en uppgift kan innehålla underuppgifter, en grupp kan innehålla vad som helst)
  while (cur) {
    if (seen.has(cur.id)) throw new RuleError("parent_cycle", "Hierarkin får inte vara cirkulär");
    seen.add(cur.id);
    if (cur.type === "task") taskAbove += 1;
    cur = cur.parent_id ? all.get(cur.parent_id) : undefined;
  }
  // Underuppgifter: högst MAX_TASK_DEPTH uppgiftsnivåer i en kedja, räknat med posten och det som ligger under den. Kontrolleras bara när något ligger under en uppgift.
  if (taskAbove > 0 && taskAbove + taskDepthBelow(item, all) > MAX_TASK_DEPTH) throw new RuleError("too_deep", `Underuppgifter kan ligga högst ${MAX_TASK_DEPTH} nivåer djupt`, { max: String(MAX_TASK_DEPTH) });
}

/** Högst så många uppgiftsnivåer i en kedja (en uppgift, dess underuppgift, och så vidare). Grupper räknas inte. */
export const MAX_TASK_DEPTH = 5;

/** Antal uppgiftsnivåer från posten och nedåt (posten själv räknas om den är en uppgift). */
export function taskDepthBelow(item: Item, all: Map<string, Item>): number {
  const kids = new Map<string, Item[]>();
  for (const i of all.values()) if (i.parent_id) kids.set(i.parent_id, [...(kids.get(i.parent_id) ?? []), i]);
  const walk = (i: Item, guard: number): number => (guard > 200 ? 0 : (i.type === "task" ? 1 : 0) + Math.max(0, ...(kids.get(i.id) ?? []).map((k) => walk(k, guard + 1))));
  return walk(item, 0);
}

export function validateDependency(dep: Dependency, all: Map<string, Item>, existing: Dependency[]): void {
  const from = all.get(dep.from_item_id);
  const to = all.get(dep.to_item_id);
  if (!from || !to) throw new RuleError("dep_missing_item", "Beroendets item finns inte");
  if (dep.from_item_id === dep.to_item_id) throw new RuleError("dep_cycle", "Item kan inte bero på sig själv");
  if (from.workspace_id !== dep.workspace_id || to.workspace_id !== dep.workspace_id)
    throw new RuleError("cross_workspace", "Beroende korsar workspace");
  if (from.project_id !== to.project_id) throw new RuleError("cross_project", "Beroende korsar projekt");
  if (!DEPENDENCY_TYPES.includes(dep.type)) throw new RuleError("bad_dep_type", `Ogiltig beroendetyp: ${String(dep.type)}`);
  if (dep.lag !== undefined && (!Number.isInteger(dep.lag) || Math.abs(dep.lag) > MAX_LAG)) throw new RuleError("bad_lag", `Fördröjningen måste vara ett heltal mellan -${MAX_LAG} och ${MAX_LAG} dagar`);
  if (reaches(dep.to_item_id, dep.from_item_id, existing))
    throw new RuleError("dep_cycle", "Beroendet skulle bilda en cykel");
}

/** Finns väg från `start` till `target` via befintliga beroenden (from -> to)? */
function reaches(start: string, target: string, deps: Dependency[]): boolean {
  const next = new Map<string, string[]>();
  for (const d of deps) {
    const a = next.get(d.from_item_id) ?? [];
    a.push(d.to_item_id);
    next.set(d.from_item_id, a);
  }
  const stack = [start];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(next.get(id) ?? []));
  }
  return false;
}

/** Härledd tidsrymd för en epic: tidigaste start och senaste slut bland dess direkta barn. null om den saknar barn. */
export function derivedSpan(children: Item[]): { start: string; end: string } | null {
  if (!children.length) return null;
  let start = children[0].start, end = children[0].end;
  for (const c of children) {
    if (c.start < start) start = c.start; // datum som ÅÅÅÅ-MM-DD sorteras rätt som text, och det går mycket fortare än att räkna om varje datum
    if (c.end > end) end = c.end;
  }
  return { start, end };
}

/**
 * Räknar om epics datum uppåt från de angivna posterna (deras föräldrar och förfäder), djupaste först så att nästlade
 * epics räknas före sina föräldrar. Muterar `items` och returnerar id för de epics som ändrats.
 */
export function rederiveEpics(items: Map<string, Item>, fromParentIds: (string | null)[]): string[] {
  const touched = new Set<string>();
  for (const pid of fromParentIds) {
    for (let cur = pid ? items.get(pid) : undefined; cur; cur = cur.parent_id ? items.get(cur.parent_id) : undefined) {
      if (cur.type === "epic") touched.add(cur.id);
    }
  }
  const depth = (i: Item) => { let d = 0; for (let c = i.parent_id ? items.get(i.parent_id) : undefined; c; c = c.parent_id ? items.get(c.parent_id) : undefined) d++; return d; };
  const order = [...touched].map((id) => items.get(id)!).sort((a, b) => depth(b) - depth(a));
  const changed: string[] = [];
  for (const epic of order) {
    const span = derivedSpan([...items.values()].filter((i) => i.parent_id === epic.id));
    if (!span) continue; // en epic utan innehåll behåller sina datum
    if (span.start !== epic.start || span.end !== epic.end) {
      items.set(epic.id, { ...epic, start: span.start, end: span.end });
      changed.push(epic.id);
    }
  }
  return changed;
}

/**
 * Flyttar efterföljare framåt så att varje slut-till-start-beroende hålls (efterföljaren börjar dagen efter föregångarens slut, eller senare).
 * "Flexibelt" som i Asana och monday: bara posten som bryter beroendet flyttas, och bara framåt. Luckor behålls och inget dras tidigare.
 * Längden bevaras, och kedjan följer vidare. Epics flyttas aldrig (deras datum härleds ur innehållet). Muterar `items`, returnerar de flyttade id:na.
 */
/**
 * Tidigaste start för `succ` givet ett beroende av `pred` (längden på `succ` bevaras):
 * slut-start: efter att föregångaren slutat, start-start: när föregångaren startat, slut-slut: slutar inte före föregångarens slut,
 * start-slut: slutar inte före föregångarens start. Fördröjningen läggs på (negativ = försprång).
 */
export function earliestStart(pred: Pick<Item, "start" | "end">, succ: Pick<Item, "start" | "end">, d: Pick<Dependency, "type" | "lag">): string {
  const lag = d.lag ?? 0;
  const len = diffDays(succ.start, succ.end);
  switch (d.type) {
    case "start_to_start": return addDays(pred.start, lag);
    case "finish_to_finish": return addDays(pred.end, lag - len);
    case "start_to_finish": return addDays(pred.start, lag - len);
    default: return addDays(pred.end, 1 + lag);
  }
}

export function shiftSuccessors(items: Map<string, Item>, deps: Dependency[], fromIds: string[]): string[] {
  const next = new Map<string, Dependency[]>();
  for (const d of deps) next.set(d.from_item_id, [...(next.get(d.from_item_id) ?? []), d]);
  const moved = new Set<string>();
  const queue = [...fromIds];
  let guard = 0;
  while (queue.length && guard++ < 100_000) {
    const x = items.get(queue.shift()!);
    if (!x) continue;
    for (const d of next.get(x.id) ?? []) {
      const y = items.get(d.to_item_id);
      if (!y || y.type === "epic") continue;
      const need = earliestStart(x, y, d);
      if (dayNumber(y.start) >= dayNumber(need)) continue;
      const delta = diffDays(y.start, need);
      items.set(y.id, { ...y, start: addDays(y.start, delta), end: addDays(y.end, delta) });
      moved.add(y.id);
      queue.push(y.id);
    }
  }
  return [...moved];
}

/** Länkar får bara vara http, https eller mailto (aldrig javascript: och liknande, som kunde köras när någon klickar). */
export function isSafeUrl(url: string): boolean {
  if (typeof url !== "string" || !url || url.length > LIMITS.linkUrl) return false;
  try { return ["http:", "https:", "mailto:"].includes(new URL(url).protocol); } catch { return false; }
}

/** Etiketter, checklista, länkar och logg: form och gränser. */
function validateExtras(item: Item): void {
  const bad = (code: string, msg: string) => { throw new RuleError(code, msg); };
  if (item.fields !== undefined) {
    if (!item.fields || typeof item.fields !== "object" || Array.isArray(item.fields) || Object.keys(item.fields).length > FIELD_LIMITS.fields) bad("bad_fields", `Högst ${FIELD_LIMITS.fields} egna fält`);
    for (const [k, v] of Object.entries(item.fields)) {
      if (!k || k.length > 60) bad("bad_fields", "Ogiltigt fält-id");
      if (!(v === null || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= FIELD_LIMITS.text))) bad("bad_fields", `Ogiltigt värde i ett eget fält (text högst ${FIELD_LIMITS.text} tecken)`);
    }
  }
  if (item.labels !== undefined) {
    if (!Array.isArray(item.labels) || item.labels.length > LIMITS.labels) bad("bad_labels", `Högst ${LIMITS.labels} etiketter`);
    const seen = new Set<string>();
    for (const l of item.labels) {
      if (typeof l !== "string" || !l.trim() || l !== l.trim() || l.length > LIMITS.labelLength) bad("bad_labels", `Ogiltig etikett (högst ${LIMITS.labelLength} tecken, inte tom)`);
      if (seen.has(l.toLowerCase())) bad("bad_labels", `Etiketten "${l}" finns redan`);
      seen.add(l.toLowerCase());
    }
  }
  if (item.checklist !== undefined) {
    if (!Array.isArray(item.checklist) || item.checklist.length > LIMITS.checklist) bad("bad_checklist", `Högst ${LIMITS.checklist} punkter i checklistan`);
    const ids = new Set<string>();
    for (const c of item.checklist) {
      if (!c || typeof c.id !== "string" || !c.id || typeof c.text !== "string" || !c.text.trim() || c.text.length > LIMITS.checklistText || typeof c.done !== "boolean") bad("bad_checklist", `Ogiltig punkt i checklistan (text högst ${LIMITS.checklistText} tecken, inte tom)`);
      if (ids.has(c.id)) bad("bad_checklist", "Två punkter i checklistan har samma id");
      ids.add(c.id);
    }
  }
  if (item.links !== undefined) {
    if (!Array.isArray(item.links) || item.links.length > LIMITS.links) bad("bad_links", `Högst ${LIMITS.links} länkar`);
    for (const l of item.links) {
      if (!l || typeof l.title !== "string" || l.title.length > LIMITS.linkTitle) bad("bad_links", `Länktiteln är längre än ${LIMITS.linkTitle} tecken`);
      if (!isSafeUrl(l.url)) bad("bad_link_url", "Länken måste börja med http://, https:// eller mailto:");
    }
  }
  if (item.log !== undefined) {
    if (!Array.isArray(item.log) || item.log.length > LIMITS.log) bad("bad_log", `Högst ${LIMITS.log} rader i loggen`);
    for (const e of item.log) if (!e || typeof e.at !== "string" || Number.isNaN(Date.parse(e.at)) || typeof e.text !== "string" || !e.text.trim() || e.text.length > LIMITS.logText) bad("bad_log", `Ogiltig rad i loggen (text högst ${LIMITS.logText} tecken, inte tom)`);
  }
}

/** Definitionerna av egna fält: unika id och namn, giltig typ, rullistor med val, och gränser. */
export function validateFieldDefs(defs: FieldDef[]): void {
  const bad = (msg: string) => { throw new RuleError("bad_field_defs", msg); };
  if (!Array.isArray(defs) || defs.length > FIELD_LIMITS.fields) bad(`Högst ${FIELD_LIMITS.fields} egna fält`);
  const ids = new Set<string>(), names = new Set<string>();
  for (const d of defs) {
    if (!d || typeof d.id !== "string" || !d.id || d.id.length > 60 || ids.has(d.id)) bad("Ogiltigt eller dubbelt fält-id");
    ids.add(d.id);
    if (typeof d.name !== "string" || !d.name.trim() || d.name.length > FIELD_LIMITS.name || names.has(d.name.trim().toLowerCase())) bad(`Fältnamnet måste vara unikt, inte tomt och högst ${FIELD_LIMITS.name} tecken`);
    names.add(d.name.trim().toLowerCase());
    if (!FIELD_TYPES.includes(d.type)) bad("Ogiltig typ för eget fält");
    if (d.type === "select") {
      if (!Array.isArray(d.options) || d.options.length === 0 || d.options.length > FIELD_LIMITS.options) bad(`En rullista behöver 1 till ${FIELD_LIMITS.options} val`);
      const seen = new Set<string>();
      for (const o of d.options!) { if (typeof o !== "string" || !o.trim() || o.length > FIELD_LIMITS.option || seen.has(o.toLowerCase())) bad(`Valen måste vara unika, inte tomma och högst ${FIELD_LIMITS.option} tecken`); seen.add(o.toLowerCase()); }
    } else if (d.options !== undefined) bad("Bara en rullista har val");
    if (d.card !== undefined && typeof d.card !== "boolean") bad("Ogiltigt värde för visa på kort");
  }
}

/** Sparade vyer: namn, form och gränser (innehållet är bara val som UI tolkar, och okända värden ignoreras där). */
export function validateSavedViews(views: SavedView[]): void {
  const bad = (msg: string) => { throw new RuleError("bad_views", msg); };
  if (!Array.isArray(views) || views.length > FIELD_LIMITS.views) bad(`Högst ${FIELD_LIMITS.views} sparade vyer`);
  const ids = new Set<string>(), names = new Set<string>();
  for (const v of views) {
    if (!v || typeof v.id !== "string" || !v.id || ids.has(v.id)) bad("Ogiltigt eller dubbelt vy-id");
    ids.add(v.id);
    if (typeof v.name !== "string" || !v.name.trim() || v.name.length > FIELD_LIMITS.viewName || names.has(v.name.trim().toLowerCase())) bad(`Vynamnet måste vara unikt, inte tomt och högst ${FIELD_LIMITS.viewName} tecken`);
    names.add(v.name.trim().toLowerCase());
    if (!["gantt", "wheel", "board", "calendar", "week", "workload", "portfolio", "report"].includes(v.view) || !["day", "week", "month"].includes(v.zoom) || typeof v.boardGroup !== "string" || !Array.isArray(v.columns) || !v.filter || typeof v.filter !== "object") bad("Ogiltig sparad vy");
  }
}

/** Baslinjen är ett ögonblicksbild av datum: giltiga datum, slut inte före start, och rimligt antal poster. */
export function validateBaseline(b: Baseline): void {
  const bad = (msg: string) => { throw new RuleError("bad_baseline", msg); };
  if (!b || typeof b !== "object" || typeof b.saved_at !== "string" || !b.items || typeof b.items !== "object" || Array.isArray(b.items)) bad("Ogiltig baslinje");
  if (!isISODate(b.saved_at.slice(0, 10))) bad("Ogiltigt datum för baslinjen");
  const ids = Object.keys(b.items);
  if (ids.length > MAX_BASELINE_ITEMS) bad(`Högst ${MAX_BASELINE_ITEMS} poster i en baslinje`);
  for (const id of ids) {
    const e = b.items[id];
    if (!id || id.length > 100 || !e || !isISODate(e.start) || !isISODate(e.end) || dayNumber(e.end) < dayNumber(e.start)) bad("Ogiltig post i baslinjen");
  }
}

/** Kommentarens text och form (författare och förälder kontrolleras av lagret, som känner till personer och poster). */
export function validateCommentText(text: string): string {
  const t = text.trim();
  if (!t) throw new RuleError("empty_comment", "Skriv en kommentar");
  if (t.length > COMMENT_LIMITS.text) throw new RuleError("comment_too_long", `Kommentaren är längre än ${COMMENT_LIMITS.text} tecken`);
  return t;
}

/** Projektets egna statusar: unika id och namn, minst en i varje kategori, och en grundstatus (id lika med kategori) måste ha just den kategorin. */
export function validateStatusDefs(defs: StatusDef[]): void {
  const bad = (msg: string) => { throw new RuleError("bad_statuses", msg); };
  if (!Array.isArray(defs) || defs.length === 0 || defs.length > STATUS_LIMITS.count) bad(`Mellan 1 och ${STATUS_LIMITS.count} statusar`);
  const ids = new Set<string>(), names = new Set<string>(), cats = new Set<string>();
  for (const d of defs) {
    if (!d || typeof d.id !== "string" || !/^[a-z0-9_]{1,40}$/.test(d.id) || ids.has(d.id)) bad("Ogiltigt eller dubbelt id för en status");
    ids.add(d.id);
    if (!STATUSES.includes(d.category)) bad("Ogiltig kategori för en status");
    if (STATUSES.includes(d.id as Status) && d.id !== d.category) bad("En grundstatus måste ligga i sin egen kategori");
    const n = typeof d.name === "string" ? d.name.trim() : "";
    if (!n || n.length > STATUS_LIMITS.name) bad(`Namnet på en status ska vara 1 till ${STATUS_LIMITS.name} tecken`);
    if (d.color !== undefined && !STATUS_COLOR_IDS.includes(d.color as never)) bad("Ogiltig färg för en status");
    if (names.has(n.toLowerCase())) bad(`Två statusar heter "${n}"`);
    names.add(n.toLowerCase());
    cats.add(d.category);
  }
  for (const c of STATUSES) if (!cats.has(c)) bad("Varje kategori (Ej påbörjad, Pågår, Klar och Blockerad) behöver minst en status");
}
