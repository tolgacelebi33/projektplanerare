import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { downloadText } from "./download";
import { MAX_IMPORT_BYTES, ImportError, parseUpload, type ParsedProject } from "./data/exchange";
import { duplicateProject, exportProject, importParsed, type ExportFormat, type ImportResult } from "./data/importExport";
import { collapseSeries, bulkDelete, bulkMove, bulkStatus, canMove, createSeries, inOneStep, deleteSubtree, descendants, epicChoices, filterActive, filterView, hidePastSeries, duplicateItem, nextOccurrenceIds, moveTargets, newItemDraft, planMove, rangeIds, selectionRoots, swapWithSibling, type BulkResult } from "./data/actions";
import { BulkBar } from "./views/BulkBar";
import { allLabels } from "./data/extras";
import { boardColumns, planColumnDrop, planColumnMoves } from "./data/boardColumns";
import { RecurringDialog } from "./views/RecurringDialog";
import { SettingsDialog } from "./views/SettingsDialog";
import { FieldsDialog } from "./views/FieldsDialog";
import { SavedViews } from "./views/SavedViews";
import { removeFieldDef } from "./data/fieldActions";
import { loadSettings, saveSettings, MORE_VIEWS, type Settings, type ViewId } from "./settings";
import { friendlyError } from "./i18n/errors";
import { ContextMenu, type MenuItem } from "./views/ContextMenu";
import { QuickAdd } from "./views/QuickAdd";
import type { ISODate } from "./data/types";
import { todayISO , addDays } from "./data/dates";
import type { Activity, Item, ItemType, Priority, Project, Status, User } from "./data/types";
import { PersistentStore } from "./data/PersistentStore";
import { getApp } from "./store";
import { useProjects } from "./useProjects";
import { ProjectBar } from "./views/ProjectBar";
import { LANGS, setLang, storedLang, sv, type Lang } from "./i18n/sv";
import { focusMedianOnNextProject, rememberScroll, uiCarry } from "./scrollCarry";
import { clampGrid, loadGridWidth, saveGridWidth } from "./layout";
import { COLUMN_ORDER, clampColumn, columnWidth, defaultColumnWidth, loadColumns, loadColumnWidths, saveColumns, saveColumnWidths, type ColumnId, type ColumnWidths } from "./columns";
import { ColumnPicker } from "./views/ColumnPicker";
import { HelpDialog } from "./views/HelpDialog";
import { effectiveColors } from "./data/colors";
import { FilterPicker, attrCount, noAttrFilter, type AttrFilter } from "./views/FilterPicker";
import { GridResizer } from "./views/GridResizer";
import { useProjectData } from "./proto/useProjectData";
import type { Zoom } from "./proto/zoom";
import { ItemPanel } from "./views/ItemPanel";
import { YearWheel } from "./views/YearWheel";
import { DatePicker } from "./views/DatePicker";
import { MAX_WINDOW_MONTHS, isCalendarYear, resolveWheel, settingFor, shiftWindow, windowLabel, windowStep, type WheelSetting } from "./views/wheelGeometry";
import { BoardView } from "./views/BoardView";
import { ImportPreview } from "./views/ImportPreview";
import { BaselineBar } from "./views/BaselineBar";
import { BackupRestore } from "./views/BackupRestore";
import { StatusDialog } from "./views/StatusDialog";
import { StatusesDialog } from "./views/StatusesDialog";
import { TemplatesDialog } from "./views/TemplatesDialog";
import { defOf, statusDefs, statusPatch } from "./data/statuses";
import { dueSummary, type DueSummary } from "./data/reminders";
import { criticalPath } from "./data/critical";
import { CommandPalette, type PaletteCommand } from "./views/CommandPalette";
import { buildBackup, firstSeenAt, lastBackupAt, markBackupSaved, parseBackup, reminderDue, restoreBackup, MAX_BACKUP_BYTES, type BackupSummary } from "./data/backup";
import { CalendarView } from "./views/CalendarView";
import { MyWeekView } from "./views/MyWeekView";
import { WorkloadView } from "./views/WorkloadView";
import { PortfolioView } from "./views/PortfolioView";
import { ReportView } from "./views/ReportView";
import { useSync } from "./sync/useSync";
import { mergeRestoredRules, normalizeCustomRules } from "./data/customRules";
import { myWeekGroups, portfolioRows, shiftPatch } from "./data/overviews";
import { THEMES, applyTheme, getTheme, type Theme } from "./theme";

// Gantt-biblioteket laddas först när vyn visas.
const DhtmlxGantt = lazy(() => import("./proto/DhtmlxGantt").then((m) => ({ default: m.DhtmlxGantt })));

const params = new URLSearchParams(location.search);
const VIEW0: ViewId = (["wheel", "board", "calendar", "week", "workload", "portfolio", "report"] as const).find((v) => v === params.get("view")) ?? "gantt";

/** Byter man språk monteras appen om (nyckeln), men lagret är kvar, så ingen data försvinner. */
export function App() {
  const app = useMemo(() => getApp(params), []);
  const [lng, setLng] = useState<Lang>(storedLang);
  // Lagringen är inläst först när `ready` är klar (IndexedDB är asynkron). Under tiden visas laddning.
  const [ready, setReady] = useState(false);
  useEffect(() => { let on = true; void app.store.ready.then(() => { if (on) setReady(true); }); return () => { on = false; }; }, [app]);
  if (!ready) return <p role="status" className="app-loading">{sv.loading}</p>;
  return <AppInner key={lng} app={app} lng={lng} onLang={(l) => { setLang(l); setLng(l); }} />;
}

