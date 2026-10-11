import { useCallback, useEffect, useRef, useState } from "react";
import { canMove, changeRecurrence, deleteSeries, deleteSubtree, descendants, epicChoices, extendSeries, MAX_SERIES, renameSeries, seriesMembers, swapWithSibling } from "../data/actions";
import { effectiveColors } from "../data/colors";
import { GROUP_COLORS, RECURRENCES, type GroupColor, type Recurrence } from "../data/types";
import type { DataStore } from "../data/DataStore";
import { isISODate, todayISO } from "../data/dates";
import { MAX_DESCRIPTION, MAX_TITLE, RuleError, isOverdue, validateItemShape } from "../data/rules";
import type { Dependency, FieldDef, Item, Priority, Status, User } from "../data/types";
import { friendlyError } from "../i18n/errors";
import { sv } from "../i18n/sv";
import { STATUS_GLYPH } from "../proto/statusUi";
import { DatePicker } from "./DatePicker";
import { PanelExtras } from "./PanelExtras";
import { PanelFields } from "./PanelFields";
import { checklistPercent } from "../data/extras";
import { DEFAULT_FEATURES, type Features } from "../settings";

const STATUSES: Status[] = ["not_started", "in_progress", "done", "blocked"];
const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];

interface Loaded { item: Item; all: Item[]; deps: Dependency[]; users: User[] }
type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

/**
 * Detaljpanel för en post, fast bredd, dockad till höger. Ändringar sparas per fält direkt (inget spara-steg), så att man
 * kan hoppa mellan poster utan att tappa något. Läser alltid färska data från DataStore (drag i vyerna sparas direkt i storen).
 */
