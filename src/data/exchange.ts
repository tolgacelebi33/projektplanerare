import { addDays, isISODate, recurringDates, todayISO } from "./dates";
import { RuleError, validateBaseline, validateCommentText, validateFieldDefs, validateItemShape, validateSavedViews } from "./rules";
import { newChecklistId, normalizeLink } from "./extras";
import { importFieldValue, inferFieldDef, newFieldId } from "./fields";
import { FIELD_LIMITS, LIMITS, type FieldValue } from "./types";
import { sv } from "../i18n/sv";
import { enDict, svDict } from "../i18n/sv";
import { friendlyError } from "../i18n/errors";
import { DEPENDENCY_TYPES, MAX_LAG, type DependencyType } from "./types";
import type { Activity, ActivityKind, Baseline, Comment, Dependency, DependencyMode, FieldDef, ISODate, Item, ItemType, Priority, Project, Recurrence, SavedView, Status, User } from "./types";

/**
 * Export och import av projekt, utan beroende av lagring. JSON ger full återgivning (används också för att kopiera ett projekt).
 * CSV är för kalkylblad: semikolon som avskiljare och BOM i UTF-8 så att svenska Excel öppnar den rätt, och inläsningen tar även
 * komma och tabb. Inläsningen är allt-eller-inget: första felet avbryter med radnummer, ingenting läggs in halvt.
 */

export const FORMAT = "projektplanerare";
export const MAX_IMPORT_ITEMS = 5000;
export const MAX_IMPORT_BYTES = 5_000_000;

export interface ParsedItem extends Omit<Item, "workspace_id" | "project_id" | "assignee_id"> { assignee: string | null }
/** Vad importen hittade och hur den tolkade det, för förhandsgranskningen innan något läggs in. */
export interface ImportReport {
  /** Rubrikerna i filen och vad de tolkades som (null för JSON, som inte har kolumner). `as` är en nyckel i ordlistan (ex.colMeaning). */
  columns: { header: string; as: string }[] | null;
  counts: Record<ItemType, number>;
  groups: { name: string; items: number }[];
  series: { title: string; recur: Recurrence; count: number; first: ISODate; last: ISODate }[];
  undated: number;
}
export interface ParsedProject {
  name: string;
  dependency_mode: DependencyMode;
  items: ParsedItem[];
  deps: { from: string; to: string; type?: DependencyType; lag?: number }[];
  /** Projektets egna fält och sparade vyer (JSON, och kolumner som blev fält vid CSV-import). */
  fields?: FieldDef[];
  views?: SavedView[];
  /** Saker som importerades med avvikelse (okänd ansvarig m.m.) */
  warnings: string[];
  report?: ImportReport;
  /** Baslinjen (JSON), med postnycklar som i filens id. */
  baseline?: Baseline;
  /** Kommentarer (JSON): `item` och `id`/`parent` är filens id, författaren ett namn. */
  /** Loggen (JSON): `item` är filens id, `actor` ett namn. */
  activity?: { item: string; at: string; actor: string | null; kind: ActivityKind; field?: string; from?: string; to?: string; other?: string; dir?: "pred" | "succ"; dep_type?: DependencyType; lag?: number; auto?: boolean; undo?: boolean }[];
  comments?: { id: string; item: string; parent?: string; author: string | null; text: string; at: string; edited?: string }[];
}

/** Sammanfattning av det som ska läggas in (antal per typ, grupper med innehåll, serier, poster utan riktigt datum). */
export function buildReport(p: Pick<ParsedProject, "items">, columns: ImportReport["columns"]): ImportReport {
  const counts: Record<ItemType, number> = { epic: 0, milestone: 0, task: 0 };
  for (const i of p.items) counts[i.type]++;
  const kids = new Map<string, number>();
  const byId = new Map(p.items.map((i) => [i.id, i]));
  for (const i of p.items) if (i.type !== "epic") for (let c: ParsedItem | undefined = i.parent_id ? byId.get(i.parent_id) : undefined; c; c = c.parent_id ? byId.get(c.parent_id) : undefined) kids.set(c.id, (kids.get(c.id) ?? 0) + 1);
  const groups = p.items.filter((i) => i.type === "epic").map((i) => ({ name: i.title, items: kids.get(i.id) ?? 0 }));
  const bySeries = new Map<string, ParsedItem[]>();
  for (const i of p.items) if (i.series) bySeries.set(i.series, [...(bySeries.get(i.series) ?? []), i]);
  const series = [...bySeries.values()].map((m) => {
    const d = m.map((i) => i.start).sort();
    return { title: m[0].title, recur: m[0].recur ?? "weekly", count: m.length, first: d[0], last: d[d.length - 1] };
  });
  return { columns, counts, groups, series, undated: p.items.filter((i) => i.undated).length };
}

const MAX_TITLE_LEN = 200;
const MAX_DESC_LEN = 5000;
const STATUSES: Status[] = ["not_started", "in_progress", "done", "blocked"];
const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];
const TYPES: ItemType[] = ["epic", "milestone", "task"];

export class ImportError extends Error {}

