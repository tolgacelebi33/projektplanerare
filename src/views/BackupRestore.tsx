import { useEffect, useRef } from "react";
import type { BackupSummary } from "../data/backup";
import { sv } from "../i18n/sv";

/** Förhandsgranskning av en säkerhetskopia före återställning. Återställningen lägger bara till nya projekt. Esc och Avbryt stänger utan att något läggs in. */
export function BackupRestore({ fileName, summary, onConfirm, onCancel }: { fileName: string; summary: BackupSummary; onConfirm: () => void; onCancel: () => void }) {
  const t = sv.backup, p = sv.importPreview;
  const go = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } };
    document.addEventListener("keydown", esc, true);
    go.current?.focus();
    return () => document.removeEventListener("keydown", esc, true);
  }, [onCancel]);
  return (
    <div className="modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal import-preview" role="dialog" aria-modal="true" aria-label={t.previewTitle}>
        <div className="help-head"><h2>{t.previewTitle}</h2><button type="button" className="panel-x" aria-label={p.close} onClick={onCancel}>×</button></div>
        <div className="preview-body">
          <p><strong>{p.file}:</strong> {fileName}</p>
          <p data-part="counts">{t.previewLine(summary.projects.length, summary.items, summary.exportedAt.slice(0, 10))}</p>
          {summary.users.length > 0 && <p data-part="users">{t.previewUsers(summary.users.length)}</p>}
          <ul data-part="projects">{summary.projects.map((x, i) => <li key={`${x.name}-${i}`}>{t.previewProject(x.name, x.items)}</li>)}</ul>
          <p className="panel-muted">{t.restoreHint}</p>
        </div>
        <div className="panel-row modal-actions">
          <button type="button" className="mini" onClick={onCancel}>{p.cancel}</button>
          <button type="button" className="mini mini-primary" ref={go} onClick={onConfirm}>{t.previewGo}</button>
        </div>
      </div>
    </div>
  );
}
