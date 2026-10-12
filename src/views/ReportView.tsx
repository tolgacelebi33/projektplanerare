import { colorOf } from "../data/statusColors";
import { useMemo } from "react";
import { projectReport } from "../data/report";
import type { Item, Project, StatusUpdate, User } from "../data/types";
import { HealthChip } from "./StatusDialog";
import { sv } from "../i18n/sv";

/** Rapport: nyckeltal, statusfördelning, försenat, kommande milstolpar, per person och per grupp för projektet. Går att skriva ut eller spara som PDF (utskriftsformatet visar bara rapporten). */
export function ReportView({ project, items, users, latest, today, onOpen }: { project: Project; items: Item[]; users: User[]; latest: StatusUpdate | null; today: string; onOpen: (id: string) => void }) {
  const t = sv.rep;
  const r = useMemo(() => projectReport(items, users, project, today), [items, users, project, today]);
  const list = (rows: Item[], none: string) => rows.length === 0 ? <p className="panel-muted">{none}</p> : (
    <ul className="rep-list">
      {rows.map((i) => <li key={i.id}><button type="button" className="panel-link" onClick={() => onOpen(i.id)}><span className="rep-date">{i.type === "milestone" ? i.end : `${i.start} – ${i.end}`}</span> {i.title}</button></li>)}
    </ul>
  );
  const bar = (done: number, total: number, label: string) => <span className="port-bar" role="img" aria-label={label}><span style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} /></span>;
  return (
    <div className="report" role="group" aria-label={sv.ov.report}>
      <div className="rep-head">
        <div>
          <h2 className="rep-title">{project.name}</h2>
          <p className="panel-muted">{t.generated(today)}{project.code ? ` · ${project.code}` : ""}</p>
        </div>
        <button type="button" className="btn no-print" onClick={() => window.print()}>{t.print}</button>
      </div>

      <section className="rep-cards" aria-label={t.keyFigures}>
        <div className="rep-card" data-card="done"><span className="rep-num">{r.percent} %</span><span>{t.doneOf(r.done, r.total)}</span>{bar(r.done, r.total, `${r.percent} %`)}</div>
        <div className="rep-card" data-card="overdue"><span className="rep-num">{r.overdue.length}</span><span>{t.overdue}</span></div>
        <div className="rep-card" data-card="period"><span className="rep-num">{r.period ? (r.daysLeft ?? 0) : "-"}</span><span>{r.period ? t.daysLeft(r.period.start, r.period.end) : t.noPeriod}</span>
          {r.elapsedPercent !== null && <span className="port-bar" role="img" aria-label={t.elapsed(r.elapsedPercent)}><span style={{ width: `${r.elapsedPercent}%` }} /></span>}
        </div>
        <div className="rep-card" data-card="health"><span className="rep-num"><HealthChip health={latest?.health ?? null} /></span><span>{latest ? `${latest.at.slice(0, 10)}${latest.text ? `: ${latest.text.slice(0, 120)}` : ""}` : sv.health.none}</span></div>
      </section>

      <section data-part="status">
        <h3>{t.byStatus}</h3>
        {r.total === 0 ? <p className="panel-muted">{t.noItems}</p> : (
          <>
            <div className="rep-stack" role="img" aria-label={r.byStatus.filter((s) => s.count).map((s) => `${s.def.name}: ${s.count}`).join(", ")}>
              {r.byStatus.filter((s) => s.count).map((s) => <span key={s.def.id} className={`st-${s.category} sc-${colorOf(s.def)}`} style={{ flexGrow: s.count }} title={`${s.def.name}: ${s.count}`} />)}
            </div>
            <ul className="rep-legend">
              {r.byStatus.map((s) => <li key={s.def.id} data-status={s.def.id}><span className={`rep-dot st-${s.category} sc-${colorOf(s.def)}`} aria-hidden="true" /> {s.def.name}: <strong>{s.count}</strong> ({Math.round((s.count / r.total) * 100)} %)</li>)}
            </ul>
          </>
        )}
      </section>

      <div className="rep-cols">
        <section data-part="overdue"><h3>{t.overdueList(r.overdue.length)}</h3>{list(r.overdue, t.noneOverdue)}</section>
        <section data-part="milestones"><h3>{t.milestones}</h3>{list(r.milestones.slice(0, 10), t.noMilestones)}{r.milestones.length > 10 && <p className="panel-muted">{t.moreItems(r.milestones.length - 10)}</p>}</section>
        <section data-part="soon"><h3>{t.endingSoon}</h3>{list(r.endingSoon, t.noneSoon)}</section>
      </div>

      <div className="rep-cols">
        <section data-part="people">
          <h3>{t.byPerson}</h3>
          {r.people.length === 0 ? <p className="panel-muted">{t.noItems}</p> : (
            <table className="wl-table"><thead><tr><th scope="col">{t.person}</th><th scope="col">{t.open}</th><th scope="col">{t.doneCol}</th><th scope="col">{t.overdueCol}</th></tr></thead>
              <tbody>{r.people.map((p) => <tr key={p.key || "none"} data-person={p.key || "none"}><th scope="row">{p.name || t.noAssignee}</th><td>{p.open}</td><td>{p.done}</td><td className={p.overdue ? "over" : undefined}>{p.overdue}</td></tr>)}</tbody></table>
          )}
        </section>
        <section data-part="groups">
          <h3>{t.byGroup}</h3>
          {r.groups.length === 0 ? <p className="panel-muted">{t.noGroups}</p> : (
            <table className="wl-table"><thead><tr><th scope="col">{t.group}</th><th scope="col">{t.itemsCol}</th><th scope="col">{t.progress}</th></tr></thead>
              <tbody>{r.groups.map((g) => <tr key={g.id} data-group={g.id}><th scope="row">{g.title}</th><td>{g.done} / {g.total}</td><td>{bar(g.done, g.total, `${g.percent} %`)} {g.percent} %</td></tr>)}</tbody></table>
          )}
        </section>
      </div>
      {r.undated > 0 && <p className="panel-muted">{t.undated(r.undated)}</p>}
    </div>
  );
}
