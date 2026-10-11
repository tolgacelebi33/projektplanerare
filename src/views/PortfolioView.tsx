import { HealthChip } from "./StatusDialog";
import type { PortfolioRow } from "../data/overviews";
import { sv } from "../i18n/sv";

/** Portfölj: alla projekt i en tabell med period, antal poster, andel klara, försenade och nästa milstolpe. */
export function PortfolioView({ rows, currentId, onOpen }: { rows: PortfolioRow[]; currentId: string | null; onOpen: (projectId: string) => void }) {
  const t = sv.ov.port;
  return (
    <div className="portfolio" role="group" aria-label={sv.ov.portfolio}>
      <p className="panel-muted">{t.intro}</p>
      <div className="wl-scroll">
        <table className="wl-table port-table">
          <thead><tr><th scope="col">{t.name}</th><th scope="col">{t.period}</th><th scope="col">{t.items}</th><th scope="col">{t.done}</th><th scope="col">{t.overdue}</th><th scope="col">{t.nextMs}</th><th scope="col">{sv.health.status}</th><th scope="col">{sv.health.lastUpdate}</th><th scope="col"><span className="sr-only">{t.open}</span></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.project.id} data-project={r.project.id} className={r.project.id === currentId ? "current" : undefined}>
                <th scope="row">{r.project.name}</th>
                <td>{r.start && r.end ? `${r.start} – ${r.end}` : t.noDates}</td>
                <td>{r.items}</td>
                <td><span className="port-bar" role="img" aria-label={`${r.percent} %`}><span style={{ width: `${r.percent}%` }} /></span> {r.percent} %</td>
                <td className={r.overdue ? "over" : undefined}>{r.overdue}{r.overdue ? <span className="wl-flag" aria-hidden="true"> {"▲"}</span> : null}</td>
                <td>{r.nextMilestone ? `${r.nextMilestone.title}, ${r.nextMilestone.start}` : t.none}</td>
                <td data-part="health"><HealthChip health={r.latest?.health ?? null} /></td>
                <td data-part="last-update" className="port-update">{r.latest ? <><time dateTime={r.latest.at}>{r.latest.at.slice(0, 10)}</time>{r.latest.text ? ` ${r.latest.text.slice(0, 80)}${r.latest.text.length > 80 ? "…" : ""}` : ""}</> : sv.health.none}</td>
                <td><button type="button" className="mini" aria-label={t.openOf(r.project.name)} onClick={() => onOpen(r.project.id)}>{t.open}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