/** Lagrets poster som en neutral beskrivning (ansvarig som namn, inga projekt- eller workspace-id). */
export function toParsed(project: Pick<Project, "name" | "dependency_mode"> & Partial<Pick<Project, "fields" | "views" | "baseline">>, items: Item[], deps: Dependency[], users: User[], comments: Comment[] = [], activity: Activity[] = []): ParsedProject {
  const name = new Map(users.map((u) => [u.id, u.name]));
  const ids = new Set(items.map((i) => i.id));
  return {
    name: project.name,
    dependency_mode: project.dependency_mode ?? "shift",
    ...(project.fields?.length ? { fields: project.fields } : {}), ...(project.views?.length ? { views: project.views } : {}),
    ...(project.baseline && Object.keys(project.baseline.items).length ? { baseline: { saved_at: project.baseline.saved_at, items: Object.fromEntries(Object.entries(project.baseline.items).filter(([k]) => ids.has(k))) } } : {}),
    ...(activity.length ? { activity: activity.filter((a) => ids.has(a.item_id)).map((a) => ({ item: a.item_id, at: a.at, actor: a.actor_name || null, kind: a.kind, ...(a.field ? { field: a.field } : {}), ...(a.from !== undefined ? { from: a.from } : {}), ...(a.to !== undefined ? { to: a.to } : {}), ...(a.other ? { other: a.other } : {}), ...(a.dir ? { dir: a.dir } : {}), ...(a.dep_type ? { dep_type: a.dep_type } : {}), ...(a.lag ? { lag: a.lag } : {}), ...(a.auto ? { auto: true } : {}), ...(a.undo ? { undo: true } : {}) })) } : {}),
    ...(comments.length ? { comments: comments.filter((c) => ids.has(c.item_id)).map((c) => ({ id: c.id, item: c.item_id, ...(c.parent_id ? { parent: c.parent_id } : {}), author: (c.author_id ? name.get(c.author_id) : undefined) ?? (c.author_name || null), text: c.text, at: c.created_at, ...(c.edited_at ? { edited: c.edited_at } : {}) })) } : {}),
    items: items.map(({ workspace_id: _w, project_id: _p, assignee_id, ...rest }) => ({ ...rest, assignee: assignee_id ? name.get(assignee_id) ?? null : null })),
    deps: deps.filter((d) => ids.has(d.from_item_id) && ids.has(d.to_item_id)).map((d) => ({ from: d.from_item_id, to: d.to_item_id, ...(d.type !== "finish_to_start" ? { type: d.type } : {}), ...(d.lag ? { lag: d.lag } : {}) })),
    warnings: [],
  };
}

// ---------- JSON ----------

export function toJson(p: ParsedProject, exportedAt: string): string {
  return JSON.stringify({ format: FORMAT, version: 1, exported_at: exportedAt, project: { name: p.name, dependency_mode: p.dependency_mode, ...(p.fields?.length ? { fields: p.fields } : {}), ...(p.views?.length ? { views: p.views } : {}), ...(p.baseline ? { baseline: p.baseline } : {}) }, items: p.items, dependencies: p.deps, ...(p.comments?.length ? { comments: p.comments } : {}), ...(p.activity?.length ? { activity: p.activity } : {}) }, null, 2);
}

function shapeCheck(it: ParsedItem, n: number) {
  try { validateItemShape({ ...it, workspace_id: "", project_id: "", assignee_id: null }); }
  catch (e) { throw new ImportError(sv.ex.itemError(n, it.title.slice(0, 40), friendlyError(e))); }
}

