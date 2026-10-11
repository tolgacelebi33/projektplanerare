import { useEffect, useRef } from "react";
import type { ParsedProject } from "../data/exchange";
import { sv } from "../i18n/sv";

/** Förhandsgranskning före import: vad som hittades och hur kolumnerna tolkades. Inget läggs in förrän man väljer Importera. Esc och Avbryt stänger. */
export function ImportPreview({ fileName, parsed, destination, onConfirm, onCancel }: { fileName: string; parsed: ParsedProject; destination: { into: string | null; name: string }; onConfirm: () => void; onCancel: () => void }) {
  const t = sv.importPreview;
  const root = useRef<HTMLDivElement>(null);
  const go = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } };
    document.addEventListener("keydown", esc, true);
    go.current?.focus();
    return () => document.removeEventListener("keydown", esc, true);
  }, [onCancel]);
  const r = parsed.report;
  return (
    <div className="modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal import-preview" role="dialog" aria-modal="true" aria-label={t.title} ref={root}>
        <div className="help-head"><h2>{t.title}</h2><button type="button" className="panel-x" aria-label={t.close} onClick={onCancel}>×</button></div>
        <div className="preview-body">
          <p><strong>{t.file}:</strong> {fileName}</p>
          <p>{destination.into ? t.into(destination.into) : t.asNew(destination.name)}</p>
          {r && <p data-part="counts">{t.counts(r.counts.epic, r.counts.milestone, r.counts.task)}</p>}
          {r && (
            <section data-part="groups">
              <h3>{t.groups}</h3>
              {r.groups.length ? <ul>{r.groups.map((g, i) => <li key={`${g.name}-${i}`}>{t.groupLine(g.name, g.items)}</li>)}</ul> : <p className="panel-muted">{t.none}</p>}
            </section>
          )}
          {r && r.series.length > 0 && (
            <section data-part="series">
              <h3>{t.series}</h3>
              <ul>{r.series.map((s, i) => <li key={`${s.title}-${i}`}>{t.seriesLine(s.title, sv.recur.kinds[s.recur], s.count, s.first, s.last)}</li>)}</ul>
            </section>
          )}
          {r && r.undated > 0 && <p data-part="undated">{t.undated(r.undated)}</p>}
          {r && (
            <section data-part="columns">
              <h3>{t.columns}</h3>
              {r.columns ? (
                <table className="preview-cols">
                  <thead><tr><th scope="col">{t.colHeader}</th><th scope="col">{t.colAs}</th></tr></thead>
                  <tbody>{r.columns.map((c, i) => <tr key={`${c.header}-${i}`}><td>{c.header}</td><td>{sv.ex.colMeaning[c.as] ?? c.as}</td></tr>)}</tbody>
                </table>
              ) : <p className="panel-muted">{t.noColumns}</p>}
            </section>
          )}
          {parsed.warnings.length > 0 && (
            <section data-part="warnings">
              <h3>{t.warnings}</h3>
              <ul>{parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </section>
          )}
        </div>
        <div className="panel-row modal-actions">
          <button type="button" className="mini" onClick={onCancel}>{t.cancel}</button>
          <button type="button" className="mini mini-primary" ref={go} onClick={onConfirm}>{t.go}</button>
        </div>
      </div>
    </div>
  );
}
