import { useEffect, useRef, useState } from "react";
import { sv } from "../i18n/sv";

/** "Så gör du": knapp i sidhuvudet som öppnar en kort guide till funktionerna. Esc, klick utanför eller Stäng stänger, och fokus går tillbaka till knappen. */
export function HelpDialog() {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const toggle = () => setOpen((o) => !o);
    window.addEventListener("pp:help", toggle);
    return () => window.removeEventListener("pp:help", toggle);
  }, []);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!root.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc, true);
    root.current?.querySelector<HTMLElement>("button")?.focus();
    return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", esc, true); };
  }, [open]);
  return (
    <>
      <button ref={btn} type="button" className="help-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{sv.help.label}</button>
      {open && (
        <div className="help-pop" role="dialog" aria-label={sv.help.title} ref={root}>
          <div className="help-head">
            <h2>{sv.help.title}</h2>
            <button type="button" className="panel-x" aria-label={sv.help.close} onClick={() => { setOpen(false); btn.current?.focus(); }}>×</button>
          </div>
          {sv.help.sections.map((s) => (
            <section key={s.h}>
              <h3>{s.h}</h3>
              <ul>{s.items.map((t) => <li key={t}>{t}</li>)}</ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
