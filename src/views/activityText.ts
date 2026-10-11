import type { Activity } from "../data/types";
import { sv } from "../i18n/sv";

/** En loggrad som text på det språk som är valt. Raderna sparas strukturerade, så att de byter språk med appen. */
export function activityText(a: Activity): string {
  const t = sv.activity;
  const dep = (a.dep_type ? sv.panel.depTypes[a.dep_type] : "") + (a.lag ? `, ${t.lag(a.lag)}` : "");
  let s: string;
  switch (a.kind) {
    case "created": s = t.created; break;
    case "moved": s = t.moved(a.from || t.top, a.to || t.top); break;
    case "dep_added": s = a.dir === "succ" ? t.depAddedSucc(a.other ?? "", dep) : t.depAddedPred(a.other ?? "", dep); break;
    case "dep_changed": s = t.depChanged(a.other ?? "", dep); break;
    case "dep_removed": s = t.depRemoved(a.other ?? ""); break;
    default:
      switch (a.field) {
        case "title": s = t.titleChanged(a.from ?? "", a.to ?? ""); break;
        case "status": s = t.status(sv.status[(a.from ?? "") as keyof typeof sv.status] ?? a.from ?? "", sv.status[(a.to ?? "") as keyof typeof sv.status] ?? a.to ?? ""); break;
        case "priority": s = t.priority(sv.panel.priorities[(a.from ?? "") as keyof typeof sv.panel.priorities] ?? a.from ?? "", sv.panel.priorities[(a.to ?? "") as keyof typeof sv.panel.priorities] ?? a.to ?? ""); break;
        case "assignee": s = t.assignee(a.from || t.none, a.to || t.none); break;
        case "assignees": s = t.assignees(a.from || t.none, a.to || t.none); break;
        case "estimate": s = t.estimate(a.from || t.none, a.to || t.none); break;
        case "dates": s = t.dates(a.from ?? "", a.to ?? ""); break;
        case "progress": s = t.progress(a.from ?? "", a.to ?? ""); break;
        case "description": s = t.description; break;
        case "labels": s = t.labels; break;
        case "checklist": s = t.checklist; break;
        case "links": s = t.links; break;
        case "fields": s = t.fields; break;
        case "color": s = t.color; break;
        default: s = t.other;
      }
  }
  return `${s}${a.auto ? ` ${t.auto}` : ""}${a.undo ? ` ${t.undo}` : ""}`;
}
