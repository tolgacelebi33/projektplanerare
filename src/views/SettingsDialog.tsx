import { useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, MORE_VIEWS, type Settings } from "../settings";
import type { FieldDef, User } from "../data/types";
import { sv } from "../i18n/sv";
import { THEMES, type Theme } from "../theme";
import { RuleBuilder } from "./RuleBuilder";
import type { SyncUi } from "../sync/useSync";

/** Inställningar: ändras direkt och sparas i webbläsaren. Esc, Stäng eller klick utanför stänger. */
const TABS = ["list", "board", "views", "item", "rules", "reminders", "people", "start", "touch", "backup", "sync", "info"] as const;
type Tab = (typeof TABS)[number];
const KEYS = ["N", "M", "G", "/", "Cmd/Ctrl + K", "T", "1, 2, 3", "?", "Cmd/Ctrl + Z", "Cmd/Ctrl + Shift + Z, Cmd/Ctrl + Y", "Alt + ↑ / ↓", "H", "Esc"]; // samma på alla språk, texterna står i ordlistan i samma ordning
const TAB0_KEY = "projektplanerare.settingsTab";

export interface InstallApi { available: boolean; installed: boolean; onInstall: () => void }
export interface BackupApi { lastSaved: string | null; onSave: () => Promise<string>; onRestoreFile: (file: File) => Promise<void> }
export interface PeopleApi { users: User[]; onCapacity: (id: string, hours: number | null) => Promise<void>; onAdd: (name: string) => Promise<void>; onRename: (id: string, name: string) => Promise<void>; onRemove: (id: string) => Promise<number> }