export function ItemPanel({ fieldDefs = [], onDuplicate, onNewSeries, nextDate, features = DEFAULT_FEATURES, checklistProgress = false, store, projectId, itemId, dataVersion, autoSelectTitle = false, focusField = null, onFocusDone, onClose, onChanged, onOpen }: {
  features?: Features; checklistProgress?: boolean;
  /** Projektets egna fält. */
  fieldDefs?: FieldDef[];
  onDuplicate?: (id: string) => void; onNewSeries?: (item: Item, count: number) => void;
  /** Datum för nästa tillfälle i postens serie (om den ingår i en). */
  nextDate?: string | null;
  store: DataStore; projectId: string; itemId: string; autoSelectTitle?: boolean;
  /** Flytta fokus till ett val när posten laddats (från högerklicksmenyn): gruppen, föregångare eller efterföljare. */
  focusField?: "placement" | "pred" | "succ" | null; onFocusDone?: () => void;
  /** Ändras när data ändrats utanför panelen (t.ex. ett drag i vyn), så att panelen visar det som är sparat. */
  dataVersion?: unknown;
  onClose: () => void; onChanged: () => void; onOpen: (id: string) => void;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const [title, setTitle] = useState("");
  const [extendN, setExtendN] = useState("12");
  const [seriesTitle, setSeriesTitle] = useState("");
  const [seriesKind, setSeriesKind] = useState<Recurrence>("monthly");
  const [seriesAsk, setSeriesAsk] = useState<null | "later" | "all">(null);
  const [description, setDescription] = useState("");
  const [progress, setProgress] = useState("0");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const savedTimer = useRef<number | undefined>(undefined);
  const dateTimer = useRef<number | undefined>(undefined);
  const pendingDate = useRef<"start" | "end" | null>(null); // datum som väntar på att sparas och inte får skrivas över av en omladdning
  const dataRef = useRef<Loaded | null>(null);
  // Vilken post panelen visar just nu. Ett svar från lagret för en tidigare post (t.ex. en sparning som pågick när man bytte post) får inte skriva över den nya.
  const currentItem = useRef(itemId);
  currentItem.current = itemId;
  const titleRef = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Ny post: titeln är markerad så att man kan skriva över den direkt
  useEffect(() => {
    if (!autoSelectTitle || !data) return;
    const focus = () => { titleRef.current?.focus(); titleRef.current?.select(); };
    // Ett fält, en dialog eller en meny som användaren själv gått till ska aldrig få fokus tillbaka stulet (text man skrev där hamnade annars i titeln på posten)
    const deliberate = (el: Element | null) => !!el && !!el.closest("input, textarea, select, [role=dialog], [role=menu], [contenteditable=true]");
    focus();
    // Gantt-biblioteket tar fokus till sig själv en kort stund efter ett klick. Under de första 700 ms tas fokus tillbaka direkt när det flyttas
    // utanför panelen, så att tecken man redan börjat skriva inte går förlorade (utan att markera om texten).
    const t0 = Date.now();
    const back = (e: FocusEvent) => {
      if (Date.now() - t0 > 700 || deliberate(e.target as Element)) return;
      const panelEl = titleRef.current?.closest("aside.panel");
      if (panelEl && !panelEl.contains(e.target as Node)) titleRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", back, true);
    // (markera om bara om inget hunnit skrivas, så att text man redan skrivit aldrig skrivs över)
    const timers = [60, 200].map((ms) => window.setTimeout(() => { const el = titleRef.current; if (el && document.activeElement !== el && !deliberate(document.activeElement) && el.value === data.item.title) focus(); }, ms));
    const off = window.setTimeout(() => document.removeEventListener("focusin", back, true), 750);
    return () => { timers.forEach(window.clearTimeout); window.clearTimeout(off); document.removeEventListener("focusin", back, true); };
  }, [autoSelectTitle, data?.item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fokus på ett val (från menyn). Gantt-biblioteket tar fokus en kort stund efter ett klick, så det görs om några gånger.
  useEffect(() => {
    if (!focusField || !data) return;
    const section = focusField === "placement" ? "placement" : focusField === "pred" ? "predecessors" : "successors";
    const go = () => { const el = document.querySelector<HTMLElement>(`aside.panel [data-section="${section}"] select`); if (el && document.activeElement !== el) { el.focus(); el.scrollIntoView({ block: "center" }); } };
    go();
    const timers = [60, 200, 450].map((ms) => window.setTimeout(go, ms));
    const done = window.setTimeout(() => onFocusDone?.(), 500);
    return () => { timers.forEach(window.clearTimeout); window.clearTimeout(done); };
  }, [focusField, data?.item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    try {
      const [all, deps, users] = await Promise.all([store.listItems(projectId), store.listDependencies(projectId), store.listUsers()]);
      if (currentItem.current !== itemId) return; // man har redan bytt post
      const item = all.find((i) => i.id === itemId);
      if (!item) { setLoadError(sv.panel.errors.not_found); return; }
      setLoadError(null);
      const switched = dataRef.current?.item.id !== itemId; // en annan post än den panelen visade senast
      const loaded = { item, all, deps, users };
      dataRef.current = loaded;
      setData(loaded);
      // Fältet man skriver i skrivs aldrig över av en omladdning av samma post. Vid byte av post ska fälten alltid byta text, annars kan texten från
      // förra posten sparas på den nya när fältet lämnas.
      const typing = !switched && (document.activeElement as HTMLElement | null)?.closest?.("aside.panel") ? (document.activeElement as HTMLElement).getAttribute("name") : null;
      if (switched) pendingDate.current = null;
      if (typing !== "title") setTitle(item.title);
      if (typing !== "description") setDescription(item.description);
      if (typing !== "progress") setProgress(String(item.progress));
      // datum återställs alltid (så att ett avvisat värde inte blir kvar i fältet), utom det som väntar på att sparas
      if (pendingDate.current !== "start") setStart(item.start);
      if (pendingDate.current !== "end") setEnd(item.end);
    } catch (e) { if (currentItem.current === itemId) setLoadError(String(e)); }
  }, [store, projectId, itemId]);

  useEffect(() => { setData(null); setFieldError(null); setConfirmDelete(false); setSeriesAsk(null); setSeriesTitle(""); setSave({ kind: "idle" }); void load(); }, [load]);
  useEffect(() => { dataRef.current = dataRef.current?.item.id === itemId ? dataRef.current : null; }, [itemId]); // aldrig data för en annan post än den som visas
  // Data ändrade utanför panelen: ladda om utan att blanka panelen
  useEffect(() => { if (dataVersion !== undefined) void load(); }, [dataVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { window.clearTimeout(savedTimer.current); window.clearTimeout(dateTimer.current); }, []);

  // Esc stänger panelen (utom när en listruta är öppen, där Esc stänger listan)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target instanceof HTMLSelectElement)) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const flashSaved = () => {
    setSave({ kind: "saved" });
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSave({ kind: "idle" }), 1800);
  };

  /** Sparar ett fält. Vid fel visas meddelandet vid fältet och fältet återställs till lagrat värde. */
  const commit = async (field: string, patch: Partial<Item>) => {
    // Alltid den senaste posten (inte den som fanns när redigeringen planerades): två fält som ändras tätt efter varandra, t.ex. start och slut,
    // ska valideras mot varandra och inte mot ett gammalt värde.
    const cur = dataRef.current ?? data;
    if (!cur) return;
    if (cur.item.id !== itemId) return; // fältets text hör till en annan post än den som visas nu: skrivs aldrig över på den nya
    const { item } = cur;
    const changed = Object.fromEntries(Object.entries(patch).filter(([k, v]) => (item as unknown as Record<string, unknown>)[k] !== v)) as Partial<Item>;
    if (!Object.keys(changed).length) { setFieldError(null); return; }
    setSave({ kind: "saving" });
    try {
      for (const k of ["start", "end"] as const) if (k in changed && !isISODate(String(changed[k]))) throw new RuleError("bad_date", String(changed[k]));
      validateItemShape({ ...item, ...changed });
      await store.updateItem(item.id, changed);
      if (currentItem.current === item.id) setFieldError(null);
      await load();
      onChanged();
      if (currentItem.current === item.id) flashSaved();
    } catch (err) {
      if (currentItem.current === item.id) { setFieldError({ field, message: messageFor(err) }); setSave({ kind: "idle" }); }
      await load(); // fältet går tillbaka till det som faktiskt är sparat
    }
  };

  /** Datum sparas efter en kort paus eller när man lämnar fältet, inte för varje siffra man skriver (år 0002, 0020, ... är giltiga datum på vägen). */
  const planDate = (field: "start" | "end", value: string, milestone: boolean, immediate = false) => {
    window.clearTimeout(dateTimer.current);
    pendingDate.current = null;
    if (!isISODate(value) || Number(value.slice(0, 4)) < 1900 || Number(value.slice(0, 4)) > 2200) return;
    const patch: Partial<Item> = milestone ? { start: value, end: value } : { [field]: value };
    if (immediate) void commit(field, patch);
    else { pendingDate.current = field; dateTimer.current = window.setTimeout(() => { pendingDate.current = null; void commit(field, patch); }, 600); }
  };

  const depAction = async (field: string, run: () => Promise<unknown>) => {
    setSave({ kind: "saving" });
    try { await run(); setFieldError(null); await load(); onChanged(); flashSaved(); }
    catch (err) { setFieldError({ field, message: messageFor(err) }); setSave({ kind: "idle" }); }
  };

  if (loadError) return (
    <aside className="panel" aria-label={sv.panel.label}>
      <PanelHead onClose={onClose} kind={sv.panel.label} />
      <p role="alert" className="panel-error">{loadError}</p>
    </aside>
  );
  if (!data) return (
    <aside className="panel" aria-label={sv.panel.label}>
      <PanelHead onClose={onClose} kind={sv.panel.label} />
      <p role="status" className="panel-muted">{sv.panel.loading}</p>
    </aside>
  );

  const { item, all, deps, users } = data;
  const byId = new Map(all.map((i) => [i.id, i]));
  const milestone = item.type === "milestone";
  const epic = item.type === "epic";
  const chain: string[] = [];
  for (let p = item.parent_id ? byId.get(item.parent_id) : undefined; p; p = p.parent_id ? byId.get(p.parent_id) : undefined) chain.unshift(p.title);
  const preds = deps.filter((d) => d.to_item_id === item.id).map((d) => ({ dep: d, other: byId.get(d.from_item_id)! })).filter((x) => x.other);
  const succs = deps.filter((d) => d.from_item_id === item.id).map((d) => ({ dep: d, other: byId.get(d.to_item_id)! })).filter((x) => x.other);
  const linkable = all.filter((i) => i.type !== "epic" && i.id !== item.id && i.project_id === item.project_id);
  const children = all.filter((i) => i.parent_id === item.id).sort((a, b) => a.sort_order - b.sort_order);
  const overdue = isOverdue(item, todayISO());
  const choices = epicChoices(all, item.id);
  const subtreeCount = descendants(all, item.id).length;
  const doDelete = async () => {
    setSave({ kind: "saving" });
    try { await deleteSubtree(store, all, item.id); onChanged(); onClose(); }
    catch (e) { setFieldError({ field: "delete", message: messageFor(e) }); setSave({ kind: "idle" }); }
  };
  const err = (f: string) => (fieldError?.field === f ? <p role="alert" className="panel-error" data-field={f}>{fieldError.message}</p> : null);

  const depList = (kind: "pred" | "succ") => {
    const rows = kind === "pred" ? preds : succs;
    const used = new Set(rows.map((r) => r.other.id));
    return (
      <section className="panel-section" data-section={kind === "pred" ? "predecessors" : "successors"}>
        <h3>{kind === "pred" ? sv.panel.predecessors : sv.panel.successors}</h3>
        <p className="panel-muted panel-hint">{sv.panel.depHint}</p>
        {rows.length === 0 ? <p className="panel-muted">{sv.panel.noneYet}</p> : (
          <ul className="panel-list">
            {rows.map(({ dep, other }) => (
              <li key={dep.id}>
                <button type="button" className="panel-link" onClick={() => onOpen(other.id)}>{STATUS_GLYPH[other.status]} {other.title}</button>
                <button type="button" className="panel-x" aria-label={sv.panel.removeDep(other.title)} onClick={() => depAction(`dep-${kind}`, () => store.deleteDependency(dep.id))}>×</button>
              </li>
            ))}
          </ul>
        )}
        <select aria-label={kind === "pred" ? sv.panel.addPredecessor : sv.panel.addSuccessor} value=""
          onChange={(e) => {
            const other = e.target.value;
            if (!other) return;
            void depAction(`dep-${kind}`, () => store.createDependency({
              workspace_id: item.workspace_id, type: "finish_to_start",
              from_item_id: kind === "pred" ? other : item.id, to_item_id: kind === "pred" ? item.id : other,
            }));
          }}>
          <option value="">{kind === "pred" ? sv.panel.addPredecessor : sv.panel.addSuccessor}</option>
          {linkable.filter((i) => !used.has(i.id)).map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
        </select>
        {err(`dep-${kind}`)}
      </section>
    );
  };

  return (
    <aside className="panel" aria-label={sv.panel.label} data-item-id={item.id}>
      <PanelHead onClose={onClose} kind={sv.panel.type[item.type]} crumbs={chain} saveState={save} />
      <div className="panel-body">
        <label className="panel-field panel-title">
          <span className="sr-only">{sv.panel.name}</span>
          <input id="panel-title" ref={titleRef} name="title" value={title} maxLength={MAX_TITLE + 50} aria-label={sv.panel.name}
            onChange={(e) => setTitle(e.target.value)} onBlur={() => void commit("title", { title: title.trim() })}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        </label>
        {err("title")}

        <div className="panel-grid">
          <label className="panel-field">
            <span>{sv.panel.status}</span>
            <select name="status" value={item.status} onChange={(e) => void commit("status", { status: e.target.value as Status })}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_GLYPH[s]} {sv.status[s]}</option>)}
            </select>
          </label>
          <label className="panel-field">
            <span>{sv.panel.priority}</span>
            <select name="priority" value={item.priority} onChange={(e) => void commit("priority", { priority: e.target.value as Priority })}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{sv.panel.priorities[p]}</option>)}
            </select>
          </label>
          <label className="panel-field panel-wide">
            <span>{sv.panel.assignee}</span>
            <select name="assignee" value={item.assignee_id ?? ""} onChange={(e) => void commit("assignee", { assignee_id: e.target.value || null })}>
              <option value="">{sv.panel.unassigned}</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          {epic ? (
            <p className="panel-muted panel-wide">{sv.panel.epicDates} ({item.start} till {item.end})</p>
          ) : (
            <>
              <label className="panel-field">
                <span>{milestone ? sv.panel.date : sv.panel.start}</span>
                <DatePicker name="start" value={start}
                  onValue={(v) => { setStart(v); planDate("start", v, milestone); }}
                  onCommit={(v) => { if (v) planDate("start", v, milestone, true); else setStart(item.start); }} />
              </label>
              {!milestone && (
                <label className="panel-field">
                  <span>{sv.panel.end}</span>
                  <DatePicker name="end" value={end}
                    onValue={(v) => { setEnd(v); planDate("end", v, false); }}
                    onCommit={(v) => { if (v) planDate("end", v, false, true); else setEnd(item.end); }} />
                </label>
              )}
            </>
          )}
        </div>
        {item.undated && !epic && (
          <div className="panel-undated" role="note">
            <span>{sv.undated.panel}</span>
            <button type="button" className="mini" onClick={() => void depAction("undated", async () => { await store.updateItem(item.id, { undated: false }); })}>{sv.undated.keep}</button>
          </div>
        )}
        {err("start")}{err("end")}{err("status")}{err("priority")}{err("assignee")}
        {overdue && <p className="panel-muted">{sv.panel.overdueNote}</p>}

        <label className="panel-field">
          <span>{sv.panel.progress}</span>
          <div className="panel-progress">
            <input type="number" name="progress" min={0} max={100} step={1} value={progress} aria-label={sv.panel.progress}
              onChange={(e) => setProgress(e.target.value)}
              onBlur={() => void commit("progress", { progress: progress.trim() === "" ? NaN : Number(progress) })}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
            <span aria-hidden="true">%</span>
            <div className="panel-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.progress}><div style={{ width: `${item.progress}%` }} /></div>
          </div>
        </label>
        {err("progress")}

        <label className="panel-field">
          <span>{sv.panel.description}</span>
          <textarea name="description" rows={5} value={description} maxLength={MAX_DESCRIPTION + 200} placeholder={sv.panel.descriptionHint}
            onChange={(e) => setDescription(e.target.value)} onBlur={() => void commit("description", { description })} />
        </label>
        {err("description")}
        <PanelFields item={item} defs={fieldDefs} save={(patch) => depAction("fields", async () => { await store.updateItem(item.id, patch); })} />
        {err("fields")}
        <PanelExtras item={item} all={all} features={features} error={err}
          save={(patch) => depAction(Object.keys(patch)[0], async () => {
            const p = { ...patch };
            if (checklistProgress && p.checklist) { const pct = checklistPercent(p.checklist); if (pct !== null) p.progress = pct; } // checklistan styr framsteget
            await store.updateItem(item.id, p);
          })} />

        {epic && (
          <section className="panel-section" data-section="color">
            <h3>{sv.colors.label}</h3>
            <div className="swatch-row" role="radiogroup" aria-label={sv.colors.label}>
              {([null, ...GROUP_COLORS, "none"] as (GroupColor | "none" | null)[]).map((v) => {
                // "Automatisk" visar färgen som automatiken skulle ge, inte den som just nu är vald
                const effective = effectiveColors(all.map((i) => (i.id === item.id ? { ...i, color: null } : i))).get(item.id);
                const label = v === null ? `${sv.colors.auto}${effective && effective !== "none" ? ` (${sv.colors.names[effective]})` : ""}` : v === "none" ? sv.colors.none : sv.colors.names[v];
                return (
                  <button key={String(v)} type="button" role="radio" aria-checked={(item.color ?? null) === v} aria-label={label} title={label}
                    className={`color-swatch${v === null ? " auto" : v === "none" ? " none" : ""}`} data-color={String(v)}
                    style={v && v !== "none" ? { background: `var(--grp-${v})` } : v === null && effective && effective !== "none" ? { color: `var(--grp-${effective})` } : undefined}
                    onClick={() => void commit("color", { color: v })} />
                );
              })}
            </div>
            {err("color")}
          </section>
        )}

        <section className="panel-section" data-section="placement">
          <h3>{sv.panel.placement}</h3>
          <label className="panel-field">
            <span>{sv.panel.moveTo}</span>
            <select name="parent" value={item.parent_id ?? ""} onChange={(e) => void commit("parent", { parent_id: e.target.value || null })}>
              <option value="">{sv.panel.topLevel}</option>
              {choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          {err("parent")}
          <div className="panel-row" role="group" aria-label={sv.panel.order}>
            <button type="button" className="mini" disabled={!canMove(all, item.id, "up")}
              onClick={() => void depAction("order", async () => { for (const u of swapWithSibling(all, item.id, "up") ?? []) await store.updateItem(u.id, { sort_order: u.sort_order }); })}>↑ {sv.panel.moveUp}</button>
            <button type="button" className="mini" disabled={!canMove(all, item.id, "down")}
              onClick={() => void depAction("order", async () => { for (const u of swapWithSibling(all, item.id, "down") ?? []) await store.updateItem(u.id, { sort_order: u.sort_order }); })}>↓ {sv.panel.moveDown}</button>
          </div>
          {err("order")}
        </section>

        {!epic && depList("pred")}
        {!epic && depList("succ")}

        {epic && (
          <section className="panel-section" data-section="contents">
            <h3>{sv.panel.contents}</h3>
            {children.length === 0 ? <p className="panel-muted">{sv.panel.noneYet}</p> : (
              <ul className="panel-list">
                {children.map((c) => (
                  <li key={c.id}><button type="button" className="panel-link" onClick={() => onOpen(c.id)}>{STATUS_GLYPH[c.status]} {c.title}</button></li>
                ))}
              </ul>
            )}
          </section>
        )}
        {item.series && item.recur && (() => {
          const mem = seriesMembers(all, item);
          const later = mem.filter((i) => i.start >= item.start).length;
          const room = MAX_SERIES - mem.length;
          return (
            <section className="panel-section" data-section="series">
              <h3>{sv.recur.series}</h3>
              <p className="panel-muted">{sv.recur.info(sv.recur.kinds[item.recur], mem.length)}{nextDate ? ` ${sv.extras.next(nextDate)}` : ""}</p>
              <label className="panel-field"><span>{sv.recur.renameAll}</span>
                <div className="panel-row">
                  <input name="series-title" value={seriesTitle || item.title} maxLength={200} onChange={(e) => setSeriesTitle(e.target.value)} />
                  <button type="button" className="mini" onClick={() => void depAction("series", async () => { await renameSeries(store, all, item, seriesTitle || item.title); setSeriesTitle(""); })}>{sv.recur.renameAllBtn}</button>
                </div>
              </label>
              <label className="panel-field"><span>{sv.recur.changeEvery}</span>
                <div className="panel-row">
                  <select name="series-kind" value={seriesKind} onChange={(e) => setSeriesKind(e.target.value as Recurrence)}>
                    {RECURRENCES.map((k) => <option key={k} value={k}>{sv.recur.kinds[k]}</option>)}
                  </select>
                  <button type="button" className="mini" onClick={() => void depAction("series", async () => { await changeRecurrence(store, all, item, seriesKind); })}>{sv.recur.changeEveryBtn}</button>
                </div>
              </label>
              <p className="panel-muted">{sv.recur.changeEveryHint}</p>
              {room > 0 && (
                <div className="panel-row">
                  <input type="number" name="series-more" min={1} max={room} step={1} value={extendN} aria-label={sv.recur.extendCount} onChange={(e) => setExtendN(e.target.value)} style={{ width: 80 }} />
                  <button type="button" className="mini" onClick={() => void depAction("series", async () => { await extendSeries(store, all, item, Number(extendN) || 1); })}>{sv.recur.extend}</button>
                </div>
              )}
              {!seriesAsk ? (
                <div className="panel-row">
                  <button type="button" className="mini" onClick={() => setSeriesAsk("later")}>{sv.recur.removeLater}</button>
                  <button type="button" className="mini" onClick={() => setSeriesAsk("all")}>{sv.recur.removeAll}</button>
                </div>
              ) : (
                <div className="panel-confirm" role="alert">
                  <p>{seriesAsk === "later" ? sv.recur.confirmLater(later) : sv.recur.confirmAll(mem.length)}</p>
                  <div className="panel-row">
                    <button type="button" className="mini mini-danger" onClick={() => void (async () => {
                      const scope = seriesAsk; setSeriesAsk(null); setSave({ kind: "saving" });
                      try { await deleteSeries(store, all, item, scope); onChanged(); onClose(); }
                      catch (e) { setFieldError({ field: "series", message: messageFor(e) }); setSave({ kind: "idle" }); }
                    })()}>{sv.panel.removeYes}</button>
                    <button type="button" className="mini" onClick={() => setSeriesAsk(null)}>{sv.panel.removeCancel}</button>
                  </div>
                </div>
              )}
              <div className="panel-row"><button type="button" className="mini" onClick={() => onNewSeries?.(item, mem.length)}>{sv.extras.newSeriesFrom}</button></div>
              {err("series")}
            </section>
          );
        })()}
        <section className="panel-section panel-danger" data-section="delete">
          {!confirmDelete ? (
            <div className="panel-row">
              <button type="button" className="mini" onClick={() => onDuplicate?.(item.id)}>{sv.extras.duplicate}</button>
              <button type="button" className="mini" onClick={() => setConfirmDelete(true)}>{sv.panel.remove}</button>
            </div>
          ) : (
            <div className="panel-confirm" role="alert">
              <p>{sv.panel.removeConfirm(item.title, subtreeCount)}</p>
              <div className="panel-row">
                <button type="button" className="mini mini-danger" onClick={() => void doDelete()}>{sv.panel.removeYes}</button>
                <button type="button" className="mini" onClick={() => setConfirmDelete(false)}>{sv.panel.removeCancel}</button>
              </div>
            </div>
          )}
          {err("delete")}
        </section>
        <p className="panel-muted panel-foot">{sv.panel.autosave}</p>
      </div>
    </aside>
  );
}

function PanelHead({ onClose, kind, crumbs = [], saveState }: { onClose: () => void; kind: string; crumbs?: string[]; saveState?: SaveState }) {
  return (
    <header className="panel-head">
      <div className="panel-head-text">
        <span className="panel-kind">{kind}</span>
        {crumbs.length > 0 && <span className="panel-crumbs">{sv.panel.inEpic}: {crumbs.join(" / ")}</span>}
      </div>
      <span className="panel-state" role="status" aria-live="polite">
        {saveState?.kind === "saving" ? sv.panel.saving : saveState?.kind === "saved" ? sv.panel.saved : ""}
      </span>
      <button type="button" className="panel-close" aria-label={sv.panel.close} onClick={onClose}>×</button>
    </header>
  );
}

const messageFor = friendlyError;

