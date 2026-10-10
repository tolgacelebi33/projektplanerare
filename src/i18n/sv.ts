import { svDict, type Dict } from "./dict-sv";
import { enDict } from "./en";

/**
 * Aktiv ordlista. Heter `sv` av historiska skäl men är den som gäller för valt språk (live-bindning: byts den når alla importörer den nya
 * vid nästa läsning, och appen monteras om vid språkbyte). Svenska är standard oavsett webbläsarens språk. Valet sparas.
 */
export type Lang = "sv" | "en";
export const LANGS: Lang[] = ["sv", "en"];
const KEY = "projektplanerare.lang";
const DICTS: Record<Lang, Dict> = { sv: svDict, en: enDict };

export function storedLang(): Lang {
  try { const v = localStorage.getItem(KEY); if (v === "sv" || v === "en") return v; } catch { /* lagring kan vara blockerad eller saknas */ }
  return "sv";
}

export let sv: Dict = DICTS[storedLang()];
export let lang: Lang = storedLang();

export function setLang(l: Lang): void {
  sv = DICTS[l]; lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* ignoreras */ }
  if (typeof document !== "undefined") document.documentElement.lang = l;
}
export { svDict, enDict };
