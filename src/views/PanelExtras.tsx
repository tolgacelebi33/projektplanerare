import { useState } from "react";
import { addLabel, allLabels, checklistCount, linkLabel, newChecklistId, normalizeLink } from "../data/extras";
import { labelColor } from "../data/extras";
import type { Item } from "../data/types";
import type { Features } from "../settings";
import { sv } from "../i18n/sv";

/** Etiketter, checklista, länkar och uppdateringslogg i panelen. Varje del kan stängas av under Inställningar. Ändringar går via `save` (en skrivning som ångras). */
export function PanelExtras({ item, all, features, save, error }: {
  item: Item; all: Item[]; features: Features;
  save: (patch: Partial<Item>) => Promise<void>;
  error: (field: string) => React.ReactNode;
}) {
  const t = sv.extras;
  const [label, setLabel] = useState("");
  const [todo, setTodo] = useState("");
  const [url, setUrl] = useState(""); const [urlTitle, setUrlTitle] = useState(""); const [urlBad, setUrlBad] = useState(false);
  const labels = item.labels ?? [], checklist = item.checklist ?? [], links = item.links ?? [];
  const { done, total } = checklistCount(checklist);
  const suggestions = allLabels(all).filter((l) => !labels.some((x) => x.toLowerCase() === l.toLowerCase()));
  const newLabel = async () => { const next = addLabel(labels, label); if (next) { await save({ labels: next }); } setLabel(""); };
  const setChecklist = (list: typeof checklist) => save({ checklist: list });
  const newLink = async () => {
    const l = normalizeLink(url, urlTitle);
    if (!l) { setUrlBad(true); return; }
    setUrlBad(false); await save({ links: [...links, l] }); setUrl(""); setUrlTitle("");
  };
  return (
    <>
      {features.labels && (
        <section className="panel-section" data-section="labels">
          <h3>{t.labels}</h3>
          {labels.length > 0 && (
            <ul className="chips">
              {labels.map((l) => (
                <li key={l} className="chip" style={{ "--chip": `var(--grp-${labelColor(l)})` } as React.CSSProperties}>
                  <span>{l}</span>
                  <button type="button" className="chip-x" aria-label={t.removeLabel(l)} onClick={() => void save({ labels: labels.filter((x) => x !== l) })}>×</button>
                </li>
              ))}
            </ul>
          )}
          <div className="panel-row">
            <input name="label-new" list="label-suggestions" value={label} maxLength={40} placeholder={t.labelPlaceholder} aria-label={t.addLabel}
              onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); void newLabel(); } }} />
            <datalist id="label-suggestions">{suggestions.map((l) => <option key={l} value={l} />)}</datalist>
            <button type="button" className="mini" disabled={!label.trim()} onClick={() => void newLabel()}>{t.addLabelBtn}</button>
          </div>
          {err(error, "labels")}
        </section>
      )}
      {features.checklist && (
        <section className="panel-section" data-section="checklist">
          <h3>{t.checklist}{total > 0 && <span className="panel-muted"> {t.checklistCount(done, total)}</span>}</h3>
          {total > 0 && <div className="panel-meter" role="progressbar" aria-label={t.checklist} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}><div style={{ width: `${(done / total) * 100}%` }} /></div>}
          <ul className="checklist">
            {checklist.map((c) => (
              <li key={c.id}>
                <input type="checkbox" checked={c.done} aria-label={c.text} onChange={(e) => void setChecklist(checklist.map((x) => (x.id === c.id ? { ...x, done: e.target.checked } : x)))} />
                <input className="check-text" defaultValue={c.text} maxLength={200} aria-label={t.checkText(c.text)} data-done={c.done}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.text) void setChecklist(checklist.map((x) => (x.id === c.id ? { ...x, text: v } : x))); else e.target.value = c.text; }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                <button type="button" className="panel-x" aria-label={t.removeCheck(c.text)} onClick={() => void setChecklist(checklist.filter((x) => x.id !== c.id))}>×</button>
              </li>
            ))}
          </ul>
          <div className="panel-row">
            <input name="check-new" value={todo} maxLength={200} placeholder={t.checkPlaceholder} aria-label={t.addCheck}
              onChange={(e) => setTodo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && todo.trim()) { e.preventDefault(); void setChecklist([...checklist, { id: newChecklistId(), text: todo.trim(), done: false }]).then(() => setTodo("")); } }} />
            <button type="button" className="mini" disabled={!todo.trim()} onClick={() => void setChecklist([...checklist, { id: newChecklistId(), text: todo.trim(), done: false }]).then(() => setTodo(""))}>{t.addCheckBtn}</button>
          </div>
          {err(error, "checklist")}
        </section>
      )}
      {features.links && (
        <section className="panel-section" data-section="links">
          <h3>{t.links}</h3>
          {links.length > 0 && (
            <ul className="links">
              {links.map((l, i) => (
                <li key={`${l.url}-${i}`}>
                  <a href={l.url} target="_blank" rel="noopener noreferrer">{linkLabel(l)}</a>
                  <button type="button" className="panel-x" aria-label={t.removeLink(linkLabel(l))} onClick={() => void save({ links: links.filter((_, j) => j !== i) })}>×</button>
                </li>
              ))}
            </ul>
          )}
          <div className="links-add">
            <input name="link-url" value={url} placeholder={t.urlPlaceholder} aria-label={t.url} aria-invalid={urlBad || undefined} onChange={(e) => { setUrl(e.target.value); setUrlBad(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void newLink(); } }} />
            <input name="link-title" value={urlTitle} maxLength={100} placeholder={t.titlePlaceholder} aria-label={t.linkTitle} onChange={(e) => setUrlTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void newLink(); } }} />
            <button type="button" className="mini" disabled={!url.trim()} onClick={() => void newLink()}>{t.addLinkBtn}</button>
          </div>
          {urlBad && <p role="alert" className="panel-error">{t.badUrl}</p>}
          {err(error, "links")}
        </section>
      )}
    </>
  );
}
const err = (error: (f: string) => React.ReactNode, f: string) => error(f);
