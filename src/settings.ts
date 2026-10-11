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
}
export const DEFAULT_SETTINGS: Settings = { touch: "auto", closeOnEmpty: true, markUndated: true, startView: "gantt", startZoom: "week" };
const KEY = "projektplanerare.settings";
const pick = <T extends string>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);

export function normalizeSettings(raw: unknown): Settings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    touch: pick(o.touch, ["auto", "on", "off"], DEFAULT_SETTINGS.touch),
    closeOnEmpty: typeof o.closeOnEmpty === "boolean" ? o.closeOnEmpty : DEFAULT_SETTINGS.closeOnEmpty,
    markUndated: typeof o.markUndated === "boolean" ? o.markUndated : DEFAULT_SETTINGS.markUndated,
    startView: pick(o.startView, ["gantt", "wheel", "board"], DEFAULT_SETTINGS.startView),
    startZoom: pick(o.startZoom, ["day", "week", "month"], DEFAULT_SETTINGS.startZoom),
  };
}
export function loadSettings(): Settings {
  try { const raw = localStorage.getItem(KEY); return normalizeSettings(raw ? JSON.parse(raw) : null); } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* lagring kan vara blockerad */ }
}
