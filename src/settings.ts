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
  /** Kolumner i en importerad fil som inte känns igen blir egna fält (annars text i beskrivningen). */
  importExtraAsFields: boolean;
}
export interface Features { labels: boolean; checklist: boolean; links: boolean; log: boolean }
export const DEFAULT_FEATURES: Features = { labels: true, checklist: true, links: true, log: true };
export interface CardFields { date: boolean; assignee: boolean; priority: boolean; description: boolean; series: boolean; progress: boolean; labels: boolean; checklist: boolean; links: boolean; lastUpdate: boolean }
export type BoardGroup = "status" | "assignee" | "priority" | "group" | `field:${string}`;
export const DEFAULT_CARD_FIELDS: CardFields = { date: true, assignee: true, priority: true, description: false, series: true, progress: false, labels: true, checklist: true, links: true, lastUpdate: false };
export const DEFAULT_SETTINGS: Settings = { touch: "auto", closeOnEmpty: true, markUndated: true, startView: "gantt", startZoom: "week", cardFields: { ...DEFAULT_CARD_FIELDS }, highlightOverdue: true, quickFilters: true, boardGroup: "status", features: { ...DEFAULT_FEATURES }, checklistProgress: false, hidePastSeries: false, importExtraAsFields: true };
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
    cardFields: ((c) => ({ date: bool(c.date, DEFAULT_CARD_FIELDS.date), assignee: bool(c.assignee, DEFAULT_CARD_FIELDS.assignee), priority: bool(c.priority, DEFAULT_CARD_FIELDS.priority), description: bool(c.description, DEFAULT_CARD_FIELDS.description), series: bool(c.series, DEFAULT_CARD_FIELDS.series), progress: bool(c.progress, DEFAULT_CARD_FIELDS.progress), labels: bool(c.labels, DEFAULT_CARD_FIELDS.labels), checklist: bool(c.checklist, DEFAULT_CARD_FIELDS.checklist), links: bool(c.links, DEFAULT_CARD_FIELDS.links), lastUpdate: bool(c.lastUpdate, DEFAULT_CARD_FIELDS.lastUpdate) }))((o.cardFields && typeof o.cardFields === "object" ? o.cardFields : {}) as Record<string, unknown>),
    highlightOverdue: bool(o.highlightOverdue, DEFAULT_SETTINGS.highlightOverdue),
    quickFilters: bool(o.quickFilters, DEFAULT_SETTINGS.quickFilters),
    boardGroup: typeof o.boardGroup === "string" && /^field:.{1,60}$/.test(o.boardGroup) ? (o.boardGroup as BoardGroup) : pick(o.boardGroup, ["status", "assignee", "priority", "group"], DEFAULT_SETTINGS.boardGroup),
    features: ((f) => ({ labels: bool(f.labels, true), checklist: bool(f.checklist, true), links: bool(f.links, true), log: bool(f.log, true) }))((o.features && typeof o.features === "object" ? o.features : {}) as Record<string, unknown>),
    checklistProgress: bool(o.checklistProgress, DEFAULT_SETTINGS.checklistProgress),
    hidePastSeries: bool(o.hidePastSeries, DEFAULT_SETTINGS.hidePastSeries),
    importExtraAsFields: bool(o.importExtraAsFields, DEFAULT_SETTINGS.importExtraAsFields),
  };
}
export function loadSettings(): Settings {
  try { const raw = localStorage.getItem(KEY); return normalizeSettings(raw ? JSON.parse(raw) : null); } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* lagring kan vara blockerad */ }
}
