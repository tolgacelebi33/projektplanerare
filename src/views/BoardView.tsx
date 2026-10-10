import { useState } from "react";
import { boardOrder } from "../data/actions";
import { todayISO } from "../data/dates";
import { isOverdue } from "../data/rules";
import type { GroupColor, Item, Status, User } from "../data/types";
import { sv } from "../i18n/sv";
import { STATUS_GLYPH } from "../proto/statusUi";

const COLUMNS: Status[] = ["not_started", "in_progress", "blocked", "done"];

/**
 * Poster per status som kolumner. Dra ett kort till en annan kolumn (eller en annan plats i samma) för att ändra status och ordning, eller använd valet på kortet.
 * Ctrl/Cmd-klick markerar flera kort och Shift-klick en följd, och ett klick på tom yta släpper både markering och öppnad post.
 * Grupper är inga kort: de syns som sökväg och som en smal färgkant på korten.
 */
export function BoardView({ items, allItems, users, colors, openId, selected, onOpen, onSelect, onBackground, onDrop, onStatus, onContext }: {
  items: Item[]; allItems: Item[]; users: User[]; colors: ReadonlyMap<string, GroupColor | "none">;
  openId: string | null; selected: ReadonlySet<string>;
  onOpen: (id: string) => void;
  onSelect: (a: { id: string; mode: "toggle" | "range" | "clear"; visible: string[] }) => void;
  onBackground: () => void;
  onDrop: (movedIds: string[], status: Status, beforeId: string | null) => void;
  onStatus: (id: string, s: Status) => void;
  onContext: (a: { id: string | null; x: number; y: number; date: null }) => void;
}) {
  const [drag, setDrag] = useState<string[] | null>(null);
  const [at, setAt] = useState<{ status: Status; before: string | null } | null>(null);
  const byId = new Map(allItems.map((i) => [i.id, i]));
  const path = (i: Item): string => { const out: string[] = []; for (let c = i.parent_id ? byId.get(i.parent_id) : undefined; c; c = c.parent_id ? byId.get(c.parent_id) : undefined) out.unshift(c.title); return out.join(" / "); };
  const today = todayISO();
  const columns = COLUMNS.map((s) => ({ s, list: boardOrder(items, s) }));
  const visible = columns.flatMap((c) => c.list.map((i) => i.id));
  const finish = () => { setDrag(null); setAt(null); };
  return (
    <div className={`board${selected.size ? " has-sel" : ""}`} role="group" aria-label={sv.board.label} title={sv.board.dragHint}
      onClick={(e) => { if (!(e.target as Element).closest("article, select, button")) onBackground(); }}>
      {columns.map(({ s, list }) => (
        <section key={s} className={`board-col st-${s}${at?.status === s ? " drop-on" : ""}`} aria-label={`${sv.status[s]}, ${list.length}`} data-status={s}
          onDragOver={(e) => { if (drag) { e.preventDefault(); if (e.target === e.currentTarget || !(e.target as Element).closest("article")) setAt({ status: s, before: null }); } }}
          onDrop={(e) => { e.preventDefault(); const moved = drag; const where = at; finish(); if (moved && where) onDrop(moved, where.status, where.before); }}>
          <h3 className="board-head"><span aria-hidden="true">{STATUS_GLYPH[s]}</span> {sv.status[s]} <span className="board-count">{list.length}</span></h3>
          {list.length === 0 && <p className="board-empty">{sv.board.empty}</p>}
          {list.map((i) => {
            const who = users.find((u) => u.id === i.assignee_id)?.name;
            const color = colors.get(i.id);
            return (
              <div key={i.id} className="board-slot">
                {drag && at?.status === s && at.before === i.id && <div className="board-drop-line" aria-hidden="true" />}
                <article className={`board-card${color && color !== "none" ? ` grp-${color}` : ""}${openId === i.id ? " open" : ""}${selected.has(i.id) ? " sel" : ""}${drag?.includes(i.id) ? " dragging" : ""}`} draggable data-id={i.id} tabIndex={0}
                  aria-selected={selected.has(i.id)}
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
                    setAt((cur) => (cur && cur.status === s && cur.before === next ? cur : { status: s, before: next }));
                  }}
                  onClick={(e) => {
                    if ((e.target as Element).closest("select")) return;
                    if (e.metaKey || e.ctrlKey) { onSelect({ id: i.id, mode: "toggle", visible }); return; }
                    if (e.shiftKey) { onSelect({ id: i.id, mode: "range", visible }); return; }
                    if (selected.size) onSelect({ id: "", mode: "clear", visible: [] });
                    onOpen(i.id);
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onOpen(i.id); }}
                  onContextMenu={(e) => { e.preventDefault(); onContext({ id: i.id, x: e.clientX, y: e.clientY, date: null }); }}>
                  <div className="board-title">{i.title}</div>
                  {path(i) && <div className="board-path">{path(i)}</div>}
                  <div className="board-meta">
                    <span>{i.type === "milestone" ? i.end : `${i.start} – ${i.end}`}</span>
                    {i.series && i.recur && <span className="board-series" title={sv.recur.series}>{"\u21BB"} {sv.recur.kinds[i.recur]}</span>}
                    {isOverdue(i, today) && <span className="board-over">{sv.overdue}</span>}
                    {i.priority !== "normal" && <span>{sv.panel.priorities[i.priority]}</span>}
                    {who && <span>{who}</span>}
                  </div>
                  <select className="board-status" aria-label={sv.board.cardStatus(i.title)} value={i.status} onChange={(e) => onStatus(i.id, e.target.value as Status)}>
                    {COLUMNS.map((c) => <option key={c} value={c}>{sv.status[c]}</option>)}
                  </select>
                </article>
              </div>
            );
          })}
          {drag && at?.status === s && at.before === null && list.length > 0 && <div className="board-drop-line" aria-hidden="true" />}
        </section>
      ))}
    </div>
  );
}
