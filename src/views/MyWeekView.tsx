import type { MyWeek } from "../data/overviews";
import { STATUS_GLYPH } from "../proto/statusUi";
import { sv } from "../i18n/sv";

/** Det som är försenat, pågår idag eller ligger i veckan och nästa vecka, över alla projekt. Ett klick öppnar posten i sitt projekt. */
export function MyWeekView({ groups, users, multi, onOpen }: {
  groups: MyWeek; users: { id: string; name: string }[]; multi: boolean; onOpen: (projectId: string, itemId: string) => void;
}) {
  const t = sv.ov.myWeek;
  const sections: { key: keyof MyWeek; title: string }[] = [{ key: "overdue", title: t.overdue }, { key: "today", title: t.today }, { key: "thisWeek", title: t.thisWeek }, { key: "nextWeek", title: t.nextWeek }];
  const total = sections.reduce((n, s) => n + groups[s.key].length, 0);
  return (
    <div className="myweek" role="group" aria-label={sv.ov.week}>
      <p className="panel-muted">{t.intro}</p>
      {total === 0 && <p role="status">{t.empty}</p>}
      {sections.filter((s) => groups[s.key].length > 0).map((s) => (
        <section key={s.key} data-section={s.key} aria-label={`${s.title}, ${groups[s.key].length}`}>
          <h3>{s.title} <span className="board-count">{groups[s.key].length}</span></h3>
          <ul className="mw-list">
            {groups[s.key].map(({ project, item }) => (
              <li key={`${project.id}-${item.id}`}>
                <button type="button" className="mw-row" data-id={item.id} data-project={project.id} onClick={() => onOpen(project.id, item.id)}>
                  <span aria-hidden="true">{item.type === "milestone" ? "◆" : STATUS_GLYPH[item.status]}</span>
                  <span className="mw-title">{item.title}</span>
                  {multi && <span className="mw-project">{project.name}</span>}
                  <span className="mw-date">{item.type === "milestone" || item.start === item.end ? item.end : `${item.start} – ${item.end}`}</span>
                  {item.assignee_id && <span className="board-who" title={users.find((u) => u.id === item.assignee_id)?.name}>{(users.find((u) => u.id === item.assignee_id)?.name ?? "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