export function SettingsDialog({ theme, onTheme, fieldDefs = [], settings, people, projects = [], projectId = null, backup, sync, install, onChange, onClose }: { theme?: Theme; onTheme?: (t: Theme) => void; projects?: { id: string; name: string }[]; projectId?: string | null; fieldDefs?: FieldDef[]; settings: Settings; people?: PeopleApi; backup?: BackupApi; sync?: SyncUi; install?: InstallApi; onChange: (s: Settings) => void; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>(() => { try { const v = sessionStorage.getItem(TAB0_KEY); return (TABS as readonly string[]).includes(v ?? "") ? (v as Tab) : "list"; } catch { return "list"; } });
  const pick = (t: Tab) => { setTab(t); try { sessionStorage.setItem(TAB0_KEY, t); } catch { /* ignoreras */ } };
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", esc, true);
    root.current?.querySelector<HTMLElement>('[role="tabpanel"] select, [role="tabpanel"] input')?.focus();
    return () => document.removeEventListener("keydown", esc, true);
  }, [onClose]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });
  const t = sv.settings;
  const onTabKey = (e: React.KeyboardEvent) => {
    const i = TABS.indexOf(tab);
    const to = e.key === "ArrowDown" || e.key === "ArrowRight" ? TABS[(i + 1) % TABS.length] : e.key === "ArrowUp" || e.key === "ArrowLeft" ? TABS[(i + TABS.length - 1) % TABS.length] : e.key === "Home" ? TABS[0] : e.key === "End" ? TABS[TABS.length - 1] : null;
    if (!to) return;
    e.preventDefault(); pick(to);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`#settings-tab-${to}`)?.focus());
  };
  const check = (label: string, hint: string | null, on: boolean, change: (v: boolean) => void) => (
    <label className="settings-check"><input type="checkbox" checked={on} onChange={(e) => change(e.target.checked)} /><span>{label}{hint && <small>{hint}</small>}</span></label>
  );
  return (
    <div className="modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal settings" role="dialog" aria-modal="true" aria-label={t.title} ref={root}>
        <div className="help-head"><h2>{t.title}</h2><button type="button" className="panel-x" aria-label={t.close} onClick={onClose}>×</button></div>
        <div className="settings-layout">
          <div className="settings-tabs" role="tablist" aria-orientation="vertical" aria-label={t.tabs.label} onKeyDown={onTabKey}>
            {TABS.map((k) => (
              <button key={k} type="button" role="tab" id={`settings-tab-${k}`} aria-selected={tab === k} aria-controls="settings-panel" tabIndex={tab === k ? 0 : -1} className="settings-tab" onClick={() => pick(k)}>{t.tabs[k]}</button>
            ))}
          </div>
          <div className="settings-panel" role="tabpanel" id="settings-panel" aria-labelledby={`settings-tab-${tab}`}>
            <h3>{t.tabs[tab]}</h3>
            {tab === "list" && (<section>
              {check(t.closeOnEmpty, t.closeOnEmptyHint, settings.closeOnEmpty, (v) => set("closeOnEmpty", v))}
              {check(t.showToday, t.showTodayHint, settings.showToday, (v) => set("showToday", v))}
              {check(t.markUndated, t.markUndatedHint, settings.markUndated, (v) => set("markUndated", v))}
              {check(t.highlightOverdue, t.highlightOverdueHint, settings.highlightOverdue, (v) => set("highlightOverdue", v))}
              {check(t.quickFilters, t.quickFiltersHint, settings.quickFilters, (v) => set("quickFilters", v))}
              {check(sv.baseline.show, sv.baseline.showHint, settings.showBaseline, (v) => set("showBaseline", v))}
              {check(t.collapseSeries, t.collapseSeriesHint, settings.collapseSeries, (v) => set("collapseSeries", v))}
            </section>)}
            {tab === "board" && (<section>
              <div className="settings-cards">
                {(Object.keys(settings.cardFields) as (keyof Settings["cardFields"])[]).map((k) => (
                  <label key={k} className="settings-check"><input type="checkbox" checked={settings.cardFields[k]} onChange={(e) => onChange({ ...settings, cardFields: { ...settings.cardFields, [k]: e.target.checked } })} /><span>{t.cardFields[k]}</span></label>
                ))}
              </div>
              <label className="panel-field"><span>{t.boardGroup}</span>
                <select name="set-boardgroup" value={settings.boardGroup} onChange={(e) => set("boardGroup", e.target.value as Settings["boardGroup"])}>
                  {(["status", "assignee", "priority", "group"] as const).map((g) => <option key={g} value={g}>{sv.board.groups[g]}</option>)}
                  {fieldDefs.filter((d) => d.type === "select").map((d) => <option key={d.id} value={`field:${d.id}`}>{d.name}</option>)}
                </select></label>
              <p className="panel-muted">{t.boardGroupHint}</p>
            </section>)}
            {tab === "views" && (<section>
              <p className="panel-muted">{t.moreViewsHint}</p>
              <div className="settings-cards">
                {MORE_VIEWS.map((v) => (
                  <label key={v} className="settings-check"><input type="checkbox" checked={settings.moreViews[v]} onChange={(e) => onChange({ ...settings, moreViews: { ...settings.moreViews, [v]: e.target.checked } })} /><span>{sv.ov[v]}</span></label>
                ))}
              </div>
              <div className="modal-row settings-row">
                <label className="panel-field"><span>{t.workloadField}</span>
                  <select name="set-wlfield" value={settings.workloadField} onChange={(e) => set("workloadField", e.target.value)}>
                    <option value="">{sv.ov.work.count}</option>
                    <option value="estimate">{sv.ov.work.hours}</option>
                    {fieldDefs.filter((d) => d.type === "number").map((d) => <option key={d.id} value={d.id}>{sv.ov.work.sumOf(d.name)}</option>)}
                  </select></label>
                <label className="panel-field"><span>{t.workloadCap}</span>
                  <input name="set-wlcap" type="number" min={0} max={999} step={1} value={settings.workloadCap} onChange={(e) => { const n = Math.floor(Number(e.target.value)); if (Number.isFinite(n) && n >= 0 && n <= 999) set("workloadCap", n); }} /></label>
              </div>
            </section>)}
            {tab === "item" && (<section>
              <div className="settings-cards">
                {(Object.keys(settings.features) as (keyof Settings["features"])[]).map((k) => (
                  <label key={k} className="settings-check"><input type="checkbox" checked={settings.features[k]} onChange={(e) => onChange({ ...settings, features: { ...settings.features, [k]: e.target.checked } })} /><span>{t.features[k]}</span></label>
                ))}
              </div>
              <p className="panel-muted">{t.featuresHint}</p>
              {check(t.checklistProgress, t.checklistProgressHint, settings.checklistProgress, (v) => set("checklistProgress", v))}
              {check(t.hidePastSeries, t.hidePastSeriesHint, settings.hidePastSeries, (v) => set("hidePastSeries", v))}
              {check(t.importFields, t.importFieldsHint, settings.importExtraAsFields, (v) => set("importExtraAsFields", v))}
              {check(t.importPreview, t.importPreviewHint, settings.importPreview, (v) => set("importPreview", v))}
            </section>)}
            {tab === "rules" && (<section>
              <p className="panel-muted">{t.rulesIntro}</p>
              {check(t.rules.doneSetsProgress, t.rules.doneSetsProgressHint, settings.rules.doneSetsProgress, (v) => onChange({ ...settings, rules: { ...settings.rules, doneSetsProgress: v } }))}
              {check(t.rules.seriesNext, t.rules.seriesNextHint, settings.rules.seriesNext, (v) => onChange({ ...settings, rules: { ...settings.rules, seriesNext: v } }))}
              <RuleBuilder rules={settings.customRules} users={people?.users ?? []} projects={projects} projectId={projectId} onChange={(r) => set("customRules", r)} />
            </section>)}
            {tab === "reminders" && <RemindersTab settings={settings} onChange={onChange} />}
            {tab === "people" && people && <PeopleTab api={people} />}
            {tab === "start" && (<section>
              {theme && onTheme && (
                <div className="theme-pick" role="radiogroup" aria-label={sv.theme.label}>
                  <span className="theme-label" aria-hidden="true">{sv.theme.label}</span>
                  {THEMES.map((th) => (
                    <button key={th} type="button" role="radio" aria-checked={theme === th} aria-label={sv.theme[th]} title={sv.theme[th]} className="swatch" data-theme-swatch={th} onClick={() => onTheme(th)} />
                  ))}
                  <span className="panel-muted">{sv.theme[theme]}</span>
                </div>
              )}
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
            </section>)}
            {tab === "touch" && (<section>
              <label className="panel-field"><span>{t.touch}</span>
                <select name="set-touch" value={settings.touch} onChange={(e) => set("touch", e.target.value as Settings["touch"])}>
                  <option value="auto">{t.touchAuto}</option><option value="on">{t.touchOn}</option><option value="off">{t.touchOff}</option>
                </select></label>
              <p className="panel-muted">{t.touchHint}</p>
            </section>)}
            {tab === "backup" && backup && <BackupTab api={backup} days={settings.backupReminderDays} onDays={(n) => set("backupReminderDays", n)} />}
            {tab === "sync" && sync && <SyncTab ui={sync} />}
            {tab === "info" && (<section>
              <p>{t.infoStorage}</p>
              <p>{t.infoCodes}</p>
              <h4>{t.shortcutsTitle}</h4>
              <p className="panel-muted">{t.shortcutsHint}</p>
              <dl className="settings-keys">
                {t.shortcuts.map((d, n) => <div key={KEYS[n]}><dt><kbd>{KEYS[n]}</kbd></dt><dd>{d}</dd></div>)}
              </dl>
              <h4>{sv.pwa.title}</h4>
              <p>{sv.pwa.intro}</p>
              {install?.installed ? <p className="panel-muted">{sv.pwa.installed}</p> : install?.available ? <div><button type="button" className="mini mini-primary" onClick={install.onInstall}>{sv.pwa.install}</button></div> : <p className="panel-muted">{sv.pwa.manual}</p>}
              <div><button type="button" className="mini" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("pp:help")); }}>{t.openHelp}</button></div>
            </section>)}
          </div>
        </div>
        <div className="panel-row modal-actions">
          <button type="button" className="mini" onClick={() => onChange({ ...DEFAULT_SETTINGS, customRules: settings.customRules })}>{t.reset}</button>
          <button type="button" className="mini mini-primary" onClick={onClose}>{t.close}</button>
        </div>
      </div>
    </div>
  );
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Personer: namnet ändras direkt (Enter eller när fältet lämnas), nya läggs till, och borttagning kräver en bekräftelse. */
function PeopleTab({ api }: { api: PeopleApi }) {
  const t = sv.settings.people;
  const [msg, setMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [adding, setAdding] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const run = async (fn: () => Promise<unknown>, ok?: (r: unknown) => string) => {
    try { const r = await fn(); setMsg(ok ? { kind: "info", text: ok(r) } : null); return true; } catch (e) { setMsg({ kind: "error", text: errText(e) }); return false; }
  };
  const commitName = async (u: User) => {
    const v = (draft[u.id] ?? u.name).trim();
    if (v === u.name) { setDraft((d) => { const n = { ...d }; delete n[u.id]; return n; }); return; }
    if (await run(() => api.onRename(u.id, v))) setDraft((d) => { const n = { ...d }; delete n[u.id]; return n; });
  };
  return (
    <section>
      <p className="panel-muted">{t.intro}</p>
      {api.users.length === 0 && <p className="panel-muted">{t.none}</p>}
      <ul className="people-list">
        {api.users.map((u) => (
          <li key={u.id}>
            {confirmId === u.id ? (
              <div className="people-confirm" role="group" aria-label={t.confirm(u.name)}>
                <span>{t.confirm(u.name)}</span>
                <button type="button" className="mini mini-danger" onClick={() => void run(() => api.onRemove(u.id), (n) => t.removed(n as number)).then(() => setConfirmId(null))}>{t.confirmYes}</button>
                <button type="button" className="mini" onClick={() => setConfirmId(null)}>{t.cancel}</button>
              </div>
            ) : (
              <>
                <input aria-label={t.nameOf(u.name)} value={draft[u.id] ?? u.name} maxLength={60}
                  onChange={(e) => setDraft((d) => ({ ...d, [u.id]: e.target.value }))} onBlur={() => void commitName(u)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void commitName(u); } else if (e.key === "Escape" && draft[u.id] !== undefined) { e.stopPropagation(); setDraft((d) => { const n = { ...d }; delete n[u.id]; return n; }); } }} />
                <label className="people-cap"><span className="sr-only">{t.capacityOf(u.name)}</span>
                  <input type="number" min={0} max={168} step={1} placeholder={t.capacityShort} aria-label={t.capacityOf(u.name)} title={t.capacityHint} defaultValue={u.capacity ?? ""} key={`${u.id}-${u.capacity ?? ""}`}
                    onBlur={(e) => { const v = e.target.value.trim(); const n = v === "" ? null : Number(v); if ((n ?? null) !== (u.capacity ?? null)) void run(() => api.onCapacity(u.id, n)); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }} />
                  <span aria-hidden="true">{t.capacityUnit}</span></label>
                <button type="button" className="mini" aria-label={`${t.remove} ${u.name}`} onClick={() => { setMsg(null); setConfirmId(u.id); }}>{t.remove}</button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form className="people-add" onSubmit={(e) => { e.preventDefault(); if (adding.trim()) void run(() => api.onAdd(adding)).then((ok) => { if (ok) setAdding(""); }); }}>
        <input aria-label={t.newName} placeholder={t.newName} value={adding} maxLength={60} onChange={(e) => setAdding(e.target.value)} />
        <button type="submit" className="mini" disabled={!adding.trim()}>{t.add}</button>
      </form>
      {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={msg.kind === "error" ? "people-error" : "panel-muted"}>{msg.text}</p>}
    </section>
  );
}

function SyncTab({ ui }: { ui: SyncUi }) {
  const t = sv.sync;
  return (
    <section>
      <p>{t.intro}</p>
      <label className="panel-field"><span>{t.clientId}</span><input name="sync-client" value={ui.cfg.clientId} onChange={(e) => ui.setCfg({ ...ui.cfg, clientId: e.target.value })} /></label>
      <label className="panel-field"><span>{t.tenantId}</span><input name="sync-tenant" value={ui.cfg.tenantId} onChange={(e) => ui.setCfg({ ...ui.cfg, tenantId: e.target.value })} /></label>
      <div className="panel-row">
        {ui.account
          ? <><span className="panel-muted" data-part="account">{t.signedInAs(ui.account)}</span><button type="button" className="mini" onClick={ui.logout}>{t.logout}</button></>
          : <><span className="panel-muted">{t.notSignedIn}</span><button type="button" className="mini mini-primary" onClick={ui.login}>{t.login}</button></>}
      </div>
      {ui.account && (<>
        <div className="panel-row">
          <button type="button" className="mini mini-primary" disabled={ui.busy} onClick={() => void ui.run()}>{ui.busy ? t.working : t.syncNow}</button>
          <span className="panel-muted" data-part="last">{ui.state.last ? t.last(ui.state.last) : t.never}</span>
        </div>
        <label className="panel-check"><input type="checkbox" name="sync-auto" checked={!!ui.state.auto} onChange={(e) => ui.setAuto(e.target.checked)} /> {t.auto}</label>
      </>)}
      {ui.choose && (
        <div role="alert" className="panel-block">
          <p>{ui.choose === "first" ? t.firstWhy : t.conflictWhy}</p>
          <div className="panel-row">
            <button type="button" className="mini" disabled={ui.busy} onClick={() => void ui.run("local")}>{t.useLocal}</button>
            <button type="button" className="mini" disabled={ui.busy} onClick={() => void ui.run("remote")}>{t.useRemote}</button>
          </div>
        </div>)}
      {ui.msg && <p role={ui.msg.kind === "error" ? "alert" : "status"} className={ui.msg.kind === "error" ? "people-error" : "panel-muted"}>{ui.msg.text}</p>}
    </section>
  );
}

function BackupTab({ api, days, onDays }: { api: BackupApi; days: number; onDays: (n: number) => void }) {
  const t = sv.backup;
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); setMsg(ok ? { kind: "info", text: ok } : null); } catch (e) { setMsg({ kind: "error", text: errText(e) }); } };
  return (
    <section>
      <p>{t.intro}</p>
      <div className="panel-row">
        <button type="button" className="mini mini-primary" onClick={() => void (async () => { try { setMsg({ kind: "info", text: await api.onSave() }); } catch (e) { setMsg({ kind: "error", text: errText(e) }); } })()}>{t.save}</button>
        <span className="panel-muted" data-part="last">{api.lastSaved ? t.lastSaved(api.lastSaved.slice(0, 10)) : t.never}</span>
      </div>
      <div className="panel-row">
        <button type="button" className="mini" onClick={() => file.current?.click()}>{t.restore}</button>
        <input ref={file} type="file" accept=".json,application/json" hidden aria-label={t.restoreFile} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void run(() => api.onRestoreFile(f)); }} />
      </div>
      <p className="panel-muted">{t.restoreHint}</p>
      <label className="panel-field"><span>{t.reminder}</span>
        <select name="set-backup-days" value={days} onChange={(e) => onDays(Number(e.target.value))}>
          {[0, 7, 14, 30, 90].map((n) => <option key={n} value={n}>{n === 0 ? t.reminderOff : t.reminderDays(n)}</option>)}
        </select></label>
      <p className="panel-muted">{t.reminderHint}</p>
      {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={msg.kind === "error" ? "people-error" : "panel-muted"}>{msg.text}</p>}
    </section>
  );
}

