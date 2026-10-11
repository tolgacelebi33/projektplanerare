/** Användarens inställningar, sparade i webbläsaren. Okända eller ogiltiga värden ersätts av standardvärdet, så en gammal eller trasig post kan aldrig stoppa appen. */
export interface Settings {
  /** Pekläge i Gantt: automatiskt (på enheter med enbart pekskärm), alltid på (dra med finger, men tooltips vid hovring försvinner), eller av. */
  touch: "auto" | "on" | "off";
  /** Ett klick på en tom yta stänger panelen och släpper markeringen. */
  closeOnEmpty: boolean;
  /** Poster som saknar riktiga datum (platshållare från import) får ett eget utseende. */
  markUndated: boolean;
  startView: "gantt" | "wheel" | "board";
  startZoom: "day" | "week" | "month";
  /** Vad som visas på korten i boarden. */
  cardFields: CardFields;
  /** Förfallna poster markeras i listan (understruket datum, inte bara färg). */
  highlightOverdue: boolean;
  /** Snabbfilter (Försenade, Denna vecka, Utan ansvarig, Utan datum) ovanför listan. */
  quickFilters: boolean;
  /** Vad boardens kolumner är. */
  boardGroup: BoardGroup;
  /** Vilka delar av posten som finns i panelen (de som är av syns inte, men data finns kvar). */
  features: Features;
  /** Checklistan styr framsteget: framsteg = andel avbockade punkter. */
  checklistProgress: boolean;
  /** Tillfällen i en serie som passerat (slutdatum före idag) döljs i vyerna. */
  hidePastSeries: boolean;
  /** Varje serie visas som en rad i listan, tidslinjen och boarden (tillfällena som markeringar). Av som standard: tillfällena är egna rader som kan flyttas var för sig. */
  collapseSeries: boolean;
  /** Visa en förhandsgranskning (kolumner, grupper, serier, antal) innan en fil läggs in. */
  importPreview: boolean;
  /** Påminnelser om det som är försenat eller förfaller idag eller imorgon (bara medan appen är öppen). `os`: också som systemnotis. */
  reminders: { banner: boolean; os: boolean; scope: "all" | "mine" };
  /** Person som skriver kommentarer (id), senast valda "Skriv som". */
  me: string;
  /** Påminnelse om säkerhetskopia efter så många dagar (0 = aldrig). */
  backupReminderDays: number;
  /** Baslinjen (om projektet har en) ritas som tunna staplar under de verkliga. */
  showBaseline: boolean;
  /** Enkla regler (inget eget regelspråk): fasta val som gäller alla poster. */
  rules: { doneSetsProgress: boolean; seriesNext: boolean };
  /** Kolumner i en importerad fil som inte känns igen blir egna fält (annars text i beskrivningen). */
  importExtraAsFields: boolean;
  /** Vilka av de extra vyerna som finns i vyväljaren "Fler vyer". */
  moreViews: Record<MoreView, boolean>;
  /** Belastning: id på ett talfält att summera ("" = antal poster). */
  workloadField: string;
  /** Belastning: en vecka över detta värde markeras (0 = ingen gräns). */
  workloadCap: number;
}
export type ViewId = "gantt" | "wheel" | "board" | "calendar" | "week" | "workload" | "portfolio";
export const MORE_VIEWS = ["calendar", "week", "workload", "portfolio"] as const;
export type MoreView = (typeof MORE_VIEWS)[number];
export interface Features { labels: boolean; checklist: boolean; links: boolean; log: boolean; comments: boolean }
export const DEFAULT_FEATURES: Features = { labels: true, checklist: true, links: true, log: true, comments: true };
export interface CardFields { date: boolean; assignee: boolean; priority: boolean; description: boolean; series: boolean; progress: boolean; labels: boolean; checklist: boolean; links: boolean; lastUpdate: boolean; code: boolean; comments: boolean; estimate: boolean }
export type BoardGroup = "status" | "assignee" | "priority" | "group" | `field:${string}`;
export const DEFAULT_CARD_FIELDS: CardFields = { date: true, assignee: true, priority: true, description: false, series: true, progress: false, labels: true, checklist: true, links: true, lastUpdate: false, code: false, comments: true, estimate: false };
export const DEFAULT_SETTINGS: Settings = { touch: "auto", closeOnEmpty: true, markUndated: true, startView: "gantt", startZoom: "week", cardFields: { ...DEFAULT_CARD_FIELDS }, highlightOverdue: true, quickFilters: true, boardGroup: "status", features: { ...DEFAULT_FEATURES }, checklistProgress: false, hidePastSeries: false, collapseSeries: false, importPreview: true, reminders: { banner: true, os: false, scope: "all" }, me: "", backupReminderDays: 30, showBaseline: true, rules: { doneSetsProgress: false, seriesNext: false }, importExtraAsFields: true, moreViews: { calendar: true, week: true, workload: true, portfolio: true }, workloadField: "", workloadCap: 5 };
const KEY = "projektplanerare.settings";
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const pick = <T extends string>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);

