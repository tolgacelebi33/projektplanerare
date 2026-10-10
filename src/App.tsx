import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { downloadText } from "./download";
import { MAX_IMPORT_BYTES, ImportError, parseFile } from "./data/exchange";
import { duplicateProject, exportProject, importParsed, type ExportFormat, type ImportResult } from "./data/importExport";
import { canMove, deleteSubtree, descendants, filterActive, filterView, newItemDraft, planMove, swapWithSibling } from "./data/actions";
import { friendlyError } from "./i18n/errors";
import { ContextMenu, type MenuItem } from "./views/ContextMenu";
import { QuickAdd } from "./views/QuickAdd";
import type { ISODate } from "./data/types";
import { todayISO } from "./data/dates";
import type { ItemType, Priority, Status, User } from "./data/types";
import { PersistentStore } from "./data/PersistentStore";
import { getApp } from "./store";
import { useProjects } from "./useProjects";
import { ProjectBar } from "./views/ProjectBar";
import { LANGS, setLang, storedLang, sv, type Lang } from "./i18n/sv";
import { focusMedianOnNextProject, rememberScroll, uiCarry } from "./scrollCarry";
import { clampGrid, loadGridWidth, saveGridWidth } from "./layout";
import { COLUMN_WIDTH, loadColumns, saveColumns, type ColumnId } from "./columns";
import { ColumnPicker } from "./views/ColumnPicker";
import { HelpDialog } from "./views/HelpDialog";
import { FilterPicker, noAttrFilter, type AttrFilter } from "./views/FilterPicker";
import { GridResizer } from "./views/GridResizer";
import { useProjectData } from "./proto/useProjectData";
import type { Zoom } from "./proto/zoom";
import { ItemPanel } from "./views/ItemPanel";
import { YearWheel } from "./views/YearWheel";
import { THEMES, applyTheme, getTheme, type Theme } from "./theme";

// Gantt-biblioteket laddas först när vyn visas.
const DhtmlxGantt = lazy(() => import("./proto/DhtmlxGantt").then((m) => ({ default: m.DhtmlxGantt })));

