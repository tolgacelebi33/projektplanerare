import { useRef, useState } from "react";
import type { ExportFormat } from "../data/importExport";
import type { DependencyMode, Project } from "../data/types";
import { sv } from "../i18n/sv";

type Mode = "idle" | "new" | "rename" | "remove";

/** Projektval med nytt, byt namn och ta bort (med bekräftelse). Fel visas i raden. */
export function ProjectBar({ projects, projectId, itemCount, onSelect, onCreate, onRename, onRemove, onDependencyMode, onDuplicate, onExport, onImport }: {
  projects: Project[]; projectId: string | null; itemCount: number;
  onSelect: (id: string) => void; onCreate: (name: string) => Promise<unknown>; onRename: (id: string, name: string) => Promise<unknown>; onRemove: (id: string) => Promise<unknown>; onDependencyMode: (id: string, mode: DependencyMode) => Promise<unknown>;
  onDuplicate: () => Promise<unknown>; onExport: (format: ExportFormat) => Promise<unknown>; onImport: (file: File, into: boolean) => Promise<unknown>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const intoRef = useRef(false); // vilken importknapp som öppnade filväljaren: nytt projekt eller det här projektet
  const [mode, setMode] = useState<Mode>("idle");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const current = projects.find((p) => p.id === projectId) ?? null;

  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); setMode("idle"); setError(null); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const nameField = (onSubmit: () => void, label: string) => (
    <input className="project-input" aria-label={label} placeholder={sv.project.namePlaceholder} value={name} autoFocus maxLength={100}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); if (e.key === "Escape") { setMode("idle"); setError(null); } }} />
  );

  return (
    <div className="project-bar" role="group" aria-label={sv.project.label}>
      <span className="toolbar-label">{sv.project.label}</span>
      {mode === "new" && (<>
        {nameField(() => void run(() => onCreate(name)), sv.project.newName)}
        <button type="button" className="mini" onClick={() => void run(() => onCreate(name))}>{sv.project.create}</button>
        <button type="button" className="mini" onClick={() => { setMode("idle"); setError(null); }}>{sv.project.cancel}</button>
      </>)}
      {mode === "rename" && current && (<>
        {nameField(() => void run(() => onRename(current.id, name)), sv.project.rename)}
        <button type="button" className="mini" onClick={() => void run(() => onRename(current.id, name))}>{sv.project.save}</button>
        <button type="button" className="mini" onClick={() => { setMode("idle"); setError(null); }}>{sv.project.cancel}</button>
      </>)}
      {mode === "remove" && current && (<>
        <span role="alert" className="project-confirm">{sv.project.confirm(current.name, itemCount)}</span>
        <button type="button" className="mini mini-danger" onClick={() => void run(() => onRemove(current.id))}>{sv.project.confirmYes}</button>
        <button type="button" className="mini" onClick={() => setMode("idle")}>{sv.project.cancel}</button>
      </>)}
      {mode === "idle" && (<>
        {projects.length > 0 && (
          <select className="project-select" aria-label={sv.project.label} value={projectId ?? ""} onChange={(e) => onSelect(e.target.value)}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {current?.code && <span className="code-tag" title={sv.project.codeHint}>{current.code}</span>}
        <button type="button" className="mini" onClick={() => { setName(""); setMode("new"); }}>{sv.project.new}</button>
        {current && <button type="button" className="mini" onClick={() => { setName(current.name); setMode("rename"); }}>{sv.project.rename}</button>}
        {current && <button type="button" className="mini" onClick={() => setMode("remove")}>{sv.project.remove}</button>}
        {current && <button type="button" className="mini" onClick={() => void run(onDuplicate)}>{sv.project.duplicate}</button>}
        <button type="button" className="mini" onClick={() => { intoRef.current = false; fileRef.current?.click(); }}>{sv.project.import}</button>
        {current && <button type="button" className="mini" title={sv.project.importIntoHint} onClick={() => { intoRef.current = true; fileRef.current?.click(); }}>{sv.project.importInto}</button>}
        <input ref={fileRef} type="file" accept=".json,.csv,.txt,.xlsx" hidden aria-label={sv.project.importFile}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { const into = intoRef.current; intoRef.current = false; void run(() => onImport(f, into)); } }} />
        {current && (
          <select className="project-select project-select-sm" aria-label={sv.project.export} value=""
            onChange={(e) => { const v = e.target.value as ExportFormat; if (v) void run(() => onExport(v)); }}>
            <option value="">{sv.project.export}</option>
            <option value="json">{sv.project.exportJson}</option>
            <option value="csv">{sv.project.exportCsv}</option>
            <option value="template">{sv.project.exportTemplate}</option>
          </select>
        )}
        {current && (
          <label className="project-deps" title={sv.deps.hint}>
            <span className="toolbar-label">{sv.deps.label}</span>
            <select className="project-select project-select-sm" aria-label={sv.deps.label} value={current.dependency_mode ?? "shift"}
              onChange={(e) => void run(() => onDependencyMode(current.id, e.target.value as DependencyMode))}>
              <option value="shift">{sv.deps.shift}</option>
              <option value="none">{sv.deps.none}</option>
            </select>
          </label>
        )}
      </>)}
      {error && <span role="alert" className="project-error">{error}</span>}
    </div>
  );
}
