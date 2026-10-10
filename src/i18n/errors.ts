import { RuleError } from "../data/rules";
import { sv } from "./sv";

/** Begriplig text (på valt språk) för ett fel från lagret eller reglerna. */
export function friendlyError(err: unknown): string {
  if (err instanceof RuleError) return err.code === "before_predecessor" && err.data?.date ? sv.panel.beforePredecessor(err.data.date) : sv.panel.errors[err.code] ?? err.message;
  return `${sv.panel.errors.unknown} ${err instanceof Error ? err.message : String(err)}`;
}
