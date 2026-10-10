import { sv } from "../i18n/sv";
import { todayISO } from "./dates";
import { fileSlug, templateCsv, toCsv, toJson, toParsed, type ParsedProject } from "./exchange";
import type { MemoryStore } from "./MemoryStore";
import type { Project } from "./types";

export type ExportFormat = "json" | "csv" | "template";

export async function exportProject(store: MemoryStore, projectId: string, format: ExportFormat) {
  if (format === "template") return { filename: sv.ex.templateFile, mime: "text/csv;charset=utf-8", text: templateCsv() };
  const project = (await store.listProjects()).find((p) => p.id === projectId);
  if (!project) throw new Error(sv.ex.projectGone);
  const [items, deps, users] = await Promise.all([store.listItems(projectId), store.listDependencies(projectId), store.listUsers()]);
  const parsed = toParsed(project, items, deps, users);
  const date = todayISO();
  const base = `${fileSlug(project.name)}-${date}`;
  return format === "json"
    ? { filename: `${base}.json`, mime: "application/json", text: toJson(parsed, new Date().toISOString()) }
    : { filename: `${base}.csv`, mime: "text/csv;charset=utf-8", text: toCsv(parsed) };
}

export interface ImportResult { project: Project; created: number; skippedDeps: string[]; warnings: string[] }

/**
 * Lägger in en tolkad fil som ett nytt projekt (aldrig i ett befintligt, så att inget kan skrivas över). Projektet skapas med beroendeläget
 * "none" medan posterna läggs in, så att inga datum flyttas, och får sitt riktiga läge sist. Går något fel tas det halvfärdiga projektet bort.
 * Beroenden som lagret avvisar (cykel, dubblett) hoppas över och redovisas.
 */
export async function importParsed(store: MemoryStore, workspaceId: string, parsed: ParsedProject, nameOverride?: string): Promise<ImportResult> {
  const users = await store.listUsers();
  const warnings = [...parsed.warnings];
  const byName = new Map(users.map((u) => [u.name.trim().toLowerCase(), u.id]));
  const unknown = new Set<string>();
  const project = await store.createProject({ workspace_id: workspaceId, name: (nameOverride ?? parsed.name).trim().slice(0, 100) || sv.ex.defaultName, dependency_mode: "none" });
  try {
    // föräldrar före barn
    const byId = new Map(parsed.items.map((i) => [i.id, i]));
    const depth = (id: string): number => { let d = 0; for (let c = byId.get(id); c?.parent_id; c = byId.get(c.parent_id)) d++; return d; };
    const ordered = [...parsed.items].sort((a, b) => depth(a.id) - depth(b.id) || a.sort_order - b.sort_order);
    const idMap = new Map<string, string>();
    for (const it of ordered) {
      const { id, assignee, parent_id, ...rest } = it;
      // Flera ansvariga kan stå i samma cell (A; B eller A/B). Första som är en känd användare blir ansvarig, resten (och okända) hamnar i beskrivningen.
      let assignee_id: string | null = null;
      const left: string[] = [];
      for (const nm of (assignee ?? "").split(/\s*[;|/]\s*/).map((x) => x.trim()).filter(Boolean)) {
        const uid = byName.get(nm.toLowerCase());
        if (uid && !assignee_id) assignee_id = uid; else { left.push(nm); if (!uid) unknown.add(nm); }
      }
      if (left.length) rest.description = [rest.description.trimEnd(), `${sv.ex.meta.assignees}: ${left.join("; ")}`].filter(Boolean).join("\n\n").slice(0, 5000);
      const made = await store.createItem({ ...rest, workspace_id: workspaceId, project_id: project.id, parent_id: parent_id ? idMap.get(parent_id)! : null, assignee_id });
      idMap.set(id, made.id);
    }
    const skippedDeps: string[] = [];
    for (const d of parsed.deps) {
      try { await store.createDependency({ workspace_id: workspaceId, from_item_id: idMap.get(d.from)!, to_item_id: idMap.get(d.to)!, type: "finish_to_start" }); }
      catch { skippedDeps.push(`${byId.get(d.from)?.title ?? d.from} -> ${byId.get(d.to)?.title ?? d.to}`); }
    }
    if (unknown.size) warnings.push(sv.ex.unknownAssignees([...unknown].join(", ")));
    const final = parsed.dependency_mode === "none" ? project : await store.updateProject(project.id, { dependency_mode: parsed.dependency_mode });
    store.clearHistory();
    return { project: final, created: parsed.items.length, skippedDeps, warnings };
  } catch (e) {
    await store.deleteProject(project.id).catch(() => undefined);
    throw e;
  }
}

/** Kopia av ett projekt (poster, hierarki, beroenden, läge) som ett nytt projekt. */
export async function duplicateProject(store: MemoryStore, workspaceId: string, projectId: string): Promise<ImportResult> {
  const project = (await store.listProjects()).find((p) => p.id === projectId);
  if (!project) throw new Error(sv.ex.projectGone);
  const [items, deps, users] = await Promise.all([store.listItems(projectId), store.listDependencies(projectId), store.listUsers()]);
  return importParsed(store, workspaceId, toParsed(project, items, deps, users), sv.ex.copy(project.name));
}
