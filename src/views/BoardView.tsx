import { useRef, useState } from "react";
import { todayISO } from "../data/dates";
import { boardColumns, columnCards, type BoardGroup } from "../data/boardColumns";
import { isOverdue } from "../data/rules";
import type { GroupColor, Item, User } from "../data/types";
import type { CardFields } from "../settings";
import { sv } from "../i18n/sv";

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
const firstLine = (t: string, n = 110) => { const l = t.split("\n").find((x) => x.trim()) ?? ""; return l.length > n ? `${l.slice(0, n - 1).trimEnd()}…` : l; };

/**
 * Kort i kolumner. Kolumnerna är status, ansvarig, prioritet eller grupp (`groupBy`). Dra ett kort till en annan kolumn (eller en annan plats i samma) för att ändra
 * värdet och ordningen, eller använd valet på kortet. Ctrl/Cmd-klick markerar flera kort och Shift-klick en följd, och ett klick på tom yta släpper både markering
 * och öppnad post. Grupper är inga kort: de syns som sökväg och som en smal färgkant på korten. Vad som visas på korten styrs av `cardFields`.
 */
export function BoardView({ groupBy = "status", cardFields, highlightOverdue = true, markUndated = true, items, allItems, users, colors, openId, selected, onOpen, onSelect, onBackground, onDrop, onMoveTo, onContext }: {
  groupBy?: BoardGroup; cardFields: CardFields; highlightOverdue?: boolean; markUndated?: boolean;
  items: Item[]; allItems: Item[]; users: User[]; colors: ReadonlyMap<string, GroupColor | "none">;
  openId: string | null; selected: ReadonlySet<string>;
  onOpen: (id: string) => void;
  onSelect: (a: { id: string; mode: "toggle" | "range" | "clear"; visible: string[] }) => void;
  onBackground: () => void;
  /** Kort släppta i en kolumn (`colKey`) före ett annat kort (`before`, null = sist). */
  onDrop: (movedIds: string[], colKey: string, before: string | null) => void;
  /** Valet på kortet: flytta kortet till en kolumn. */
  onMoveTo: (id: string, colKey: string) => void;
  onContext: (a: { id: string | null; x: number; y: number; date: null }) => void;
}) {
  const [drag, setDrag] = useState<string[] | null>(null);
  const [at, setAt] = useState<{ col: string; before: string | null } | null>(null);
  const byId = new Map(allItems.map((i) => [i.id, i]));
  const path = (i: Item): string => { const out: string[] = []; for (let c = i.parent_id ? byId.get(i.parent_id) : undefined; c; c = c.parent_id ? byId.get(c.parent_id) : undefined) out.unshift(c.title); return out.join(" / "); };
  const today = todayISO();
  const cols = boardColumns(groupBy, allItems, users);
  const columns = cols.map((col) => ({ col, list: columnCards(items, col) }));
  const visible = columns.flatMap((c) => c.list.map((i) => i.id));
  const finish = () => { setDrag(null); setAt(null); setGhost(null); };
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string } | null>(null);
  const noClick = useRef(false);
  /** Var ett släpp vid (x, y) hamnar: kolumn och kortet det läggs före (null = sist). */
  const targetAt = (x: number, y: number): { col: string; before: string | null } | null => {
    const el = document.elementFromPoint(x, y);
    const colEl = el?.closest<HTMLElement>("section.board-col");
    if (!colEl || colEl.dataset.col === undefined) return null;
    const key = colEl.dataset.col;
    const card = el?.closest<HTMLElement>("article.board-card");
    if (!card?.dataset.id) return { col: key, before: null };
    const list = columns.find((c) => c.col.key === key)!.list;
    const r = card.getBoundingClientRect(), idx = list.findIndex((i) => i.id === card.dataset.id);
    return { col: key, before: y > r.top + r.height / 2 ? list[idx + 1]?.id ?? null : card.dataset.id };
  };
  /** Pekskärm: ett långt tryck på ett kort startar dragning (HTML5-dragning fungerar inte med finger överallt). Musen använder den vanliga dragningen. */
  const beginPress = (i: Item, e: React.PointerEvent) => {
    if (e.pointerType === "mouse" || (e.target as Element).closest("select")) return;
    const sx = e.clientX, sy = e.clientY;
    let dragging = false, ids: string[] = [i.id];
    const label = () => (ids.length > 1 ? `${ids.length}` : i.title);
    const cleanup = () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointermove", move, true); document.removeEventListener("pointerup", up, true); document.removeEventListener("pointercancel", cancel, true);
      document.removeEventListener("touchmove", block, true);
    };
    const timer = window.setTimeout(() => {
      dragging = true; noClick.current = true;
      ids = selected.has(i.id) && selected.size > 1 ? visible.filter((v) => selected.has(v)) : [i.id];
      setDrag(ids); setGhost({ x: sx, y: sy, label: label() });
    }, 350);
    const block = (ev: TouchEvent) => { if (dragging && ev.cancelable) ev.preventDefault(); }; // utan detta rullar sidan medan man drar
    const move = (ev: PointerEvent) => {
      if (!dragging) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 10) cleanup(); return; } // fingret rörde sig före långa trycket: det är rullning
      ev.preventDefault();
      setGhost({ x: ev.clientX, y: ev.clientY, label: label() });
      setAt(targetAt(ev.clientX, ev.clientY));
    };
    const up = (ev: PointerEvent) => {
      const was = dragging, where = was ? targetAt(ev.clientX, ev.clientY) : null;
      cleanup(); finish();
      if (was) { window.setTimeout(() => { noClick.current = false; }, 400); if (where) onDrop(ids, where.col, where.before); }
    };
    const cancel = () => { cleanup(); finish(); window.setTimeout(() => { noClick.current = false; }, 400); };
    document.addEventListener("pointermove", move, true); document.addEventListener("pointerup", up, true); document.addEventListener("pointercancel", cancel, true);
    document.addEventListener("touchmove", block, { capture: true, passive: false });
  };
  return (
    <div className={`board${selected.size ? " has-sel" : ""}`} role="group" aria-label={sv.board.label} title={sv.board.dragHint} style={{ "--cols": cols.length } as React.CSSProperties}
      onClick={(e) => { if (!(e.target as Element).closest("article, select, button")) onBackground(); }}>
      {columns.map(({ col, list }) => (
        <section key={col.key || "__none"} className={`board-col${col.status ? ` st-${col.status}` : ""}${at?.col === col.key ? " drop-on" : ""}`} aria-label={`${col.label}, ${list.length}`} data-status={col.status} data-col={col.key}
          onDragOver={(e) => { if (drag) { e.preventDefault(); if (e.target === e.currentTarget || !(e.target as Element).closest("article")) setAt({ col: col.key, before: null }); } }}
          onDrop={(e) => { e.preventDefault(); const moved = drag; const where = at; finish(); if (moved && where) onDrop(moved, where.col, where.before); }}>
          <h3 className="board-head">{col.glyph && <span aria-hidden="true">{col.glyph}</span>} {col.label} <span className="board-count">{list.length}</span></h3>
          {list.length === 0 && <p className="board-empty">{sv.board.empty}</p>}
          {list.map((i) => {
            const who = users.find((u) => u.id === i.assignee_id)?.name;
            const color = colors.get(i.id);
            const mine = cols.find((c) => c.belongs(i))?.key ?? col.key;
            return (
              <div key={i.id} className="board-slot">
                {drag && at?.col === col.key && at.before === i.id && <div className="board-drop-line" aria-hidden="true" />}
                <article className={`board-card${color && color !== "none" ? ` grp-${color}` : ""}${openId === i.id ? " open" : ""}${selected.has(i.id) ? " sel" : ""}${drag?.includes(i.id) ? " dragging" : ""}`} draggable data-id={i.id} tabIndex={0}
                  aria-selected={selected.has(i.id)} onPointerDown={(e) => beginPress(i, e)}
                  onDragStart={(e) => {
                    const ids = selected.has(i.id) && selected.size > 1 ? visible.filter((v) => selected.has(v)) : [i.id];
                    setDrag(ids); e.dataTransfer.setData("text/plain", ids.join(",")); e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={finish}
                  onDragOver={(e) => {
                    if (!drag) return;
                    e.preventDefault(); e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    const after = e.clientY > r.top + r.height / 2;
                    const next = after ? list[list.indexOf(i) + 1]?.id ?? null : i.id;
                    setAt((cur) => (cur && cur.col === col.key && cur.before === next ? cur : { col: col.key, before: next }));
                  }}
                  onClick={(e) => {
                    if ((e.target as Element).closest("select") || noClick.current) return;
                    if (e.metaKey || e.ctrlKey) { onSelect({ id: i.id, mode: "toggle", visible }); return; }
                    if (e.shiftKey) { onSelect({ id: i.id, mode: "range", visible }); return; }
                    if (selected.size) onSelect({ id: "", mode: "clear", visible: [] });
                    onOpen(i.id);
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onOpen(i.id); }}
                  onContextMenu={(e) => { e.preventDefault(); if (noClick.current) return; onContext({ id: i.id, x: e.clientX, y: e.clientY, date: null }); }}>
                  <div className="board-title">{i.title}</div>
                  {path(i) && <div className="board-path">{path(i)}</div>}
                  {cardFields.description && i.description.trim() && <div className="board-desc">{firstLine(i.description)}</div>}
                  <div className="board-meta">
                    {cardFields.date && (i.undated && markUndated ? <span className="board-undated">{sv.undated.tag}</span> : <span>{i.type === "milestone" ? i.end : `${i.start} – ${i.end}`}</span>)}
                    {cardFields.series && i.series && i.recur && <span className="board-series" title={sv.recur.series}>{"↻"} {sv.recur.kinds[i.recur]}</span>}
                    {highlightOverdue && isOverdue(i, today) && <span className="board-over">{sv.overdue}</span>}
                    {cardFields.priority && i.priority !== "normal" && <span>{sv.panel.priorities[i.priority]}</span>}
                    {cardFields.progress && i.progress > 0 && <span>{i.progress} %</span>}
                    {cardFields.assignee && who && <span className="board-who" title={who} aria-label={who}>{initials(who)}</span>}
                  </div>
                  <select className="board-status" aria-label={`${sv.board.groups[groupBy]} för ${i.title}`} value={mine} onChange={(e) => onMoveTo(i.id, e.target.value)}>
                    {cols.map((c) => <option key={c.key || "__none"} value={c.key}>{c.label}</option>)}
                  </select>
                </article>
              </div>
            );
          })}
          {drag && at?.col === col.key && at.before === null && list.length > 0 && <div className="board-drop-line" aria-hidden="true" />}
        </section>
      ))}
      {ghost && <div className="board-ghost" aria-hidden="true" style={{ left: ghost.x + 12, top: ghost.y + 12 }}>{ghost.label}</div>}
    </div>
  );
}
