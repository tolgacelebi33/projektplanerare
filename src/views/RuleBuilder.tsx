import { useState } from "react";
import { RULE_LIMITS, isTimeTrigger, newRuleId, type CustomRule, type RuleAction, type RuleTrigger } from "../data/customRules";
import type { Priority, Status, User } from "../data/types";
import { sv } from "../i18n/sv";

const STATUSES: Status[] = ["not_started", "in_progress", "done", "blocked"];
const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];

/** Regelns text som en mening, till exempel "status blir Klar, om prioriteten är Hög: sätt framsteg 100 %". */
export function ruleSentence(r: CustomRule, users: User[], projects: { id: string; name: string }[]): string {
  const t = sv.rb;
  const when = r.when.kind === "status" ? t.whenStatusShort(sv.status[r.when.to]) : r.when.kind === "created" ? t.whenCreatedShort : r.when.kind === "overdue" ? t.whenOverdueShort : t.whenDueInShort(r.when.days);
  const cond = [r.type ? t.condType(sv.panel.type[r.type]) : "", r.priority ? t.condPriority(sv.panel.priorities[r.priority]) : ""].filter(Boolean).join(" och ");
  const a = r.then;
  const then = a.kind === "priority" ? t.thenPriority(sv.panel.priorities[a.value]) : a.kind === "status" ? t.thenStatus(sv.status[a.value]) : a.kind === "assignee" ? t.thenAssignee(a.value ? users.find((u) => u.id === a.value)?.name ?? a.value : t.noAssignee) : a.kind === "progress" ? t.thenProgress(a.value) : a.kind === "label" ? t.thenLabel(a.value) : t.thenComment(a.value);
  const scope = r.project ? projects.find((p) => p.id === r.project)?.name ?? "" : "";
  return t.sentence(when, cond, then, scope);
}

