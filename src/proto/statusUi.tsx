import { sv } from "../i18n/sv";
import type { Status } from "../data/types";

/** Ikon + text. Status signaleras aldrig enbart med färg. Ikonerna är enkla former, ersätts av Feather i fas 1. */
export const STATUS_GLYPH: Record<Status, string> = {
  not_started: "○",
  in_progress: "◐",
  done: "●",
  blocked: "■",
};

export function statusLabel(s: Status) {
  return `${STATUS_GLYPH[s]} ${sv.status[s]}`;
}
