import { useEffect, useMemo, useRef } from "react";
import { gantt, type Task } from "dhtmlx-gantt";
import "dhtmlx-gantt/codebase/dhtmlxgantt.css";
import type { DataStore } from "../data/DataStore";
import { addDays, fromLocalDate, toLocalDate, todayISO } from "../data/dates";
import { friendlyError } from "../i18n/errors";
import type { ISODate } from "../data/types";
import { isOverdue } from "../data/rules";
import type { Dependency, Item, Status } from "../data/types";
import { sv } from "../i18n/sv";
import { datePatch, persistPatch } from "./persist";
import { STATUS_GLYPH } from "./statusUi";
import type { Zoom } from "./zoom";

// Epics ritas som vanliga staplar och inte som DHTMLX "project": biblioteket räknar själv om ett projekts datum från barnen och tappar då
// milstolpens dag, så vyn skulle visa andra datum än lagret. Våra epics härleds i lagret. Vilken sorts post det är ligger i `kind`.
const TYPE: Record<Item["type"], string> = { epic: "task", milestone: "milestone", task: "task" };

const ZOOM = {
  day: { scales: [{ unit: "month", step: 1, format: "%F %Y" }, { unit: "day", step: 1, format: "%j" }], min: 28 },
  week: { scales: [{ unit: "month", step: 1, format: "%F %Y" }, { unit: "week", step: 1, format: "%j" }], min: 50 },
  month: { scales: [{ unit: "year", step: 1, format: "%Y" }, { unit: "month", step: 1, format: "%M" }], min: 70 },
} as const;

import { GRID_WIDTH } from "../layout";
import { consumeFocusMedian, scrollCarry } from "../scrollCarry";
/** Rutnätets fasta bredd är GRID_WIDTH (layout.ts). Panelen till höger tar plats från tidslinjen, aldrig från rutnätet. */

interface TaskRow { id: string; text: string; start_date: Date; end_date: Date; type: string; kind: Item["type"]; parent: string | number; status: Status; open: boolean }
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