/** Byggare för egna regler: välj när, villkor, vad som ska göras och var det gäller. Reglerna sparas i inställningarna. */
export function RuleBuilder({ rules, users, projects, projectId, onChange }: { rules: CustomRule[]; users: User[]; projects: { id: string; name: string }[]; projectId: string | null; onChange: (rules: CustomRule[]) => void }) {
  const t = sv.rb;
  const [name, setName] = useState("");
  const [whenKind, setWhenKind] = useState<string>("status:done");
  const [days, setDays] = useState("3");
  const [type, setType] = useState<"" | "task" | "milestone">("");
  const [priority, setPriority] = useState<"" | Priority>("");
  const [scope, setScope] = useState<"all" | "this">("all");
  const [doKind, setDoKind] = useState<RuleAction["kind"]>("progress");
  const [value, setValue] = useState("100");
  const [err, setErr] = useState("");
  const when = (): RuleTrigger => {
    if (whenKind.startsWith("status:")) return { kind: "status", to: whenKind.slice(7) as Status };
    if (whenKind === "due_in") return { kind: "due_in", days: Math.max(0, Math.min(RULE_LIMITS.days, Math.floor(Number(days) || 0))) };
    return { kind: whenKind as "created" | "overdue" };
  };
  const timeBased = isTimeTrigger(when());
  const defaultValue = (k: RuleAction["kind"]) => k === "priority" ? "urgent" : k === "status" ? "done" : k === "progress" ? "100" : k === "assignee" ? "" : "";
  const build = (): RuleAction | null => {
    const v = value.trim();
    switch (doKind) {
      case "priority": return { kind: "priority", value: v as Priority };
      case "status": return { kind: "status", value: v as Status };
      case "assignee": return { kind: "assignee", value: v || null };
      case "progress": { const n = Math.floor(Number(v)); return v !== "" && Number.isFinite(n) && n >= 0 && n <= 100 ? { kind: "progress", value: n } : null; }
      case "label": return v && v.length <= RULE_LIMITS.label ? { kind: "label", value: v } : null;
      case "comment": return v && v.length <= RULE_LIMITS.text ? { kind: "comment", value: v } : null;
    }
  };
  const add = () => {
    if (rules.length >= RULE_LIMITS.count) { setErr(t.full(RULE_LIMITS.count)); return; }
    const a = build();
    if (!a) { setErr(t.needValue); return; }
    if (timeBased && a.kind === "comment") { setErr(t.commentNotTime); return; }
    const rule: CustomRule = { id: newRuleId(), name: name.trim().slice(0, RULE_LIMITS.name), enabled: true, project: scope === "this" ? projectId : null, when: when(), then: a };
    if (type) rule.type = type;
    if (priority) rule.priority = priority;
    onChange([...rules, rule]); setErr(""); setName("");
  };
  const valueControl = () => {
    if (doKind === "priority") return <select name="rb-value" value={value} onChange={(e) => setValue(e.target.value)}>{PRIORITIES.map((p) => <option key={p} value={p}>{sv.panel.priorities[p]}</option>)}</select>;
    if (doKind === "status") return <select name="rb-value" value={value} onChange={(e) => setValue(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{sv.status[s]}</option>)}</select>;
    if (doKind === "assignee") return <select name="rb-value" value={value} onChange={(e) => setValue(e.target.value)}><option value="">{t.noAssignee}</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>;
    if (doKind === "progress") return <input name="rb-value" type="number" min={0} max={100} step={1} value={value} onChange={(e) => setValue(e.target.value)} />;
    return <input name="rb-value" value={value} maxLength={doKind === "label" ? RULE_LIMITS.label : RULE_LIMITS.text} placeholder={t.textPlaceholder} onChange={(e) => setValue(e.target.value)} />;
  };
  return (
    <div className="rule-builder" data-section="rule-builder">
      <h3>{t.title}</h3>
      <p className="panel-muted">{t.intro}</p>
      {rules.length === 0 ? <p className="panel-muted">{t.none}</p> : (
        <ul className="rule-list">
          {rules.map((r) => {
            const label = r.name || ruleSentence(r, users, projects);
            return (
              <li key={r.id} data-rule={r.id}>
                <label className="settings-check"><input type="checkbox" checked={r.enabled} aria-label={t.toggle(label)} onChange={(e) => onChange(rules.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x)))} /><span>{r.name ? <strong>{r.name}: </strong> : null}{ruleSentence(r, users, projects)}</span></label>
                <button type="button" className="mini" aria-label={t.remove(label)} onClick={() => onChange(rules.filter((x) => x.id !== r.id))}>{"×"}</button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="rule-form">
        <label className="panel-field"><span>{t.name}</span><input name="rb-name" value={name} maxLength={RULE_LIMITS.name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="panel-field"><span>{t.when}</span>
          <select name="rb-when" value={whenKind} onChange={(e) => { setWhenKind(e.target.value); if ((e.target.value === "overdue" || e.target.value === "due_in") && doKind === "comment") { setDoKind("priority"); setValue("urgent"); } }}>
            {STATUSES.map((s) => <option key={s} value={`status:${s}`}>{t.whenStatus(sv.status[s])}</option>)}
            <option value="created">{t.whenCreated}</option><option value="overdue">{t.whenOverdue}</option><option value="due_in">{t.whenDueIn}</option>
          </select></label>
        {whenKind === "due_in" && <label className="panel-field"><span>{t.days}</span><input name="rb-days" type="number" min={0} max={RULE_LIMITS.days} step={1} value={days} onChange={(e) => setDays(e.target.value)} /></label>}
        <label className="panel-field"><span>{t.cond} {t.typeLabel}</span>
          <select name="rb-type" value={type} onChange={(e) => setType(e.target.value as "" | "task" | "milestone")}><option value="">{t.anyType}</option><option value="task">{sv.panel.type.task}</option><option value="milestone">{sv.panel.type.milestone}</option></select></label>
        <label className="panel-field"><span>{t.cond} {t.priorityLabel}</span>
          <select name="rb-priority" value={priority} onChange={(e) => setPriority(e.target.value as "" | Priority)}><option value="">{t.anyPriority}</option>{PRIORITIES.map((p) => <option key={p} value={p}>{sv.panel.priorities[p]}</option>)}</select></label>
        <label className="panel-field"><span>{t.then}</span>
          <select name="rb-do" value={doKind} onChange={(e) => { const k = e.target.value as RuleAction["kind"]; setDoKind(k); setValue(defaultValue(k)); }}>
            <option value="priority">{t.doPriority}</option><option value="status">{t.doStatus}</option><option value="assignee">{t.doAssignee}</option><option value="progress">{t.doProgress}</option><option value="label">{t.doLabel}</option>
            {!timeBased && <option value="comment">{t.doComment}</option>}
          </select></label>
        <label className="panel-field"><span>{t.value}</span>{valueControl()}</label>
        <label className="panel-field"><span>{t.scope}</span>
          <select name="rb-scope" value={scope} onChange={(e) => setScope(e.target.value as "all" | "this")}><option value="all">{t.allProjects}</option>{projectId && <option value="this">{t.thisProject(projects.find((p) => p.id === projectId)?.name ?? "")}</option>}</select></label>
        <div className="rule-actions"><button type="button" className="btn" onClick={add}>{t.add}</button>{err && <span className="field-error" role="alert">{err}</span>}</div>
      </div>
    </div>
  );
}
