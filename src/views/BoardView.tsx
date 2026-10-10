import { useState } from "react";
import { todayISO } from "../data/dates";
import { isOverdue } from "../data/rules";
import type { Item, Status, User } from "../data/types";
import { sv } from "../i18n/sv";
import { STATUS_GLYPH } from "../proto/statusUi";

const COLUMNS: Status[] = ["not_started", "in_progress", "blocked", "done"];

/** Poster per status som kolumner. Ett kort dras till en annan kolumn för att ändra status (eller ändras med valet på kortet). Grupper visas inte som kort, utan som sökväg på korten. */
export function BoardView({ items, allItems, users, selectedId, onOpen, onStatus, onContext }: {
  items: Item[]; allItems: Item[]; users: User[]; selectedId: string | null;
  onOpen: (id: string) => void; onStatus: (id: string, s: Status) => void;
  onContext: (a: { id: string | null; x: number; y: number; date: null }) => void;
}) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const byId = new Map(allItems.map((i) => [i.id, i]));
  const path = (i: Item): string => { const out: string[] = []; for (let c = i.parent_id ? byId.get(i.parent_id) : undefined; c; c = c.parent_id ? byId.get(c.parent_id) : undefined) out.unshift(c.title); return out.join(" / "); };
  const today = todayISO();
  const cards = items.filter((i) => i.type !== "epic").sort((a, b) => a.sort_order - b.sort_order);
  return (
    <div className="board" role="group" aria-label={sv.board.label} title={sv.board.dragHint}>
      {COLUMNS.map((s) => {
        const list = cards.filter((i) => i.status === s);
        return (
          <section key={s} className={`board-col st-${s}${over === s ? " drop-on" : ""}`} aria-label={`${sv.status[s]}, ${list.length}`} data-status={s}
            onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(s); } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === s ? null : o)); }}
            onDrop={(e) => { e.preventDefault(); const id = drag ?? e.dataTransfer.getData("text/plain"); setDrag(null); setOver(null); if (id && byId.get(id)?.status !== s) onStatus(id, s); }}>
            <h3 className="board-head"><span aria-hidden="true">{STATUS_GLYPH[s]}</span> {sv.status[s]} <span className="board-count">{list.length}</span></h3>
            {list.length === 0 && <p className="board-empty">{sv.board.empty}</p>}
            {list.map((i) => {
              const who = users.find((u) => u.id === i.assignee_id)?.name;
              return (
                <article key={i.id} className={`board-card${selectedId === i.id ? " selected" : ""}${drag === i.id ? " dragging" : ""}`} draggable data-id={i.id} tabIndex={0}
                  onDragStart={(e) => { setDrag(i.id); e.dataTransfer.setData("text/plain", i.id); e.dataTransfer.effectAllowed = "move"; }}
                  onDragEnd={() => { setDrag(null); setOver(null); }}
                  onClick={(e) => { if (!(e.target as Element).closest("select")) onOpen(i.id); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onOpen(i.id); }}
                  onContextMenu={(e) => { e.preventDefault(); onContext({ id: i.id, x: e.clientX, y: e.clientY, date: null }); }}>
                  <div className="board-title">{i.title}</div>
                  {path(i) && <div className="board-path">{path(i)}</div>}
                  <div className="board-meta">
                    <span>{i.type === "milestone" ? i.end : `${i.start} – ${i.end}`}</span>
                    {isOverdue(i, today) && <span className="board-over">{sv.overdue}</span>}
                    {i.priority !== "normal" && <span>{sv.panel.priorities[i.priority]}</span>}
                    {who && <span>{who}</span>}
                  </div>
                  <select className="board-status" aria-label={sv.board.cardStatus(i.title)} value={i.status} onChange={(e) => onStatus(i.id, e.target.value as Status)}>
                    {COLUMNS.map((c) => <option key={c} value={c}>{sv.status[c]}</option>)}
                  </select>
                </article>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