function RemindersTab({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const t = sv.reminders;
  const r = settings.reminders;
  const [msg, setMsg] = useState<string | null>(null);
  const supported = typeof Notification !== "undefined";
  const set = (patch: Partial<Settings["reminders"]>) => onChange({ ...settings, reminders: { ...r, ...patch } });
  const toggleOs = async (on: boolean) => {
    if (!on) { set({ os: false }); setMsg(null); return; }
    if (!supported) { setMsg(t.unsupported); return; }
    const p = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (p === "granted") { set({ os: true }); setMsg(null); } else setMsg(t.denied);
  };
  return (
    <section>
      <p className="panel-muted">{t.intro}</p>
      <label className="settings-check"><input type="checkbox" checked={r.banner} onChange={(e) => set({ banner: e.target.checked })} /><span>{t.banner}<small>{t.bannerHint}</small></span></label>
      <label className="settings-check"><input type="checkbox" checked={r.os} onChange={(e) => void toggleOs(e.target.checked)} /><span>{t.os}<small>{t.osHint}</small></span></label>
      <label className="panel-field"><span>{t.scope}</span>
        <select name="set-remind-scope" value={r.scope} onChange={(e) => set({ scope: e.target.value as "all" | "mine" })}>
          <option value="all">{t.scopeAll}</option><option value="mine">{t.scopeMine}</option>
        </select></label>
      <p className="panel-muted">{t.limit}</p>
      {msg && <p role="alert" className="people-error">{msg}</p>}
    </section>
  );
}
