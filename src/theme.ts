export type Theme = "standard" | "ljust" | "morkt";
export const THEMES: Theme[] = ["standard", "ljust", "morkt"];
const KEY = "projektplanerare.theme";

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v && (THEMES as string[]).includes(v)) return v as Theme;
  } catch { /* lagring kan vara blockerad */ }
  return "standard";
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* ignoreras */ }
}