export function normalizeSettings(raw: unknown): Settings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    touch: pick(o.touch, ["auto", "on", "off"], DEFAULT_SETTINGS.touch),
    closeOnEmpty: typeof o.closeOnEmpty === "boolean" ? o.closeOnEmpty : DEFAULT_SETTINGS.closeOnEmpty,
    markUndated: typeof o.markUndated === "boolean" ? o.markUndated : DEFAULT_SETTINGS.markUndated,
    startView: pick(o.startView, ["gantt", "wheel", "board"], DEFAULT_SETTINGS.startView),
    startZoom: pick(o.startZoom, ["day", "week", "month"], DEFAULT_SETTINGS.startZoom),
    cardFields: ((c) => ({ date: bool(c.date, DEFAULT_CARD_FIELDS.date), assignee: bool(c.assignee, DEFAULT_CARD_FIELDS.assignee), priority: bool(c.priority, DEFAULT_CARD_FIELDS.priority), description: bool(c.description, DEFAULT_CARD_FIELDS.description), series: bool(c.series, DEFAULT_CARD_FIELDS.series), progress: bool(c.progress, DEFAULT_CARD_FIELDS.progress), labels: bool(c.labels, DEFAULT_CARD_FIELDS.labels), checklist: bool(c.checklist, DEFAULT_CARD_FIELDS.checklist), links: bool(c.links, DEFAULT_CARD_FIELDS.links), lastUpdate: bool(c.lastUpdate, DEFAULT_CARD_FIELDS.lastUpdate), code: bool(c.code, DEFAULT_CARD_FIELDS.code), comments: bool(c.comments, DEFAULT_CARD_FIELDS.comments), estimate: bool(c.estimate, DEFAULT_CARD_FIELDS.estimate) }))((o.cardFields && typeof o.cardFields === "object" ? o.cardFields : {}) as Record<string, unknown>),
    highlightOverdue: bool(o.highlightOverdue, DEFAULT_SETTINGS.highlightOverdue),
    quickFilters: bool(o.quickFilters, DEFAULT_SETTINGS.quickFilters),
    boardGroup: typeof o.boardGroup === "string" && /^field:.{1,60}$/.test(o.boardGroup) ? (o.boardGroup as BoardGroup) : pick(o.boardGroup, ["status", "assignee", "priority", "group"], DEFAULT_SETTINGS.boardGroup),
    features: ((f) => ({ labels: bool(f.labels, true), checklist: bool(f.checklist, true), links: bool(f.links, true), log: bool(f.log, true), comments: bool(f.comments, true) }))((o.features && typeof o.features === "object" ? o.features : {}) as Record<string, unknown>),
    checklistProgress: bool(o.checklistProgress, DEFAULT_SETTINGS.checklistProgress),
    hidePastSeries: bool(o.hidePastSeries, DEFAULT_SETTINGS.hidePastSeries),
    collapseSeries: bool(o.collapseSeries, DEFAULT_SETTINGS.collapseSeries),
    importPreview: bool(o.importPreview, DEFAULT_SETTINGS.importPreview),
    reminders: ((r) => ({ banner: bool(r.banner, true), os: bool(r.os, false), scope: r.scope === "mine" ? ("mine" as const) : ("all" as const) }))((o.reminders && typeof o.reminders === "object" ? o.reminders : {}) as Record<string, unknown>),
    me: typeof o.me === "string" && o.me.length <= 100 ? o.me : "",
    backupReminderDays: [0, 7, 14, 30, 90].includes(o.backupReminderDays as number) ? (o.backupReminderDays as number) : DEFAULT_SETTINGS.backupReminderDays,
    showBaseline: bool(o.showBaseline, DEFAULT_SETTINGS.showBaseline),
    rules: ((r) => ({ doneSetsProgress: bool(r.doneSetsProgress, false), seriesNext: bool(r.seriesNext, false) }))((o.rules && typeof o.rules === "object" ? o.rules : {}) as Record<string, unknown>),
    importExtraAsFields: bool(o.importExtraAsFields, DEFAULT_SETTINGS.importExtraAsFields),
    moreViews: ((m) => ({ calendar: bool(m.calendar, true), week: bool(m.week, true), workload: bool(m.workload, true), portfolio: bool(m.portfolio, true) }))((o.moreViews && typeof o.moreViews === "object" ? o.moreViews : {}) as Record<string, unknown>),
    workloadField: typeof o.workloadField === "string" && o.workloadField.length <= 60 ? o.workloadField : "",
    workloadCap: typeof o.workloadCap === "number" && Number.isInteger(o.workloadCap) && o.workloadCap >= 0 && o.workloadCap <= 999 ? o.workloadCap : DEFAULT_SETTINGS.workloadCap,
  };
}
export function loadSettings(): Settings {
  try { const raw = localStorage.getItem(KEY); return normalizeSettings(raw ? JSON.parse(raw) : null); } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* lagring kan vara blockerad */ }
}