const params = new URLSearchParams(location.search);
const VIEW0 = params.get("view") === "wheel" ? "wheel" : "gantt";

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
  const [zoom, setZoom] = useState<Zoom>(uiCarry.zoom ?? "week");
  const [query, setQuery] = useState("");
  const [hideDone, setHideDone] = useState(false);
  const [attrFilter, setAttrFilter] = useState<AttrFilter>(noAttrFilter);
  const [collapse, setCollapse] = useState({ n: 0, open: true });
  const shown = useMemo(
    () => (state.kind === "ready" ? filterView(state.items, state.deps, { query, hideDone, ...attrFilter }) : { items: [], deps: [] }),
    [state, query, hideDone, attrFilter],
  );
  const filtering = filterActive({ query, hideDone, ...attrFilter });
  const [view, setView] = useState<"gantt" | "wheel">(uiCarry.view ?? VIEW0);
  const [year, setYear] = useState<number | null>(uiCarry.year ?? null);
  uiCarry.zoom = zoom; uiCarry.view = view; uiCarry.year = year;
  const [theme, setTheme] = useState<Theme>(getTheme);
  const firstYear = state.kind === "ready" && state.items.length ? Number(state.items.map((i) => i.start).sort()[0].slice(0, 4)) : new Date().getFullYear();
  const effectiveYear = year ?? firstYear;
  const [editId, setEditId] = useState<string | null>(null);
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
    if (!main || view !== "gantt") return;
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
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return; // drag, inte klick
      if (itemsRef.current.has(d.id)) setEditId(d.id);
    };
    main.addEventListener("pointerdown", onDown, true);
    main.addEventListener("pointerup", onUp, true);
    return () => { main.removeEventListener("pointerdown", onDown, true); main.removeEventListener("pointerup", onUp, true); };
  }, [view]);
  // Drag i Gantt sparas direkt i storen. Vid vybyte hämtas data om så att årshjulet aldrig visar gamla datum.
  useEffect(() => { void refresh(); }, [view, refresh]);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [reveal, setReveal] = useState<string | null>(null); // post som vyn ska bläddra fram, med eller utan att panelen öppnas
  useEffect(() => { if (editId !== justCreated) setJustCreated(null); }, [editId, justCreated]);
  // Byte av projekt: stäng panelen, den hör till ett annat projekt
  useEffect(() => { setEditId(null); }, [projects.projectId]);

  /** Skapar en post. `anchorId` styr var den hamnar (inuti en epic, annars bredvid), `start` ger datum, annars den valda postens eller dagens. */
  const addItem = async (kind: ItemType, opts: { anchorId?: string | null; start?: ISODate | null; title?: string; open?: boolean } = {}) => {
    if (!projects.projectId || state.kind !== "ready") return;
    try {
      const anchor = opts.anchorId === undefined ? (editId ?? activeGroup) : opts.anchorId;
      const selected = anchor ? state.items.find((i) => i.id === anchor) ?? null : null;
      const draft = newItemDraft(kind, state.items, selected, { projectId: projects.projectId, workspaceId }, todayISO(), opts.start ?? undefined);
      const created = await store.createItem(opts.title ? { ...draft, title: opts.title } : draft);
      await refresh();
      setReveal(created.id);
      if (opts.open !== false) { setJustCreated(created.id); setEditId(created.id); }
      setWriteError(null);
      return created.id;
    } catch (e) { setWriteError(friendlyError(e)); throw e; }
  };
  /** Klar eller inte klar direkt i raden: klar blir ej påbörjad igen, allt annat blir klar. */
  const toggleDone = async (id: string) => {
    if (state.kind !== "ready") return;
    const it = state.items.find((i) => i.id === id);
    if (!it) return;
    try { await store.updateItem(id, { status: it.status === "done" ? "not_started" : "done" }); await refresh(); }
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
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable=true]"))) return; // fält har sin egen ångra
      const k = e.key.toLowerCase();
      if (k === "z") { e.preventDefault(); void travel(e.shiftKey ? "redo" : "undo"); }
      else if (k === "y" && !e.shiftKey) { e.preventDefault(); void travel("redo"); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  // Export, import och kopiering av projekt. Fel kastas vidare till projektraden, som visar dem. Lyckade resultat visas som meddelande.
  const report = (r: ImportResult) => {
    const extra = [...r.warnings, ...(r.skippedDeps.length ? [sv.ex.skippedDeps(r.skippedDeps.length, r.skippedDeps.slice(0, 3).join(", "), r.skippedDeps.length > 3)] : [])];
    setWriteError([sv.project.importedAs(r.project.name, r.created), ...extra].join(" "));
  };
  const doExport = async (format: ExportFormat) => {
    if (!projects.projectId) return;
    const out = await exportProject(store, projects.projectId, format);
    downloadText(out.filename, out.mime, out.text);
  };
  const doImport = async (file: File) => {
    if (file.size > MAX_IMPORT_BYTES) throw new ImportError(sv.ex.fileTooBig);
    const res = await importParsed(store, workspaceId, parseFile(file.name, await file.text()));
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
      for (const u of plan) await store.updateItem(u.id, u.patch);
      await refresh(); // även utan ändring: biblioteket kan ha visat raden på en plats som inte gäller
    } catch (e) { setWriteError(friendlyError(e)); reload(); }
  };
  // Vänstra kolumnens bredd: användarens val, sparas i webbläsaren. Begränsas av utrymmet så att tidslinjen alltid syns.
  const [gridWidth, setGridWidth] = useState(loadGridWidth);
  const gridRef = useRef(gridWidth);
  const changeGrid = (w: number) => { const next = clampGrid(w, mainRef.current?.clientWidth ?? Infinity); gridRef.current = next; setGridWidth(next); };
  const commitGrid = () => saveGridWidth(gridRef.current);
  /** Dubbelklick på dragfältet: bredda så att de längsta synliga titlarna ryms (de rader som ritats just nu). */
  const fitGrid = () => {
    let extra = 0;
    document.querySelectorAll<HTMLElement>(".gantt-host .grid-title").forEach((e) => { extra = Math.max(extra, e.scrollWidth - e.clientWidth); });
    if (extra > 0) { changeGrid(gridRef.current + extra + 8); commitGrid(); }
  };
  // Valbara kolumner i rutnätet. Rutnätet blir lika mycket bredare (eller smalare) som kolumnen, så att titeln inte trängs ihop.
  const [columns, setColumns] = useState<ColumnId[]>(loadColumns);
  const toggleColumn = (c: ColumnId) => {
    const on = columns.includes(c);
    const next = (["status", "assignee", "priority", "start", "end", "progress"] as ColumnId[]).filter((x) => (x === c ? !on : columns.includes(x)));
    setColumns(next); saveColumns(next);
    changeGrid(gridRef.current + (on ? -COLUMN_WIDTH[c] : COLUMN_WIDTH[c])); commitGrid();
  };
  const [users, setUsers] = useState<User[]>([]);
  useEffect(() => { let on = true; void store.listUsers().then((u) => { if (on) setUsers(u); }).catch(() => undefined); return () => { on = false; }; }, [store]);
  /** Status, prioritet eller ansvarig ändrad direkt i en rad. */
  const editField = async (id: string, field: "status" | "priority" | "assignee", value: string) => {
    try {
      await store.updateItem(id, field === "assignee" ? { assignee_id: value || null } : field === "status" ? { status: value as Status } : { priority: value as Priority });
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
      { id: "epic", label: sv.menu.newEpic },
      { id: "move-to", label: sv.menu.moveToGroup },
      ...(isEpic ? [] : [{ id: "pred", label: sv.menu.addPred }, { id: "succ", label: sv.menu.addSucc }]),
      { id: "up", label: sv.menu.moveUp, disabled: !canMove(state.items, menuItem.id, "up") },
      { id: "down", label: sv.menu.moveDown, disabled: !canMove(state.items, menuItem.id, "down") },
      { id: "remove", label: sv.menu.remove, danger: true },
    ];
  })();
  const pickMenu = async (choice: string) => {
    if (!menu || state.kind !== "ready") return;
    const m = menu, target = menuItem;
    if (choice === "remove") { setMenu({ ...m, confirm: true }); return; }
    setMenu(null);
    try {
      if (choice === "open" && target) setEditId(target.id);
      else if ((choice === "move-to" || choice === "pred" || choice === "succ") && target) { setPanelFocus(choice === "move-to" ? "placement" : choice); setEditId(target.id); }
      else if (choice === "task" || choice === "milestone") await addItem(choice, { anchorId: target?.id ?? null, start: m.date });
      else if (choice === "epic-in") await addItem("epic", { anchorId: target?.id ?? null, start: m.date });
      else if (choice === "epic") await addItem("epic", { anchorId: null, start: m.date });
      else if ((choice === "up" || choice === "down") && target) {
        for (const u of swapWithSibling(state.items, target.id, choice) ?? []) await store.updateItem(u.id, { sort_order: u.sort_order });
        await refresh();
      }
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

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo-slot" aria-label={sv.logoSlot} />
        <h1 className="app-title">{sv.title}</h1>
        <div className="header-controls">
        <div className="header-top">
        <HelpDialog />
        <div className="lang-switch" role="group" aria-label={sv.lang.label}>
          {LANGS.map((l) => (
            <button key={l} type="button" aria-pressed={lng === l} aria-label={sv.lang[l === "sv" ? "svName" : "enName"]} title={sv.lang[l === "sv" ? "svName" : "enName"]} onClick={() => { if (l !== lng) { rememberScroll(); onLang(l); } }}>{sv.lang[l]}</button>
          ))}
        </div>
        </div>
        <div className="theme-switch" role="radiogroup" aria-label={sv.theme.label}>
          <span className="theme-label" aria-hidden="true">{sv.theme.label}</span>
          {THEMES.map((t) => (
            <button key={t} role="radio" aria-checked={theme === t} aria-label={sv.theme[t]} title={sv.theme[t]}
              className="swatch" data-theme-swatch={t} onClick={() => { rememberScroll(); applyTheme(t); setTheme(t); }} />
          ))}
        </div>
        </div>
      </header>
      <div className="toolbar project-row">
        {projects.projects && (
          <ProjectBar projects={projects.projects} projectId={projects.projectId} itemCount={state.kind === "ready" ? state.items.length : 0}
            onSelect={(id) => { focusMedianOnNextProject(); projects.select(id); }} onCreate={(n) => { focusMedianOnNextProject(); return projects.create(n); }} onRename={projects.rename} onRemove={(id) => { focusMedianOnNextProject(); return projects.remove(id); }} onDependencyMode={projects.setDependencyMode}
            onDuplicate={doDuplicate} onExport={doExport} onImport={doImport} />
        )}
        <span className="lib-tag" title={persistent?.persistGranted === true ? sv.project.persistYes : persistent?.persistGranted === false ? sv.project.persistNo : undefined}>{app.persistent ? sv.project.persisted : sv.project.demo}</span>
      </div>
      <div className="toolbar">
        <span className="toolbar-label">{sv.view.label}</span>
        <div className="seg" role="group" aria-label={sv.view.label}>
          {(["gantt", "wheel"] as const).map((v) => (
            <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{sv.view[v]}</button>
          ))}
        </div>
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
          </>
        ) : (
          <>
            <span className="toolbar-sep" aria-hidden="true" />
            <span className="toolbar-label">{sv.year.label}</span>
            <div className="stepper" role="group" aria-label={sv.year.label}>
              <button aria-label={sv.year.prev} onClick={() => setYear((effectiveYear) - 1)}>{"\u2039"}</button>
              <output aria-live="polite" data-testid="wheel-year">{effectiveYear}</output>
              <button aria-label={sv.year.next} onClick={() => setYear((effectiveYear) + 1)}>{"\u203A"}</button>
            </div>
          </>
        )}
        <span className="toolbar-sep" aria-hidden="true" />
        <div className="add-group" role="group" aria-label={sv.add.label} title={sv.add.hint}>
          <span className="toolbar-label">{sv.add.label}</span>
          {(["task", "milestone", "epic"] as ItemType[]).map((k) => (
            <button key={k} type="button" className="mini" disabled={!projects.projectId || state.kind !== "ready"} onClick={() => void addItem(k, k === "epic" ? { anchorId: null } : {}).catch(() => undefined)}>+ {sv.add[k]}</button>
          ))}
        </div>
        <span className="toolbar-sep" aria-hidden="true" />
        <div className="add-group" role="group" aria-label={sv.history.label}>
          <button type="button" className="mini" disabled={!hist.undo} title={sv.history.undoHint} onClick={() => void travel("undo")}>{sv.history.undo}</button>
          <button type="button" className="mini" disabled={!hist.redo} title={sv.history.redoHint} onClick={() => void travel("redo")}>{sv.history.redo}</button>
        </div>
        <span className="toolbar-sep" aria-hidden="true" />
        <div className="add-group" role="group" aria-label={sv.filter.label}>
          <input type="search" className="search" aria-label={sv.filter.search} placeholder={sv.filter.placeholder} value={query}
            onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }} />
          <button type="button" className="mini" aria-pressed={hideDone} onClick={() => setHideDone((v) => !v)}>{sv.filter.hideDone}</button>
          <FilterPicker filter={attrFilter} users={users} onChange={setAttrFilter} />
          {filtering && state.kind === "ready" && <span className="toolbar-label" role="status">{sv.filter.count(shown.items.length, state.items.length)}</span>}
        </div>
        <span className="toolbar-sep" aria-hidden="true" />
        <ColumnPicker columns={columns} onToggle={toggleColumn} />
        {view === "gantt" && (<>
          <button type="button" className="mini" onClick={() => setCollapse((c) => ({ n: c.n + 1, open: false }))}>{sv.filter.collapseAll}</button>
          <button type="button" className="mini" onClick={() => setCollapse((c) => ({ n: c.n + 1, open: true }))}>{sv.filter.expandAll}</button>
        </>)}
      </div>
      {persistent?.loadWarning && <div role="alert" className="notice">{persistent.loadWarning}</div>}
      {notice && <div role="alert" className="notice">{notice}{writeError && <button type="button" className="notice-x" aria-label={sv.dismiss} onClick={() => setWriteError(null)}>×</button>}</div>}
      {projects.error && <div role="alert" className="notice">{projects.error}</div>}
      <div className="app-body">
      <main className="app-main" ref={mainRef}>
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
        {state.kind === "ready" && projects.projectId && view === "wheel" && <YearWheel items={shown.items} year={effectiveYear} selectedId={editId} onOpen={setEditId} onContext={openMenu} />}
        {state.kind === "ready" && projects.projectId && view === "gantt" && (
          <div className="gantt-wrap">
          <div className="gantt-main">
          <DhtmlxGantt key={theme} collapse={collapse} gridWidth={gridWidth} columns={columns} users={users} onEditField={editField} revealId={reveal} todayToken={todayToken} onPersisted={() => void refresh()}
            onNotice={setWriteError}
            onCreateAt={({ rowId, date }) => void addItem("task", { anchorId: rowId, start: date }).catch(() => undefined)}
            onRename={(id) => { setJustCreated(id); setEditId(id); }}
            onContext={openMenu}
            onToggleDone={(id) => void toggleDone(id)} onMoveRow={moveRow} onAddInGroup={(gid) => void addItem("task", { anchorId: gid }).catch(() => undefined)} store={store} items={shown.items} deps={shown.deps} zoom={zoom}
            onError={(e) => { setWriteError(typeof e === "string" ? e : friendlyError(e)); reload(); }} />
          <GridResizer width={gridWidth} onChange={changeGrid} onCommit={commitGrid} onFit={fitGrid} />
          </div>
          <QuickAdd width={gridWidth} groupName={targetGroup?.title ?? null} onAdd={(title) => addItem("task", { title, open: false })} />
          </div>
        )}
       </Suspense>
      </main>
      {editId && (
        <ItemPanel key="panel" store={store} projectId={projects.projectId!} itemId={editId} dataVersion={state.kind === "ready" ? state.items : undefined} autoSelectTitle={editId === justCreated} focusField={panelFocus} onFocusDone={() => setPanelFocus(null)}
          onClose={() => setEditId(null)} onChanged={() => void refresh()} onOpen={setEditId} />
      )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} confirm={confirmRemove} onPick={(id) => void pickMenu(id)} onClose={() => setMenu(null)} />}
    </div>
  );
}
