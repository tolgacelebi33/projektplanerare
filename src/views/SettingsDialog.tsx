import { useEffect, useRef } from "react";
import { DEFAULT_SETTINGS, type Settings } from "../settings";
import { sv } from "../i18n/sv";

/** Inställningar: ändras direkt och sparas i webbläsaren. Esc, Stäng eller klick utanför stänger. */
export function SettingsDialog({ settings, onChange, onClose }: { settings: Settings; onChange: (s: Settings) => void; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", esc, true);
    root.current?.querySelector<HTMLElement>("select, input")?.focus();
    return () => document.removeEventListener("keydown", esc, true);
  }, [onClose]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });
  const t = sv.settings;
  return (
    <div className="modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal settings" role="dialog" aria-modal="true" aria-label={t.title} ref={root}>
        <div className="help-head"><h2>{t.title}</h2><button type="button" className="panel-x" aria-label={t.close} onClick={onClose}>×</button></div>
        <section>
          <h3>{t.panelGroup}</h3>
          <label className="settings-check"><input type="checkbox" checked={settings.closeOnEmpty} onChange={(e) => set("closeOnEmpty", e.target.checked)} /><span>{t.closeOnEmpty}<small>{t.closeOnEmptyHint}</small></span></label>
          <label className="settings-check"><input type="checkbox" checked={settings.markUndated} onChange={(e) => set("markUndated", e.target.checked)} /><span>{t.markUndated}<small>{t.markUndatedHint}</small></span></label>
        </section>
        <section>
          <h3>{t.listGroup}</h3>
          <label className="settings-check"><input type="checkbox" checked={settings.highlightOverdue} onChange={(e) => set("highlightOverdue", e.target.checked)} /><span>{t.highlightOverdue}<small>{t.highlightOverdueHint}</small></span></label>
          <label className="settings-check"><input type="checkbox" checked={settings.quickFilters} onChange={(e) => set("quickFilters", e.target.checked)} /><span>{t.quickFilters}<small>{t.quickFiltersHint}</small></span></label>
        </section>
        <section>
          <h3>{t.cardsGroup}</h3>
          <div className="settings-cards">
            {(Object.keys(settings.cardFields) as (keyof Settings["cardFields"])[]).map((k) => (
              <label key={k} className="settings-check"><input type="checkbox" checked={settings.cardFields[k]} onChange={(e) => onChange({ ...settings, cardFields: { ...settings.cardFields, [k]: e.target.checked } })} /><span>{t.cardFields[k]}</span></label>
            ))}
          </div>
          <label className="panel-field"><span>{t.boardGroup}</span>
            <select name="set-boardgroup" value={settings.boardGroup} onChange={(e) => set("boardGroup", e.target.value as Settings["boardGroup"])}>
              {(["status", "assignee", "priority", "group"] as const).map((g) => <option key={g} value={g}>{sv.board.groups[g]}</option>)}
            </select></label>
          <p className="panel-muted">{t.boardGroupHint}</p>
        </section>
        <section>
          <h3>{t.startGroup}</h3>
          <div className="modal-row settings-row">
            <label className="panel-field"><span>{t.startView}</span>
              <select name="set-view" value={settings.startView} onChange={(e) => set("startView", e.target.value as Settings["startView"])}>
                <option value="gantt">{sv.view.gantt}</option><option value="wheel">{sv.view.wheel}</option><option value="board">{sv.view.board}</option>
              </select></label>
            <label className="panel-field"><span>{t.startZoom}</span>
              <select name="set-zoom" value={settings.startZoom} onChange={(e) => set("startZoom", e.target.value as Settings["startZoom"])}>
                <option value="day">{sv.zoom.day}</option><option value="week">{sv.zoom.week}</option><option value="month">{sv.zoom.month}</option>
              </select></label>
          </div>
        </section>
        <section>
          <h3>{t.touchGroup}</h3>
          <label className="panel-field"><span>{t.touch}</span>
            <select name="set-touch" value={settings.touch} onChange={(e) => set("touch", e.target.value as Settings["touch"])}>
              <option value="auto">{t.touchAuto}</option><option value="on">{t.touchOn}</option><option value="off">{t.touchOff}</option>
            </select></label>
          <p className="panel-muted">{t.touchHint}</p>
        </section>
        <div className="panel-row modal-actions">
          <button type="button" className="mini" onClick={() => onChange({ ...DEFAULT_SETTINGS })}>{t.reset}</button>
          <button type="button" className="mini mini-primary" onClick={onClose}>{t.close}</button>
        </div>
      </div>
    </div>
  );
}
