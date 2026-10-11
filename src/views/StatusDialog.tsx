import { useEffect, useRef, useState } from "react";
import { logStamp } from "../data/extras";
import { PROJECT_HEALTH, STATUS_UPDATE_LIMITS, type Project, type ProjectHealth, type StatusUpdate } from "../data/types";
import { friendlyError } from "../i18n/errors";
import { sv } from "../i18n/sv";

export const HEALTH_GLYPH: Record<ProjectHealth, string> = { on_track: "●", at_risk: "▲", off_track: "■", on_hold: "‖", done: "✓" };

/** Märke för projektets status (färg och symbol och text, aldrig bara färg). */
export function HealthChip({ health, onClick }: { health: ProjectHealth | null; onClick?: () => void }) {
  const t = sv.health;
  const label = health ? t.labels[health] : t.none;
  return (
    <button type="button" className={`health-chip health-${health ?? "none"}`} title={t.hint} onClick={onClick} data-health={health ?? "none"}>
      <span aria-hidden="true">{health ? HEALTH_GLYPH[health] : "○"}</span> {label}
    </button>
  );
}

/** Projektstatus: välj hälsa, skriv några rader, publicera. Historiken under visar tidigare uppdateringar (de skrivs och ändras inte). */
export function StatusDialog({ project, updates, onPublish, onClose }: { project: Project; updates: StatusUpdate[]; onPublish: (health: ProjectHealth, text: string) => Promise<void>; onClose: () => void }) {
  const t = sv.health;
  const mine = updates.filter((u) => u.project_id === project.id).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id < a.id ? -1 : 1));
  const [health, setHealth] = useState<ProjectHealth>(mine[0]?.health ?? "on_track");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", esc, true);
    first.current?.focus();
    return () => document.removeEventListener("keydown", esc, true);
  }, [onClose]);
  const publish = async () => { try { await onPublish(health, text); setText(""); setError(null); } catch (e) { setError(friendlyError(e)); } };
  return (
    <div className="modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal status-dialog" role="dialog" aria-modal="true" aria-label={t.title(project.name)}>
        <div className="help-head"><h2>{t.title(project.name)}</h2><button type="button" className="panel-x" aria-label={t.close} onClick={onClose}>×</button></div>
        <fieldset className="health-pick">
          <legend>{t.status}</legend>
          {PROJECT_HEALTH.map((h, i) => (
            <label key={h} className="health-option"><input ref={i === 0 ? first : undefined} type="radio" name="health" value={h} checked={health === h} onChange={() => setHealth(h)} /><span><span aria-hidden="true">{HEALTH_GLYPH[h]}</span> {t.labels[h]}</span></label>
          ))}
        </fieldset>
        <label className="panel-field"><span>{t.text}</span>
          <textarea name="health-text" rows={3} maxLength={STATUS_UPDATE_LIMITS.text} value={text} placeholder={t.placeholder} onChange={(e) => setText(e.target.value)} /></label>
        <div className="panel-row"><button type="button" className="mini mini-primary" onClick={() => void publish()}>{t.publish}</button></div>
        {error && <p role="alert" className="panel-error">{error}</p>}
        <h3>{t.history}</h3>
        {mine.length === 0 ? <p className="panel-muted">{t.noHistory}</p> : (
          <ul className="log activity health-history">
            {mine.map((u) => (
              <li key={u.id}>
                <div className="log-head"><time dateTime={u.at}>{logStamp(u.at)}</time>{u.actor_name && <strong>{u.actor_name}</strong>}<span className={`health-chip health-${u.health} small`}><span aria-hidden="true">{HEALTH_GLYPH[u.health]}</span> {t.labels[u.health]}</span></div>
                {u.text && <p>{u.text}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
