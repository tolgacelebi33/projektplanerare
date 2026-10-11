import { sv } from "../i18n/sv";
import { friendlyError } from "../i18n/errors";
import { ImportError, parseJson, toJson, toParsed, type ParsedProject } from "./exchange";
import { importParsed } from "./importExport";
import type { MemoryStore } from "./MemoryStore";

/**
 * Säkerhetskopia: alla projekt (poster, beroenden, egna fält, vyer, baslinje) och personerna i en fil. Varje projekt är en vanlig JSON-export, så filen går
 * igenom samma kontroller som en import. Återställning läggs alltid till som nya projekt (aldrig över det som finns), så den kan inte förstöra något.
 */
export const BACKUP_FORMAT = "projektplanerare-backup";
export const MAX_BACKUP_BYTES = 50_000_000;
export const MAX_BACKUP_PROJECTS = 200;

export interface BackupSummary {
  exportedAt: string;
  users: string[];
  projects: { name: string; items: number; parsed: ParsedProject }[];
  items: number;
}

export async function buildBackup(store: MemoryStore, now: Date): Promise<{ filename: string; mime: string; text: string; projects: number; items: number }> {
  const [projects, users] = await Promise.all([store.listProjects(), store.listUsers()]);
  const out: unknown[] = [];
  let items = 0;
  for (const p of projects) {
    const [it, deps, comments] = await Promise.all([store.listItems(p.id), store.listDependencies(p.id), store.listComments(p.id)]);
    items += it.length;
    out.push(JSON.parse(toJson(toParsed(p, it, deps, users, comments, await store.listActivity(p.id), (await store.listStatusUpdates()).filter((u) => u.project_id === p.id)), now.toISOString())));
  }
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return {
    filename: `projektplanerare-sakerhetskopia-${date}.json`, mime: "application/json", projects: projects.length, items,
    text: JSON.stringify({ format: BACKUP_FORMAT, version: 1, exported_at: now.toISOString(), users: users.map((u) => u.name), projects: out }, null, 1),
  };
}

export function parseBackup(text: string): BackupSummary {
  if (text.length > MAX_BACKUP_BYTES) throw new ImportError(sv.backup.tooBig);
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new ImportError(sv.backup.notBackup); }
  const o = raw as { format?: unknown; version?: unknown; exported_at?: unknown; users?: unknown; projects?: unknown } | null;
  if (!o || typeof o !== "object" || o.format !== BACKUP_FORMAT) throw new ImportError(sv.backup.notBackup);
  if (o.version !== 1) throw new ImportError(sv.backup.version(String(o.version)));
  if (!Array.isArray(o.projects) || o.projects.length > MAX_BACKUP_PROJECTS) throw new ImportError(sv.backup.tooManyProjects(MAX_BACKUP_PROJECTS));
  const users = Array.isArray(o.users) ? o.users.filter((u): u is string => typeof u === "string" && u.trim().length > 0 && u.length <= 60).slice(0, 100) : [];
  const projects = o.projects.map((p, i) => {
    let parsed: ParsedProject;
    try { parsed = parseJson(JSON.stringify(p)); } catch (e) { throw new ImportError(sv.backup.projectBroken(i + 1, e instanceof Error ? e.message : String(e))); }
    return { name: parsed.name, items: parsed.items.length, parsed };
  });
  return { exportedAt: typeof o.exported_at === "string" ? o.exported_at : "", users, projects, items: projects.reduce((n, p) => n + p.items, 0) };
}

export interface RestoreResult { projects: number; items: number; warnings: string[]; firstProjectId: string | null }

export async function restoreBackup(store: MemoryStore, workspaceId: string, b: BackupSummary): Promise<RestoreResult> {
  const warnings: string[] = [];
  // Personer som saknas läggs till (på namn), så att tilldelningarna följer med
  const have = new Set((await store.listUsers()).map((u) => u.name.trim().toLowerCase()));
  for (const name of b.users) {
    if (have.has(name.trim().toLowerCase())) continue;
    try { await store.addUser(name); have.add(name.trim().toLowerCase()); } catch (e) { warnings.push(`${name}: ${friendlyError(e)}`); }
  }
  let made = 0, items = 0, first: string | null = null;
  for (const p of b.projects) {
    const taken = new Set((await store.listProjects()).map((x) => x.name.trim().toLowerCase()));
    let name = p.name, n = 2;
    if (taken.has(name.trim().toLowerCase())) { name = sv.backup.restoredName(p.name); while (taken.has(name.trim().toLowerCase())) name = `${sv.backup.restoredName(p.name)} ${n++}`; }
    try {
      const r = await importParsed(store, workspaceId, p.parsed, name.slice(0, 100));
      made++; items += r.created; first ??= r.project.id;
      warnings.push(...r.warnings.map((w) => `${p.name}: ${w}`), ...r.skippedDeps.map((d) => `${p.name}: ${sv.backup.skippedDep(d)}`));
    } catch (e) { warnings.push(`${p.name}: ${friendlyError(e)}`); }
  }
  if (!made && b.projects.length) throw new ImportError(warnings.join(" "));
  return { projects: made, items, warnings, firstProjectId: first };
}

const LAST_KEY = "projektplanerare.lastBackup";
const SEEN_KEY = "projektplanerare.firstSeen";
export const REMINDER_CHOICES = [0, 7, 14, 30, 90] as const;

/** När den senaste säkerhetskopian sparades i den här webbläsaren (ISO), eller null. */
export function lastBackupAt(): string | null { try { return localStorage.getItem(LAST_KEY); } catch { return null; } }
export function markBackupSaved(now: Date): void { try { localStorage.setItem(LAST_KEY, now.toISOString()); } catch { /* lagring blockerad */ } }
/** Första gången appen användes här (för påminnelsen: räknar från start om ingen säkerhetskopia sparats). Sätts vid första anropet. */
export function firstSeenAt(now: Date): string { try { const v = localStorage.getItem(SEEN_KEY); if (v) return v; localStorage.setItem(SEEN_KEY, now.toISOString()); } catch { /* ignoreras */ } return now.toISOString(); }
export const daysBetween = (fromIso: string, now: Date): number => Math.max(0, Math.floor((now.getTime() - new Date(fromIso).getTime()) / 86_400_000));
/** Dags att påminna? Bara om påminnelsen är på, det finns något att spara, och det gått minst så många dagar sedan senaste kopian (eller sedan första användningen). */
export function reminderDue(opts: { days: number; hasData: boolean; last: string | null; firstSeen: string; now: Date }): { due: boolean; since: number; never: boolean } {
  const from = opts.last ?? opts.firstSeen;
  const since = daysBetween(from, opts.now);
  return { due: opts.days > 0 && opts.hasData && since >= opts.days, since, never: !opts.last };
}
