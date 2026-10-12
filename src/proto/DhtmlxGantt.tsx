import { useEffect, useMemo, useRef } from "react";
import { gantt, type Task } from "dhtmlx-gantt";
import "dhtmlx-gantt/codebase/dhtmlxgantt.css";
import type { DataStore } from "../data/DataStore";
import { addDays, diffDays, fromLocalDate, toLocalDate, todayISO } from "../data/dates";
import { friendlyError } from "../i18n/errors";
import type { ISODate } from "../data/types";
import { isOverdue } from "../data/rules";
import type { Baseline, Dependency, Item, Status, StatusDef, User } from "../data/types";
import { defOf, defaultStatusDefs } from "../data/statuses";
import type { CriticalResult } from "../data/critical";
import { sv } from "../i18n/sv";
import { datePatch, persistPatch } from "./persist";
import { STATUS_GLYPH } from "./statusUi";
import type { Zoom } from "./zoom";

// Epics ritas som vanliga staplar och inte som DHTMLX "project": biblioteket räknar själv om ett projekts datum från barnen och tappar då
// milstolpens dag, så vyn skulle visa andra datum än lagret. Våra epics härleds i lagret. Vilken sorts post det är ligger i `kind`.
/** Ikon för en epic i rutnätet (Feather "layers", MIT), så att en tom epic inte ser ut som en uppgift. */
const EPIC_GLYPH = `<svg class="epic-glyph" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`;
const TYPE: Record<Item["type"], string> = { epic: "task", milestone: "milestone", task: "task" };

const ZOOM = {
  day: { scales: [{ unit: "month", step: 1, format: "%F %Y" }, { unit: "day", step: 1, format: "%j" }], min: 28 },
  week: { scales: [{ unit: "month", step: 1, format: "%F %Y" }, { unit: "week", step: 1, format: "%j" }], min: 50 },
  month: { scales: [{ unit: "year", step: 1, format: "%Y" }, { unit: "month", step: 1, format: "%M" }], min: 70 },
} as const;

import { GRID_MIN } from "../layout";
import { COLUMN_ORDER, COLUMN_WIDTH, columnWidth, type ColumnId, type ColumnWidths, type StaticColumnId } from "../columns";
import type { FieldDef } from "../data/types";
import { setDragParent, startRowDragFeedback } from "./rowDrag";
import { consumeFocusMedian, scrollCarry } from "../scrollCarry";
/** Rutnätets fasta bredd är GRID_WIDTH (layout.ts). Panelen till höger tar plats från tidslinjen, aldrig från rutnätet. */

const LINK_TYPE: Record<string, string> = { finish_to_start: "0", start_to_start: "1", finish_to_finish: "2", start_to_finish: "3" };
const DEP_TYPE: Record<string, "finish_to_start" | "start_to_start" | "finish_to_finish" | "start_to_finish"> = { "0": "finish_to_start", "1": "start_to_start", "2": "finish_to_finish", "3": "start_to_finish" };
interface TaskRow { cr: boolean; sid: string; sname: string; ss: string; sm: string; code: string; cf: Record<string, string | number | null>; od: boolean; und: boolean; rec: boolean; color: string; id: string; text: string; start_date: Date; end_date: Date; type: string; kind: Item["type"]; parent: string | number; status: Status; priority: Item["priority"]; assignee: string; progress: number; open: boolean }
interface LinkRow { id: string; source: string; target: string; type: string }

/** Förväntad ordning för träd i djupet först, syskon efter sort_order. Används för att avgöra om strukturen ändrats. */
function treeOrder(items: Item[]): string[] {
  const kids = new Map<string | null, Item[]>();
  for (const i of [...items].sort((a, b) => a.sort_order - b.sort_order)) kids.set(i.parent_id, [...(kids.get(i.parent_id) ?? []), i]);
  const out: string[] = [];
  const walk = (pid: string | null) => { for (const i of kids.get(pid) ?? []) { out.push(i.id); walk(i.id); } };
  walk(null);
  return out;
}

export interface ContextArgs { id: string | null; x: number; y: number; date: ISODate | null }

