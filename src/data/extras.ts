import { GROUP_COLORS, LIMITS, type ChecklistEntry, type GroupColor, type Item, type LinkEntry, type LogEntry } from "./types";
import { isSafeUrl } from "./rules";

/** Färgen för en etikett: samma namn ger alltid samma färg (ur gruppernas palett). */
export function labelColor(name: string): GroupColor {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return GROUP_COLORS[h % GROUP_COLORS.length];
}

/** Alla etiketter som används i projektet, i bokstavsordning (till förslag i panelen och filtret). */
export function allLabels(items: Item[]): string[] {
  const seen = new Map<string, string>();
  for (const i of items) for (const l of i.labels ?? []) if (!seen.has(l.toLowerCase())) seen.set(l.toLowerCase(), l);
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "sv"));
}

/** Lägger till en etikett (trimmad, utan dubbletter oavsett versaler, högst gränsen). Returnerar null om inget ändras. */
export function addLabel(labels: string[] | undefined, raw: string): string[] | null {
  const l = raw.trim().replace(/\s+/g, " ").slice(0, LIMITS.labelLength);
  const cur = labels ?? [];
  if (!l || cur.some((x) => x.toLowerCase() === l.toLowerCase()) || cur.length >= LIMITS.labels) return null;
  return [...cur, l];
}

export const newChecklistId = () => `c_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/** Framsteg i procent ur en checklista (avbockade av alla), eller null om den är tom. */
export function checklistPercent(list: ChecklistEntry[] | undefined): number | null {
  if (!list?.length) return null;
  return Math.round((list.filter((c) => c.done).length / list.length) * 100);
}
export const checklistCount = (list: ChecklistEntry[] | undefined) => ({ done: (list ?? []).filter((c) => c.done).length, total: (list ?? []).length });

/** En länk från inmatning: utan skyddsprefix läggs https:// till. Returnerar null om den inte är tillåten (t.ex. javascript:). */
export function normalizeLink(rawUrl: string, title: string): LinkEntry | null {
  let url = rawUrl.trim();
  if (!url) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
  if (!isSafeUrl(url)) return null;
  return { title: title.trim().slice(0, LIMITS.linkTitle), url };
}
export function linkLabel(l: LinkEntry): string {
  if (l.title) return l.title;
  try { const u = new URL(l.url); return u.protocol === "mailto:" ? u.pathname : u.host + (u.pathname === "/" ? "" : u.pathname); } catch { return l.url; }
}

export function addLog(log: LogEntry[] | undefined, text: string, now: Date = new Date()): LogEntry[] | null {
  const t = text.trim().slice(0, LIMITS.logText);
  const cur = log ?? [];
  if (!t || cur.length >= LIMITS.log) return null;
  return [...cur, { at: now.toISOString(), text: t }];
}
/** Datum och klockslag för en loggrad, i lokal tid: ÅÅÅÅ-MM-DD TT:MM. */
export function logStamp(at: string): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
