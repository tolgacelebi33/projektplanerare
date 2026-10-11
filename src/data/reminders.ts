import { addDays } from "./dates";
import type { ISODate, Item, Project } from "./types";

/** Påminnelser: det som är försenat, förfaller idag eller imorgon (poster som inte är klara, har riktigt datum och inte är grupper), över alla projekt. */
export interface DueEntry { project: Project; item: Item }
export interface DueSummary { overdue: DueEntry[]; today: DueEntry[]; tomorrow: DueEntry[]; total: number }
export type ReminderScope = "all" | "mine";

export function dueSummary(all: { project: Project; items: Item[] }[], today: ISODate, opts: { scope?: ReminderScope; me?: string | null } = {}): DueSummary {
  const tomorrow = addDays(today, 1);
  const out: DueSummary = { overdue: [], today: [], tomorrow: [], total: 0 };
  for (const { project, items } of all) {
    for (const item of items) {
      if (item.type === "epic" || item.status === "done" || item.undated) continue;
      if (opts.scope === "mine" && opts.me && item.assignee_id !== opts.me) continue;
      const e = { project, item };
      if (item.end < today) out.overdue.push(e);
      else if (item.end === today) out.today.push(e);
      else if (item.end === tomorrow) out.tomorrow.push(e);
    }
  }
  const byEnd = (a: DueEntry, b: DueEntry) => (a.item.end < b.item.end ? -1 : a.item.end > b.item.end ? 1 : a.item.title.localeCompare(b.item.title));
  out.overdue.sort(byEnd); out.today.sort(byEnd); out.tomorrow.sort(byEnd);
  out.total = out.overdue.length + out.today.length + out.tomorrow.length;
  return out;
}