export function DhtmlxGantt({ store, items, deps, zoom, onError, onPersisted, revealId, onNotice, onCreateAt, onRename, onContext, onToggleDone, onMoveRow, onAddInGroup, onEditField, onSelect, selected, touchMode, fieldDefs, gridWidth, columns, users, collapse, colors, todayToken, seriesMarks, openId, navToken, onOpenItem, baseline, columnWidths, onResizeColumn, statuses, critical }: {
  /** Kritisk linje: poster och länkar som markeras (null: ingen markering). */
  critical?: CriticalResult | null;
  /** Projektets statusar (egna eller grundstatusarna), för statuskolumnen och verktygstipsen. */
  statuses?: StatusDef[];
  /** Egna kolumnbredder, och hur de ändras (id "title" = rutnätets bredd; null = tillbaka till standard). */
  columnWidths?: ColumnWidths;
  onResizeColumn?: (id: ColumnId | "title", width: number | null, final: boolean) => void;
  /** Baslinje att rita som tunna staplar under de verkliga (null: ingen). */
  baseline?: Baseline | null;
  /** Serier som visas som en rad: raden (id) och de andra tillfällena, som ritas som romber på raden. */
  seriesMarks?: ReadonlyMap<string, Item[]>;
  /** Posten som är öppen i panelen (en romb ritas som vald också när den är öppnad utan att vara markerad). */
  openId?: string | null;
  /** Räknas upp när ett tillfälle i en serie öppnas med pilarna i panelen: då rullas tidslinjen till det om det ligger utanför bild. */
  navToken?: number;
  /** Klick på en romb: öppna det tillfället. */
  onOpenItem?: (id: string) => void;
  /** Markerade rader (flerval). Klick med Ctrl/Cmd växlar, Shift markerar en följd, ett vanligt klick avmarkerar. */
  selected?: ReadonlySet<string>;
  /** Pekläge: automatiskt (bara enheter med enbart pekskärm), alltid på, eller av. */
  touchMode?: "auto" | "on" | "off";
  onSelect?: (a: { id: string; mode: "toggle" | "range" | "clear"; visible: string[] }) => void;
  store: DataStore; items: Item[]; deps: Dependency[]; zoom: Zoom; onError: (e: unknown) => void; onPersisted?: () => void;
  /** Post som ska bläddras fram och markeras (t.ex. en nyskapad). */
  revealId?: string | null;
  /** Meddelande till användaren som inte kräver omladdning (t.ex. ett avvisat beroende). */
  onNotice?: (message: string) => void;
  /** Dubbelklick på en tom del av en rad (datum) eller under raderna (rowId null). */
  onCreateAt?: (a: { rowId: string | null; date: ISODate | null }) => void;
  /** Dubbelklick på en rads titel i rutnätet. */
  onRename?: (id: string) => void;
  /** Högerklick (eller ctrl-klick på Mac) på en rad eller en tom yta. */
  onContext?: (a: ContextArgs) => void;
  /** Klick på bocken i en rad. */
  onToggleDone?: (id: string) => void;
  /** En rad drogs till ny plats i rutnätet: ny förälder (null = överst) och syskonen i den ordning vyn visar dem. */
  onMoveRow: (id: string, parentId: string | null, visibleOrder: string[]) => Promise<void> | void;
  /** "+" på en grupprad: lägg till en uppgift sist i den gruppen. */
  onAddInGroup?: (groupId: string) => void;
  /** Rutnätets bredd i px (användarens val). */
  gridWidth: number;
  /** Fäll ihop eller öppna alla grupper (n ökas för varje klick). */
  collapse?: { n: number; open: boolean };
  /** Färg per post (efter gruppen), räknad på alla poster så att filter inte flyttar färgerna. */
  colors: Map<string, string>;
  /** Valda kolumner (titeln visas alltid) och personer att välja bland som ansvarig. */
  columns: ColumnId[]; users: User[];
  /** Projektets egna fält (för kolumner med egna fält). */
  fieldDefs?: FieldDef[];
  /** En ruta i en rad ändrades (status, prioritet eller ansvarig). Ska spara, och returnera efter att det är gjort. */
  onEditField?: (id: string, field: "status" | "priority" | "assignee", value: string) => Promise<unknown> | void;
  /** Ökas för att bläddra till dagens datum. */
  todayToken?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const known = useRef(new Map<string, Item>());
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const workspaceId = items[0]?.workspace_id ?? "";
  const marksRef = useRef<ReadonlyMap<string, Item[]>>(new Map());
  marksRef.current = seriesMarks ?? new Map();
  const drawMarksRef = useRef<(() => void) | null>(null);
  const drawResizersRef = useRef<(() => void) | null>(null);
  const keyFocusRef = useRef<string | null>(null);
  const baselineRef = useRef<Baseline | null>(null);
  baselineRef.current = baseline ?? null;
  const openItemRef = useRef(onOpenItem);
  openItemRef.current = onOpenItem;
  const latest = useRef({ store, onError, workspaceId, onPersisted, onNotice, onCreateAt, onRename, onContext, onToggleDone, onMoveRow, onAddInGroup, onEditField, onSelect, users });
  latest.current = { store, onError, workspaceId, onPersisted, onNotice, onCreateAt, onRename, onContext, onToggleDone, onMoveRow, onAddInGroup, onEditField, onSelect, users };
  const openIdRef = useRef<string | null>(openId ?? null);
  openIdRef.current = openId ?? null;
  const selectedRef = useRef<ReadonlySet<string>>(selected ?? new Set());
  selectedRef.current = selected ?? selectedRef.current;
  const gridWidthRef = useRef(gridWidth);
  const columnsRef = useRef(columns);
  const criticalRef = useRef<CriticalResult | null>(null);
  criticalRef.current = critical ?? null;
  const statusesRef = useRef<StatusDef[]>(statuses ?? defaultStatusDefs());
  statusesRef.current = statuses ?? defaultStatusDefs();
  const widthsRef = useRef<ColumnWidths>(columnWidths ?? {});
  widthsRef.current = columnWidths ?? {};
  const resizeRef = useRef(onResizeColumn);
  resizeRef.current = onResizeColumn;
  const widthSigRef = useRef(JSON.stringify(columnWidths ?? {}));
  const fieldSigRef = useRef(JSON.stringify((fieldDefs ?? []).map((d) => [d.id, d.name])));
  const fieldDefsRef = useRef<FieldDef[]>(fieldDefs ?? []);
  fieldDefsRef.current = fieldDefs ?? [];
  const buildColumnsRef = useRef<(() => unknown[]) | null>(null);
  const openState = useRef(new Map<string, boolean>());
  const pendingSelect = useRef<{ id: string; field: string; until: number } | null>(null); // ruta i en rad som ändrats: fokus ska följa med när raden ritats om
  const restoreFocusRef = useRef<(() => void) | null>(null);
  const pendingFocus = useRef<string | null>(null); // bock som växlats med tangentbord: fokus ska ligga kvar när raden ritats om

  const mapped = useMemo(() => {
    known.current = new Map(items.map((i) => [i.id, i]));
    const marks = marksRef.current;
    const crit = criticalRef.current;
    const sdefs = statusesRef.current, ssig = JSON.stringify(sdefs);
    const tasks: TaskRow[] = [...items].sort((a, b) => a.sort_order - b.sort_order).map((i) => ({
      id: i.id,
      text: i.title,
      start_date: toLocalDate(i.start),
      end_date: toLocalDate(addDays(i.end, 1)), // biblioteket räknar slutdatum exklusivt
      type: TYPE[i.type],
      kind: i.type,
      parent: i.parent_id ?? 0,
      cr: !!crit?.ids.has(i.id), sid: defOf(i, sdefs).id, sname: defOf(i, sdefs).name, ss: ssig, sm: (marks.get(i.id) ?? []).map((m) => `${m.id}|${m.start}|${m.status}|${m.title}`).join(";"), code: i.code ?? "", status: i.status, priority: i.priority, assignee: i.assignee_id ?? "", progress: i.progress, color: colors.get(i.id) ?? "none", rec: !!i.series, und: !!i.undated, od: isOverdue(i, todayISO()), cf: i.fields ?? {},
      open: true,
    }));
    const links: LinkRow[] = deps.map((d) => ({ id: d.id, source: d.from_item_id, target: d.to_item_id, type: LINK_TYPE[d.type] ?? "0" }));
    return { tasks, links, order: treeOrder(items) };
  }, [items, deps, colors, seriesMarks, statuses, critical]);

  // Engångsinställning och initiering
  useEffect(() => {
    gantt.config.date_format = "%Y-%m-%d";
    gantt.config.show_progress = false;
    gantt.config.details_on_dblclick = false; // vi har egen panel, inte DHTMLX:s dialog
    gantt.config.details_on_create = false;
    gantt.config.fit_tasks = true; // tidsskalan utökas så att alla poster ryms (annars syns inte en post som läggs utanför det första spannet)
    gantt.config.drag_progress = false;
    gantt.config.drag_project = false;
    gantt.config.grid_width = gridWidthRef.current;
    gantt.config.order_branch = "marker"; // rader kan dras i rutnätet för att byta plats ...
    gantt.config.order_branch_free = true; // ... och förälder (släpps på en epic)
    gantt.config.row_height = 30;
    gantt.config.bar_height = 22;
    gantt.config.start_on_monday = true;
    gantt.config.keyboard_navigation = true;
    // Rutnätet har fast bredd och ingen dragbar skiljelinje (ett länkdrag som började nära linjen ändrade annars rutnätets bredd). Utan fast bredd kan en smalare behållare (när panelen öppnas) låta rutnätet ta över så att tidslinjen försvinner.
    gantt.config.layout = {
      css: "gantt_container",
      cols: [
        { width: gridWidthRef.current, min_width: GRID_MIN, rows: [{ view: "grid", scrollX: "gridScroll", scrollable: true, scrollY: "scrollVer" }, { view: "scrollbar", id: "gridScroll" }] },
        { rows: [{ view: "timeline", scrollX: "scrollHor", scrollY: "scrollVer" }, { view: "scrollbar", id: "scrollHor" }] },
        { view: "scrollbar", id: "scrollVer" },
      ],
    };
    gantt.locale.date.month_full = [...sv.dates.monthsFull] as typeof gantt.locale.date.month_full;
    gantt.locale.date.month_short = [...sv.dates.monthsShort] as typeof gantt.locale.date.month_short;
    gantt.templates.link_class = (link) => (criticalRef.current?.links.has(String(link.id)) ? "critical-link" : "");
    gantt.templates.task_class = (_s, _e, t) => `st-${(t as unknown as { status: Status }).status}${(t as unknown as { kind: string }).kind === "epic" ? " epic" : ""}${(t as unknown as TaskRow).und ? " undated" : ""}${(t as unknown as TaskRow).cr ? " critical" : ""}${openIdRef.current === String(t.id) ? " open-item" : ""}`;
    gantt.templates.grid_row_class = (_s, _e, t) => `${(t as unknown as { kind: string }).kind === "epic" ? "epic-row" : ""} grp-${(t as unknown as TaskRow).color}${(t as unknown as TaskRow).rec ? " has-series" : ""}${(t as unknown as TaskRow).und ? " undated-row" : ""}${(t as unknown as TaskRow).od ? " overdue-row" : ""}${selectedRef.current.has(String(t.id)) ? " sel-row" : ""}`;
    gantt.templates.task_row_class = (_s, _e, t) => `${(t as unknown as { kind: string }).kind === "epic" ? "epic-row" : ""}${selectedRef.current.has(String(t.id)) ? " sel-row" : ""}`;
    gantt.templates.task_row_class = (_s, _e, t) => ((t as unknown as { kind: string }).kind === "epic" ? "epic-row" : "");
    // Texten i en stapel: ryms titeln flyttas den till höger om staplen (som i andra planeringsverktyg), annars visas den inuti.
    // Bredden mäts med typsnittet och storleken staplarna faktiskt har. Titeln finns alltid kvar som tooltip.
    const canvas = document.createElement("canvas").getContext("2d")!;
    const measure = (text: string) => {
      canvas.font = `500 13px ${getComputedStyle(host.current ?? document.body).fontFamily}`;
      return canvas.measureText(text).width;
    };
    const label = (t: { text: string; status: Status; end_date: Date }) => {
      const overdue = isOverdue({ end: addDays(fromLocalDate(t.end_date), -1), status: t.status }, todayISO());
      return { glyph: STATUS_GLYPH[t.status], title: `${t.text}${overdue ? ` (${sv.overdue})` : ""}` };
    };
    const fits = (t: Task) => {
      const { glyph, title } = label(t as never);
      const width = gantt.getTaskPosition(t, t.start_date as Date, t.end_date as Date).width as number;
      return t.type !== "milestone" && width - 2 /* ram */ - 8 /* luft */ >= measure(`${glyph} ${title}`) + 2;
    };
    gantt.templates.task_text = (_s, _e, t) => {
      const status = (t as unknown as { status: Status }).status;
      const { glyph, title } = label(t as never);
      const sr = `<span class="sr-only">${esc((t as unknown as TaskRow).sname)}${(t as unknown as TaskRow).cr ? `, ${esc(sv.critical.sr)}` : ""}. </span>`;
      if (!fits(t)) return sr; // titeln visas till höger, se rightside_text
      return `<span class="bar-glyph" aria-hidden="true">${glyph}</span>${sr}${title}`;
    };
    gantt.templates.rightside_text = (_s, _e, t) => {
      if ((t as unknown as TaskRow).sm) return ""; // serie som en rad: rombena ligger till höger, titeln står i listan och i verktygstipset
      if (fits(t)) return "";
      const { glyph, title } = label(t as never);
      return `<span class="bar-glyph" aria-hidden="true">${glyph}</span>${title}`;
    };
    // Serier som en rad: en romb för varje tillfälle utom det som raden själv visar. Ritas som ett eget lager över tidslinjen (Community-utgåvan har inga egna lager).
    // Ett klick på en romb öppnar tillfället.
    const drawMarks = () => {
      const area = (gantt as unknown as { $task_data?: HTMLElement }).$task_data;
      const host = (area?.querySelector(".gantt_data_area") as HTMLElement | null) ?? area ?? null;
      if (!host) return;
      host.querySelectorAll(":scope > .series-marks").forEach((e) => e.remove());
      const bl = baselineRef.current;
      if (!marksRef.current.size && !bl) return;
      const st = gantt.getScrollState(), viewH = (area?.clientHeight ?? 800) + 80; // bara raderna som syns (och lite till), så att en stor plan inte ritar tusentals element vid varje rullning
      const near = (top: number) => top >= (st.y ?? 0) - 80 && top <= (st.y ?? 0) + viewH;
      const wrap = document.createElement("div");
      wrap.className = "series-marks";
      wrap.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:3;";
      for (const [repId, others] of marksRef.current) {
        if (!gantt.isTaskExists(repId) || !gantt.isTaskVisible(repId)) continue;
        const task = gantt.getTask(repId);
        const pos = gantt.getTaskPosition(task, task.start_date as Date, task.end_date as Date);
        if (!near(pos.top as number)) continue;
        for (const m of others) {
          const d = toLocalDate(m.start);
          const cell = gantt.getTaskPosition(task, d, toLocalDate(addDays(m.start, 1)));
          const b = document.createElement("button");
          b.type = "button"; b.className = `series-mark st-${m.status}${selectedRef.current.has(m.id) || openIdRef.current === m.id ? " sel" : ""}`; b.dataset.id = m.id; b.dataset.series = repId;
          b.style.left = `${(cell.left as number) + (cell.width as number) / 2 - 8}px`;
          b.style.top = `${pos.top + Math.max(0, ((pos.height as number) - 16) / 2)}px`;
          b.title = `${m.title}, ${m.start}`; b.setAttribute("aria-label", `${m.title}, ${m.start}`);
          b.addEventListener("click", (e) => { e.stopPropagation(); try { if (gantt.getSelectedId()) gantt.unselectTask(); } catch { /* ingen vald */ } openItemRef.current?.(m.id); });
          b.addEventListener("dblclick", (e) => e.stopPropagation());
          b.addEventListener("pointerdown", (e) => e.stopPropagation());
          wrap.appendChild(b);
        }
      }
      // Baslinje: en tunn stapel under den verkliga för varje post som fanns när baslinjen sparades. Röd kant om slutet har glidit.
      if (bl) {
        gantt.eachTask((task) => {
          const e = bl.items[String(task.id)];
          if (!e || !gantt.isTaskVisible(task.id)) return;
          const pos = gantt.getTaskPosition(task, task.start_date as Date, task.end_date as Date);
          if (!near(pos.top as number)) return;
          const a = gantt.getTaskPosition(task, toLocalDate(e.start), toLocalDate(addDays(e.end, 1)));
          const slip = diffDays(e.end, addDays(fromLocalDate(task.end_date as Date), -1));
          const bar = document.createElement("div");
          bar.className = `baseline-bar${slip > 0 ? " slip" : slip < 0 ? " early" : ""}`;
          bar.dataset.id = String(task.id);
          bar.style.cssText = `position:absolute;left:${a.left}px;top:${(pos.top as number) + (pos.height as number) + 1}px;width:${Math.max(4, a.width as number)}px;`;
          bar.title = sv.baseline.tip(e.start, e.end, slip);
          wrap.appendChild(bar);
        });
      }
      host.appendChild(wrap);
    };
    drawMarksRef.current = drawMarks;
    // Kolumnrubrikernas kanter går att dra (Community-utgåvan saknar det): ett handtag i varje rubrik. Titeln ändrar rutnätets bredd, de andra sin egen.
    const colOf = (name: string): ColumnId | "title" | null => name === "text" ? "title" : name === "start_date" ? "start" : name === "end_date" ? "end" : name === "progress_pct" ? "progress" : name.startsWith("field_") ? (`f:${name.slice(6)}` as ColumnId) : (COLUMN_ORDER as string[]).includes(name) ? (name as ColumnId) : null;
    const drawResizers = () => {
      const area = (gantt as unknown as { $grid_scale?: HTMLElement }).$grid_scale ?? document.querySelector<HTMLElement>(".dhx-host .gantt_grid_scale");
      area?.querySelectorAll<HTMLElement>(".gantt_grid_head_cell").forEach((cell) => {
        if (cell.querySelector(":scope > .col-resizer")) return;
        const id = colOf(cell.getAttribute("data-column-id") ?? "");
        if (!id) return;
        const label = cell.textContent?.trim() || String(id);
        const h = document.createElement("span");
        h.className = "col-resizer"; h.setAttribute("role", "separator"); h.setAttribute("aria-orientation", "vertical"); h.tabIndex = 0;
        h.setAttribute("aria-label", sv.cols.resize(label)); h.title = sv.cols.resizeHint; h.dataset.col = String(id);
        const widthNow = () => (id === "title" ? gridWidthRef.current : columnWidth(id, widthsRef.current));
        h.addEventListener("pointerdown", (e) => {
          e.preventDefault(); e.stopPropagation();
          const x0 = e.clientX, w0 = widthNow();
          h.classList.add("active");
          document.body.classList.add("col-resizing");
          // Lyssnarna sitter på dokumentet: rubriken ritas om medan man drar (kolumnerna byggs om), och då försvinner handtaget under pekaren
          let raf = 0, last = w0;
          const move = (ev: PointerEvent) => { last = w0 + (ev.clientX - x0); if (!raf) raf = requestAnimationFrame(() => { raf = 0; resizeRef.current?.(id, last, false); }); };
          const up = () => { document.removeEventListener("pointermove", move, true); document.removeEventListener("pointerup", up, true); document.removeEventListener("pointercancel", up, true); document.body.classList.remove("col-resizing"); h.classList.remove("active"); if (raf) cancelAnimationFrame(raf); resizeRef.current?.(id, last, true); };
          document.addEventListener("pointermove", move, true); document.addEventListener("pointerup", up, true); document.addEventListener("pointercancel", up, true);
        });
        h.addEventListener("dblclick", (e) => { e.preventDefault(); e.stopPropagation(); resizeRef.current?.(id, id === "title" ? null : null, true); });
        h.addEventListener("click", (e) => e.stopPropagation());
        h.addEventListener("keydown", (e) => {
          const step = 8;
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            keyFocusRef.current = id; e.preventDefault(); e.stopPropagation(); resizeRef.current?.(id, widthNow() + (e.key === "ArrowRight" ? step : -step), true); }
        });
        cell.appendChild(h);
        if (keyFocusRef.current === id) h.focus({ preventScroll: true }); // rubriken ritas om när bredden ändras: fokus ska ligga kvar
      });
    };
    drawResizersRef.current = drawResizers;
    const dropKeyFocus = (e: Event) => { if (!(e.target as Element | null)?.closest?.(".col-resizer")) keyFocusRef.current = null; };
    document.addEventListener("pointerdown", dropKeyFocus, true); document.addEventListener("focusin", dropKeyFocus, true);
    const markEvents = ["onGanttRender", "onGanttReady", "onGridResizeEnd", "onDataRender", "onAfterTaskUpdate", "onAfterTaskAdd", "onAfterTaskDelete", "onGanttScroll"].map((ev) => gantt.attachEvent(ev as never, (() => { drawMarks(); drawResizers(); return true; }) as never));
    gantt.plugins({ tooltip: true });
    gantt.templates.tooltip_text = (start, end, t) => {
      const status = (t as unknown as { status: Status }).status;
      const last = addDays(fromLocalDate(end), -1);
      return `<b>${t.text}</b><br/>${sv.dates.range(fromLocalDate(start), last)}<br/>${STATUS_GLYPH[status]} ${String((t as unknown as TaskRow).sname).replace(/&/g, "&amp;").replace(/</g, "&lt;")}${(t as unknown as TaskRow).cr ? `<br/><b>${sv.critical.tip}</b>` : ""}`;
    };
    // Slutdatumet i en dämpad kolumn: titel, datum och status ska inte ha samma tyngd (som listorna i Asana och monday)
    // Slutdagen: biblioteket räknar slutet exklusivt, och en milstolpe har sitt datum i startdatumet
    const shortDate = (t: Task) => { const e = t.end_date as Date, s = t.start_date as Date; const d = t.type === "milestone" ? s : new Date(e.getFullYear(), e.getMonth(), e.getDate() - 1); return `${d.getDate()} ${gantt.locale.date.month_short[d.getMonth()]}`; };
    gantt.config.columns = [
      { name: "text", label: sv.grid.title, tree: true, width: "*", template: (t) => {
        const done = (t as unknown as { status: Status }).status === "done";
        // Bocken: klar eller inte klar direkt i raden. En knapp, så tangentbord (Enter, mellanslag) fungerar och skärmläsare får status.
        const check = `<button type="button" class="row-check" role="checkbox" aria-checked="${done}" aria-label="${done ? sv.check.undone : sv.check.done}: ${String(t.text).replace(/"/g, "&quot;")}" data-check="${t.id}">${done ? "\u2713" : ""}</button>`;
        const isGroup = (t as unknown as { kind: string }).kind === "epic";
        const title = `<span class="grid-title" title="${String(t.text).replace(/"/g, "&quot;")}">${t.text}</span>`;
        if (!isGroup) return `${check}${title}`;
        // Grupprad: ikon, antal direkta poster och "+" för att lägga till en uppgift sist i gruppen (synlig vid hovring, alltid synlig i en tom grupp)
        const n = gantt.getChildren(t.id).length;
        const add = `<button type="button" class="row-add${n === 0 ? " empty" : ""}" data-add-in="${t.id}" aria-label="${sv.group.addTask(String(t.text)).replace(/"/g, "&quot;")}" title="${sv.group.addTask(String(t.text)).replace(/"/g, "&quot;")}">+</button>`;
        return `${check}${EPIC_GLYPH}${title}<span class="group-tools"><span class="group-count" title="${sv.group.count(n)}">${n || ""}</span>${add}</span>`;
      } },
    ];
    const titleColumn = gantt.config.columns[0];
    // Valbara kolumner. Status, ansvarig och prioritet är redigerbara rutor direkt i raden (ändringen fångas av en gemensam lyssnare, se onCellChange).
    const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const select = (t: Task, field: string, label: string, value: string, options: [string, string][], cls = "") =>
      `<select class="cell-select ${cls}" data-id="${t.id}" data-field="${field}" aria-label="${esc(`${label}: ${t.text}`)}">${options.map(([v, l]) => `<option value="${esc(v)}"${v === value ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    const dayOf = (d: Date) => `${d.getDate()} ${gantt.locale.date.month_short[d.getMonth()]}`;
    const cw = (c: ColumnId) => columnWidth(c, widthsRef.current);
    const COLS: Record<StaticColumnId, unknown> = {
      code: { name: "code", label: sv.cols.code, width: cw("code"), template: (t: Task) => `<span class="grid-code">${esc((t as unknown as TaskRow).code)}</span>` },
      status: { name: "status", label: sv.panel.status, width: cw("status"), template: (t: Task) => select(t, "status", sv.panel.status, (t as unknown as TaskRow).sid,
        statusesRef.current.map((d) => [d.id, `${STATUS_GLYPH[d.category]} ${d.name}`] as [string, string]), `chip st-${(t as unknown as TaskRow).status}`) },
      assignee: { name: "assignee", label: sv.panel.assignee, width: cw("assignee"), template: (t: Task) => select(t, "assignee", sv.panel.assignee, (t as unknown as TaskRow).assignee,
        [["", sv.cols.none], ...latest.current.users.map((u) => [u.id, u.name] as [string, string])]) },
      priority: { name: "priority", label: sv.panel.priority, width: cw("priority"), template: (t: Task) => select(t, "priority", sv.panel.priority, (t as unknown as TaskRow).priority,
        (["low", "normal", "high", "urgent"] as const).map((p) => [p, sv.panel.priorities[p]] as [string, string]), `prio-${(t as unknown as TaskRow).priority}`) },
      start: { name: "start_date", label: sv.panel.start, width: cw("start"), align: "right", template: (t: Task) => `<span class="grid-date">${dayOf(t.start_date as Date)}</span>` },
      end: { name: "end_date", label: sv.grid.end, width: cw("end"), align: "right", template: (t: Task) => `<span class="grid-date">${(t as unknown as TaskRow).und ? `<i class="grid-undated">${esc(sv.undated.cell)}</i>` : shortDate(t)}</span>` },
      progress: { name: "progress_pct", label: sv.panel.progress, width: cw("progress"), align: "right", template: (t: Task) => `<span class="grid-date">${(t as unknown as TaskRow).progress}%</span>` },
    };
    const fieldCol = (c: ColumnId) => {
      const def = fieldDefsRef.current.find((d) => `f:${d.id}` === c);
      if (!def) return null;
      return { name: `field_${def.id}`, label: def.name, width: cw(c), template: (t: Task) => `<span class="grid-field">${esc(String(((t as unknown as TaskRow).cf ?? {})[def.id] ?? ""))}</span>` };
    };
    buildColumnsRef.current = () => [titleColumn,
      ...COLUMN_ORDER.filter((c) => columnsRef.current.includes(c)).map((c) => ({ ...(COLS[c] as object), width: cw(c) })), // bredden läses om varje gång (användaren kan ha dragit i den)
      ...columnsRef.current.filter((c) => c.startsWith("f:")).map(fieldCol).filter(Boolean)];
    gantt.config.columns = buildColumnsRef.current() as never;
    gantt.plugins({ keyboard_navigation: true });
    // Helger skuggas (lördag och söndag), bara när dagar är den minsta enheten
    const weekend = (d: Date) => (zoomRef.current === "day" && (d.getDay() === 0 || d.getDay() === 6) ? "wk-end" : "");
    // Dagens kolumn tonas: dagen i dagzoom, veckan i veckozoom, månaden i månadszoom
    const isToday = (d: Date) => {
      const t = new Date();
      if (zoomRef.current === "day") return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
      if (zoomRef.current === "week") { const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7); return t >= d && t < end; }
      return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth();
    };
    const cellClass = (d: Date) => `${weekend(d)} ${isToday(d) ? "wk-today" : ""}`.trim();
    gantt.templates.timeline_cell_class = (_t, d) => cellClass(d);
    gantt.templates.scale_cell_class = (d) => cellClass(d);
    // Biblioteket slår på pekläget bara på enheter med mobil användaragent. En platta eller dator med enbart pekskärm ska också kunna dras med finger.
    // Pekläget stänger av tooltips vid hovring, så en dator som också har mus eller pekplatta (finns det en "fine" pekare) behåller det vanliga läget.
    const touchOnly = !!window.matchMedia?.("(any-pointer: coarse)").matches && !window.matchMedia("(any-pointer: fine)").matches;
    if (touchMode === "on" || (touchMode !== "off" && touchOnly)) gantt.config.touch = "force" as never;
    else if (touchMode === "off") gantt.config.touch = false as never;
    gantt.init(host.current!);
    scrollCarry.read = () => gantt.getScrollState();
    void document.fonts.ready.then(() => gantt.render()); // textmåtten beror på att typsnittet är laddat
    (window as unknown as { __dhx: typeof gantt }).__dhx = gantt;
    let stopDragFeedback: (() => void) | null = null;
    const ids = [
      // Epics härleds ur innehållet och kan inte dras eller ändras i kanten
      // Dra rader i rutnätet. Biblioteket flyttar raden live medan man drar och nästlar den under vilken rad som helst man håller över, men bara en
      // epic kan innehålla andra poster. Vid släpp avvisas därför ett läge inne i en uppgift (raden hoppar tillbaka), annars sparas det läge biblioteket visar.
      gantt.attachEvent("onRowDragStart", (id, target) => {
        if ((target as HTMLElement)?.closest?.(".row-check, .row-add, .cell-select, .gantt_tree_icon")) return false;
        stopDragFeedback?.(); stopDragFeedback = startRowDragFeedback(String(id));
        return true;
      }, {}),
      // Markörläge (order_branch "marker"): raden flyttas inte under dragningen, bara en markör visar var den hamnar. Vid släpp anger biblioteket målets
      // förälder och plats bland dess barn. En uppgift kan inte innehålla något: släpp inne i en uppgift tolkas som "efter uppgiften, i dess grupp".
      (gantt.attachEvent as unknown as (n: string, f: (id: string | number, parent: string | number | null) => void, c: object) => string)("onRowDragMove", (_id, parent) => { setDragParent(parent); }, {}),
      gantt.attachEvent("onBeforeRowDragEnd", (id, parent, tindex) => {
        stopDragFeedback?.(); stopDragFeedback = null;
        const norm = (p: unknown) => (!p || String(p) === String(gantt.config.root_id) ? null : String(p));
        let target = norm(parent), at = Number(tindex);
        let after: string | null = null;
        if (target && (gantt.getTask(target) as unknown as { kind: string }).kind !== "epic") { after = target; target = norm(gantt.getParent(target)); }
        const kids = gantt.getChildren(target ?? gantt.config.root_id).map((x) => String(x)).filter((x) => x !== String(id));
        const pos = after ? kids.indexOf(after) + 1 : Math.max(0, Math.min(Number.isFinite(at) ? at : kids.length, kids.length));
        const order = [...kids.slice(0, pos), String(id), ...kids.slice(pos)];
        void latest.current.onMoveRow(String(id), target, order);
        return true;
      }, {}),
      gantt.attachEvent("onBeforeTaskDrag", (id) => (gantt.getTask(id) as unknown as { kind: string }).kind !== "epic", {}),
      gantt.attachEvent("onAfterTaskDrag", (id) => {
        const t = gantt.getTask(id);
        const patch = datePatch(known.current, String(id), t.start_date, t.end_date);
        // Efter sparning hämtas data om: biblioteket räknar själv om epics datum (och tappar milstolpens dag), lagret har rätt värden
        if (patch) persistPatch(latest.current.store, known.current, String(id), patch).then(() => latest.current.onPersisted?.()).catch(latest.current.onError);
      }, {}),
      // Beroenden: DHTMLX anger typ efter vilka handtag man drog mellan (0 slut till start, 1 start till start, 2 slut till slut, 3 start till slut), källan är föregångare.
      gantt.attachEvent("onBeforeLinkAdd", (_id, link) => {
        const src = String(link.source), tgt = String(link.target), type = String(link.type);
        const notice = (m: string) => (latest.current.onNotice ?? latest.current.onError)(m);
        const dtype = DEP_TYPE[type];
        if (!dtype) { notice(sv.link.unsupported); return false; }
        latest.current.store.createDependency({ workspace_id: latest.current.workspaceId, from_item_id: src, to_item_id: tgt, type: dtype })
          .then(() => latest.current.onPersisted?.())
          .catch((e) => notice(friendlyError(e)));
        return false; // beroendet ritas först när det sparats och vyn synkats från lagret
      }, {}),
    ];
    // Datum under pekaren i tidslinjen, avrundat nedåt till hel dag
    const hostEl = host.current!;
    const dateAt = (clientX: number): ISODate | null => {
      const bg = hostEl.querySelector(".gantt_task_bg");
      if (!bg) return null;
      const d = gantt.dateFromPos(clientX - bg.getBoundingClientRect().left);
      return d ? fromLocalDate(gantt.date.date_part(new Date(d))) : null;
    };
    const rowId = (t: Element) => t.closest("[data-task-id]")?.getAttribute("data-task-id") ?? null;
    // Tidslinjens kropp: rader, bakgrund och den tomma ytan under raderna, men inte skalhuvudet
    const inTimeline = (t: Element) => !!t.closest(".gantt_task") && !t.closest(".gantt_task_scale");
    const onDblClick = (e: MouseEvent) => {
      const t = e.target as Element;
      if (t.closest(".gantt_task_line, .gantt_tree_icon, .gantt_task_drag, .gantt_link_control, .row-check, .row-add, .cell-select")) return;
      if (inTimeline(t)) { latest.current.onCreateAt?.({ rowId: rowId(t), date: dateAt(e.clientX) }); return; }
      if (t.closest(".gantt_grid_data")) {
        const id = rowId(t);
        if (id) latest.current.onRename?.(id); else latest.current.onCreateAt?.({ rowId: null, date: null });
      }
    };
    const onContextMenu = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!t.closest(".gantt_grid, .gantt_task")) return;
      e.preventDefault();
      latest.current.onContext?.({ id: rowId(t), x: e.clientX, y: e.clientY, date: inTimeline(t) && !t.closest(".gantt_task_line") ? dateAt(e.clientX) : null });
    };
    // En tooltip får aldrig bli kvar: den döljs så fort pekaren lämnar Gantt eller är över något annat än en stapel eller rad
    const hideTip = () => gantt.ext.tooltips.tooltip.hide();
    const onAnyMove = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!hostEl.contains(t) || !t.closest(".gantt_task_line, .gantt_row")) hideTip();
    };
    document.addEventListener("pointermove", onAnyMove, true);
    document.addEventListener("pointerleave", hideTip, true);
    window.addEventListener("blur", hideTip);
    // Flerval: Ctrl/Cmd-klick växlar en rad, Shift-klick markerar en följd från senast klickade, ett vanligt klick avmarkerar
    const onSelectClick = (e: MouseEvent) => {
      const t = e.target as Element;
      if (t.closest(".row-check, .row-add, .cell-select, .gantt_tree_icon, .gantt_task_line, .gantt_link_control, .gantt_task_drag")) return;
      const id = t.closest(".gantt_grid_data") ? rowId(t) : null;
      const mode = id && (e.metaKey || e.ctrlKey) ? "toggle" : id && e.shiftKey ? "range" : "clear";
      if (mode === "clear") { if (selectedRef.current.size) latest.current.onSelect?.({ id: "", mode, visible: [] }); return; }
      e.stopPropagation(); e.preventDefault();
      window.getSelection()?.removeAllRanges();
      const visible: string[] = [];
      for (let i = 0, n = gantt.getVisibleTaskCount(); i < n; i++) visible.push(String(gantt.getTaskByIndex(i).id));
      latest.current.onSelect?.({ id: id!, mode, visible });
    };
    const onCheck = (e: MouseEvent) => {
      const add = (e.target as Element).closest<HTMLElement>("[data-add-in]");
      if (add) { e.stopPropagation(); e.preventDefault(); latest.current.onAddInGroup?.(add.getAttribute("data-add-in")!); return; }
      const b = (e.target as Element).closest<HTMLElement>("[data-check]");
      if (!b) return;
      e.stopPropagation(); e.preventDefault();
      latest.current.onToggleDone?.(b.getAttribute("data-check")!);
    };
    // Tangentbord: Enter och mellanslag på bocken. Bibliotekets tangentbordsstöd tar annars tangenten, så den hanteras här (och keyup spärras så att inget dubbelt klick uppstår).
    const onCheckKey = (e: KeyboardEvent) => {
      // Tangenter i en ruta i raden (status, ansvarig, prioritet) hör till rutan. Bibliotekets tangentbordsstöd tog annars pilar och Enter (raden markerades i stället).
      if ((e.target as Element).closest?.("select.cell-select")) { e.stopPropagation(); return; }
      const addBtn = (e.target as Element).closest?.("[data-add-in]");
      if (addBtn && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); if (e.type === "keydown") latest.current.onAddInGroup?.(addBtn.getAttribute("data-add-in")!); return; }
      if (!(e.target as Element).closest?.("[data-check]") || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault(); e.stopPropagation();
      if (e.type === "keydown") { const id = ((e.target as Element).closest("[data-check]") as HTMLElement).getAttribute("data-check")!; pendingFocus.current = id; latest.current.onToggleDone?.(id); }
    };
    // En ruta i en rad ändrades: spara, och rita om raden efteråt så att den visar det som faktiskt är sparat (även om lagret avvisade ändringen)
    const onCellChange = (e: Event) => {
      const el = (e.target as Element).closest?.<HTMLSelectElement>("select.cell-select");
      if (!el) return;
      const id = el.dataset.id!, field = el.dataset.field as "status" | "priority" | "assignee", value = el.value;
      // Med tangentbordet (pilar i Windows och Linux) ändras värdet direkt och raden ritas om. Fokus ska då stanna kvar i rutan så att man kan fortsätta.
      pendingSelect.current = { id, field, until: Date.now() + 2500 };
      void Promise.resolve(latest.current.onEditField?.(id, field, value)).catch(() => undefined).finally(() => { if (gantt.isTaskExists(id)) gantt.refreshTask(id); restoreSelectFocus(); });
    };
    // Återställer fokus till rutan som just ändrats, om fokus tappades vid omritningen (inte om användaren har flyttat det själv)
    const restoreSelectFocus = () => requestAnimationFrame(() => {
      const p = pendingSelect.current;
      if (!p || Date.now() > p.until) return;
      const a = document.activeElement;
      if (a && a !== document.body && a.isConnected) return;
      hostEl.querySelector<HTMLElement>(`select.cell-select[data-id="${CSS.escape(p.id)}"][data-field="${p.field}"]`)?.focus({ preventScroll: true });
    });
    restoreFocusRef.current = restoreSelectFocus;
    hostEl.addEventListener("change", onCellChange, true);
    hostEl.addEventListener("keydown", onCheckKey, true);
    hostEl.addEventListener("keyup", onCheckKey, true);
    hostEl.addEventListener("click", onSelectClick, true);
    hostEl.addEventListener("click", onCheck, true);
    // Dubbelklick känns igen här av två tryck i följd (inom 400 ms och 8 px) i stället för webbläsarens dblclick. Raden ritas om efter första klicket (panelen
    // öppnas och ytan ändras), och Safari skickar då varken klick eller dblclick när raden byts ut under det andra trycket. Därför räknas tryck på pointerup.
    let down = { x: 0, y: 0 }, lastClick = { t: 0, x: 0, y: 0 };
    const forget = () => { lastClick = { t: 0, x: 0, y: 0 }; }; // en tangent eller ett annat musknapptryck emellan gör det till två enkla klick
    const onPtrDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; if (e.button !== 0) forget(); };
    const onPtrUp = (e: PointerEvent) => {
      if (e.button !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return; // dragning, inget klick
      const now = performance.now();
      const dbl = now - lastClick.t < 400 && Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 8;
      lastClick = dbl ? { t: 0, x: 0, y: 0 } : { t: now, x: e.clientX, y: e.clientY };
      if (dbl) onDblClick(e as unknown as MouseEvent);
    };
    hostEl.addEventListener("pointerdown", onPtrDown, true);
    hostEl.addEventListener("pointerup", onPtrUp, true);
    document.addEventListener("keydown", forget, true);
    hostEl.addEventListener("contextmenu", onContextMenu, true);
    // Panelen till höger tar plats: DHTMLX måste få veta när behållaren ändrar storlek
    const ro = new ResizeObserver(() => gantt.setSizes());
    ro.observe(host.current!);
    return () => { scrollCarry.read = null; hostEl.removeEventListener("change", onCellChange, true); hostEl.removeEventListener("keydown", onCheckKey, true); hostEl.removeEventListener("keyup", onCheckKey, true); hostEl.removeEventListener("click", onSelectClick, true); hostEl.removeEventListener("click", onCheck, true); document.removeEventListener("pointermove", onAnyMove, true); document.removeEventListener("pointerleave", hideTip, true); window.removeEventListener("blur", hideTip); hostEl.removeEventListener("pointerdown", onPtrDown, true); hostEl.removeEventListener("pointerup", onPtrUp, true); document.removeEventListener("keydown", forget, true); hostEl.removeEventListener("contextmenu", onContextMenu, true); ro.disconnect(); ids.forEach((id) => gantt.detachEvent(id)); markEvents.forEach((id) => gantt.detachEvent(id)); drawMarksRef.current = null; drawResizersRef.current = null; document.removeEventListener("pointerdown", dropKeyFocus, true); document.removeEventListener("focusin", dropKeyFocus, true); stopDragFeedback?.(); gantt.clearAll(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rutnätets bredd ändras av användaren. Biblioteket bygger om layouten (och nollställer scrollen, som därför sparas och återställs).
  useEffect(() => {
    const sig = JSON.stringify((fieldDefs ?? []).map((d) => [d.id, d.name]));
    const sigW = JSON.stringify(columnWidths ?? {});
    if (gridWidthRef.current === gridWidth && columnsRef.current === columns && fieldSigRef.current === sig && widthSigRef.current === sigW) return;
    gridWidthRef.current = gridWidth; columnsRef.current = columns; fieldSigRef.current = sig; widthSigRef.current = sigW;
    const layout = gantt.config.layout as unknown as { cols: { width?: number }[] };
    layout.cols[0].width = gridWidth;
    // Rutnätsvyn har en egen bredd (grid_width), och biblioteket skriver över titelkolumnens "*" med det beräknade värdet första gången.
    // Båda måste sättas om, annars växer behållaren men kolumnerna behåller sin gamla bredd.
    gantt.config.grid_width = gridWidth;
    gantt.config.columns = buildColumnsRef.current!() as never;
    gantt.config.columns[0].width = "*";
    const sc = gantt.getScrollState();
    gantt.resetLayout();
    requestAnimationFrame(() => gantt.scrollTo(sc.x, sc.y));
  }, [gridWidth, columns, fieldDefs, columnWidths]);

  // Synkning från lagret. Ändras bara fält (titel, datum, status) uppdateras bilden på plats, så att scroll, markering och
  // hopfällda grupper bevaras. Ändras strukturen (poster, förälder, ordning, beroenden) laddas om med scroll och fällning bevarade.
  useEffect(() => {
    const { tasks, links, order } = mapped;
    // Skalan omfattar alltid dagens datum (14 dagar före, 60 efter) och alla poster (med marginal). Utan dagens datum saknas tidslinje i ett
    // tomt projekt och Idag-knappen har ingenstans att gå. DHTMLX utökar inte ett uttryckligen satt intervall själv (fit_tasks räcker inte).
    const DAY = 86_400_000;
    let lo = Date.now() - 14 * DAY, hi = Date.now() + 60 * DAY;
    for (const t of tasks) { lo = Math.min(lo, t.start_date.getTime() - 7 * DAY); hi = Math.max(hi, t.end_date.getTime() + 14 * DAY); }
    // Rombernas tillfällen (serier som en rad) är inte rader men måste gå att nå: skalan sträcker sig till dem också.
    for (const others of marksRef.current.values()) for (const m of others) { lo = Math.min(lo, toLocalDate(m.start).getTime() - 7 * DAY); hi = Math.max(hi, toLocalDate(addDays(m.end, 1)).getTime() + 14 * DAY); }
    gantt.config.start_date = gantt.date.date_part(new Date(lo));
    gantt.config.end_date = gantt.date.date_part(new Date(hi));
    const current: string[] = [];
    gantt.eachTask((t) => { current.push(String(t.id)); });
    const sameStructure =
      current.length === order.length && current.every((id, i) => id === order[i]) &&
      tasks.every((t) => String(gantt.getParent(t.id) || 0) === String(t.parent)) &&
      gantt.getLinks().length === links.length && links.every((l) => gantt.isLinkExists(l.id) && String(gantt.getLink(l.id).source) === l.source && String(gantt.getLink(l.id).target) === l.target && String(gantt.getLink(l.id).type) === l.type);
    gantt.silent(() => {
      if (sameStructure) {
        consumeFocusMedian();
        gantt.batchUpdate(() => {
          // Bara det som ändrats ritas om. Ritas alla staplar om vid varje sparning byts staplen man är på väg att klicka på ut under klicket.
          for (const t of tasks) {
            const g = gantt.getTask(t.id) as unknown as Record<string, unknown>;
            const same = g.text === t.text && g.cr === t.cr && g.code === t.code && g.sm === t.sm && g.sid === t.sid && g.sname === t.sname && g.ss === t.ss && g.status === t.status && g.priority === t.priority && g.assignee === t.assignee && g.progress === t.progress && g.color === t.color && g.und === t.und && g.od === t.od && JSON.stringify(g.cf) === JSON.stringify(t.cf) && (g.start_date as Date).getTime() === t.start_date.getTime() && (g.end_date as Date).getTime() === t.end_date.getTime();
            if (same) continue;
            g.text = t.text; g.cr = t.cr; g.code = t.code; g.sm = t.sm; g.sid = t.sid; g.sname = t.sname; g.ss = t.ss; g.start_date = t.start_date; g.end_date = t.end_date; g.status = t.status; g.priority = t.priority; g.assignee = t.assignee; g.progress = t.progress; g.color = t.color; g.und = t.und; g.od = t.od; g.cf = t.cf;
            gantt.updateTask(t.id);
          }
        });
        return;
      }
      const scroll = gantt.getScrollState();
      // Bara för poster med barn: en epic utan innehåll är "stängd" i biblioteket, och det minnet ska inte hålla ett nytt barn dolt
      gantt.eachTask((t) => { if (gantt.hasChild(t.id)) openState.current.set(String(t.id), !!gantt.getTask(t.id).$open); else openState.current.delete(String(t.id)); });
      gantt.clearAll();
      gantt.parse({ data: tasks.map((t) => ({ ...t, open: openState.current.get(t.id) ?? true })), links });
      const to = scrollCarry.saved ?? scroll;
      const restored = scrollCarry.saved !== null;
      const wantFocus = consumeFocusMedian();
      const focus = wantFocus && !restored && tasks.length > 0;
      scrollCarry.saved = null;
      gantt.scrollTo(to.x, to.y);
      // Direkt efter en ommontering har biblioteket inte hunnit mäta sina ytor, och en scroll då ignoreras. Görs därför om efter ritningen.
      if (restored) requestAnimationFrame(() => requestAnimationFrame(() => gantt.scrollTo(to.x, to.y)));
      if (focus) {
        const starts = tasks.map((t) => t.start_date.getTime()).sort((a, b) => a - b);
        const median = new Date(starts[Math.floor(starts.length / 2)]);
        requestAnimationFrame(() => requestAnimationFrame(() => gantt.showDate(median)));
      }
    });
    // Bocken ritas om när statusen ändras. Har den växlats med tangentbord ska fokus ligga kvar på den nya knappen.
    restoreFocusRef.current?.();
    const id = pendingFocus.current;
    if (id) requestAnimationFrame(() => { host.current?.querySelector<HTMLElement>(`[data-check="${CSS.escape(id)}"]`)?.focus(); });
  }, [mapped]);
  // Kritiska länkar ritas om när visningen slås på eller av eller när den kritiska linjen ändras. Inte vid första ritningen (länkarna ritas då med rätt klass),
  // och med en enda ritning: en refreshLink per länk gav kvadratisk tid med tusentals länkar.
  const criticalSeen = useRef<typeof critical>(critical);
  useEffect(() => {
    if (criticalSeen.current === critical) return;
    const was = criticalSeen.current; criticalSeen.current = critical;
    if (!was && !critical) return;
    gantt.render();
  }, [critical]);
  useEffect(() => { const id = requestAnimationFrame(() => { drawMarksRef.current?.(); drawResizersRef.current?.(); }); return () => cancelAnimationFrame(id); }, [mapped, seriesMarks, baseline, gridWidth, columns, columnWidths]);
  // Den öppna posten ritas med samma ram som en vald romb, så att valet ser likadant ut vare sig det är en romb eller seriens egen stapel
  // Öppnas en stapel som ligger utanför bild (till exempel seriens egen stapel med pilarna i panelen) rullar tidslinjen dit. Bara när den öppna posten byts, inte vid varje ändring.
  useEffect(() => {
    if (!navToken || !openId || !gantt.isTaskExists(openId)) return;
    const t = gantt.getTask(openId), st = gantt.getScrollState() as { x: number; inner_width?: number }, x = gantt.posFromDate(t.start_date as Date), w = st.inner_width ?? 0;
    if (w > 0 && (x < st.x + 20 || x > st.x + w - 40)) gantt.scrollTo(Math.max(0, x - w / 2), null);
  }, [navToken]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Klassen sätts direkt på staplarna (inte med refreshTask: en omritning släppte radens markering när klicket precis gjorts)
    const apply = () => {
      const host = (gantt as unknown as { $task_data?: HTMLElement }).$task_data;
      host?.querySelectorAll(".gantt_task_line.open-item").forEach((e) => e.classList.remove("open-item"));
      if (openId) host?.querySelector(`.gantt_task_line[data-task-id="${CSS.escape(openId)}"]`)?.classList.add("open-item");
    };
    apply();
    const id = requestAnimationFrame(apply);
    drawMarksRef.current?.();
    // Biblioteket ritar om en stapel när dess markering ändras: klassen sätts då på den nya
    const host = (gantt as unknown as { $task_data?: HTMLElement }).$task_data;
    let pending = 0;
    const mo = new MutationObserver(() => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; apply(); }); });
    if (host) mo.observe(host, { childList: true, subtree: true });
    return () => { cancelAnimationFrame(id); if (pending) cancelAnimationFrame(pending); mo.disconnect(); };
  }, [openId, mapped]); // en romb som öppnas eller släpps (en annan post öppnas) ritas om direkt

  useEffect(() => {
    gantt.config.scales = ZOOM[zoom].scales as never;
    gantt.config.min_column_width = ZOOM[zoom].min;
    gantt.render();
  }, [zoom, mapped]);

  // Fäll ihop alla eller öppna alla grupper
  const collapseSeen = useRef(collapse?.n ?? 0);
  useEffect(() => {
    if (!collapse || collapse.n === collapseSeen.current) return;
    collapseSeen.current = collapse.n;
    // En enda ritning i stället för en per grupp: med tusentals poster var varje öppna eller stäng en egen omritning
    gantt.silent(() => {
      gantt.eachTask((t) => { if (gantt.hasChild(t.id)) { t.$open = collapse.open; openState.current.set(String(t.id), collapse.open); } });
    });
    gantt.render();
  }, [collapse]);

  // Markerade rader ritas om när markeringen ändras
  const drawnSel = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const now = selected ?? new Set<string>(), was = drawnSel.current;
    for (const id of new Set([...now, ...was])) if (now.has(id) !== was.has(id) && gantt.isTaskExists(id)) gantt.refreshTask(id);
    drawnSel.current = new Set(now);
    // Valet kan flyttas utanför Gantt (pilarna i panelen, en romb): bibliotekets egen markering av raden släpps då, så att bara det valda ser valt ut
    try { const sid = gantt.getSelectedId(); if (sid && now.size && !now.has(String(sid))) gantt.unselectTask(); } catch { /* ingen vald */ }
    drawMarksRef.current?.(); // rombernas markering följer valet
    // Är det valda ett tillfälle som visas som en romb ska det synas: tidslinjen rullar dit om det ligger utanför
    if (now.size === 1) {
      const only = [...now][0];
      for (const others of marksRef.current.values()) {
        const m = others.find((x) => x.id === only);
        if (!m) continue;
        const st = gantt.getScrollState() as { x: number; inner_width?: number }, x = gantt.posFromDate(toLocalDate(m.start)), w = st.inner_width ?? 0;
        if (x < (st.x ?? 0) + 20 || x > (st.x ?? 0) + w - 40) gantt.scrollTo(Math.max(0, x - w / 2), null);
        break;
      }
    }
  }, [selected, mapped]);

  // Idag-knappen
  useEffect(() => { if (todayToken) gantt.showDate(new Date()); }, [todayToken]);

  // Nyskapad post: bläddra fram och markera den
  useEffect(() => {
    if (!revealId || !gantt.isTaskExists(revealId)) return;
    // En post som skapas i en hopfälld epic ska synas: öppna alla föräldrar först
    for (let p = gantt.getParent(revealId); p && p !== gantt.config.root_id; p = gantt.getParent(p)) gantt.open(p);
    gantt.showTask(revealId); // bara bläddra fram. selectTask tar fokus till biblioteket och rycker det från titeln i panelen medan man skriver
  }, [revealId, mapped]);

  return <div className="gantt-host dhx-host" data-lib="dhtmlx" ref={host} />;
}
