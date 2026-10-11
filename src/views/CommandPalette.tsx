import { useEffect, useMemo, useRef, useState } from "react";
import { matchCommands, searchAll, textScore, type ProjectData } from "../data/search";
import { STATUS_GLYPH } from "../proto/statusUi";
import { sv } from "../i18n/sv";

export interface PaletteCommand { id: string; label: string; hint?: string; run: () => void }

/**
 * Sök överallt och kör kommandon (Cmd/Ctrl+K). Poster i alla projekt, projekt och kommandon i en lista. Pil upp och ner väljer, Enter kör, Esc stänger.
 * Listan följer mönstret combobox och listbox, så skärmläsare läser upp vald rad.
 */
export function CommandPalette({ data, loading, commands, onOpenItem, onOpenProject, onClose }: {
  data: ProjectData[]; loading: boolean; commands: PaletteCommand[];
  onOpenItem: (projectId: string, itemId: string) => void; onOpenProject: (projectId: string) => void; onClose: () => void;
}) {
  const t = sv.palette;
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const rows = useMemo(() => {
    const hits = searchAll(q, data);
    const cmds = matchCommands(q, commands);
    const out: { key: string; group: string; label: string; sub?: string; glyph?: string; run: () => void }[] = [];
    // Matchar frågan början av ett ord i ett kommando ("board", "ny uppgift") kommer kommandona först, annars posterna
    const cmdFirst = q.trim() !== "" && cmds.length > 0 && textScore(cmds[0].label, q) >= 25;
    const push = () => { for (const c of cmds) out.push({ key: `c-${c.id}`, group: t.commands, label: c.label, sub: c.hint, run: c.run }); };
    if (cmdFirst) push();
    for (const h of hits) {
      if (h.kind === "project") out.push({ key: `p-${h.project.id}`, group: t.projects, label: h.project.name, sub: h.project.code, run: () => onOpenProject(h.project.id) });
      else out.push({ key: `i-${h.item.id}`, group: t.items, label: h.item.title, sub: [h.item.code, data.length > 1 ? h.project.name : ""].filter(Boolean).join("  "), glyph: STATUS_GLYPH[h.item.status], run: () => onOpenItem(h.project.id, h.item.id) });
    }
    if (!cmdFirst) push();
    return out;
  }, [q, data, commands, t, onOpenItem, onOpenProject]);
  const sel = Math.min(at, Math.max(0, rows.length - 1));
  useEffect(() => { list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [sel, rows]);
  const choose = (i: number) => { const r = rows[i]; if (!r) return; onClose(); r.run(); };
  return (
    <div className="modal-back palette-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal palette" role="dialog" aria-modal="true" aria-label={t.title}>
        <input ref={input} className="palette-input" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" aria-activedescendant={rows[sel] ? `palette-opt-${sel}` : undefined}
          aria-label={t.title} placeholder={t.placeholder} value={q} onChange={(e) => { setQ(e.target.value); setAt(0); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
            else if (e.key === "ArrowDown") { e.preventDefault(); setAt(Math.min(rows.length - 1, sel + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setAt(Math.max(0, sel - 1)); }
            else if (e.key === "Enter") { e.preventDefault(); choose(sel); }
          }} />
        <ul id="palette-list" ref={list} role="listbox" aria-label={t.results} className="palette-list">
          {rows.map((r, i) => (
            <li key={r.key} id={`palette-opt-${i}`} role="option" aria-selected={i === sel} className="palette-row" data-group={r.group} onPointerMove={() => setAt(i)} onClick={() => choose(i)}>
              {(i === 0 || rows[i - 1].group !== r.group) && <span className="palette-group">{r.group}</span>}
              <span className="palette-main">{r.glyph && <span aria-hidden="true">{r.glyph} </span>}{r.label}</span>
              {r.sub && <span className="palette-sub">{r.sub}</span>}
            </li>
          ))}
          {rows.length === 0 && <li className="palette-empty" role="presentation">{loading ? t.loading : t.none}</li>}
        </ul>
        <p className="panel-muted palette-foot">{t.hint}</p>
      </div>
    </div>
  );
}