/** Hierarkin måste hänga ihop: förälder finns, är en epic och bildar ingen cykel. Beroenden pekar på poster som finns. */
function structureCheck(p: ParsedProject) {
  const byId = new Map(p.items.map((i) => [i.id, i]));
  if (byId.size !== p.items.length) throw new ImportError(sv.ex.dupIdItems);
  for (const i of p.items) {
    if (i.parent_id === null) continue;
    const par = byId.get(i.parent_id);
    if (!par) throw new ImportError(sv.ex.parentMissing(i.title, i.parent_id));
    if (par.type !== "epic") throw new ImportError(sv.ex.parentNotEpic(i.title, par.title));
    const seen = new Set([i.id]);
    for (let c: ParsedItem | undefined = par; c; c = c.parent_id ? byId.get(c.parent_id) : undefined) {
      if (seen.has(c.id)) throw new ImportError(sv.ex.cycle(i.title));
      seen.add(c.id);
    }
  }
  for (const d of p.deps) {
    if (!byId.has(d.from) || !byId.has(d.to)) throw new ImportError(sv.ex.depMissing(d.from, d.to));
    if (d.from === d.to) throw new ImportError(sv.ex.depSelf(byId.get(d.from)!.title));
  }
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

export function parseJson(text: string): ParsedProject {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new ImportError(sv.ex.notJson); }
  if (!isObj(raw) || raw.format !== FORMAT) throw new ImportError(sv.ex.notExport);
  if (raw.version !== 1) throw new ImportError(sv.ex.version(String(raw.version)));
  if (!Array.isArray(raw.items)) throw new ImportError(sv.ex.noItems);
  if (raw.items.length > MAX_IMPORT_ITEMS) throw new ImportError(sv.ex.tooManyItems(MAX_IMPORT_ITEMS));
  const proj = isObj(raw.project) ? raw.project : {};
  const items: ParsedItem[] = raw.items.map((x, idx) => {
    const n = idx + 1;
    if (!isObj(x)) throw new ImportError(sv.ex.itemShape(n));
    const str = (k: string, def?: string) => { const v = x[k]; if (typeof v === "string") return v; if (v === undefined && def !== undefined) return def; throw new ImportError(sv.ex.itemField(n, k)); };
    if (!TYPES.includes(x.type as ItemType)) throw new ImportError(sv.ex.itemType(n, String(x.type)));
    const parent = x.parent_id ?? null; const assignee = x.assignee ?? null;
    if (parent !== null && typeof parent !== "string") throw new ImportError(sv.ex.itemParent(n));
    if (assignee !== null && typeof assignee !== "string") throw new ImportError(sv.ex.itemAssignee(n));
    const it: ParsedItem = {
      id: str("id"), parent_id: parent, type: x.type as ItemType, title: str("title"), start: str("start"), end: str("end"),
      status: str("status", "not_started") as Status, assignee, description: str("description", ""), priority: str("priority", "normal") as Priority,
      progress: typeof x.progress === "number" ? x.progress : 0, sort_order: typeof x.sort_order === "number" ? x.sort_order : n,
      ...(x.color !== undefined ? { color: x.color as ParsedItem["color"] } : {}),
      ...(typeof x.board_rank === "number" ? { board_rank: x.board_rank } : {}),
      ...(x.undated === true ? { undated: true } : {}),
      ...(Array.isArray(x.labels) ? { labels: x.labels as string[] } : {}),
      ...(Array.isArray(x.checklist) ? { checklist: x.checklist as Item["checklist"] } : {}),
      ...(Array.isArray(x.links) ? { links: x.links as Item["links"] } : {}),
      ...(Array.isArray(x.log) ? { log: x.log as Item["log"] } : {}),
      ...(isObj(x.fields) ? { fields: x.fields as Item["fields"] } : {}),
      ...(typeof x.ref === "string" && x.ref ? { ref: x.ref.slice(0, 60) } : typeof x.code === "string" && x.code ? { ref: x.code.slice(0, 60) } : {}),
      ...(typeof x.series === "string" && x.series ? { series: x.series } : {}),
      ...(typeof x.recur === "string" ? { recur: x.recur as ParsedItem["recur"] } : {}),
    };
    if (!it.id) throw new ImportError(sv.ex.itemNoId(n));
    shapeCheck(it, n);
    return it;
  });
  const depsRaw = Array.isArray(raw.dependencies) ? raw.dependencies : [];
  const deps = depsRaw.map((d, i) => {
    if (!isObj(d) || typeof d.from !== "string" || typeof d.to !== "string") throw new ImportError(sv.ex.depShape(i + 1));
    if (d.type !== undefined && !DEPENDENCY_TYPES.includes(d.type as DependencyType)) throw new ImportError(sv.ex.depType(i + 1, String(d.type)));
    if (d.lag !== undefined && (typeof d.lag !== "number" || !Number.isInteger(d.lag) || Math.abs(d.lag) > MAX_LAG)) throw new ImportError(sv.ex.depLag(i + 1, MAX_LAG));
    return { from: d.from, to: d.to, ...(d.type !== undefined && d.type !== "finish_to_start" ? { type: d.type as DependencyType } : {}), ...(typeof d.lag === "number" && d.lag !== 0 ? { lag: d.lag } : {}) };
  });
  const out: ParsedProject = {
    name: typeof proj.name === "string" && proj.name.trim() ? proj.name.trim().slice(0, 100) : sv.ex.defaultName,
    dependency_mode: proj.dependency_mode === "none" ? "none" : "shift", items, deps, warnings: [],
  };
  if (Array.isArray(proj.fields)) { try { validateFieldDefs(proj.fields as FieldDef[]); } catch (er) { throw new ImportError(friendlyError(er)); } out.fields = proj.fields as FieldDef[]; }
  if (Array.isArray(raw.activity)) {
    const ids = new Set(items.map((i) => i.id));
    const KINDS = ["created", "changed", "moved", "dep_added", "dep_changed", "dep_removed"];
    const str = (v: unknown, n = 200) => (typeof v === "string" ? v.slice(0, n) : undefined);
    out.activity = (raw.activity as unknown[]).flatMap((a, i) => {
      if (!isObj(a) || typeof a.item !== "string" || !KINDS.includes(String(a.kind)) || typeof a.at !== "string" || Number.isNaN(Date.parse(a.at))) throw new ImportError(sv.ex.activityShape(i + 1));
      if (!ids.has(a.item)) return [];
      const dep = typeof a.dep_type === "string" && DEPENDENCY_TYPES.includes(a.dep_type as DependencyType) ? (a.dep_type as DependencyType) : undefined;
      return [{ item: a.item, at: a.at, actor: str(a.actor, 60) ?? null, kind: a.kind as ActivityKind, ...(str(a.field, 40) ? { field: str(a.field, 40) } : {}), ...(str(a.from) !== undefined ? { from: str(a.from) } : {}), ...(str(a.to) !== undefined ? { to: str(a.to) } : {}), ...(str(a.other) ? { other: str(a.other) } : {}), ...(a.dir === "pred" || a.dir === "succ" ? { dir: a.dir } : {}), ...(dep ? { dep_type: dep } : {}), ...(typeof a.lag === "number" && Number.isInteger(a.lag) && a.lag !== 0 && Math.abs(a.lag) <= MAX_LAG ? { lag: a.lag } : {}), ...(a.auto === true ? { auto: true } : {}), ...(a.undo === true ? { undo: true } : {}) }];
    });
  }
  if (Array.isArray(raw.comments)) {
    const ids = new Set(items.map((i) => i.id));
    out.comments = (raw.comments as unknown[]).flatMap((c, i) => {
      if (!isObj(c) || typeof c.item !== "string" || typeof c.text !== "string" || typeof c.id !== "string") throw new ImportError(sv.ex.commentShape(i + 1));
      if (!ids.has(c.item)) return []; // kommentar på en post som inte finns i filen
      try { validateCommentText(c.text); } catch (er) { throw new ImportError(sv.ex.commentBad(i + 1, friendlyError(er))); }
      return [{ id: c.id, item: c.item, ...(typeof c.parent === "string" ? { parent: c.parent } : {}), author: typeof c.author === "string" && c.author.trim() ? c.author.trim().slice(0, 60) : null, text: c.text, at: typeof c.at === "string" && !Number.isNaN(Date.parse(c.at)) ? c.at : new Date(0).toISOString(), ...(typeof c.edited === "string" ? { edited: c.edited } : {}) }];
    });
  }
  if (isObj(proj.baseline)) { try { validateBaseline(proj.baseline as unknown as Baseline); } catch (er) { throw new ImportError(friendlyError(er)); } out.baseline = proj.baseline as unknown as Baseline; }
  if (Array.isArray(proj.views)) { try { validateSavedViews(proj.views as SavedView[]); } catch (er) { throw new ImportError(friendlyError(er)); } out.views = proj.views as SavedView[]; }
  structureCheck(out);
  out.report = buildReport(out, null);
  return out;
}

// ---------- CSV ----------

const FORMULA = /^[=+\-@\t\r]/;

/** Celler som ett kalkylblad skulle tolka som formel får ett inledande apostrofprefix (och tas bort igen vid inläsning). */
function cell(s: string): string {
  const safe = FORMULA.test(s) ? `'${s}` : s;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
const uncell = (s: string) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);

