import { addDays, isISODate, todayISO } from "./dates";
import { RuleError, validateItemShape } from "./rules";
import { sv } from "../i18n/sv";
import { enDict, svDict } from "../i18n/sv";
import { friendlyError } from "../i18n/errors";
import type { Dependency, DependencyMode, Item, ItemType, Priority, Project, Status, User } from "./types";

/**
 * Export och import av projekt, utan beroende av lagring. JSON ger full återgivning (används också för att kopiera ett projekt).
 * CSV är för kalkylblad: semikolon som avskiljare och BOM i UTF-8 så att svenska Excel öppnar den rätt, och inläsningen tar även
 * komma och tabb. Inläsningen är allt-eller-inget: första felet avbryter med radnummer, ingenting läggs in halvt.
 */

export const FORMAT = "projektplanerare";
export const MAX_IMPORT_ITEMS = 5000;
export const MAX_IMPORT_BYTES = 5_000_000;

export interface ParsedItem extends Omit<Item, "workspace_id" | "project_id" | "assignee_id"> { assignee: string | null }
export interface ParsedProject {
  name: string;
  dependency_mode: DependencyMode;
  items: ParsedItem[];
  deps: { from: string; to: string }[];
  /** Saker som importerades med avvikelse (okänd ansvarig m.m.) */
  warnings: string[];
}

const MAX_TITLE_LEN = 200;
const MAX_DESC_LEN = 5000;
const STATUSES: Status[] = ["not_started", "in_progress", "done", "blocked"];
const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];
const TYPES: ItemType[] = ["epic", "milestone", "task"];

export class ImportError extends Error {}

/** Lagrets poster som en neutral beskrivning (ansvarig som namn, inga projekt- eller workspace-id). */
export function toParsed(project: Pick<Project, "name" | "dependency_mode">, items: Item[], deps: Dependency[], users: User[]): ParsedProject {
  const name = new Map(users.map((u) => [u.id, u.name]));
  const ids = new Set(items.map((i) => i.id));
  return {
    name: project.name,
    dependency_mode: project.dependency_mode ?? "shift",
    items: items.map(({ workspace_id: _w, project_id: _p, assignee_id, ...rest }) => ({ ...rest, assignee: assignee_id ? name.get(assignee_id) ?? null : null })),
    deps: deps.filter((d) => ids.has(d.from_item_id) && ids.has(d.to_item_id)).map((d) => ({ from: d.from_item_id, to: d.to_item_id })),
    warnings: [],
  };
}

// ---------- JSON ----------

export function toJson(p: ParsedProject, exportedAt: string): string {
  return JSON.stringify({ format: FORMAT, version: 1, exported_at: exportedAt, project: { name: p.name, dependency_mode: p.dependency_mode }, items: p.items, dependencies: p.deps }, null, 2);
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
    };
    if (!it.id) throw new ImportError(sv.ex.itemNoId(n));
    shapeCheck(it, n);
    return it;
  });
  const depsRaw = Array.isArray(raw.dependencies) ? raw.dependencies : [];
  const deps = depsRaw.map((d, i) => {
    if (!isObj(d) || typeof d.from !== "string" || typeof d.to !== "string") throw new ImportError(sv.ex.depShape(i + 1));
    return { from: d.from, to: d.to };
  });
  const out: ParsedProject = {
    name: typeof proj.name === "string" && proj.name.trim() ? proj.name.trim().slice(0, 100) : sv.ex.defaultName,
    dependency_mode: proj.dependency_mode === "none" ? "none" : "shift", items, deps, warnings: [],
  };
  structureCheck(out);
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

