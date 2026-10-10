import { gantt } from "dhtmlx-gantt";
import { sv } from "../i18n/sv";

/**
 * Medan en rad dras: markerar gruppen som raden hamnar i, visar en etikett vid pekaren som säger vart den läggs. (Biblioteket scrollar listan
 * självt när man drar nära dess kant, uppmätt, så det görs inte här.) Returnerar en funktion som städar upp. Den anropas när dragningen slutar (och som säkerhetsnät vid första uppsläpp av musen).
 */
/** Målets förälder enligt biblioteket under en dragning (markörläget flyttar inte raden, så det är den enda källan till vart raden hamnar). */
let dragParent: string | number | null = null;
export const setDragParent = (p: string | number | null) => { dragParent = p; };

export function startRowDragFeedback(id: string): () => void {
  dragParent = null;
  const root = String(gantt.config.root_id);
  let x = 0, y = 0, raf = 0, active = true, label: HTMLElement | null = null, marked: Element[] = [];
  const isGroup = (tid: string | number) => (gantt.getTask(tid) as unknown as { kind: string }).kind === "epic";
  /** Gruppen raden hamnar i. Ligger den inne i en uppgift tolkas det som att den läggs efter uppgiften, i uppgiftens grupp (samma regel som vid släpp). */
  const target = (): string | null => {
    if (!gantt.isTaskExists(id)) return null;
    let p: string | number | null = dragParent ?? gantt.getParent(id);
    if (!p || String(p) === root) return null;
    if (!isGroup(p)) p = gantt.getParent(p);
    return !p || String(p) === root ? null : String(p);
  };
  const unmark = () => { marked.forEach((e) => e.classList.remove("drop-group")); marked = []; };
  const paint = () => {
    raf = 0;
    if (!active) return;
    unmark();
    const g = target();
    if (g) document.querySelectorAll(`.gantt_row[data-task-id="${CSS.escape(g)}"], .gantt_task_row[task_id="${CSS.escape(g)}"]`).forEach((e) => { e.classList.add("drop-group"); marked.push(e); });
    if (!label) { label = document.createElement("div"); label.className = "drag-hint"; label.setAttribute("aria-hidden", "true"); document.body.appendChild(label); }
    label.textContent = g ? sv.drag.into(String(gantt.getTask(g).text)) : sv.drag.top;
    label.style.left = `${x + 16}px`; label.style.top = `${y + 18}px`;
  };
  const move = (e: PointerEvent) => { x = e.clientX; y = e.clientY; if (!raf) raf = requestAnimationFrame(paint); };
  document.addEventListener("pointermove", move, true);
  const end = () => {
    if (!active) return;
    active = false;
    document.removeEventListener("pointermove", move, true);
    document.removeEventListener("pointerup", end, true);
    cancelAnimationFrame(raf); unmark(); label?.remove(); label = null;
  };
  document.addEventListener("pointerup", end, true); // säkerhetsnät, t.ex. om det bara var ett klick och ingen dragning började
  return end;
}
