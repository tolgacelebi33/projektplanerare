import { useState } from "react";
import type { StatusDef } from "../data/types";
import { sv } from "../i18n/sv";

/** Åtgärder för markerade poster: ändra status, flytta till en grupp, ta bort, avmarkera. */
export function BulkBar({ statuses, count, inside, targets, onStatus, onMove, onDelete, onClear }: {
  /** Projektets statusar (egna eller grundstatusarna). */
  statuses: StatusDef[];
  count: number;
  /** Antal poster som ligger under de markerade (de tas bort tillsammans med dem). */
  inside: number;
  targets: { id: string; label: string }[];
  onStatus: (s: StatusDef) => void;
  /** `null` = översta nivån. */
  onMove: (groupId: string | null) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  if (confirm) {
    return (
      <div className="bulk-bar" role="alertdialog" aria-label={sv.bulk.label}>
        <span>{sv.bulk.confirm(count, inside)}</span>
        <button type="button" className="mini mini-danger" onClick={() => { setConfirm(false); onDelete(); }}>{sv.bulk.confirmYes}</button>
        <button type="button" className="mini" autoFocus onClick={() => setConfirm(false)}>{sv.bulk.cancel}</button>
      </div>
    );
  }
  return (
    <div className="bulk-bar" role="region" aria-label={sv.bulk.label}>
      <span className="bulk-count" role="status">{sv.bulk.count(count)}</span>
      <select aria-label={sv.bulk.status} value="" onChange={(e) => { const d = statuses.find((x) => x.id === e.target.value); if (d) onStatus(d); }}>
        <option value="">{sv.bulk.status}</option>
        {statuses.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <select aria-label={sv.bulk.move} value="" onChange={(e) => { if (e.target.value !== "") onMove(e.target.value === "__top" ? null : e.target.value); }}>
        <option value="">{sv.bulk.move}</option>
        <option value="__top">{sv.bulk.top}</option>
        {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
      <button type="button" className="mini" onClick={() => setConfirm(true)}>{sv.bulk.remove}</button>
      <button type="button" className="mini" onClick={onClear}>{sv.bulk.clear}</button>
    </div>
  );
}