export function DhtmlxGantt({ store, items, deps, zoom, onError, onPersisted, revealId, onNotice, onCreateAt, onRename, onContext, onToggleDone, onMoveRow, todayToken }: {
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
  /** Ökas för att bläddra till dagens datum. */
  todayToken?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const known = useRef(new Map<string, Item>());
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const workspaceId = items[0]?.workspace_id ?? "";
  const latest = useRef({ store, onError, workspaceId, onPersisted, onNotice, onCreateAt, onRename, onContext, onToggleDone, onMoveRow });
  latest.current = { store, onError, workspaceId, onPersisted, onNotice, onCreateAt, onRename, onContext, onToggleDone, onMoveRow };
  const openState = useRef(new Map<string, boolean>());
  const pendingFocus = useRef<string | null>(null); // bock som växlats med tangentbord: fokus ska ligga kvar när raden ritats om

  const mapped = useMemo(() => {
    known.current = new Map(items.map((i) => [i.id, i]));
    const tasks: TaskRow[] = [...items].sort((a, b) => a.sort_order - b.sort_order).map((i) => ({
      id: i.id,
      text: i.title,
      start_date: toLocalDate(i.start),
      end_date: toLocalDate(addDays(i.end, 1)), // biblioteket räknar slutdatum exklusivt
      type: TYPE[i.type],
      kind: i.type,
      parent: i.parent_id ?? 0,
      status: i.status,
      open: true,
    }));
    const links: LinkRow[] = deps.map((d) => ({ id: d.id, source: d.from_item_id, target: d.to_item_id, type: "0" }));
    return { tasks, links, order: treeOrder(items) };
  }, [items, deps]);

  // Engångsinställning och initiering
  useEffect(() => {
    gantt.config.date_format = "%Y-%m-%d";
    gantt.config.show_progress = false;
    gantt.config.details_on_dblclick = false; // vi har egen panel, inte DHTMLX:s dialog
    gantt.config.details_on_create = false;
    gantt.config.fit_tasks = true; // tidsskalan utökas så att alla poster ryms (annars syns inte en post som läggs utanför det första spannet)
    gantt.config.drag_progress = false;
    gantt.config.drag_project = false;
    gantt.config.order_branch = true; // rader kan dras i rutnätet för att byta plats ...
    gantt.config.order_branch_free = true; // ... och förälder (släpps på en epic)
    gantt.config.row_height = 30;
    gantt.config.bar_height = 22;
    gantt.config.start_on_monday = true;
    gantt.config.keyboard_navigation = true;
    // Rutnätet har fast bredd och ingen dragbar skiljelinje (ett länkdrag som började nära linjen ändrade annars rutnätets bredd). Utan fast bredd kan en smalare behållare (när panelen öppnas) låta rutnätet ta över så att tidslinjen försvinner.
    gantt.config.layout = {
      css: "gantt_container",
      cols: [
        { width: GRID_WIDTH, min_width: 200, rows: [{ view: "grid", scrollX: "gridScroll", scrollable: true, scrollY: "scrollVer" }, { view: "scrollbar", id: "gridScroll" }] },
        { rows: [{ view: "timeline", scrollX: "scrollHor", scrollY: "scrollVer" }, { view: "scrollbar", id: "scrollHor" }] },
        { view: "scrollbar", id: "scrollVer" },
      ],
    };
    gantt.locale.date.month_full = [...sv.dates.monthsFull] as typeof gantt.locale.date.month_full;
    gantt.locale.date.month_short = [...sv.dates.monthsShort] as typeof gantt.locale.date.month_short;
    gantt.templates.task_class = (_s, _e, t) => `st-${(t as unknown as { status: Status }).status}${(t as unknown as { kind: string }).kind === "epic" ? " epic" : ""}`;
    gantt.templates.grid_row_class = (_s, _e, t) => ((t as unknown as { kind: string }).kind === "epic" ? "epic-row" : "");
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
      const sr = `<span class="sr-only">${sv.status[status]}. </span>`;
      if (!fits(t)) return sr; // titeln visas till höger, se rightside_text
      return `<span class="bar-glyph" aria-hidden="true">${glyph}</span>${sr}${title}`;
    };
    gantt.templates.rightside_text = (_s, _e, t) => {
      if (fits(t)) return "";
      const { glyph, title } = label(t as never);
      return `<span class="bar-glyph" aria-hidden="true">${glyph}</span>${title}`;
    };
    gantt.plugins({ tooltip: true });
    gantt.templates.tooltip_text = (start, end, t) => {
      const status = (t as unknown as { status: Status }).status;
      const last = addDays(fromLocalDate(end), -1);
      return `<b>${t.text}</b><br/>${sv.dates.range(fromLocalDate(start), last)}<br/>${STATUS_GLYPH[status]} ${sv.status[status]}`;
    };
    // Slutdatumet i en dämpad kolumn: titel, datum och status ska inte ha samma tyngd (som listorna i Asana och monday)
    // Slutdagen: biblioteket räknar slutet exklusivt, och en milstolpe har sitt datum i startdatumet
    const shortDate = (t: Task) => { const e = t.end_date as Date, s = t.start_date as Date; const d = t.type === "milestone" ? s : new Date(e.getFullYear(), e.getMonth(), e.getDate() - 1); return `${d.getDate()} ${gantt.locale.date.month_short[d.getMonth()]}`; };
    gantt.config.columns = [
      { name: "text", label: sv.grid.title, tree: true, width: "*", template: (t) => {
        const done = (t as unknown as { status: Status }).status === "done";
        // Bocken: klar eller inte klar direkt i raden. En knapp, så tangentbord (Enter, mellanslag) fungerar och skärmläsare får status.
        const check = `<button type="button" class="row-check" role="checkbox" aria-checked="${done}" aria-label="${done ? sv.check.undone : sv.check.done}: ${String(t.text).replace(/"/g, "&quot;")}" data-check="${t.id}">${done ? "\u2713" : ""}</button>`;
        return `${check}<span class="grid-title" title="${String(t.text).replace(/"/g, "&quot;")}">${t.text}</span>`;
      } },
      { name: "end_date", label: sv.grid.end, width: 64, align: "right", template: (t) => `<span class="grid-date">${shortDate(t)}</span>` },
    ];
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
    gantt.init(host.current!);
    scrollCarry.read = () => gantt.getScrollState();
    void document.fonts.ready.then(() => gantt.render()); // textmåtten beror på att typsnittet är laddat
    (window as unknown as { __dhx: typeof gantt }).__dhx = gantt;
    const ids = [
      // Epics härleds ur innehållet och kan inte dras eller ändras i kanten
      // Dra rader i rutnätet. Biblioteket flyttar raden live medan man drar och nästlar den under vilken rad som helst man håller över, men bara en
      // epic kan innehålla andra poster. Vid släpp avvisas därför ett läge inne i en uppgift (raden hoppar tillbaka), annars sparas det läge biblioteket visar.
      gantt.attachEvent("onRowDragStart", (_id, target) => !(target as HTMLElement)?.closest?.(".row-check, .gantt_tree_icon"), {}),
      gantt.attachEvent("onBeforeRowDragEnd", (id) => {
        let parent = gantt.getParent(id);
        const norm = (p: unknown) => (!p || String(p) === String(gantt.config.root_id) ? null : String(p));
        let after: string | null = null; // släpp på en uppgift: placeras efter den, bredvid den (en uppgift kan inte innehålla något)
        if (norm(parent) && (gantt.getTask(parent) as unknown as { kind: string }).kind !== "epic") { after = String(parent); parent = gantt.getParent(parent); }
        const kids = gantt.getChildren(norm(parent) ?? gantt.config.root_id).map((x) => String(x));
        const order = after ? [...kids.slice(0, kids.indexOf(after) + 1), String(id), ...kids.slice(kids.indexOf(after) + 1)] : kids;
        void latest.current.onMoveRow(String(id), norm(parent), order);
        return true;
      }, {}),
      gantt.attachEvent("onBeforeTaskDrag", (id) => (gantt.getTask(id) as unknown as { kind: string }).kind !== "epic", {}),
      gantt.attachEvent("onAfterTaskDrag", (id) => {
        const t = gantt.getTask(id);
        const patch = datePatch(known.current, String(id), t.start_date, t.end_date);
        // Efter sparning hämtas data om: biblioteket räknar själv om epics datum (och tappar milstolpens dag), lagret har rätt värden
        if (patch) persistPatch(latest.current.store, known.current, String(id), patch).then(() => latest.current.onPersisted?.()).catch(latest.current.onError);
      }, {}),
      // Beroenden normaliseras till slut-till-start. DHTMLX anger typ efter vilka handtag man drog mellan:
      //  "0" slut -> början: källan är föregångare.
      //  "3" början -> slut: man valde A:s början och B:s slut, alltså börjar A när B är klar, så B är föregångare (tvärtom mot källa -> mål).
      //  "1" början -> början och "2" slut -> slut finns inte i modellen och avvisas med en förklaring.
      gantt.attachEvent("onBeforeLinkAdd", (_id, link) => {
        const src = String(link.source), tgt = String(link.target), type = String(link.type);
        const notice = (m: string) => (latest.current.onNotice ?? latest.current.onError)(m);
        if (type !== "0" && type !== "3") { notice(sv.link.unsupported); return false; }
        const [from, to] = type === "0" ? [src, tgt] : [tgt, src];
        latest.current.store.createDependency({ workspace_id: latest.current.workspaceId, from_item_id: from, to_item_id: to, type: "finish_to_start" })
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
      if (t.closest(".gantt_task_line, .gantt_tree_icon, .gantt_task_drag, .gantt_link_control, .row-check")) return;
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
    const onCheck = (e: MouseEvent) => {
      const b = (e.target as Element).closest<HTMLElement>("[data-check]");
      if (!b) return;
      e.stopPropagation(); e.preventDefault();
      latest.current.onToggleDone?.(b.getAttribute("data-check")!);
    };
    // Tangentbord: Enter och mellanslag på bocken. Bibliotekets tangentbordsstöd tar annars tangenten, så den hanteras här (och keyup spärras så att inget dubbelt klick uppstår).
    const onCheckKey = (e: KeyboardEvent) => {
      if (!(e.target as Element).closest?.("[data-check]") || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault(); e.stopPropagation();
      if (e.type === "keydown") { const id = ((e.target as Element).closest("[data-check]") as HTMLElement).getAttribute("data-check")!; pendingFocus.current = id; latest.current.onToggleDone?.(id); }
    };
    hostEl.addEventListener("keydown", onCheckKey, true);
    hostEl.addEventListener("keyup", onCheckKey, true);
    hostEl.addEventListener("click", onCheck, true);
    hostEl.addEventListener("dblclick", onDblClick, true);
    hostEl.addEventListener("contextmenu", onContextMenu, true);
    // Panelen till höger tar plats: DHTMLX måste få veta när behållaren ändrar storlek
    const ro = new ResizeObserver(() => gantt.setSizes());
    ro.observe(host.current!);
    return () => { scrollCarry.read = null; hostEl.removeEventListener("keydown", onCheckKey, true); hostEl.removeEventListener("keyup", onCheckKey, true); hostEl.removeEventListener("click", onCheck, true); document.removeEventListener("pointermove", onAnyMove, true); document.removeEventListener("pointerleave", hideTip, true); window.removeEventListener("blur", hideTip); hostEl.removeEventListener("dblclick", onDblClick, true); hostEl.removeEventListener("contextmenu", onContextMenu, true); ro.disconnect(); ids.forEach((id) => gantt.detachEvent(id)); gantt.clearAll(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Synkning från lagret. Ändras bara fält (titel, datum, status) uppdateras bilden på plats, så att scroll, markering och
  // hopfällda grupper bevaras. Ändras strukturen (poster, förälder, ordning, beroenden) laddas om med scroll och fällning bevarade.
  useEffect(() => {
    const { tasks, links, order } = mapped;
    // Skalan omfattar alltid dagens datum (14 dagar före, 60 efter) och alla poster (med marginal). Utan dagens datum saknas tidslinje i ett
    // tomt projekt och Idag-knappen har ingenstans att gå. DHTMLX utökar inte ett uttryckligen satt intervall själv (fit_tasks räcker inte).
    const DAY = 86_400_000;
    let lo = Date.now() - 14 * DAY, hi = Date.now() + 60 * DAY;
    for (const t of tasks) { lo = Math.min(lo, t.start_date.getTime() - 7 * DAY); hi = Math.max(hi, t.end_date.getTime() + 14 * DAY); }
    gantt.config.start_date = gantt.date.date_part(new Date(lo));
    gantt.config.end_date = gantt.date.date_part(new Date(hi));
    const current: string[] = [];
    gantt.eachTask((t) => { current.push(String(t.id)); });
    const sameStructure =
      current.length === order.length && current.every((id, i) => id === order[i]) &&
      tasks.every((t) => String(gantt.getParent(t.id) || 0) === String(t.parent)) &&
      gantt.getLinks().length === links.length && links.every((l) => gantt.isLinkExists(l.id) && String(gantt.getLink(l.id).source) === l.source && String(gantt.getLink(l.id).target) === l.target);
    gantt.silent(() => {
      if (sameStructure) {
        consumeFocusMedian();
        gantt.batchUpdate(() => {
          // Bara det som ändrats ritas om. Ritas alla staplar om vid varje sparning byts staplen man är på väg att klicka på ut under klicket.
          for (const t of tasks) {
            const g = gantt.getTask(t.id) as unknown as Record<string, unknown>;
            const same = g.text === t.text && g.status === t.status && (g.start_date as Date).getTime() === t.start_date.getTime() && (g.end_date as Date).getTime() === t.end_date.getTime();
            if (same) continue;
            g.text = t.text; g.start_date = t.start_date; g.end_date = t.end_date; g.status = t.status;
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
    const id = pendingFocus.current;
    if (id) requestAnimationFrame(() => { host.current?.querySelector<HTMLElement>(`[data-check="${CSS.escape(id)}"]`)?.focus(); });
  }, [mapped]);

  useEffect(() => {
    gantt.config.scales = ZOOM[zoom].scales as never;
    gantt.config.min_column_width = ZOOM[zoom].min;
    gantt.render();
  }, [zoom, mapped]);

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