function AppInner({ app, lng, onLang }: { app: ReturnType<typeof getApp>; lng: Lang; onLang: (l: Lang) => void }) {
  const { store, workspaceId } = app;
  // Exponeras för tester. Sätts i effekt, inte i useMemo, så att det är exakt den store UI:t använder (StrictMode kör useMemo två gånger).
  useEffect(() => { (window as unknown as { __store: unknown }).__store = store; }, [store]);
  const projects = useProjects(store, workspaceId);
  const { state, reload, refresh } = useProjectData(store, projects.projectId);
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const setSettings = (s: Settings) => { saveSettings(s); setSettingsState(s); };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusesOpen, setStatusesOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templates, setTemplates] = useState<import("./data/types").Template[]>([]);
  const [statusUpdates, setStatusUpdates] = useState<import("./data/types").StatusUpdate[]>([]);
  const [paletteData, setPaletteData] = useState<{ project: Project; items: Item[] }[] | null>(null);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  useEffect(() => { store.rules = settings.rules; }, [store, settings.rules]);
  useEffect(() => { store.customRules = settings.customRules; }, [store, settings.customRules]);
  // Tidsregler (försenad, slutar inom N dagar) körs när appen öppnas, när reglerna ändras och sedan varje minut medan den är öppen
  useEffect(() => {
    if (!settings.customRules.some((r) => r.enabled && (r.when.kind === "overdue" || r.when.kind === "due_in"))) return;
    let alive = true;
    const run = () => { void store.runTimeRules(todayISO()).then((n) => { if (alive && n > 0) void refresh(); }).catch(() => undefined); };
    run();
    const id = window.setInterval(run, 60_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [store, settings.customRules, refresh]);
  const [zoom, setZoom] = useState<Zoom>(uiCarry.zoom ?? settings.startZoom);
  const [query, setQuery] = useState("");
  const [hideDone, setHideDone] = useState(false);
  const [attrFilter, setAttrFilter] = useState<AttrFilter>(noAttrFilter);
  const [collapse, setCollapse] = useState({ n: 0, open: true });
  const [quick, setQuick] = useState({ overdue: false, thisWeek: false, noAssignee: false, undated: false });
  const shown = useMemo(
    () => {
      if (state.kind !== "ready") return { items: [], deps: [] };
      const v = filterView(state.items, state.deps, { query, hideDone, ...attrFilter, ...quick, today: todayISO() });
      return settings.hidePastSeries ? hidePastSeries(v, todayISO()) : v;
    },
    [state, query, hideDone, attrFilter, quick, settings.hidePastSeries],
  );
  const viewFilter = { query, hideDone, ...attrFilter, ...quick, today: todayISO() };
  const filtering = filterActive(viewFilter);
  const labelList = useMemo(() => (state.kind === "ready" ? allLabels(state.items) : []), [state]);
  const nextIds = useMemo(() => (state.kind === "ready" ? nextOccurrenceIds(state.items, todayISO()) : new Set<string>()), [state]);
  const colors = useMemo(() => (state.kind === "ready" ? effectiveColors(state.items) : new Map<string, never>()), [state]);
  const [view, setView] = useState<ViewId>(uiCarry.view ?? (new URLSearchParams(window.location.search).get("view") ? VIEW0 : settings.startView));
  uiCarry.zoom = zoom; uiCarry.view = view;
  // "Visa serier som en rad": bara listan, tidslinjen och boarden. Kalendern och de andra vyerna visar alla tillfällen.
  const markIdsRef = useRef<ReadonlySet<string>>(new Set());
  const collapsed = useMemo(() => (settings.collapseSeries && (view === "gantt" || view === "board") ? collapseSeries(shown, todayISO()) : null), [settings.collapseSeries, view, shown]);
  markIdsRef.current = useMemo(() => (collapsed ? new Set([...collapsed.marks.values()].flat().map((m) => m.id)) : new Set<string>()), [collapsed]);
  const listItems = collapsed?.items ?? shown.items, listDeps = collapsed?.deps ?? shown.deps;
  const [theme, setTheme] = useState<Theme>(getTheme);
  const firstYear = state.kind === "ready" && state.items.length ? Number(state.items.map((i) => i.start).sort()[0].slice(0, 4)) : new Date().getFullYear();
  // Årshjulets period, per projekt (standard: rullande 12 månader från idag)
  const wheelSetting = (projects.projectId ? settings.wheelByProject[projects.projectId] : undefined) ?? settings.wheelDefault;
  const wheelWin = resolveWheel(wheelSetting, todayISO(), firstYear);
  const setWheel = (s: WheelSetting) => { if (projects.projectId) setSettings({ ...settings, wheelByProject: { ...settings.wheelByProject, [projects.projectId]: s } }); };
  const stepWheel = (dir: 1 | -1) => { const w = shiftWindow(wheelWin, dir * windowStep(wheelWin)); setWheel(wheelSetting.mode === "year" ? { mode: "year", year: w.sy } : settingFor(w)); };
  const [editId, setEditId] = useState<string | null>(null);
  const [navToken, setNavToken] = useState(0);
  // Aktiv grupp: den grupp man senast valde eller skapade (eller vars post man valde). Nya poster hamnar där när inget är valt, som i monday och Asana.
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [panelFocus, setPanelFocus] = useState<"placement" | "pred" | "succ" | null>(null);
  const down = useRef<{ x: number; y: number; id: string | null } | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const itemsRef = useRef<Set<string>>(new Set());
  itemsRef.current = new Set(state.kind === "ready" ? state.items.map((i) => i.id) : []);
  // Native lyssnare i capture-fasen. Biblioteken (DHTMLX) ritar om stapeln under klicket, och då är klickmålet redan borttaget ur DOM
  // när Reacts rotlyssnare körs, så onClick i React nås aldrig. Capture läser klickmålet före bibliotekens egna hanterare.
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    // Ett klick på en tom yta (inte en post, knapp, skala eller liknande) stänger panelen och släpper markeringen. Gäller alla vyer.
    const INTERACTIVE = "button, a, input, select, textarea, label, summary, [role=menu], [role=dialog], .gantt_row[data-task-id], .gantt_task_line, .gantt_link_control, .gantt_task_drag, .gantt_tree_icon, .gantt_scale_line, .gantt_scale_cell, .gantt_grid_head_cell, .gantt_grid_scale, .gantt_task_scale, .gantt_grid_head, .grid-resizer, .quick-add, .wheel-arc, .wheel-ms, .wheel-hit, .wheel-legend, article, .bulk-bar, .datepick, .board-head";
    let emptyDown: { x: number; y: number } | null = null;
    const emptyDownH = (e: PointerEvent) => { emptyDown = e.button === 0 && !(e.target as Element).closest(INTERACTIVE) ? { x: e.clientX, y: e.clientY } : null; };
    const emptyUpH = (e: PointerEvent) => {
      const d = emptyDown; emptyDown = null;
      if (!d || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || !settingsRef.current.closeOnEmpty) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return; // dragning, inget klick
      if ((e.target as Element).closest(INTERACTIVE)) return;
      setEditId(null); selAnchor.current = null; setSelected((cur) => (cur.size ? new Set() : cur));
    };
    main.addEventListener("pointerdown", emptyDownH, true);
    main.addEventListener("pointerup", emptyUpH, true);
    if (view !== "gantt") return () => { main.removeEventListener("pointerdown", emptyDownH, true); main.removeEventListener("pointerup", emptyUpH, true); };
    // Ett klick tolkas från nedtryck och upplyft (inte från click-händelsen): biblioteket kan rita om staplen mellan de två, och då
    // hamnar click på fel element och går förlorat. Målet läses vid nedtrycket, innan något hunnit ritas om.
    const resolve = (t: Element) => {
      if (t.closest(".gantt_tree_icon, .gantt_task_drag, .row-check, .row-add")) return null; // fällpil och kanthandtag. Länkhandtag på milstolpar täcker romben och räknas som stapeln.
      // Bara staplar och rader i rutnätet öppnar en post. Ett klick på en tom del av tidslinjen gör ingenting.
      return t.closest(".gantt-host .gantt_task_line[data-task-id], .gantt-host .gantt_row[data-task-id]")?.getAttribute("data-task-id") ?? null;
    };
    const onDown = (e: PointerEvent) => { down.current = e.button === 0 ? { x: e.clientX, y: e.clientY, id: resolve(e.target as Element) } : null; };
    const onUp = (e: PointerEvent) => {
      const d = down.current; down.current = null;
      if (!d || e.button !== 0 || !d.id) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey) return; // markering av flera rader, inte öppna
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return; // drag, inte klick
      if (itemsRef.current.has(d.id)) setEditId(d.id);
      // Var en romb (ett dolt tillfälle i en serie) vald släpps den: ett klick på en stapel flyttar valet dit, så att inte två ser valda ut
      const hidden = markIdsRef.current;
      if (hidden.size) setSelected((cur) => ([...cur].some((id) => hidden.has(id)) ? new Set() : cur));
    };
    main.addEventListener("pointerdown", onDown, true);
    main.addEventListener("pointerup", onUp, true);
    return () => { main.removeEventListener("pointerdown", onDown, true); main.removeEventListener("pointerup", onUp, true); main.removeEventListener("pointerdown", emptyDownH, true); main.removeEventListener("pointerup", emptyUpH, true); };
  }, [view]);
  // Drag i Gantt sparas direkt i storen. Vid vybyte hämtas data om så att årshjulet aldrig visar gamla datum.
  useEffect(() => { void refresh(); }, [view, refresh]);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [reveal, setReveal] = useState<string | null>(null); // post som vyn ska bläddra fram, med eller utan att panelen öppnas
  useEffect(() => { if (editId !== justCreated) setJustCreated(null); }, [editId, justCreated]);
  // Byte av projekt: stäng panelen, den hör till ett annat projekt
  const pendingOpen = useRef<string | null>(null);
  useEffect(() => { const p = pendingOpen.current; setEditId(p); if (p) setReveal(p); pendingOpen.current = null; setSelected(new Set()); }, [projects.projectId]);
  // Min vecka och Portfölj läser alla projekt. Läses om när det aktuella projektets data ändras.
  const [allData, setAllData] = useState<{ project: Project; items: Item[] }[]>([]);
  useEffect(() => {
    if ((view !== "week" && view !== "portfolio") || !projects.projects) return;
    let on = true;
    void Promise.all(projects.projects.map(async (p) => ({ project: p, items: await store.listItems(p.id) }))).then((r) => { if (on) setAllData(r); }).catch(() => undefined);
    return () => { on = false; };
  }, [view, projects.projects, state, store]);
  // Sök överallt läser alla projekt när den öppnas
  useEffect(() => {
    if (!paletteOpen || !projects.projects) return;
    let on = true;
    setPaletteData(null);
    void Promise.all(projects.projects.map(async (p) => ({ project: p, items: await store.listItems(p.id) }))).then((r) => { if (on) setPaletteData(r); }).catch(() => { if (on) setPaletteData([]); });
    return () => { on = false; };
  }, [paletteOpen, projects.projects, store]);
  useEffect(() => {
    let on = true;
    const load = () => void store.listStatusUpdates().then((u) => { if (on) setStatusUpdates(u); }).catch(() => undefined);
    load();
    const un = store.subscribe(load);
    return () => { on = false; un(); };
  }, [store]);
  const latestHealth = useMemo(() => { const mine = statusUpdates.filter((u) => u.project_id === projects.projectId); return mine.length ? mine[mine.length - 1].health : null; }, [statusUpdates, projects.projectId]);
  useEffect(() => {
    let on = true;
    const load = () => void store.listTemplates().then((t) => { if (on) setTemplates(t); }).catch(() => undefined);
    load();
    const un = store.subscribe(load);
    return () => { on = false; un(); };
  }, [store]);
  const openInProject = (pid: string, iid: string) => {
    if (pid === projects.projectId) { setEditId(iid); setReveal(iid); return; }
    pendingOpen.current = iid; projects.select(pid);
  };
  const shiftItem = async (id: string, delta: number) => {
    if (state.kind !== "ready") return;
    const it = state.items.find((i) => i.id === id);
    if (!it || delta === 0) return;
    try { await store.updateItem(id, shiftPatch(it, delta)); await refresh(); } catch (e) { setWriteError(friendlyError(e)); reload(); }
  };
  // Flerval: markerade rader (bara i Gantt). Poster som tagits bort (t.ex. av ångra) tas ur markeringen.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const selAnchor = useRef<string | null>(null);
  useEffect(() => {
    if (state.kind !== "ready") return;
    setSelected((cur) => { const keep = [...cur].filter((id) => itemsRef.current.has(id)); return keep.length === cur.size ? cur : new Set(keep); });
  }, [state]);
  const selectRow = ({ id, mode, visible }: { id: string; mode: "toggle" | "range" | "clear"; visible: string[] }) => {
    if (mode === "clear") { selAnchor.current = null; setSelected(new Set()); return; }
    if (mode === "toggle") {
      const n = new Set(selected);
      if (n.has(id)) n.delete(id); else n.add(id);
      selAnchor.current = id; setSelected(n); return;
    }
    const from = selAnchor.current ?? editId ?? id;
    if (!selAnchor.current) selAnchor.current = from;
    setSelected(new Set(rangeIds(visible, from, id)));
  };
  const dropCards = async (moved: string[], colKey: string, before: string | null) => {
    if (!projects.projectId) return;
    try {
      const pid = projects.projectId;
      const col = boardColumns(boardGroup, await store.listItems(pid), users, fieldDefs, project?.statuses).find((c) => c.key === colKey);
      if (!col) return;
      await inOneStep(store, async () => {
        // Kolumner som är grupper: korten flyttas först till gruppen (ett i taget, eftersom varje flytt ändrar syskonens ordning)
        if (col.parent !== undefined) for (const id of moved) for (const u of planColumnMoves(await store.listItems(pid), id, col)) await store.updateItem(u.id, u.patch);
        for (const u of planColumnDrop(await store.listItems(pid), moved, col, before)) await store.updateItem(u.id, u.patch);
      });
      await refresh();
    } catch (e) { setWriteError(friendlyError(e)); reload(); }
  };
  const moveCardTo = (id: string, colKey: string) => void dropCards([id], colKey, null);
  const dropSelection = () => { selAnchor.current = null; setSelected(new Set()); setEditId(null); };
  const runBulk = async (fn: (projectId: string) => Promise<BulkResult>) => {
    if (!projects.projectId) return;
    try {
      const pid = projects.projectId;
      const r = await inOneStep(store, () => fn(pid));
      await refresh();
      if (editId && !(await store.listItems(projects.projectId)).some((i) => i.id === editId)) setEditId(null);
      if (r.failed) setWriteError(sv.bulk.partial(r.done, r.failed, friendlyError(r.firstError)));
      else setSelected(new Set());
    } catch (e) { setWriteError(friendlyError(e)); reload(); }
  };

  /** Skapar en post. `anchorId` styr var den hamnar (inuti en epic, annars bredvid), `start` ger datum, annars den valda postens eller dagens. */
  const addItem = async (kind: ItemType, opts: { anchorId?: string | null; start?: ISODate | null; title?: string; open?: boolean; parentId?: string } = {}) => {
    if (!projects.projectId || state.kind !== "ready") return;
    try {
      const anchor = opts.anchorId === undefined ? (editId ?? activeGroup) : opts.anchorId;
      const selected = anchor ? state.items.find((i) => i.id === anchor) ?? null : null;
      const draft = newItemDraft(kind, state.items, selected, { projectId: projects.projectId, workspaceId }, todayISO(), opts.start ?? undefined);
      if (opts.parentId) { const par = state.items.find((i) => i.id === opts.parentId); if (par && par.type === "task") { draft.parent_id = par.id; draft.start = opts.start ?? par.start; draft.end = kind === "milestone" ? draft.start : addDays(draft.start, 4); } }
      const created = await store.createItem(opts.title ? { ...draft, title: opts.title } : draft);
      await refresh();
      setReveal(created.id);
      if (opts.open !== false) { setJustCreated(created.id); setEditId(created.id); }
      setWriteError(null);
      return created.id;
    } catch (e) { setWriteError(friendlyError(e)); throw e; }
  };
  const project = projects.projects?.find((p) => p.id === projects.projectId) ?? null;
  const fieldDefs = project?.fields ?? [];
  // Samma lista (samma objekt) så länge statusarna inte ändrats: annars ritas rutnätet om varje gång projektet läses om
  const statusKey = JSON.stringify(project?.statuses ?? null);
  const statusList = useMemo(() => statusDefs(project), [statusKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Kritisk linje: räknas på alla poster i projektet (inte bara de som syns), och bara när den är påslagen
  const critical = useMemo(() => (settings.showCritical && state.kind === "ready" ? criticalPath(state.items, state.deps) : null), [settings.showCritical, state]);
  const statusCounts = useMemo(() => { const m = new Map<string, number>(); if (state.kind === "ready") for (const i of state.items) if (i.type !== "epic") { const id = defOf(i, statusList).id; m.set(id, (m.get(id) ?? 0) + 1); } return m; }, [state, statusList]);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const savedViews = project?.views ?? [];
  // En gruppering på ett fält som inte finns (i det här projektet) blir status
  const boardGroup: Settings["boardGroup"] = settings.boardGroup.startsWith("field:") && !fieldDefs.some((d) => `field:${d.id}` === settings.boardGroup && d.type === "select") ? "status" : settings.boardGroup;
  const [recurOpen, setRecurOpen] = useState(false);
  const [recurInit, setRecurInit] = useState<{ title: string; kind: import("./data/types").Recurrence; count: number } | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false); // smalt fönster: verktygsfälten är hopfällda tills man öppnar dem
  /** Skapar en återkommande milstolpe (en serie) i den aktiva gruppen, som övriga nya poster. */
  const addSeries = async (a: { title: string; first: ISODate; kind: import("./data/types").Recurrence; count: number; type?: "milestone" | "task"; days?: number }) => {
    if (!projects.projectId || state.kind !== "ready") return;
    setRecurOpen(false);
    try {
      const anchor = editId ?? activeGroup;
      const selected = anchor ? state.items.find((i) => i.id === anchor) ?? null : null;
      const draft = newItemDraft("milestone", state.items, selected, { projectId: projects.projectId, workspaceId }, todayISO(), a.first);
      const made = await inOneStep(store, () => createSeries(store, draft, a.kind, a.count, a.title, { type: a.type, days: a.days }));
      await refresh();
      if (made[0]) setReveal(made[0].id);
      setWriteError(sv.recur.done(made.length));
    } catch (e) { setWriteError(friendlyError(e)); reload(); }
  };
  // Utskriftsformatet (rapporten) styrs av vilken vy som visas
  useEffect(() => { document.documentElement.dataset.view = view; return () => { delete document.documentElement.dataset.view; }; }, [view]);
  /** Allt som bestämmer hur projektet visas just nu, som en sparbar vy. */
  const currentView = (): import("./data/types").SavedView => ({
    id: "", name: "", view, zoom, boardGroup, columns: [...columns],
    filter: { query, hideDone, statuses: attrFilter.statuses, priorities: attrFilter.priorities, assignees: attrFilter.assignees, labels: attrFilter.labels, fields: attrFilter.fields, quick: { ...quick } },
  });
  const saveView = async (name: string) => {
    if (!project) return;
    const cur = currentView();
    const old = savedViews.find((v) => v.name.trim().toLowerCase() === name.trim().toLowerCase());
    const next = old ? savedViews.map((v) => (v.id === old.id ? { ...cur, id: old.id, name: old.name } : v)) : [...savedViews, { ...cur, id: `v_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, name: name.trim() }];
    await projects.setViews(project.id, next);
  };
  const applyView = (v: import("./data/types").SavedView) => {
    const ids = new Set(fieldDefs.map((d) => d.id));
    const cols = v.columns.filter((c) => !c.startsWith("f:") || ids.has(c.slice(2))) as ColumnId[];
    const w = (list: ColumnId[]) => list.reduce((n, c) => n + columnWidth(c, widthsRef.current), 0);
    changeGrid(gridRef.current + w(cols) - w(columns)); commitGrid();
    setColumns(cols); saveColumns(cols);
    setView(v.view); setZoom(v.zoom);
    setQuery(v.filter.query); setHideDone(v.filter.hideDone);
    setAttrFilter({ statuses: v.filter.statuses, priorities: v.filter.priorities, assignees: v.filter.assignees, labels: v.filter.labels ?? [], fields: Object.fromEntries(Object.entries(v.filter.fields ?? {}).filter(([k]) => ids.has(k))) });
    setQuick({ overdue: !!v.filter.quick?.overdue, thisWeek: !!v.filter.quick?.thisWeek, noAssignee: !!v.filter.quick?.noAssignee, undated: !!v.filter.quick?.undated });
    const bg = v.boardGroup.startsWith("field:") && !ids.has(v.boardGroup.slice(6)) ? "status" : v.boardGroup;
    if (bg !== settings.boardGroup) setSettings({ ...settings, boardGroup: bg as Settings["boardGroup"] });
  };
  /** Sparar planens datum som de är nu (alla poster i projektet, inte bara de som syns). */
  const saveBaseline = async () => {
    if (!project) return;
    try {
      const all = await store.listItems(project.id);
      await projects.setBaseline(project.id, { saved_at: new Date().toISOString(), items: Object.fromEntries(all.map((i) => [i.id, { start: i.start, end: i.end }])) });
    } catch (e) { setWriteError(friendlyError(e)); }
  };
  const removeView = async (id: string) => { if (project) await projects.setViews(project.id, savedViews.filter((v) => v.id !== id)); };
  /** Duplicerar en post (en grupp med hela sitt innehåll), och öppnar kopian med titeln markerad. */
  const doDuplicateItem = async (id: string) => {
    if (!projects.projectId || state.kind !== "ready") return;
    try {
      const ids = await inOneStep(store, () => duplicateItem(store, state.items, id, sv.extras.copySuffix));
      await refresh();
      if (ids[0]) { setReveal(ids[0]); setJustCreated(ids[0]); setEditId(ids[0]); }
      setWriteError(sv.extras.duplicated(ids.length));
    } catch (e) { setWriteError(friendlyError(e)); }
  };
  /** Klar eller inte klar direkt i raden: klar blir ej påbörjad igen, allt annat blir klar. */
  const toggleDone = async (id: string) => {
    if (state.kind !== "ready") return;
    const it = state.items.find((i) => i.id === id);
    if (!it) return;
    // Tre lägen: Ej startad (och Blockerad) -> Pågår -> Klar -> Ej startad. Med egna statusar väljs projektets första status i den kategorin.
    const next: Status = it.status === "done" ? "not_started" : it.status === "in_progress" ? "done" : "in_progress";
    try {
      const proj = (await store.listProjects()).find((p) => p.id === it.project_id); // färska statusar (inte de som lästes in senast)
      const def = statusDefs(proj).find((d) => d.category === next);
      await store.updateItem(id, def ? statusPatch(def, it) : { status: next }); await refresh();
    }
    catch (e) { setWriteError(friendlyError(e)); }
  };
  useEffect(() => {
    if (!editId || state.kind !== "ready") return;
    const it = state.items.find((i) => i.id === editId);
    if (it) setActiveGroup(it.type === "epic" ? it.id : it.parent_id);
  }, [editId, state]);
  // Målgruppen för nya poster: vald posts grupp, annars den aktiva gruppen (om den finns kvar)
  const targetGroup = (() => {
    if (state.kind !== "ready") return null;
    const sel = editId ? state.items.find((i) => i.id === editId) : null;
    const gid = sel ? (sel.type === "epic" ? sel.id : sel.parent_id) : activeGroup;
    return gid ? state.items.find((i) => i.id === gid && i.type === "epic") ?? null : null;
  })();

  // Ångra och gör om
  const [hist, setHist] = useState({ undo: store.canUndo, redo: store.canRedo });
  useEffect(() => {
    const sync = () => setHist({ undo: store.canUndo, redo: store.canRedo });
    sync();
    return store.subscribe(sync);
  }, [store]);
  const travel = async (dir: "undo" | "redo") => {
    try {
      if (!(await store[dir]())) return;
      await projects.reload();
      await refresh();
      setMenu(null);
      // Panelen för en post som ångrandet tog bort stängs
      if (editId && projects.projectId && !(await store.listItems(projects.projectId)).some((i) => i.id === editId)) setEditId(null);
    } catch (e) { setWriteError(friendlyError(e)); }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && !!t.closest("input, textarea, select, [contenteditable=true]"); // fält har sina egna tangenter (och sin egen ångra)
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") { e.preventDefault(); e.stopPropagation(); setPaletteOpen((o) => !o); return; } // sök överallt, även när man skriver
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        if (typing) return;
        const k = e.key.toLowerCase();
        if (k === "z") { e.preventDefault(); void travel(e.shiftKey ? "redo" : "undo"); }
        else if (k === "y" && !e.shiftKey) { e.preventDefault(); void travel("redo"); }
        return;
      }
      if (e.metaKey || e.ctrlKey || typing || state.kind !== "ready" || !projects.projectId) return;
      if (menu || recurOpen || settingsOpen || fieldsOpen || paletteOpen || t?.closest("[role=dialog], [role=menu], aside.panel")) return; // en öppen meny äger tangenterna även innan den hunnit ta fokus
      if (e.key === "Escape" && selected.size) { e.preventDefault(); selAnchor.current = null; setSelected(new Set()); return; }
      // Alt+pil upp eller ner: flytta den valda raden i sin grupp
      if (e.altKey) {
        if (editId && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); void moveSibling(editId, e.key === "ArrowUp" ? "up" : "down"); }
        return;
      }
      const key = e.key;
      const run = (fn: () => unknown) => { e.preventDefault(); void fn(); };
      if (key === "n") run(() => addItem("task").catch(() => undefined));
      else if (key === "m") run(() => addItem("milestone").catch(() => undefined));
      else if (key === "g") run(() => addItem("epic", { anchorId: null }).catch(() => undefined));
      else if (key === "h") run(() => setSettings({ ...settingsRef.current, toolsMin: !settingsRef.current.toolsMin }));
      else if (key === "/") run(() => document.querySelector<HTMLInputElement>("input.search")?.focus());
      else if (key === "?") run(() => window.dispatchEvent(new CustomEvent("pp:help")));
      else if (view === "gantt" && key === "t") run(() => setTodayToken((n) => n + 1));
      else if (view === "gantt" && (key === "1" || key === "2" || key === "3")) run(() => setZoom((["day", "week", "month"] as Zoom[])[Number(key) - 1]));
    };
    // Capture-fasen: appens genvägar går före bibliotekens egna tangenthanterare (Gantt-biblioteket tog t.ex. Alt+pil)
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  });
  // Export, import och kopiering av projekt. Fel kastas vidare till projektraden, som visar dem. Lyckade resultat visas som meddelande.
  const report = (r: ImportResult) => {
    const extra = [...r.warnings, ...(r.skippedDeps.length ? [sv.ex.skippedDeps(r.skippedDeps.length, r.skippedDeps.slice(0, 3).join(", "), r.skippedDeps.length > 3)] : [])];
    setWriteError([(r.merged ? sv.project.importedInto : sv.project.importedAs)(r.project.name, r.created), ...extra].join(" "));
  };
  const doExport = async (format: ExportFormat) => {
    if (!projects.projectId) return;
    const out = await exportProject(store, projects.projectId, format);
    downloadText(out.filename, out.mime, out.text);
  };
  // Säkerhetskopia: spara som fil, återställ som nya projekt, och en påminnelse när det gått länge
  const [lastBackup, setLastBackup] = useState<string | null>(lastBackupAt);
  const [commentCounts, setCommentCounts] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => {
    const pid = projects.projectId;
    if (!pid) return;
    let on = true;
    const load = () => void store.listComments(pid).then((cs) => { if (!on) return; const m = new Map<string, number>(); for (const c of cs) m.set(c.item_id, (m.get(c.item_id) ?? 0) + 1); setCommentCounts(m); }).catch(() => undefined);
    load();
    const un = store.subscribe(load);
    return () => { on = false; un(); };
  }, [store, projects.projectId]);
  const [lastActivity, setLastActivity] = useState<ReadonlyMap<string, Activity>>(new Map());
  useEffect(() => {
    const pid = projects.projectId;
    if (!pid) return;
    let on = true;
    const load = () => void store.listActivity(pid).then((as) => { if (!on) return; const m = new Map<string, Activity>(); for (const a of as) m.set(a.item_id, a); setLastActivity(m); }).catch(() => undefined);
    load();
    const un = store.subscribe(load);
    return () => { on = false; un(); };
  }, [store, projects.projectId]);
  const [backupPreview, setBackupPreview] = useState<{ file: string; summary: BackupSummary } | null>(null);
  const [nagHidden, setNagHidden] = useState(false);
  const syncBackup = useCallback(async () => { const b = await buildBackup(store, new Date(), settingsRef.current.customRules); downloadText(b.filename, b.mime, b.text); }, [store]);
  const syncStore = useMemo(() => {
    const ps = store as unknown as PersistentStore;
    return {
      snapshot: () => ps.snapshot(), replaceAll: (x: Parameters<PersistentStore["replaceAll"]>[0]) => ps.replaceAll(x), flush: () => ps.flush(),
      rules: { get: () => settingsRef.current.customRules, set: (v: unknown) => setSettings({ ...settingsRef.current, customRules: normalizeCustomRules(v) }) },
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);
  const sync = useSync(syncStore, syncBackup, sv.sync);
  const saveBackupFile = async (): Promise<string> => {
    const now = new Date();
    const b = await buildBackup(store, now, settingsRef.current.customRules);
    downloadText(b.filename, b.mime, b.text);
    markBackupSaved(now); setLastBackup(lastBackupAt()); setNagHidden(true);
    return sv.backup.saved(b.projects, b.items);
  };
  const pickBackup = async (file: File) => {
    if (file.size > MAX_BACKUP_BYTES) throw new ImportError(sv.backup.tooBig);
    setBackupPreview({ file: file.name, summary: parseBackup(await file.text()) });
  };
  const confirmRestore = async () => {
    const p = backupPreview; setBackupPreview(null);
    if (!p) return;
    try {
      const r = await restoreBackup(store, workspaceId, p.summary);
      focusMedianOnNextProject();
      await reloadUsers();
      await projects.reload(r.firstProjectId);
      const m = mergeRestoredRules(settingsRef.current.customRules, p.summary.customRules, new Set((await store.listProjects()).map((x) => x.id)));
      if (m.added) setSettings({ ...settingsRef.current, customRules: m.rules });
      setWriteError([sv.backup.restored(r.projects, r.items), ...(m.added ? [sv.backup.rulesAdded(m.added)] : []), ...(m.skipped ? [sv.backup.rulesSkipped(m.skipped)] : []), ...r.warnings].join(" "));
    } catch (e) { setWriteError(friendlyError(e)); }
  };
  const nag = app.persistent && !nagHidden && settings.backupReminderDays > 0 && state.kind === "ready" && state.items.length > 0
    ? reminderDue({ days: settings.backupReminderDays, hasData: true, last: lastBackup, firstSeen: firstSeenAt(new Date()), now: new Date() }) : null;
  const [preview, setPreview] = useState<{ file: string; parsed: ParsedProject; into: boolean } | null>(null);
  const doImport = async (file: File, into = false) => {
    if (file.size > MAX_IMPORT_BYTES) throw new ImportError(sv.ex.fileTooBig);
    const parsed = await parseUpload(file, { extraAsFields: settingsRef.current.importExtraAsFields });
    if (settingsRef.current.importPreview) { setPreview({ file: file.name, parsed, into: into && !!projects.projectId }); return; } // läggs in först när man bekräftar
    await commitImport(parsed, into);
  };
  const commitImport = async (parsed: ParsedProject, into = false) => {
    if (into && projects.projectId) {
      // In i det här projektet: inget nytt projekt, vyn hämtas om och den första nya raden visas
      const res = await inOneStep(store, () => importParsed(store, workspaceId, parsed, undefined, projects.projectId!));
      await projects.reload(projects.projectId);
      await refresh();
      if (res.firstItemId) setReveal(res.firstItemId);
      report(res);
      return;
    }
    const res = await importParsed(store, workspaceId, parsed);
    focusMedianOnNextProject();
    await projects.reload(res.project.id);
    report(res);
  };
  const doDuplicate = async () => {
    if (!projects.projectId) return;
    const res = await duplicateProject(store, workspaceId, projects.projectId);
    focusMedianOnNextProject();
    await projects.reload(res.project.id);
    report(res);
  };
  // Rad dragen i rutnätet: skriv ny förälder och ordning. Utgår från lagrets alla poster, inte vyns (som kan vara filtrerad).
  const moveRow = async (id: string, parentId: string | null, visibleOrder: string[]) => {
    if (!projects.projectId) return;
    try {
      const plan = planMove(await store.listItems(projects.projectId), id, parentId, visibleOrder);
      await inOneStep(store, async () => { for (const u of plan) await store.updateItem(u.id, u.patch); });
      await refresh(); // även utan ändring: biblioteket kan ha visat raden på en plats som inte gäller
    } catch (e) { setWriteError(friendlyError(e)); reload(); }
  };
  // Vänstra kolumnens bredd: användarens val, sparas i webbläsaren. Begränsas av utrymmet så att tidslinjen alltid syns.
  const [gridWidth, setGridWidth] = useState(() => (typeof window !== "undefined" && window.innerWidth < 700 ? 200 : loadGridWidth())); // på en telefon ska tidslinjen synas bredvid listan
  const gridRef = useRef(gridWidth);
  // Kolumnbredder: att dra i en rubriks kant ändrar kolumnens bredd och rutnätets lika mycket (titeln behåller sin), att dra i titelns kant ändrar rutnätets bredd.
  const [colWidths, setColWidths] = useState<ColumnWidths>(loadColumnWidths);
  const widthsRef = useRef(colWidths); widthsRef.current = colWidths;
  const resizeColumn = (id: ColumnId | "title", width: number | null, final: boolean) => {
    if (id === "title") { changeGrid(width ?? gridRef.current); if (final) commitGrid(); return; }
    const before = columnWidth(id, widthsRef.current);
    const to = width === null ? defaultColumnWidth(id) : clampColumn(width);
    const next = { ...widthsRef.current };
    if (width === null) delete next[id]; else next[id] = to;
    widthsRef.current = next; setColWidths(next);
    changeGrid(gridRef.current + (to - before));
    if (final) { saveColumnWidths(next); commitGrid(); }
  };
  const changeGrid = (w: number) => { const next = clampGrid(w, mainRef.current?.clientWidth ?? Infinity); gridRef.current = next; setGridWidth(next); };
  const commitGrid = () => saveGridWidth(gridRef.current);
  /** Dubbelklick på dragfältet: bredda så att de längsta synliga titlarna ryms (de rader som ritats just nu). */
  const fitGrid = () => {
    let extra = 0;
    document.querySelectorAll<HTMLElement>(".gantt-host .grid-title").forEach((e) => { extra = Math.max(extra, e.scrollWidth - e.clientWidth); });
    if (extra > 0) { changeGrid(gridRef.current + extra + 8); commitGrid(); }
  };
  // Valbara kolumner i rutnätet. Rutnätet blir lika mycket bredare (eller smalare) som kolumnen, så att titeln inte trängs ihop.
  const [columns, setColumns] = useState<ColumnId[]>(() => (typeof window !== "undefined" && window.innerWidth < 700 ? loadColumns().filter((c) => c !== "end") : loadColumns())); // telefon: bara titeln i listan, så att den går att läsa
  const toggleColumn = (c: ColumnId) => {
    const on = columns.includes(c);
    const staticIds = COLUMN_ORDER as ColumnId[];
    const next = [...staticIds.filter((x) => (x === c ? !on : columns.includes(x))), ...(columns.filter((x) => x.startsWith("f:") && x !== c) as ColumnId[]), ...(c.startsWith("f:") && !on ? [c] : [])];
    setColumns(next); saveColumns(next);
    changeGrid(gridRef.current + (on ? -columnWidth(c, widthsRef.current) : columnWidth(c, widthsRef.current))); commitGrid();
  };
  const [users, setUsers] = useState<User[]>([]);
  const reloadUsers = async () => { setUsers(await store.listUsers()); };
  // Påminnelser: försenat, idag och imorgon över alla projekt. Läses om vid ändringar (med fördröjning) och var tionde minut, bara medan appen är öppen.
  const [due, setDue] = useState<DueSummary | null>(null);
  const [remindDismissed, setRemindDismissed] = useState<string | null>(() => { try { return localStorage.getItem("projektplanerare.remindDismissed"); } catch { return null; } });
  useEffect(() => {
    const r = settings.reminders;
    if (!(r.banner || r.os) || !projects.projects) { setDue(null); return; }
    let on = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        const data = await Promise.all(projects.projects!.map(async (p) => ({ project: p, items: await store.listItems(p.id) })));
        if (!on) return;
        const today = todayISO();
        const s = dueSummary(data, today, { scope: r.scope, me: settings.me || users[0]?.id || null });
        setDue(s);
        if (r.os && s.total > 0 && typeof Notification !== "undefined" && Notification.permission === "granted") {
          let last: string | null = null; try { last = localStorage.getItem("projektplanerare.remindNotified"); } catch { /* ignoreras */ }
          if (last !== today) { try { localStorage.setItem("projektplanerare.remindNotified", today); } catch { /* ignoreras */ } new Notification(sv.reminders.osTitle, { body: sv.reminders.bar(s.overdue.length, s.today.length, s.tomorrow.length), tag: "pp-reminder" }); }
        }
      } catch { /* påminnelser är en hjälp: ett läsfel ska inte störa */ }
    };
    void run();
    const un = store.subscribe(() => { clearTimeout(timer); timer = setTimeout(() => void run(), 1500); });
    const iv = setInterval(() => void run(), 10 * 60 * 1000);
    return () => { on = false; clearTimeout(timer); clearInterval(iv); un(); };
  }, [store, projects.projects, settings.reminders, settings.me, users]);
  // Installera som app (Chrome och Edge ger ett installationsförslag som vi sparar tills man trycker på knappen)
  const [installEvt, setInstallEvt] = useState<(Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> }) | null>(null);
  const [installed, setInstalled] = useState(() => typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches ?? false));
  useEffect(() => {
    const before = (e: Event) => { e.preventDefault(); setInstallEvt(e as never); };
    const done = () => { setInstalled(true); setInstallEvt(null); };
    window.addEventListener("beforeinstallprompt", before); window.addEventListener("appinstalled", done);
    return () => { window.removeEventListener("beforeinstallprompt", before); window.removeEventListener("appinstalled", done); };
  }, []);
  // Den som gör ändringarna i loggen: vald "Skriv som", annars första personen (som kommentarsrutan)
  useEffect(() => { const u = users.find((x) => x.id === settings.me) ?? users[0]; store.actor = u ? { id: u.id, name: u.name } : { id: null, name: "" }; }, [store, users, settings.me]);
  useEffect(() => { let on = true; void store.listUsers().then((u) => { if (on) setUsers(u); }).catch(() => undefined); return () => { on = false; }; }, [store]);
  /** Status, prioritet eller ansvarig ändrad direkt i en rad. */
  const editField = async (id: string, field: "status" | "priority" | "assignee", value: string) => {
    try {
      const d = field === "status" ? statusList.find((x) => x.id === value) : undefined;
      const cur = state.kind === "ready" ? state.items.find((i) => i.id === id) : undefined;
      await store.updateItem(id, field === "assignee" ? { assignee_id: value || null } : field === "status" ? (d ? statusPatch(d, cur) : { status: value as Status }) : { priority: value as Priority });
      await refresh();
    } catch (e) { setWriteError(friendlyError(e)); }
  };
  const [todayToken, setTodayToken] = useState(0);
  // Meddelanden försvinner av sig själva efter en stund (och går att stänga)
  useEffect(() => { if (!writeError) return; const t = window.setTimeout(() => setWriteError(null), 9000); return () => window.clearTimeout(t); }, [writeError]);

  // Snabbmeny
  const [menu, setMenu] = useState<{ x: number; y: number; id: string | null; date: ISODate | null; confirm: boolean } | null>(null);
  // Medan en meny är öppen ska inga tooltips visas (de lade sig ovanpå menyn)
  useEffect(() => { if (menu) document.body.dataset.overlay = "menu"; else delete document.body.dataset.overlay; return () => { delete document.body.dataset.overlay; }; }, [menu]);
  const openMenu = (a: { id: string | null; x: number; y: number; date?: ISODate | null }) => setMenu({ x: a.x, y: a.y, id: a.id, date: a.date ?? null, confirm: false });
  const menuItem = menu && menu.id && state.kind === "ready" ? state.items.find((i) => i.id === menu.id) ?? null : null;
  const menuItems: MenuItem[] = (() => {
    if (!menu || state.kind !== "ready") return [];
    const here = menu.date !== null;
    if (!menuItem) return [
      { id: "task", label: here ? sv.menu.newTaskHere : sv.add.task }, { id: "milestone", label: here ? sv.menu.newMilestoneHere : sv.add.milestone }, { id: "epic", label: sv.menu.newEpic },
    ];
    const isEpic = menuItem.type === "epic";
    // Högerklick på en tom del av en rads tidslinje: skapa på just den dagen (i radens epic, eller inuti epicen om raden är en epic)
    return [
      { id: "open", label: sv.menu.open },
      { id: "task", label: here ? sv.menu.newTaskHere : isEpic ? sv.menu.newTaskIn : sv.menu.newTaskNext },
      { id: "milestone", label: here ? sv.menu.newMilestoneHere : isEpic ? sv.menu.newMilestoneIn : sv.menu.newMilestoneNext },
      ...(isEpic ? [{ id: "epic-in", label: sv.menu.newEpicIn }] : []),
      ...(menuItem.type === "task" ? [{ id: "subtask", label: sv.menu.newSubtask }] : []),
      { id: "epic", label: sv.menu.newEpic },
      { id: "move-to", label: sv.menu.moveToGroup },
      ...(isEpic ? [] : [{ id: "pred", label: sv.menu.addPred }, { id: "succ", label: sv.menu.addSucc }]),
      { id: "up", label: sv.menu.moveUp, disabled: !canMove(state.items, menuItem.id, "up") },
      { id: "down", label: sv.menu.moveDown, disabled: !canMove(state.items, menuItem.id, "down") },
      { id: "duplicate", label: sv.extras.duplicate },
      { id: "remove", label: sv.menu.remove, danger: true },
    ];
  })();
  /** Flytta en post upp eller ner bland sina syskon (menyn och Alt+pil). */
  const moveSibling = async (id: string, dir: "up" | "down") => {
    if (state.kind !== "ready") return;
    try {
      for (const u of swapWithSibling(state.items, id, dir) ?? []) await store.updateItem(u.id, { sort_order: u.sort_order });
      await refresh();
    } catch (e) { setWriteError(friendlyError(e)); }
  };
  const pickMenu = async (choice: string) => {
    if (!menu || state.kind !== "ready") return;
    const m = menu, target = menuItem;
    if (choice === "remove") { setMenu({ ...m, confirm: true }); return; }
    setMenu(null);
    try {
      if (choice === "open" && target) setEditId(target.id);
      else if ((choice === "move-to" || choice === "pred" || choice === "succ") && target) { setPanelFocus(choice === "move-to" ? "placement" : choice); setEditId(target.id); }
      else if (choice === "duplicate" && target) await doDuplicateItem(target.id);
      else if (choice === "task" || choice === "milestone") await addItem(choice, { anchorId: target?.id ?? null, start: m.date });
      else if (choice === "epic-in") await addItem("epic", { anchorId: target?.id ?? null, start: m.date });
      else if (choice === "subtask" && target) await addItem("task", { anchorId: target.id, parentId: target.id, start: m.date });
      else if (choice === "epic") await addItem("epic", { anchorId: null, start: m.date });
      else if ((choice === "up" || choice === "down") && target) await moveSibling(target.id, choice);
    } catch (e) { setWriteError(friendlyError(e)); }
  };
  const confirmRemove = menu?.confirm && menuItem && state.kind === "ready"
    ? { text: sv.menu.confirm(menuItem.title, descendants(state.items, menuItem.id).length), yes: sv.menu.confirmYes, onYes: async () => {
        const id = menuItem.id, items = state.items;
        setMenu(null);
        try { await deleteSubtree(store, items, id); if (editId && (editId === id || descendants(items, id).some((d) => d.id === editId))) setEditId(null); await refresh(); }
        catch (e) { setWriteError(friendlyError(e)); }
      } }
    : null;
  const persistent = store instanceof PersistentStore ? store : null;
  const notice = writeError ?? persistent?.saveError ?? null;

  const clearAllFilters = () => { setQuery(""); setHideDone(false); setAttrFilter(noAttrFilter); setQuick({ overdue: false, thisWeek: false, noAssignee: false, undated: false }); };
  // Aktiva filter som chips som går att ta bort ett och ett (söktext, dölj klara och urvalen i Filtrera). Snabbfiltren är knappar som syns som nedtryckta.
  const paletteCommands: PaletteCommand[] = [
    { id: "task", label: sv.palette.cmd.newTask, run: () => void addItem("task").catch(() => undefined) },
    { id: "milestone", label: sv.palette.cmd.newMilestone, run: () => void addItem("milestone").catch(() => undefined) },
    { id: "group", label: sv.palette.cmd.newGroup, run: () => void addItem("epic", { anchorId: null }).catch(() => undefined) },
    { id: "template", label: sv.palette.cmd.fromTemplate, run: () => setTemplatesOpen(true) },
    { id: "series", label: sv.palette.cmd.newSeries, run: () => { setRecurInit(null); setRecurOpen(true); } },
    { id: "gantt", label: sv.palette.cmd.viewGantt, run: () => setView("gantt") },
    { id: "wheel", label: sv.palette.cmd.viewWheel, run: () => setView("wheel") },
    { id: "board", label: sv.palette.cmd.viewBoard, run: () => setView("board") },
    { id: "today", label: sv.palette.cmd.today, run: () => { setView("gantt"); setTodayToken((n) => n + 1); } },
    { id: "undo", label: sv.palette.cmd.undo, run: () => void travel("undo") },
    { id: "redo", label: sv.palette.cmd.redo, run: () => void travel("redo") },
    { id: "settings", label: sv.palette.cmd.settings, run: () => setSettingsOpen(true) },
    { id: "help", label: sv.palette.cmd.help, run: () => window.dispatchEvent(new CustomEvent("pp:help")) },
    { id: "backup", label: sv.palette.cmd.backup, run: () => void saveBackupFile().then((m) => setWriteError(m)).catch((e) => setWriteError(friendlyError(e))) },
    { id: "export", label: sv.palette.cmd.export, run: () => void doExport("json").catch((e) => setWriteError(friendlyError(e))) },
  ];
  const filterChips: { key: string; label: string; remove: () => void }[] = [];
  if (query.trim()) filterChips.push({ key: "q", label: sv.filter.chipQuery(query.trim()), remove: () => setQuery("") });
  for (const s of attrFilter.statuses) filterChips.push({ key: `s-${s}`, label: `${sv.panel.status}: ${sv.status[s]}`, remove: () => setAttrFilter((f) => ({ ...f, statuses: f.statuses.filter((x) => x !== s) })) });
  for (const p of attrFilter.priorities) filterChips.push({ key: `p-${p}`, label: `${sv.panel.priority}: ${sv.panel.priorities[p]}`, remove: () => setAttrFilter((f) => ({ ...f, priorities: f.priorities.filter((x) => x !== p) })) });
  for (const id of attrFilter.assignees) filterChips.push({ key: `a-${id}`, label: `${sv.panel.assignee}: ${users.find((u) => u.id === id)?.name ?? sv.cols.none}`, remove: () => setAttrFilter((f) => ({ ...f, assignees: f.assignees.filter((x) => x !== id) })) });
  for (const l of attrFilter.labels) filterChips.push({ key: `l-${l}`, label: `${sv.extras.labels}: ${l}`, remove: () => setAttrFilter((f) => ({ ...f, labels: f.labels.filter((x) => x !== l) })) });
  for (const [fid, vals] of Object.entries(attrFilter.fields)) for (const v of vals) filterChips.push({ key: `f-${fid}-${v}`, label: `${fieldDefs.find((d) => d.id === fid)?.name ?? fid}: ${v}`, remove: () => setAttrFilter((f) => ({ ...f, fields: { ...f.fields, [fid]: (f.fields[fid] ?? []).filter((x) => x !== v) } })) });
  const activeFilterCount = filterChips.length + (hideDone ? 1 : 0) + Object.values(quick).filter(Boolean).length; // Dölj klara och snabbfiltren är knappar som visas nedtryckta, de får ingen chip

  return (
    <div className={`app${toolsOpen ? " tools-open" : ""}${settings.toolsMin ? " tools-min" : ""}`}>
      <header className="app-header">
        <div className="logo-slot" aria-label={sv.logoSlot} />
        <h1 className="app-title">{sv.title}</h1>
        <div className="header-controls">
        <div className="header-top">
        <HelpDialog />
        <button type="button" className="help-btn" title={sv.palette.buttonHint} onClick={() => setPaletteOpen(true)}>{sv.palette.button}</button>
        <button type="button" className="help-btn" onClick={() => setSettingsOpen(true)}>{sv.settings.button}</button>
        <div className="lang-switch" role="group" aria-label={sv.lang.label}>
          {LANGS.map((l) => (
            <button key={l} type="button" aria-pressed={lng === l} aria-label={sv.lang[l === "sv" ? "svName" : "enName"]} title={sv.lang[l === "sv" ? "svName" : "enName"]} onClick={() => { if (l !== lng) { rememberScroll(); onLang(l); } }}>{sv.lang[l]}</button>
          ))}
        </div>
        </div>
        </div>
      </header>
      <div className="toolbar project-row">
        {projects.projects && (
          <ProjectBar health={latestHealth} onHealth={() => setStatusOpen(true)} projects={projects.projects} projectId={projects.projectId} itemCount={state.kind === "ready" ? state.items.length : 0}
            onSelect={(id) => { focusMedianOnNextProject(); projects.select(id); }} onCreate={(n) => { focusMedianOnNextProject(); return projects.create(n); }} onRename={projects.rename} onRemove={(id) => { focusMedianOnNextProject(); return projects.remove(id); }} onDependencyMode={projects.setDependencyMode}
            onDuplicate={doDuplicate} onExport={doExport} onImport={doImport} />
        )}
        <button type="button" className="mini tools-toggle" aria-expanded={!settings.toolsMin} aria-label={settings.toolsMin ? sv.tools.show : sv.tools.hide} title={`${settings.toolsMin ? sv.tools.show : sv.tools.hide} (H)`} onClick={() => setSettings({ ...settings, toolsMin: !settings.toolsMin })}>{settings.toolsMin ? "+" : "\u2212"}</button>
      </div>
      <div className="toolbar list-row">
        <div className="list-tools" role="group" aria-label={sv.filter.listLabel}>
          <span className="toolbar-label">{sv.filter.listLabel}</span>
          <ColumnPicker columns={columns} fieldDefs={fieldDefs} onToggle={toggleColumn} />
          <button type="button" className="mini" disabled={!project} onClick={() => setFieldsOpen(true)}>{sv.fields.button}</button>
          <button type="button" className="mini" disabled={!project} onClick={() => setStatusesOpen(true)}>{sv.statuses.button}</button>
          {project && <SavedViews views={savedViews} current={currentView()} onApply={applyView} onSave={saveView} onRemove={removeView} />}
          {(view === "gantt" || view === "board") && project && state.kind === "ready" && (
            <button type="button" className="mini" aria-pressed={settings.collapseSeries} title={sv.recur.collapseHint} onClick={() => setSettings({ ...settings, collapseSeries: !settings.collapseSeries })}>{sv.recur.collapseButton}</button>
          )}
          {view === "gantt" && project && state.kind === "ready" && (
            <button type="button" className="mini" aria-pressed={settings.showCritical} title={sv.critical.hint} onClick={() => setSettings({ ...settings, showCritical: !settings.showCritical })}>{sv.critical.button}</button>
          )}
          {view === "gantt" && project && state.kind === "ready" && (
            <BaselineBar baseline={project.baseline} count={state.items.length} onSave={saveBaseline} onRemove={async () => { await projects.setBaseline(project.id, null); }} />
          )}
          {view === "gantt" && (<>
            <button type="button" className="mini" onClick={() => setCollapse((c) => ({ n: c.n + 1, open: false }))}>{sv.filter.collapseAll}</button>
            <button type="button" className="mini" onClick={() => setCollapse((c) => ({ n: c.n + 1, open: true }))}>{sv.filter.expandAll}</button>
          </>)}
        </div>
      </div>
      <div className="toolbar filter-row">
        <div className={`filter-band${filtering ? " active" : ""}`} role="group" aria-label={sv.filter.label}>
          <span className="filter-title">{sv.filter.label}{activeFilterCount > 0 && <span className="filter-badge" aria-label={sv.filter.activeCount(activeFilterCount)}>{activeFilterCount}</span>}</span>
          <input type="search" className="search" aria-label={sv.filter.search} placeholder={sv.filter.placeholder} value={query}
            onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }} />
          <button type="button" className="mini" aria-pressed={hideDone} onClick={() => setHideDone((v) => !v)}>{sv.filter.hideDone}</button>
          <FilterPicker filter={attrFilter} users={users} labels={labelList} fieldDefs={fieldDefs} onChange={setAttrFilter} />
          {settings.quickFilters && (
            <div className="quick-filters" role="group" aria-label={sv.qf.label}>
              {(["overdue", "thisWeek", "noAssignee", "undated"] as const).map((k) => (
                <button key={k} type="button" className="mini" aria-pressed={quick[k]} onClick={() => setQuick((q) => ({ ...q, [k]: !q[k] }))}>{sv.qf[k]}</button>
              ))}
            </div>
          )}
          {filterChips.length > 0 && (
            <ul className="chips filter-chips" aria-label={sv.filter.activeLabel}>
              {filterChips.map((c) => (
                <li key={c.key} className="chip">
                  <span>{c.label}</span>
                  <button type="button" className="chip-x" aria-label={sv.filter.removeOf(c.label)} onClick={c.remove}>×</button>
                </li>
              ))}
            </ul>
          )}
          {filtering && state.kind === "ready" && <span className="toolbar-label" role="status">{sv.filter.count(shown.items.length, state.items.length)}</span>}
          {filtering && <button type="button" className="mini filter-clear" onClick={clearAllFilters}>{sv.filter.clearAll}</button>}
        </div>
      </div>
      <div className="toolbar">
        <span className="toolbar-label keep-narrow">{sv.view.label}</span>
        <div className="seg keep-narrow" role="group" aria-label={sv.view.label}>
          {(["gantt", "wheel", "board"] as const).map((v) => (
            <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{sv.view[v]}</button>
          ))}
        </div>
        {(MORE_VIEWS.some((v) => settings.moreViews[v]) || !(["gantt", "wheel", "board"] as string[]).includes(view)) && (
          <select className="project-select project-select-sm keep-narrow" aria-label={sv.ov.more} value={(MORE_VIEWS as readonly string[]).includes(view) ? view : ""} onChange={(e) => { if (e.target.value) setView(e.target.value as ViewId); }}>
            <option value="">{sv.ov.more}</option>
            {MORE_VIEWS.filter((v) => settings.moreViews[v] || v === view).map((v) => <option key={v} value={v}>{sv.ov[v]}</option>)}
          </select>
        )}
        {view === "board" && (
          <label className="project-deps keep-narrow">
            <span className="toolbar-label">{sv.board.groupBy}</span>
            <select className="project-select project-select-sm" aria-label={sv.board.groupBy} value={boardGroup} onChange={(e) => setSettings({ ...settings, boardGroup: e.target.value as Settings["boardGroup"] })}>
              {(["status", "assignee", "priority", "group"] as const).map((g) => <option key={g} value={g}>{sv.board.groups[g]}</option>)}
              {fieldDefs.filter((d) => d.type === "select").map((d) => <option key={d.id} value={`field:${d.id}`}>{d.name}</option>)}
            </select>
          </label>
        )}
        <button type="button" className="mini narrow-only keep-narrow" aria-expanded={toolsOpen} onClick={() => setToolsOpen((o) => !o)}>{toolsOpen ? sv.narrow.hideTools : sv.narrow.tools}</button>
        {view === "gantt" ? (
          <>
            <span className="toolbar-sep" aria-hidden="true" />
            <span className="toolbar-label">{sv.zoom.label}</span>
            <div className="seg" role="group" aria-label={sv.zoom.label}>
              {(["day", "week", "month"] as Zoom[]).map((z) => (
                <button key={z} aria-pressed={zoom === z} onClick={() => setZoom(z)}>{sv.zoom[z]}</button>
              ))}
            </div>
            <button type="button" className="mini" onClick={() => setTodayToken((n) => n + 1)}>{sv.today}</button>
            <button type="button" className="mini min-hide" aria-pressed={settings.showToday} title={sv.zoom.todayMarkHint} onClick={() => setSettings({ ...settings, showToday: !settings.showToday })}>{sv.zoom.todayMark}</button>
          </>
        ) : view === "wheel" ? (
          <>
            <span className="toolbar-sep" aria-hidden="true" />
            <span className="toolbar-label">{sv.period.label}</span>
            <select className="project-select project-select-sm" aria-label={sv.period.label} value={wheelSetting.mode}
              onChange={(e) => { const m = e.target.value; setWheel(m === "rolling" ? { mode: "rolling" } : m === "year" ? { mode: "year", year: wheelWin.sy } : { mode: "custom", sy: wheelWin.sy, sm: wheelWin.sm, months: wheelWin.months }); }}>
              <option value="year">{sv.period.year}</option><option value="rolling">{sv.period.rolling}</option><option value="custom">{sv.period.custom}</option>
            </select>
            {wheelSetting.mode === "custom" && (
              <>
                <span className="toolbar-label">{sv.period.from}</span>
                <DatePicker name="wheel-from" value={`${wheelWin.sy}-${String(wheelWin.sm + 1).padStart(2, "0")}-01`} onValue={() => undefined}
                  onCommit={(v) => { if (v) setWheel({ mode: "custom", sy: Number(v.slice(0, 4)), sm: Number(v.slice(5, 7)) - 1, months: wheelWin.months }); }} />
                <select className="project-select project-select-sm" aria-label={sv.period.months} value={wheelWin.months} onChange={(e) => setWheel({ mode: "custom", sy: wheelWin.sy, sm: wheelWin.sm, months: Number(e.target.value) })}>
                  {Array.from({ length: MAX_WINDOW_MONTHS }, (_, k) => k + 1).map((n) => <option key={n} value={n}>{sv.period.monthsOption(n)}</option>)}
                </select>
              </>
            )}
            <div className="stepper" role="group" aria-label={sv.period.label}>
              <button aria-label={wheelSetting.mode === "year" ? sv.year.prev : sv.wheel.prevPeriod} onClick={() => stepWheel(-1)}>{"\u2039"}</button>
              <output aria-live="polite" data-testid="wheel-year">{windowLabel(wheelWin, sv.wheel.months, sv.wheel.quarter)}</output>
              <button aria-label={wheelSetting.mode === "year" ? sv.year.next : sv.wheel.nextPeriod} onClick={() => stepWheel(1)}>{"\u203A"}</button>
            </div>
          </>
        ) : null}
        <span className="toolbar-sep" aria-hidden="true" />
        <div className="add-group keep-narrow min-hide" role="group" aria-label={sv.add.label} title={sv.add.hint}>
          <span className="toolbar-label" aria-hidden="true">{sv.add.heading}</span>
          {(["task", "milestone", "epic"] as ItemType[]).map((k) => (
            <button key={k} type="button" className="mini" disabled={!projects.projectId || state.kind !== "ready"} onClick={() => void addItem(k, k === "epic" ? { anchorId: null } : {}).catch(() => undefined)}>+ {sv.add[k]}</button>
          ))}
          <button type="button" className="mini btn-tpl" disabled={!projects.projectId || state.kind !== "ready"} onClick={() => setTemplatesOpen(true)}>{sv.templates.button}</button>
          <button type="button" className="mini btn-series" disabled={!projects.projectId || state.kind !== "ready"} aria-label={sv.recur.button} title={sv.recur.button} onClick={() => { setRecurInit(null); setRecurOpen(true); }}>{sv.recur.buttonShort}</button>
        </div>
        <span className="toolbar-sep" aria-hidden="true" />
        <div className="add-group" role="group" aria-label={sv.history.label}>
          <button type="button" className="mini" disabled={!hist.undo} title={sv.history.undoHint} onClick={() => void travel("undo")}>{sv.history.undo}</button>
          <button type="button" className="mini" disabled={!hist.redo} title={sv.history.redoHint} onClick={() => void travel("redo")}>{sv.history.redo}</button>
        </div>
      </div>
      {(view === "gantt" || view === "board") && selected.size > 0 && state.kind === "ready" && (
        <BulkBar statuses={statusList} count={selected.size} inside={selectionRoots(state.items, selected).reduce((n, id) => n + descendants(state.items, id).length, 0)}
          targets={(() => { const ok = new Set(moveTargets(state.items, selected).map((i) => i.id)); return epicChoices(state.items, "").filter((c) => ok.has(c.id)); })()}
          onStatus={(d) => void runBulk((pid) => bulkStatus(store, [...selected], statusPatch(d)))}
          onMove={(g) => void runBulk((pid) => bulkMove(store, pid, [...selected], g))}
          onDelete={() => void runBulk((pid) => bulkDelete(store, pid, [...selected]))}
          onClear={() => { selAnchor.current = null; setSelected(new Set()); }} />
      )}
      {persistent?.loadWarning && <div role="alert" className="notice">{persistent.loadWarning}</div>}
      {due && settings.reminders.banner && due.total > 0 && remindDismissed !== todayISO() && (
        <div role="status" className="notice remind-bar" data-part="reminder">
          {sv.reminders.bar(due.overdue.length, due.today.length, due.tomorrow.length)}
          <button type="button" className="mini" onClick={() => setView("week")}>{sv.reminders.show}</button>
          <button type="button" className="mini" onClick={() => { const d = todayISO(); try { localStorage.setItem("projektplanerare.remindDismissed", d); } catch { /* ignoreras */ } setRemindDismissed(d); }}>{sv.reminders.later}</button>
        </div>
      )}
      {nag?.due && (
        <div role="status" className="notice backup-nag">
          {nag.never ? sv.backup.nagNever : sv.backup.nag(nag.since)}
          <button type="button" className="mini" onClick={() => void saveBackupFile().catch((e) => setWriteError(friendlyError(e)))}>{sv.backup.nagSave}</button>
          <button type="button" className="mini" onClick={() => setNagHidden(true)}>{sv.backup.nagLater}</button>
        </div>
      )}
      {notice && <div role="alert" className="notice">{notice}{writeError && <button type="button" className="notice-x" aria-label={sv.dismiss} onClick={() => setWriteError(null)}>×</button>}</div>}
      {projects.error && <div role="alert" className="notice">{projects.error}</div>}
      <div className="app-body">
      <main className={`app-main${settings.markUndated ? " mark-undated" : ""}${settings.highlightOverdue ? " hl-overdue" : ""}`} ref={mainRef}>
       <Suspense fallback={<p role="status">{sv.loading}</p>}>
        {state.kind === "loading" && <p role="status">{sv.loading}</p>}
        {state.kind === "error" && (
          <div role="alert" className="notice">
            {sv.error}: {state.message} <button className="pill" onClick={reload}>{sv.retry}</button>
          </div>
        )}
        {projects.projects && projects.projects.length === 0 && (
          <div className="empty-state"><p>{sv.project.none}</p><button type="button" className="btn btn-primary" onClick={() => void projects.create(sv.project.defaultName)}>{sv.project.createFirst}</button></div>
        )}
        {state.kind === "ready" && projects.projectId && view === "board" && <BoardView statuses={project?.statuses} lastActivity={lastActivity} commentCounts={commentCounts} fields={fieldDefs} nextIds={nextIds} groupBy={boardGroup} cardFields={settings.cardFields} highlightOverdue={settings.highlightOverdue} markUndated={settings.markUndated} items={listItems} allItems={state.items} users={users} colors={colors} openId={editId} selected={selected} onOpen={setEditId} onSelect={selectRow} onBackground={dropSelection} onDrop={(m, k, b) => void dropCards(m, k, b)} onMoveTo={moveCardTo} onContext={openMenu} />}
        {state.kind === "ready" && projects.projectId && view === "calendar" && <CalendarView items={shown.items} today={todayISO()} markUndated={settings.markUndated} colors={colors} openId={editId} onOpen={setEditId} onShift={(id, d) => void shiftItem(id, d)} />}
        {state.kind === "ready" && projects.projectId && view === "workload" && <WorkloadView items={shown.items} users={users} fieldDefs={fieldDefs} fieldId={settings.workloadField} cap={settings.workloadCap} today={todayISO()} onOpen={setEditId} />}
        {state.kind === "ready" && projects.projectId && project && view === "report" && <ReportView project={project} items={state.items} users={users} latest={statusUpdates.filter((u) => u.project_id === project.id).at(-1) ?? null} today={todayISO()} onOpen={setEditId} />}
        {view === "week" && projects.projects && projects.projects.length > 0 && <MyWeekView groups={myWeekGroups(allData, todayISO())} users={users} multi={projects.projects.length > 1} onOpen={openInProject} />}
        {view === "portfolio" && projects.projects && projects.projects.length > 0 && <PortfolioView rows={portfolioRows(allData, todayISO(), statusUpdates)} currentId={projects.projectId} onOpen={(pid) => { focusMedianOnNextProject(); projects.select(pid); setView("gantt"); }} />}
        {state.kind === "ready" && projects.projectId && view === "wheel" && <YearWheel onWindow={(w) => setWheel(wheelSetting.mode === "year" && isCalendarYear(w) ? { mode: "year", year: w.sy } : settingFor(w))} statuses={statusList} items={shown.items} win={wheelWin} colors={colors} selectedId={editId} onOpen={setEditId} onContext={openMenu} />}
        {state.kind === "ready" && projects.projectId && view === "gantt" && (
          <div className="gantt-wrap">
          <div className="gantt-main">
          <DhtmlxGantt showToday={settings.showToday} navToken={navToken} openId={editId} critical={view === "gantt" ? critical : null} statuses={statusList} fieldDefs={fieldDefs} key={`${theme}-${settings.touch}`} touchMode={settings.touch} selected={selected} onSelect={selectRow} colors={colors} collapse={collapse} gridWidth={gridWidth} columns={columns} columnWidths={colWidths} onResizeColumn={resizeColumn} users={users} onEditField={editField} revealId={reveal} todayToken={todayToken} onPersisted={() => void refresh()}
            onNotice={setWriteError}
            onCreateAt={({ rowId, date }) => void addItem("task", { anchorId: rowId, start: date }).catch(() => undefined)}
            onRename={(id) => { setJustCreated(id); setEditId(id); }}
            onContext={openMenu}
            onToggleDone={(id) => void toggleDone(id)} onMoveRow={moveRow} onAddInGroup={(gid) => void addItem("task", { anchorId: gid }).catch(() => undefined)} store={store} items={listItems} deps={listDeps} seriesMarks={collapsed?.marks} onOpenItem={(id) => { selAnchor.current = id; setSelected(new Set([id])); setEditId(id); }} baseline={settings.showBaseline ? project?.baseline ?? null : null} zoom={zoom}
            onError={(e) => { setWriteError(typeof e === "string" ? e : friendlyError(e)); reload(); }} />
          <GridResizer width={gridWidth} onChange={changeGrid} onCommit={commitGrid} onFit={fitGrid} />
          </div>
          <QuickAdd width={gridWidth} groupName={targetGroup?.title ?? null} onAdd={(title) => addItem("task", { title, open: false })} />
          </div>
        )}
       </Suspense>
      </main>
      {editId && (
        <ItemPanel key="panel" critical={critical} me={settings.me} onMe={(id) => setSettings({ ...settingsRef.current, me: id })} baseline={project?.baseline ?? null} fieldDefs={fieldDefs} onDuplicate={(id) => void doDuplicateItem(id)} onNewSeries={(it, n) => { if (it.recur) { setRecurInit({ title: it.title, kind: it.recur, count: n }); setRecurOpen(true); } }} nextDate={state.kind === "ready" ? (() => { const cur = state.items.find((i) => i.id === editId); if (!cur?.series) return null; const nx = nextOccurrenceIds(state.items, todayISO()); return state.items.find((i) => i.series === cur.series && nx.has(i.id))?.start ?? null; })() : null} features={settings.features} checklistProgress={settings.checklistProgress} store={store} projectId={projects.projectId!} itemId={editId} dataVersion={state.kind === "ready" ? state.items : undefined} autoSelectTitle={editId === justCreated} focusField={panelFocus} onFocusDone={() => setPanelFocus(null)}
          onClose={() => setEditId(null)} onChanged={() => void refresh()} onAddChild={(pid) => void addItem("task", { anchorId: pid, parentId: pid }).catch(() => undefined)} onOpen={(id) => { if (state.kind === "ready" && state.items.find((i) => i.id === id)?.series) { selAnchor.current = id; setSelected(new Set([id])); setNavToken((n) => n + 1); } setEditId(id); }} />
      )}
      </div>
      {fieldsOpen && project && <FieldsDialog fields={fieldDefs} onSave={(f) => projects.setFields(project.id, f)} onRemove={async (id) => { await removeFieldDef(store, project, id); await projects.reload(project.id); await refresh(); }} onClose={() => setFieldsOpen(false)} />}
      {preview && <ImportPreview fileName={preview.file} parsed={preview.parsed} destination={{ into: preview.into ? project?.name ?? "" : null, name: preview.parsed.name }} onCancel={() => setPreview(null)} onConfirm={() => { const p = preview; setPreview(null); void commitImport(p.parsed, p.into).catch((e) => setWriteError(friendlyError(e))); }} />}
      {templatesOpen && project && <TemplatesDialog templates={templates} today={todayISO()} group={targetGroup ? { id: targetGroup.id, title: targetGroup.title } : null} onClose={() => setTemplatesOpen(false)}
        onDelete={async (id) => { await store.deleteTemplate(id); }}
        onCreate={async (id, o) => { const ids = await inOneStep(store, () => store.createFromTemplate(id, { project_id: project.id, parent_id: o.parentId, start: o.start, title: o.title })); await refresh(); if (ids[0]) { setReveal(ids[0]); setEditId(ids[0]); } setWriteError(sv.templates.made(ids.length)); }} />}
      {statusesOpen && project && <StatusesDialog statuses={statusList} custom={!!project.statuses} counts={statusCounts} onClose={() => setStatusesOpen(false)} onSave={async (defs) => { await projects.setStatuses(project.id, defs); await refresh(); }} />}
      {statusOpen && project && <StatusDialog project={project} updates={statusUpdates} onClose={() => setStatusOpen(false)} onPublish={async (h, t) => { await store.addStatusUpdate({ project_id: project.id, health: h, text: t }); }} />}
      {paletteOpen && <CommandPalette data={paletteData ?? []} loading={paletteData === null} commands={paletteCommands} onClose={() => setPaletteOpen(false)}
        onOpenItem={(pid, iid) => { openInProject(pid, iid); }} onOpenProject={(pid) => { focusMedianOnNextProject(); projects.select(pid); }} />}
      {settingsOpen && <SettingsDialog theme={theme} onTheme={(t) => { rememberScroll(); applyTheme(t); setTheme(t); }} projects={(projects.projects ?? []).map((p) => ({ id: p.id, name: p.name }))} projectId={projects.projectId} fieldDefs={fieldDefs} settings={settings} install={{ available: !!installEvt, installed, onInstall: () => { const e = installEvt; if (!e) return; void e.prompt().then(() => e.userChoice).finally(() => setInstallEvt(null)); } }} sync={sync} backup={{ lastSaved: lastBackup, onSave: saveBackupFile, onRestoreFile: pickBackup }} people={{ users, onCapacity: async (id, h) => { await store.setUserCapacity(id, h); await reloadUsers(); }, onAdd: async (n) => { await store.addUser(n); await reloadUsers(); }, onRename: async (id, n) => { await store.renameUser(id, n); await reloadUsers(); await refresh(); }, onRemove: async (id) => { const n = await store.removeUser(id); await reloadUsers(); await refresh(); setAttrFilter((f) => ({ ...f, assignees: f.assignees.filter((x) => x !== id) })); return n; } }} onChange={setSettings} onClose={() => setSettingsOpen(false)} />}
      {backupPreview && <BackupRestore fileName={backupPreview.file} summary={backupPreview.summary} onCancel={() => setBackupPreview(null)} onConfirm={() => void confirmRestore()} />}
      {recurOpen && <RecurringDialog key={recurInit ? "from" : "new"} today={todayISO()} initial={recurInit ?? undefined} onCreate={(a) => void addSeries(a)} onClose={() => setRecurOpen(false)} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} confirm={confirmRemove} onPick={(id) => void pickMenu(id)} onClose={() => setMenu(null)} />}
    </div>
  );
}
