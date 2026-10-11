import { useEffect, useRef, useState } from "react";
import { isISODate } from "../data/dates";
import type { Template } from "../data/types";
import { friendlyError } from "../i18n/errors";
import { sv } from "../i18n/sv";
import { DatePicker } from "./DatePicker";

/** Skapa från en mall: välj mall, startdatum (rotens start) och var den hamnar (överst eller i den valda gruppen). Mallar går att ta bort här. */
export function TemplatesDialog({ templates, today, group, onCreate, onDelete, onClose }: {
  templates: Template[]; today: string; group: { id: string; title: string } | null;
  onCreate: (templateId: string, opts: { start: string; parentId: string | null; title: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>; onClose: () => void;
}) {
  const t = sv.templates;
  const [start, setStart] = useState(today);
  const [into, setInto] = useState<"top" | "group">(group ? "group" : "top");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", esc, true);
    root.current?.querySelector<HTMLElement>("input, button")?.focus();
    return () => document.removeEventListener("keydown", esc, true);
  }, [onClose]);
  const create = async (id: string) => {
    if (!isISODate(start)) { setError(sv.recur.badDate); return; }
    try { await onCreate(id, { start, parentId: into === "group" && group ? group.id : null, title }); onClose(); } catch (e) { setError(friendlyError(e)); }
  };
  return (
    <div className="modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal templates-dialog" role="dialog" aria-modal="true" aria-label={t.title} ref={root}>
        <div className="help-head"><h2>{t.title}</h2><button type="button" className="panel-x" aria-label={t.close} onClick={onClose}>×</button></div>
        {templates.length === 0 ? <p className="panel-muted">{t.none}</p> : (
          <>
            <div className="modal-row">
              <label className="panel-field"><span>{t.start}</span><DatePicker name="tpl-start" value={start} onValue={(v) => { setStart(v); setError(null); }} onCommit={(v) => { if (v) setStart(v); }} /></label>
              <label className="panel-field"><span>{t.where}</span>
                <select name="tpl-into" value={into} onChange={(e) => setInto(e.target.value as "top" | "group")}>
                  <option value="top">{t.top}</option>
                  {group && <option value="group">{t.inGroup(group.title)}</option>}
                </select></label>
            </div>
            <label className="panel-field"><span>{t.newTitle}</span><input name="tpl-title" value={title} maxLength={200} placeholder={t.newTitleHint} onChange={(e) => setTitle(e.target.value)} /></label>
            <ul className="templates-list">
              {templates.map((x) => (
                <li key={x.id}>
                  <span className="tpl-name"><strong>{x.name}</strong> <span className="panel-muted">{t.count(x.nodes.length)}</span></span>
                  {confirm === x.id ? (
                    <span className="panel-confirm" role="group" aria-label={t.confirmDelete(x.name)}>
                      <span>{t.confirmDelete(x.name)}</span>
                      <button type="button" className="mini mini-danger" onClick={() => void onDelete(x.id).then(() => setConfirm(null)).catch((e) => setError(friendlyError(e)))}>{t.deleteYes}</button>
                      <button type="button" className="mini" onClick={() => setConfirm(null)}>{t.cancel}</button>
                    </span>
                  ) : (
                    <>
                      <button type="button" className="mini mini-primary" aria-label={t.createFrom(x.name)} onClick={() => void create(x.id)}>{t.create}</button>
                      <button type="button" className="mini" aria-label={t.remove(x.name)} onClick={() => setConfirm(x.id)}>{t.removeBtn}</button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {error && <p role="alert" className="panel-error">{error}</p>}
        <p className="panel-muted">{t.hint}</p>
      </div>
    </div>
  );
}
