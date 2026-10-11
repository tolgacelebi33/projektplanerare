import { logStamp } from "../data/extras";
import type { Activity, Item } from "../data/types";
import { sv } from "../i18n/sv";
import { activityText } from "./activityText";

/**
 * Loggen för en post: allt som hänt, nyaste överst, med vem och när. Skrivs av appen och går inte att skriva i eller ändra.
 * Anteckningar som skrevs för hand i en äldre version visas kvar som skrivskyddade rader (markerade som anteckning), så inget försvinner.
 */
export function LogTab({ item, activity }: { item: Item; activity: Activity[] }) {
  const t = sv.activity;
  type Row = { key: string; at: string; who: string; text: string; note: boolean; n?: number };
  const rows: Row[] = [ // vid samma tid (snabba ändringar efter varandra) gäller ordningen i loggen: den senast skrivna överst
    ...activity.filter((a) => a.item_id === item.id).map((a) => ({ key: a.id, at: a.at, who: a.actor_name || t.unknownActor, text: activityText(a), note: false })),
    ...(item.log ?? []).map((e, i) => ({ key: `n${i}-${e.at}`, at: e.at, who: "", text: `${t.note}: ${e.text}`, note: true })),
  ].map((r, n) => ({ ...r, n })).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.n - a.n));
  return (
    <section className="panel-section" data-section="log">
      <p className="panel-muted">{t.intro}</p>
      {rows.length === 0 ? <p className="panel-muted">{t.empty}</p> : (
        <ul className="log activity">
          {rows.map((r) => (
            <li key={r.key} data-note={r.note || undefined}>
              <div className="log-head"><time dateTime={r.at}>{logStamp(r.at)}</time>{r.who && <strong>{r.who}</strong>}</div>
              <p>{r.text}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
