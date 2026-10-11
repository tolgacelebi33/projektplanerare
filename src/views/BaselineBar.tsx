import { useState } from "react";
import type { Baseline } from "../data/types";
import { sv } from "../i18n/sv";

/** Baslinje: spara planens datum som de är nu (ersätta en tidigare kräver bekräftelse), eller ta bort den. Visas bara i Gantt. */
export function BaselineBar({ baseline, count, onSave, onRemove }: { baseline: Baseline | null | undefined; count: number; onSave: () => Promise<unknown>; onRemove: () => Promise<unknown> }) {
  const t = sv.baseline;
  const [ask, setAsk] = useState<"replace" | "remove" | null>(null);
  const run = async (fn: () => Promise<unknown>) => { setAsk(null); await fn(); };
  if (ask) {
    return (
      <span className="baseline-bar-ui" role="group" aria-label={t.label}>
        <span>{ask === "replace" ? t.confirmReplace(baseline?.saved_at.slice(0, 10) ?? "") : t.confirmRemove}</span>
        <button type="button" className="mini mini-danger" onClick={() => void run(ask === "replace" ? onSave : onRemove)}>{ask === "replace" ? t.replace : t.removeYes}</button>
        <button type="button" className="mini" onClick={() => setAsk(null)}>{t.cancel}</button>
      </span>
    );
  }
  return (
    <span className="baseline-bar-ui" role="group" aria-label={t.label}>
      <span className="toolbar-label">{t.label}</span>
      <button type="button" className="mini" disabled={count === 0} title={t.saveHint} onClick={() => (baseline ? setAsk("replace") : void run(onSave))}>{baseline ? t.update : t.save}</button>
      {baseline && <span className="baseline-date" title={t.savedAt(baseline.saved_at.slice(0, 10))}>{baseline.saved_at.slice(0, 10)}</span>}
      {baseline && <button type="button" className="mini" onClick={() => setAsk("remove")}>{t.remove}</button>}
    </span>
  );
}