/** Poster i trädordning (förälder före barn, syskon efter sort_order), så att arket läses som Gantt-raderna. */
function treeOrder(items: ParsedItem[]): ParsedItem[] {
  const kids = new Map<string | null, ParsedItem[]>();
  const ids = new Set(items.map((i) => i.id));
  for (const i of items) { const k = i.parent_id && ids.has(i.parent_id) ? i.parent_id : null; kids.set(k, [...(kids.get(k) ?? []), i]); }
  const out: ParsedItem[] = [];
  const walk = (k: string | null) => { for (const i of (kids.get(k) ?? []).sort((a, b) => a.sort_order - b.sort_order)) { out.push(i); walk(i.id); } };
  walk(null);
  return out;
}

/** Föregångare i en CSV-cell: bara id för slut-start utan fördröjning, annars id:TYP och fördröjning (till exempel i7:SS+2). Kolon avskiljer, så id som Jira-nycklar (A-12) går bra. */
const DEP_ABBR: Record<DependencyType, string> = { finish_to_start: "FS", start_to_start: "SS", finish_to_finish: "FF", start_to_finish: "SF" };
const predCell = (d: { from: string; type?: DependencyType; lag?: number }): string => (!d.type && !d.lag ? d.from : `${d.from}:${DEP_ABBR[d.type ?? "finish_to_start"]}${d.lag ? (d.lag > 0 ? `+${d.lag}` : `${d.lag}`) : ""}`);
function parsePred(token: string, line: number): { ref: string; type?: DependencyType; lag?: number } {
  const m = /^(.*):(FS|SS|FF|SF)([+-]\d+)?$/i.exec(token);
  if (!m) return { ref: token };
  const type = (Object.keys(DEP_ABBR) as DependencyType[]).find((k) => DEP_ABBR[k] === m[2].toUpperCase())!;
  const lag = m[3] ? Number(m[3]) : 0;
  if (Math.abs(lag) > MAX_LAG) throw new ImportError(sv.ex.row(line, sv.ex.depLag(0, MAX_LAG)));
  return { ref: m[1].trim(), ...(type !== "finish_to_start" ? { type } : {}), ...(lag ? { lag } : {}) };
}

export function toCsv(p: ParsedProject): string {
  const preds = new Map<string, string[]>();
  for (const d of p.deps) preds.set(d.to, [...(preds.get(d.to) ?? []), predCell(d)]);
  const rows = treeOrder(p.items).map((i) => [
    i.id, sv.panel.type[i.type], i.title, i.parent_id ?? "", i.start, i.type === "milestone" ? i.start : i.end, sv.status[i.status], i.assignee ?? "",
    sv.panel.priorities[i.priority], String(i.progress), i.description, (preds.get(i.id) ?? []).join(", "), i.code ?? "",
  ]);
  return "﻿" + [[...sv.ex.header], ...rows].map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}

/** Minimal CSV-läsare: citerade fält med radbrytning, dubbla citattecken, valfri avskiljare. */
export function readCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const count = (c: string) => firstLine.split(c).length - 1;
  const delim = count(";") >= count(",") && count(";") >= count("\t") ? ";" : count(",") >= count("\t") ? "," : "\t";
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; row.push(field); field = ""; rows.push(row); row = []; }
    else field += c;
  }
  if (quoted) throw new ImportError(sv.ex.csvUnclosed);
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

// ---------- Smart tolkning av CSV ----------
// Målet är att ingen mall ska behövas: kolumner känns igen på namn (med synonymer på svenska och engelska), värden för typ, status och
// prioritet översätts, och det som saknas får rimliga standardvärden. Bara en titelkolumn krävs. Det som inte kan tolkas förloras inte:
// det läggs i beskrivningen. Strukturfel (cirkulär hierarki, saknad förälder, ogiltigt datum) avbryter fortfarande med radnummer.

const norm = (s: string) => s.toLowerCase().replace(/[\s_\-.:/]/g, "");
const ALIASES: Record<string, string[]> = {
  id: ["id", "itemid", "key", "nr", "nummer", "issueid", "taskid"],
  type: ["typ", "type", "recordtype", "itemtype", "issuetype", "kind", "nivå"],
  title: ["titel", "title", "namn", "name", "uppgift", "task", "taskname", "summary", "rubrik", "aktivitet", "subject"],
  parent: ["förälder", "forälder", "parent", "parentid", "parentitem", "epic", "epiclink", "överordnad"],
  start: ["start", "startdatum", "startdate", "begin", "från", "from"],
  end: ["slut", "slutdatum", "end", "enddate", "due", "duedate", "deadline", "förfallodatum", "finish", "till", "to"],
  status: ["status", "state", "tillstånd"],
  assignee: ["ansvarig", "assignee", "assignedto", "owner", "ägare", "responsible"],
  priority: ["prioritet", "priority", "prio"],
  progress: ["framsteg", "progress", "progresspercent", "complete", "percentcomplete", "%complete", "färdig"],
  description: ["beskrivning", "description", "notes", "anteckningar", "details", "kommentar"],
  preds: ["föregångare", "foregangare", "predecessors", "dependson", "beroenden", "blockedby", "dependencies"],
  completed: ["completeddate", "klardatum", "doneat", "closedat", "resolved", "completedat"],
  target: ["targetperiod", "målperiod", "period"],
  // Följande har ingen egen plats i modellen och läggs som rader i beskrivningen
  labels: ["etiketter", "etikett", "labels", "label", "taggar", "tagg", "tags", "tag"],
  links: ["länk", "länkar", "link", "links", "url", "webbadress", "urls"],
  checklist: ["checklista", "checklist", "delmoment", "deluppgifter", "subtasks", "todo"],
  recur: ["återkommer", "aterkommer", "upprepning", "upprepas", "recurrence", "repeat", "repeats", "frekvens", "intervall", "återkommande"],
  repeatcount: ["antaltillfällen", "tillfällen", "occurrences", "repeatcount", "antalupprepningar", "antalgånger"],
  code: ["kod", "code", "referens", "reference"],
  category: ["kategori", "category", "grupp", "group", "avdelning"],
  area: ["area", "område"], contacts: ["contacts", "kontakter", "contact"], origstatus: ["originalstatus", "ursprungligstatus"],
  basis: ["basis", "underlag", "grund"], asof: ["statusasof", "statusper"], effmin: ["efforthoursmin"], effmax: ["efforthoursmax"],
};
for (const k of Object.keys(ALIASES)) ALIASES[k] = ALIASES[k].map(norm);

