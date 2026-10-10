import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { sv } from "../i18n/sv";

export interface MenuItem { id: string; label: string; disabled?: boolean; danger?: boolean }

/**
 * Snabbmeny vid pekaren (högerklick, eller ctrl-klick på Mac). Tangentbord: pil upp/ned flyttar, Enter väljer, Esc stänger.
 * Borttagning har ett bekräftelsesteg i menyn.
 */
export function ContextMenu({ x, y, items, confirm, onPick, onClose }: {
  x: number; y: number; items: MenuItem[];
  /** Satt när menyn ska visa en bekräftelse i stället för alternativen. */
  confirm?: { text: string; yes: string; onYes: () => void } | null;
  onPick: (id: string) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Håll menyn inom fönstret
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
  }, [x, y, items.length, confirm]);

  // Menyn tar fokus när den öppnas. Gantt-biblioteket tar tillbaka fokus efter högerklicket, så det görs om efter en kort stund
  // (bara om fokus fortfarande ligger utanför menyn, så att inget tas ifrån användaren).
  useEffect(() => {
    const focusFirst = () => { if (!ref.current?.contains(document.activeElement)) ref.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus(); };
    focusFirst();
    const timers = [30, 120, 300].map((ms) => window.setTimeout(focusFirst, ms));
    return () => timers.forEach(window.clearTimeout);
  }, [confirm]);

  useEffect(() => {
    // Stängs av användarens egna handlingar (klick på något annat, hjul, tangent, ändrad storlek). Inte av scroll-händelser: de kan komma av sig själva
    // (ritning efter laddning, bibliotek som flyttar vyn) och skulle stänga en meny som just öppnats.
    const away = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => {
      // Medan menyn är öppen tillhör piltangenter, Enter och Esc menyn. Gantt-bibliotekets tangentbordsstöd ska inte få dem (det tog fokus).
      if (["Escape", "ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(e.key)) e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      const btns = [...(ref.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])];
      if (!btns.length) return;
      if (e.key === "Home" || e.key === "End") { e.preventDefault(); btns[e.key === "Home" ? 0 : btns.length - 1].focus(); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const at = btns.indexOf(document.activeElement as HTMLElement);
      btns[(at + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length].focus();
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("wheel", away, { capture: true, passive: true });
    document.addEventListener("contextmenu", away, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", away, true); document.removeEventListener("wheel", away, true); document.removeEventListener("contextmenu", away, true);
      document.removeEventListener("keydown", key, true); window.removeEventListener("resize", onClose); window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="ctx-menu" role="menu" aria-label={sv.menu.label} style={{ left: pos.x, top: pos.y }}>
      {confirm ? (
        <div className="ctx-confirm" role="alertdialog" aria-label={confirm.text}>
          <p>{confirm.text}</p>
          <div className="panel-row">
            <button type="button" className="mini mini-danger" onClick={confirm.onYes}>{confirm.yes}</button>
            <button type="button" className="mini" onClick={onClose}>{sv.menu.cancel}</button>
          </div>
        </div>
      ) : items.map((it) => (
        <button key={it.id} type="button" role="menuitem" className={`ctx-item${it.danger ? " ctx-danger" : ""}`} disabled={it.disabled} onClick={() => onPick(it.id)}>{it.label}</button>
      ))}
    </div>
  );
}