export function toCsv(p: ParsedProject): string {
  const preds = new Map<string, string[]>();
  for (const d of p.deps) preds.set(d.to, [...(preds.get(d.to) ?? []), d.from]);
  const rows = treeOrder(p.items).map((i) => [
    i.id, sv.panel.type[i.type], i.title, i.parent_id ?? "", i.start, i.type === "milestone" ? i.start : i.end, sv.status[i.status], i.assignee ?? "",
    sv.panel.priorities[i.priority], String(i.progress), i.description, (preds.get(i.id) ?? []).join(", "),
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

export function parseCsv(text: string, name: string, today: string = todayISO()): ParsedProject {
  const rows = readCsv(text);
  if (rows.length < 2) throw new ImportError(sv.ex.csvNoRows);
  if (rows.length - 1 > MAX_IMPORT_ITEMS) throw new ImportError(sv.ex.tooManyRows(MAX_IMPORT_ITEMS));
  const head = rows[0].map((h) => norm(h));
  const col: Record<string, number> = {};
  for (const [key, names] of Object.entries(ALIASES)) col[key] = head.findIndex((h) => names.includes(h));
  if (col.title < 0) throw new ImportError(sv.ex.csvColumn(sv.grid.title));
  const get = (r: string[], k: string) => (col[k] >= 0 ? uncell((r[col[k]] ?? "").trim()) : "");
  const getRaw = (r: string[], k: string) => (col[k] >= 0 ? uncell(r[col[k]] ?? "") : "");

  const warnings: string[] = [];
  const unknown = new Map<string, number>(); // "typ|värde" -> antal
  const note = (kind: string, value: string) => unknown.set(`${kind}|${value}`, (unknown.get(`${kind}|${value}`) ?? 0) + 1);
  const undatedIds: string[] = [];
  let shortened = 0, dayFirst = 0;
  const parentRef: (string | null)[] = []; const predRef: string[][] = [];
  const TYPES_: ItemType[] = ["epic", "milestone", "task"];
  const items: ParsedItem[] = rows.slice(1).map((r, idx) => {
    const line = idx + 2; const err = (m: string) => new ImportError(sv.ex.row(line, m));
    let title = get(r, "title");
    if (!title) throw err(sv.ex.rowTitle);

    const typeRaw = get(r, "type");
    let type: ItemType = "task";
    if (typeRaw) { const t = lookup("type", typeRaw, TYPES_); if (t) type = t; else note("type", typeRaw); }
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
    const progress = Number.isFinite(progNum) ? Math.min(100, Math.max(0, Math.round(progNum))) : 0;

    // Allt som inte har egen plats i modellen läggs sist i beskrivningen i stället för att försvinna
    const meta: string[] = [];
    const add = (label: string, v: string) => { if (v) meta.push(`${label}: ${v}`); };
    add(sv.ex.meta.area, get(r, "area")); add(sv.ex.meta.contacts, get(r, "contacts")); add(sv.ex.meta.origStatus, get(r, "origstatus"));
    add(sv.ex.meta.basis, get(r, "basis")); add(sv.ex.meta.asOf, get(r, "asof")); add(sv.ex.meta.target, targetRaw);
    add(sv.ex.meta.completed, cd ?? ""); if (/^\d+$/.test(prioRaw)) add(sv.ex.meta.priorityInFile, prioRaw);
    const emin = get(r, "effmin"), emax = get(r, "effmax"); if (emin || emax) add(sv.ex.meta.effort, emin === emax || !emax ? emin : `${emin}-${emax}`);
    let description = getRaw(r, "description");
    if (title.length > MAX_TITLE_LEN) { shortened++; description = description ? `${title}\n\n${description}` : title; title = `${title.slice(0, MAX_TITLE_LEN - 1).trimEnd()}…`; }
    if (meta.length) description = [description.trimEnd(), meta.join("\n")].filter(Boolean).join("\n\n");
    description = description.slice(0, MAX_DESC_LEN);

    parentRef.push(get(r, "parent") || null);
    predRef.push(get(r, "preds").split(/[,|;\n]/).map((x) => x.trim()).filter(Boolean));
    const it: ParsedItem = {
      id: get(r, "id") || `rad${line}`, parent_id: null, type, title, start, end, status,
      assignee: get(r, "assignee") || null, description, priority, progress, sort_order: idx + 1,
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
  const deps: { from: string; to: string }[] = [];
  items.forEach((it, idx) => {
    if (parentRef[idx]) it.parent_id = resolve(parentRef[idx]!, idx + 2, sv.ex.whatParent);
    for (const p of predRef[idx]) deps.push({ from: resolve(p, idx + 2, sv.ex.whatPred), to: it.id });
  });
  // Allt som har innehåll är en epic (bara en epic kan innehålla andra poster), oavsett vad filen kallar det
  const hasKids = new Set(items.map((i) => i.parent_id).filter((x): x is string => !!x));
  let promoted = 0;
  for (const i of items) if (hasKids.has(i.id) && i.type !== "epic") { i.type = "epic"; promoted++; }

  // Epics med innehåll får sina datum ur innehållet och räknas därför inte som saknade
  const undated = undatedIds.filter((id) => !hasKids.has(id)).length;
  if (undated) warnings.push(sv.ex.undated(undated, today, addDays(today, PLACEHOLDER_DAYS - 1)));
  if (promoted) warnings.push(sv.ex.promoted(promoted));
  if (shortened) warnings.push(sv.ex.shortened(shortened, MAX_TITLE_LEN));
  if (dayFirst) warnings.push(sv.ex.dayFirst(dayFirst));
  const fallback = { type: sv.panel.type.task, status: sv.status.not_started, priority: sv.panel.priorities.normal };
  const kindName = { type: sv.ex.kindType, status: sv.ex.kindStatus, priority: sv.ex.kindPriority };
  for (const [key, n] of unknown) { const [kind, value] = key.split("|") as ["type" | "status" | "priority", string]; warnings.push(sv.ex.unknownValue(kindName[kind], value, n, fallback[kind])); }
  const out: ParsedProject = { name: name.replace(/\.[^.]+$/, "").replace(/_/g, " ").trim().slice(0, 100) || sv.ex.defaultName, dependency_mode: "shift", items, deps, warnings };
  structureCheck(out);
  return out;
}

/** Tom exempelfil som visar kolumnerna. Bara Titel behövs, resten är valfritt. */
export function templateCsv(): string {
  return "﻿" + [[...sv.ex.header], ...sv.ex.sample].map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}

export function parseFile(fileName: string, text: string): ParsedProject {
  if (text.length > MAX_IMPORT_BYTES) throw new ImportError(sv.ex.fileTooBig);
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".json")) return parseJson(text);
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return parseCsv(text, fileName);
  throw new ImportError(sv.ex.fileType);
}

export function fileSlug(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "projekt";
}