/** Synonymer per intern typ, status och prioritet (jämförs normaliserat). Etiketterna på båda språken läggs till. */
const SYN = {
  type: { epic: ["grupp", "group", "section", "sektion", "project", "projekt", "workpackage", "arbetspaket", "program", "initiative", "initiativ", "theme", "tema", "phase", "fas", "portfolio", "group", "grupp"], milestone: ["gate", "checkpoint"], task: ["activity", "aktivitet", "deliverable", "leverans", "story", "bug", "issue", "subtask", "delaktivitet", "item", "work"] },
  status: { not_started: ["planned", "planerad", "todo", "backlog", "idea", "idé", "ny", "nytt", "new", "open", "unknown", "okänd", "proposed", "förslag"], in_progress: ["påbörjad", "started", "active", "aktiv", "doing", "ongoing", "testpågår"], done: ["klar", "complete", "completed", "closed", "avslutad", "färdig", "finished"], blocked: ["onhold", "paus", "paused", "waiting", "väntar", "stoppad"] },
  priority: { low: ["lägst", "minor", "trivial", "p4", "p5", "3", "4", "5"], normal: ["medium", "medel", "p2", "p3", "2"], high: ["p1", "1"], urgent: ["critical", "kritisk", "blocker", "highest", "högst", "p0", "0"] },
} as const;
const LABELS = {
  type: (k: ItemType) => [svDict.panel.type[k], enDict.panel.type[k]],
  status: (k: Status) => [svDict.status[k], enDict.status[k]],
  priority: (k: Priority) => [svDict.panel.priorities[k], enDict.panel.priorities[k]],
};
function lookup<T extends string>(kind: "type" | "status" | "priority", raw: string, keys: readonly T[]): T | null {
  const v = norm(raw);
  for (const k of keys) {
    const syn = (SYN[kind] as Record<string, readonly string[]>)[k] ?? [];
    const labels = (LABELS[kind] as unknown as (k: T) => string[])(k);
    if (v === norm(k) || labels.some((l) => v === norm(l)) || syn.some((x) => v === norm(x))) return k;
  }
  return null;
}

/** Upprepning som text: svenska och engelska former (jämförs normaliserat). */
const RECUR_SYN: Record<Recurrence, string[]> = {
  weekly: ["varjevecka", "veckovis", "veckovist", "varjeveckan", "weekly", "everyweek", "vecka"],
  biweekly: ["varannanvecka", "varjeandravecka", "varjetvåveckor", "varjevecka2", "var2avecka", "var2:avecka", "14dagar", "biweekly", "fortnightly", "everyotherweek", "everytwoweeks"],
  monthly: ["varjemånad", "månadsvis", "månatlig", "månatligen", "monthly", "everymonth", "månad"],
  quarterly: ["var3emånad", "var3:emånad", "vartredjemånad", "varjetredjemånad", "var3månad", "kvartalsvis", "varjekvartal", "kvartal", "quarterly", "every3months", "every3rdmonth", "everyquarter"],
};
const lookupRecur = (raw: string): Recurrence | null => {
  const v = norm(raw);
  return (Object.keys(RECUR_SYN) as Recurrence[]).find((k) => RECUR_SYN[k].some((s) => norm(s) === v)) ?? null;
};

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Datum i vanliga former: ÅÅÅÅ-MM-DD (även med klockslag), ÅÅÅÅ/MM/DD, ÅÅÅÅMMDD och D.M.ÅÅÅÅ eller D/M/ÅÅÅÅ (dag först). null om det inte är ett datum. */
function parseDate(raw: string): { iso: string; dayFirst: boolean } | null {
  const v = raw.trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/.exec(v) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) { const iso = `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`; return isISODate(iso) ? { iso, dayFirst: false } : null; }
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(v);
  if (m) { const iso = `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`; return isISODate(iso) ? { iso, dayFirst: true } : null; }
  return null;
}
/** Målperiod som kvartal, månad, halvår eller år. Allt annat (t.ex. "Startperiod 38") tolkas inte. */
function parsePeriod(raw: string): { start: string; end: string } | null {
  const v = raw.trim();
  let m = /^Q([1-4])\s*(\d{4})$/i.exec(v) ?? /^(\d{4})\s*Q([1-4])$/i.exec(v);
  if (m) { const [q, y] = /^Q/i.test(v) ? [+m[1], +m[2]] : [+m[2], +m[1]]; return { start: `${y}-${pad(q * 3 - 2)}-01`, end: `${y}-${pad(q * 3)}-${lastDay(y, q * 3)}` }; }
  m = /^H([12])\s*(\d{4})$/i.exec(v);
  if (m) { const y = +m[2], h = +m[1]; return { start: `${y}-${h === 1 ? "01" : "07"}-01`, end: `${y}-${h === 1 ? "06" : "12"}-${h === 1 ? "30" : "31"}` }; }
  m = /^(\d{4})-(\d{2})$/.exec(v);
  if (m && +m[2] >= 1 && +m[2] <= 12) return { start: `${m[1]}-${m[2]}-01`, end: `${m[1]}-${m[2]}-${lastDay(+m[1], +m[2])}` };
  m = /^(\d{4})$/.exec(v);
  if (m) return { start: `${m[1]}-01-01`, end: `${m[1]}-12-31` };
  return null;
}

/** Poster som saknar datum läggs från importdagen och en vecka framåt, så att de syns och går att dra bakåt eller framåt. */
export const PLACEHOLDER_DAYS = 7;

export function parseCsv(text: string, name: string, today: string = todayISO(), opts: ParseOpts = {}): ParsedProject {
  return parseRows(readCsv(text), name, today, opts);
}

/** Raderna ovanför rubrikraden tas bort (rubrikraden är den första inom de 15 första som har en titelkolumn). Finns ingen titelkolumn lämnas raderna orörda. */
export function trimToHeader(rows: string[][]): string[][] {
  const at = rows.slice(0, 15).findIndex((r) => r.some((c) => ALIASES.title.includes(norm(c))));
  return at > 0 ? rows.slice(at) : rows;
}

