import { useRef } from "react";
import { sv } from "../i18n/sv";
import { GRID_MAX, GRID_MIN } from "../layout";

/**
 * Dragfält på gränsen mellan rutnätet och tidslinjen. Dra med mus eller tryck pilar (Skift = större steg) för att ändra rutnätets bredd,
 * dubbelklicka för att passa de längsta titlarna. Ligger utanför Gantt-biblioteket (dess egen delare är avstängd, den gav fel vid länkdrag).
 */
export function GridResizer({ width, onChange, onCommit, onFit }: { width: number; onChange: (w: number) => void; onCommit: () => void; onFit: () => void }) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const raf = useRef(0);
  return (
    <div className="grid-resizer" role="separator" aria-orientation="vertical" aria-label={sv.grid.resize} title={sv.grid.resizeHint}
      aria-valuenow={width} aria-valuemin={GRID_MIN} aria-valuemax={GRID_MAX} tabIndex={0} style={{ left: width - 4 }}
      onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, w: width }; e.currentTarget.dataset.dragging = "true"; e.preventDefault(); }}
      onPointerMove={(e) => {
        const d = drag.current; if (!d) return;
        const w = d.w + (e.clientX - d.x);
        cancelAnimationFrame(raf.current);
        raf.current = requestAnimationFrame(() => onChange(w)); // en ritning per bildruta räcker
      }}
      onPointerUp={(e) => { if (!drag.current) return; drag.current = null; delete e.currentTarget.dataset.dragging; cancelAnimationFrame(raf.current); onCommit(); }}
      onPointerCancel={(e) => { drag.current = null; delete e.currentTarget.dataset.dragging; onCommit(); }}
      onDoubleClick={onFit}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        if (e.key === "ArrowRight") { e.preventDefault(); onChange(width + step); onCommit(); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); onChange(width - step); onCommit(); }
        else if (e.key === "Enter") { e.preventDefault(); onFit(); }
      }} />
  );
}
