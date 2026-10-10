import { useState } from "react";
import type { Status } from "../data/types";
import { sv } from "../i18n/sv";

const STATUSES: Status[] = ["not_started", "in_progress", "done", "blocked"];

/** Åtgärder för markerade poster: ändra status, flytta till en grupp, ta bort, avmarkera. */
export function BulkBar({ count, inside, targets, onStatus, onMove, onDelete, onClear }: {
  count: number;
  /** Antal poster som ligger under de markerade (de tas bort tillsammans med dem). */
  inside: number;
  targets: { id: string; label: string }[];
  onStatus: (s: Status) => void;
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
      <select aria-label={sv.bulk.status} value="" onChange={(e) => { if (e.target.value) onStatus(e.target.value as Status); }}>
        <option value="">{sv.bulk.status}</option>
        {STATUSES.map((s) => <option key={s} value={s}>{sv.status[s]}</option>)}
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