/**
 * Tolkar rader (första raden är rubriker) till ett projekt. Delas av CSV och Excel.
 * `fractionProgress`: Excel lagrar procent som bråk (40 % är 0,4). Är alla värden i framstegskolumnen högst 1, och något över 0, tolkas de som bråk.
 */
export interface ParseOpts {
  /** Excel lagrar procent som bråk (se parseRows). */
  fractionProgress?: boolean;
  /** Kolumner som inte känns igen blir egna fält (högst 20) i stället för text i beskrivningen. */
  extraAsFields?: boolean;
}
export function parseRows(rows: string[][], name: string, today: string = todayISO(), opts: ParseOpts = {}): ParsedProject {
  if (rows.length < 2) throw new ImportError(sv.ex.csvNoRows);
  if (rows.length - 1 > MAX_IMPORT_ITEMS) throw new ImportError(sv.ex.tooManyRows(MAX_IMPORT_ITEMS));
  const head = rows[0].map((h) => norm(h));
  const col: Record<string, number> = {};
  for (const [key, names] of Object.entries(ALIASES)) col[key] = head.findIndex((h) => names.includes(h));
  if (col.title < 0) throw new ImportError(sv.ex.csvColumn(sv.grid.title));
  const progScale = opts.fractionProgress && col.progress >= 0 && (() => {
    const v = rows.slice(1).map((r) => (r[col.progress] ?? "").trim()).filter(Boolean).map((x) => Number(x.replace(/%$/, "").replace(",", "."))).filter(Number.isFinite);
    return v.length > 0 && v.some((x) => x > 0) && v.every((x) => x <= 1) ? 100 : 1;
  })() || 1;
  const get = (r: string[], k: string) => (col[k] >= 0 ? uncell((r[col[k]] ?? "").trim()) : "");
  const getRaw = (r: string[], k: string) => (col[k] >= 0 ? uncell(r[col[k]] ?? "") : "");

  const warnings: string[] = [];
  const unknown = new Map<string, number>(); // "typ|värde" -> antal
  const note = (kind: string, value: string) => unknown.set(`${kind}|${value}`, (unknown.get(`${kind}|${value}`) ?? 0) + 1);
  const undatedIds: string[] = [];
  let shortened = 0, dayFirst = 0, linksSkipped = 0;
  const parentRef: (string | null)[] = []; const predRef: string[][] = []; const catRef: string[] = [];
  const recurRef: ({ kind: Recurrence; count: number } | null)[] = []; let recurIgnored = 0;
  // Kolumner som inte känns igen sparas i beskrivningen i stället för att försvinna
  const knownCols = new Set(Object.values(col).filter((i) => i >= 0));
  const extraCols = rows[0].map((h, i) => ({ h: h.trim(), i })).filter((x) => x.h && !knownCols.has(x.i));
  // Med valet "okända kolumner blir egna fält": typ och val ur kolumnens värden, och värdena ligger på posterna
  const fieldDefs: { x: { h: string; i: number }; def: FieldDef }[] = [];
  if (opts.extraAsFields) {
    const used = new Set<string>();
    for (const x of extraCols.slice(0, FIELD_LIMITS.fields)) {
      const base = inferFieldDef(x.h, rows.slice(1).map((r) => uncell(r[x.i] ?? "")));
      let nm = base.name, k = 2;
      while (used.has(nm.toLowerCase())) nm = `${base.name} ${k++}`.slice(0, FIELD_LIMITS.name);
      used.add(nm.toLowerCase());
      fieldDefs.push({ x, def: { ...base, name: nm, id: newFieldId() } });
    }
  }
  const asField = new Set(fieldDefs.map((f) => f.x.i));
  const TYPES_: ItemType[] = ["epic", "milestone", "task"];
  const items: ParsedItem[] = rows.slice(1).map((r, idx) => {
    const line = idx + 2; const err = (m: string) => new ImportError(sv.ex.row(line, m));
    let title = get(r, "title");
    if (!title) throw err(sv.ex.rowTitle);

    const typeRaw = get(r, "type");
    let type: ItemType = "task";
    if (typeRaw) { const t = lookup("type", typeRaw, TYPES_); if (t) type = t; else note("type", typeRaw); }
    // Återkommande: en rad med upprepning blir en serie milstolpar (om inte typen uttryckligen är något annat)
    let recur: { kind: Recurrence; count: number } | null = null;
    const recRaw = get(r, "recur");
    if (recRaw) {
      const k = lookupRecur(recRaw);
      if (!k) note("recur", recRaw);
      else if (typeRaw && type !== "milestone") recurIgnored++;
      else { const c = Number(get(r, "repeatcount").replace(",", ".")); recur = { kind: k, count: Number.isFinite(c) && c >= 1 ? Math.min(120, Math.floor(c)) : 12 }; type = "milestone"; }
    }
    recurRef.push(recur);
    const statusRaw = get(r, "status");
    let status: Status = "not_started";
    if (statusRaw) { const t = lookup("status", statusRaw, STATUSES); if (t) status = t; else note("status", statusRaw); }
    const prioRaw = get(r, "priority");
    let priority: Priority = "normal";
    if (prioRaw) { const t = lookup("priority", prioRaw, PRIORITIES); if (t) priority = t; else note("priority", prioRaw); }

    const dates = (k: string) => { const raw = get(r, k); if (!raw) return null; const d = parseDate(raw); if (!d) throw err(k === "start" ? sv.ex.rowStart(raw) : sv.ex.rowEnd(raw)); if (d.dayFirst) dayFirst++; return d.iso; };
    const sd = dates("start"), ed = dates("end");
    const cdRaw = get(r, "completed"); const cd = cdRaw ? parseDate(cdRaw)?.iso ?? null : null;
    const targetRaw = get(r, "target"); const tp = targetRaw ? parsePeriod(targetRaw) : null;
    let start: string, end: string;
    if (sd || ed) { start = sd ?? ed!; end = ed ?? sd!; }
    else if (tp) { start = tp.start; end = tp.end; }
    else if (status === "done" && cd) { start = end = cd; }
    else { undatedIds.push(get(r, "id") || `rad${line}`); start = today; end = addDays(today, PLACEHOLDER_DAYS - 1); }
    if (type === "milestone") end = start;

    const progRaw = get(r, "progress").replace(/%$/, "").trim().replace(",", ".");
    const progNum = progRaw === "" ? 0 : Number(progRaw);
    const progress = Number.isFinite(progNum) ? Math.min(100, Math.max(0, Math.round(progNum * progScale))) : 0;

    // Allt som inte har egen plats i modellen läggs sist i beskrivningen i stället för att försvinna
    const meta: string[] = [];
    const add = (label: string, v: string) => { if (v) meta.push(`${label}: ${v}`); };
    add(sv.ex.meta.area, get(r, "area")); add(sv.ex.meta.contacts, get(r, "contacts")); add(sv.ex.meta.origStatus, get(r, "origstatus"));
    add(sv.ex.meta.basis, get(r, "basis")); add(sv.ex.meta.asOf, get(r, "asof")); add(sv.ex.meta.target, targetRaw);
    add(sv.ex.meta.completed, cd ?? ""); if (/^\d+$/.test(prioRaw)) add(sv.ex.meta.priorityInFile, prioRaw);
    for (const x of extraCols) if (!asField.has(x.i)) add(x.h, uncell(r[x.i] ?? "").trim());
    const cf: Record<string, FieldValue> = {};
    for (const f of fieldDefs) { const v = importFieldValue(f.def, uncell(r[f.x.i] ?? "")); if (v !== null) cf[f.def.id] = v; }
    const emin = get(r, "effmin"), emax = get(r, "effmax"); if (emin || emax) add(sv.ex.meta.effort, emin === emax || !emax ? emin : `${emin}-${emax}`);
    let description = getRaw(r, "description");
    if (title.length > MAX_TITLE_LEN) { shortened++; description = description ? `${title}\n\n${description}` : title; title = `${title.slice(0, MAX_TITLE_LEN - 1).trimEnd()}…`; }
    if (meta.length) description = [description.trimEnd(), meta.join("\n")].filter(Boolean).join("\n\n");
    description = description.slice(0, MAX_DESC_LEN);

    // Etiketter, länkar och checklista från egna kolumner
    const seenLabel = new Set<string>(); const labels: string[] = [];
    for (const x of get(r, "labels").split(/[,;|\n]/)) { const l = x.trim().replace(/\s+/g, " ").slice(0, LIMITS.labelLength); if (l && !seenLabel.has(l.toLowerCase()) && labels.length < LIMITS.labels) { seenLabel.add(l.toLowerCase()); labels.push(l); } }
    const links = [] as NonNullable<Item["links"]>;
    for (const x of get(r, "links").split(/[\s|]+/).filter(Boolean)) { const l = normalizeLink(x, ""); if (l && links.length < LIMITS.links) links.push(l); else linksSkipped++; }
    const checklist = [] as NonNullable<Item["checklist"]>;
    for (const line of getRaw(r, "checklist").split(/\n|\|/)) {
      const m = /^\s*(?:\[(x|X| )\]|(x|X|✓))?\s*(.*)$/.exec(line);
      const text = (m?.[3] ?? "").trim().slice(0, LIMITS.checklistText);
      if (text && checklist.length < LIMITS.checklist) checklist.push({ id: newChecklistId(), text, done: !!(m?.[1] === "x" || m?.[1] === "X" || m?.[2]) });
    }
    parentRef.push(get(r, "parent") || null); catRef.push(get(r, "category"));
    predRef.push(get(r, "preds").split(/[,|;\n]/).map((x) => x.trim()).filter(Boolean));
    const it: ParsedItem = {
      id: get(r, "id") || `rad${line}`, parent_id: null, type, title, start, end, status,
      assignee: get(r, "assignee") || null, description, priority, progress, sort_order: idx + 1,
      ...(labels.length ? { labels } : {}), ...(links.length ? { links } : {}), ...(checklist.length ? { checklist } : {}),
      ...(Object.keys(cf).length ? { fields: cf } : {}),
      ...(get(r, "code") ? { ref: get(r, "code").slice(0, 60) } : {}),
    };
    try { validateItemShape({ ...it, workspace_id: "", project_id: "", assignee_id: null }); }
    catch (e) { throw err(friendlyError(e)); }
    return it;
  });

  // Förälder och föregångare anges som ID, eller som titel om titeln är unik.
  const byId = new Map(items.map((i) => [i.id, i]));
  if (byId.size !== items.length) throw new ImportError(sv.ex.dupIdRows);
  const titleCount = new Map<string, number>(); for (const i of items) titleCount.set(i.title, (titleCount.get(i.title) ?? 0) + 1);
  const resolve = (ref: string, line: number, what: string): string => {
    if (byId.has(ref)) return ref;
    const byTitle = items.filter((i) => i.title === ref);
    if (byTitle.length === 1) return byTitle[0].id;
    throw new ImportError(sv.ex.row(line, byTitle.length > 1 ? sv.ex.refAmbiguous(what, ref, titleCount.get(ref) ?? byTitle.length) : sv.ex.refMissing(what, ref)));
  };
  const deps: ParsedProject["deps"] = [];
  items.forEach((it, idx) => {
    if (parentRef[idx]) it.parent_id = resolve(parentRef[idx]!, idx + 2, sv.ex.whatParent);
    for (const p of predRef[idx]) { const q = parsePred(p, idx + 2); deps.push({ from: resolve(q.ref, idx + 2, sv.ex.whatPred), to: it.id, ...(q.type ? { type: q.type } : {}), ...(q.lag ? { lag: q.lag } : {}) }); }
  });
  // Återkommande rader blir en serie: ett tillfälle per datum, direkt efter raden, med samma serie och egenskaper
  const catById = new Map(items.map((it, i) => [it.id, catRef[i]] as const));
  if (recurRef.some(Boolean)) {
    const out: ParsedItem[] = []; let series = 0, total = 0;
    items.forEach((it, idx) => {
      out.push(it);
      const rc = recurRef[idx];
      if (!rc) return;
      const dates = recurringDates(it.start, rc.kind, rc.count);
      it.series = `s_${it.id}`; it.recur = rc.kind;
      dates.slice(1).forEach((d, k) => { const copy = { ...it, id: `${it.id}~${k + 2}`, start: d, end: d }; out.push(copy); catById.set(copy.id, catById.get(it.id) ?? ""); });
      series++; total += dates.length;
    });
    items.length = 0; items.push(...out);
    items.forEach((it, i) => { it.sort_order = i + 1; }); // tillfällena ligger direkt efter sin rad, i datumordning
    warnings.push(sv.ex.recurMade(series, total));
  }
  if (linksSkipped) warnings.push(sv.ex.linksSkipped(linksSkipped));
  if (recurIgnored) warnings.push(sv.ex.recurIgnored(recurIgnored));
  // Kategori (eller Grupp) blir grupper: varje kategori en grupp, och raderna läggs i sin grupp om de inte redan har en förälder
  if (col.category >= 0) {
    const groups = new Map<string, ParsedItem>();
    items.forEach((it, idx) => {
      const c = catById.get(it.id);
      if (!c || it.parent_id) return;
      let g = groups.get(c);
      if (!g) { g = { id: `__kategori_${groups.size + 1}`, parent_id: null, type: "epic", title: c.slice(0, MAX_TITLE_LEN), start: it.start, end: it.end, status: "not_started", assignee: null, description: "", priority: "normal", progress: 0, sort_order: it.sort_order }; groups.set(c, g); }
      it.parent_id = g.id;
    });
    for (const g of groups.values()) {
      const kids = items.filter((i) => i.parent_id === g.id);
      g.start = kids.reduce((m, k) => (k.start < m ? k.start : m), kids[0].start); g.end = kids.reduce((m, k) => (k.end > m ? k.end : m), kids[0].end);
      g.status = kids.every((k) => k.status === "done") ? "done" : kids.some((k) => k.status !== "not_started") ? "in_progress" : "not_started";
    }
    if (groups.size) {
      items.push(...groups.values());
      const top = items.filter((i) => !i.parent_id).sort((a, b) => a.sort_order - b.sort_order);
      top.forEach((i, n) => { i.sort_order = n + 1; }); // gruppernas plats är den första radens, så ordningen i filen bevaras
      warnings.push(sv.ex.categoryGroups(groups.size, rows[0][col.category].trim()));
    }
  }
  // Allt som har innehåll är en epic (bara en epic kan innehålla andra poster), oavsett vad filen kallar det
  const hasKids = new Set(items.map((i) => i.parent_id).filter((x): x is string => !!x));
  let promoted = 0;
  for (const i of items) if (hasKids.has(i.id) && i.type !== "epic") { i.type = "epic"; promoted++; }

  // Epics med innehåll får sina datum ur innehållet och räknas därför inte som saknade
  const undSet = new Set(undatedIds);
  for (const i of items) if (undSet.has(i.id.split("~")[0]) && !hasKids.has(i.id)) i.undated = true; // platshållardatum märks, så att de går att skilja från riktiga
  const undated = undatedIds.filter((id) => !hasKids.has(id)).length;
  if (undated) warnings.push(sv.ex.undated(undated, today, addDays(today, PLACEHOLDER_DAYS - 1)));
  if (promoted) warnings.push(sv.ex.promoted(promoted));
  if (shortened) warnings.push(sv.ex.shortened(shortened, MAX_TITLE_LEN));
  if (dayFirst) warnings.push(sv.ex.dayFirst(dayFirst));
  const fallback = { type: sv.panel.type.task, status: sv.status.not_started, priority: sv.panel.priorities.normal, recur: sv.ex.noRecur };
  const kindName = { type: sv.ex.kindType, status: sv.ex.kindStatus, priority: sv.ex.kindPriority, recur: sv.ex.kindRecur };
  for (const [key, n] of unknown) { const [kind, value] = key.split("|") as ["type" | "status" | "priority" | "recur", string]; warnings.push(sv.ex.unknownValue(kindName[kind], value, n, fallback[kind])); }
  const out: ParsedProject = { name: name.replace(/\.[^.]+$/, "").replace(/_/g, " ").trim().slice(0, 100) || sv.ex.defaultName, dependency_mode: "shift", items, deps, warnings };
  if (fieldDefs.length) { out.fields = fieldDefs.map((f) => f.def); warnings.push(sv.ex.fieldsMade(fieldDefs.length)); }
  structureCheck(out);
  const meaning = (i: number): string => {
    const key = Object.keys(col).find((k) => col[k] === i);
    return key ?? (asField.has(i) ? "field" : "description");
  };
  out.report = buildReport(out, rows[0].map((h, i) => ({ header: h.trim(), as: meaning(i) })).filter((c) => c.header));
  return out;
}

/** Tom exempelfil som visar kolumnerna. Bara Titel behövs, resten är valfritt. */
export function templateCsv(): string {
  return "﻿" + [[...sv.ex.header], ...sv.ex.sample].map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}

export function parseFile(fileName: string, text: string, opts: ParseOpts = {}): ParsedProject {
  if (text.length > MAX_IMPORT_BYTES) throw new ImportError(sv.ex.fileTooBig);
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".json")) return parseJson(text);
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return parseCsv(text, fileName, undefined, opts);
  throw new ImportError(sv.ex.fileType);
}

/** Läser en uppladdad fil: Excel (.xlsx) som binärfil, övriga som text. */
export async function parseUpload(file: File, opts: ParseOpts = {}): Promise<ParsedProject> {
  if (file.size > MAX_IMPORT_BYTES) throw new ImportError(sv.ex.fileTooBig);
  if (file.name.toLowerCase().endsWith(".xlsx")) {
    const { parseXlsx } = await import("./xlsx"); // laddas först när en Excel-fil väljs
    return parseXlsx(file, file.name, opts);
  }
  return parseFile(file.name, await file.text(), opts);
}

export function fileSlug(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "projekt";
}
