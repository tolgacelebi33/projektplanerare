import { sv } from "../i18n/sv";
import { todayISO } from "./dates";
import { fileSlug, templateCsv, toCsv, toJson, toParsed, type ParsedProject } from "./exchange";
import type { MemoryStore } from "./MemoryStore";
import { newFieldId } from "./fields";
import type { FieldDef, Item, Project } from "./types";

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

export interface ImportResult { project: Project; created: number; skippedDeps: string[]; warnings: string[]; /** Första nya raden på översta nivån (för att visa den), eller null. */ firstItemId: string | null; /** Lades in i ett befintligt projekt (annars skapades ett nytt). */ merged: boolean }

/**
 * Lägger in en tolkad fil. Som standard i ett nytt projekt (så att inget kan skrivas över): projektet skapas med beroendeläget "none" medan
 * posterna läggs in, så att inga datum flyttas, och får sitt riktiga läge sist. Med `into` läggs posterna i det befintliga projektet i stället,
 * sist på sina nivåer, utan att något befintligt rörs. Då sätts beroendeläget tillfälligt till "none" av samma skäl och återställs sedan,
 * och hela importen är ett steg att ångra (historiken nollställs inte). Går något fel rullas allt tillbaka: det halvfärdiga projektet tas bort,
 * eller de nya posterna och beroendena i det befintliga projektet. Beroenden som lagret avvisar (cykel, dubblett) hoppas över och redovisas.
 */
export async function importParsed(store: MemoryStore, workspaceId: string, parsed: ParsedProject, nameOverride?: string, into?: string): Promise<ImportResult> {
  const users = await store.listUsers();
  const warnings = [...parsed.warnings];
  const byName = new Map(users.map((u) => [u.name.trim().toLowerCase(), u.id]));
  const unknown = new Set<string>();
  const existing = into ? (await store.listProjects()).find((p) => p.id === into) : undefined;
  if (into && !existing) throw new Error(sv.ex.projectGone);
  const originalMode = existing?.dependency_mode ?? "shift";
  const sortBase = into ? (await store.listItems(into)).reduce((m, i) => Math.max(m, i.sort_order), 0) : 0;
  const originalFields = existing?.fields;
  const project = existing ?? await store.createProject({ workspace_id: workspaceId, name: (nameOverride ?? parsed.name).trim().slice(0, 100) || sv.ex.defaultName, dependency_mode: "none" });
  const createdItems: string[] = [], createdDeps: string[] = [];
  try {
    if (existing && originalMode !== "none") await store.updateProject(project.id, { dependency_mode: "none" });
    // Egna fält: ett nytt projekt får filens fält och vyer som de är. I ett befintligt projekt förs fälten samman på namn (samma typ återanvänds, rullistans val läggs ihop), och posternas värden flyttas till rätt fält.
    const fieldMap = new Map<string, string>();
    if (parsed.fields?.length) {
      if (!existing) { for (const d of parsed.fields) fieldMap.set(d.id, d.id); await store.updateProject(project.id, { fields: parsed.fields, ...(parsed.views?.length ? { views: parsed.views } : {}) }); }
      else {
        const have: FieldDef[] = (existing.fields ?? []).map((d) => ({ ...d }));
        for (const d of parsed.fields) {
          const same = have.find((h) => h.name.trim().toLowerCase() === d.name.trim().toLowerCase() && h.type === d.type);
          if (same) {
            fieldMap.set(d.id, same.id);
            if (same.type === "select") for (const o of d.options ?? []) if (!(same.options ?? []).some((x) => x.toLowerCase() === o.toLowerCase())) same.options = [...(same.options ?? []), o];
          } else {
            let name = d.name, n = 2;
            while (have.some((h) => h.name.trim().toLowerCase() === name.trim().toLowerCase())) name = `${d.name} ${n++}`.slice(0, 40);
            const nd: FieldDef = { ...d, name, id: have.some((h) => h.id === d.id) ? newFieldId() : d.id };
            have.push(nd); fieldMap.set(d.id, nd.id);
          }
        }
        await store.updateProject(project.id, { fields: have });
      }
    }
    // föräldrar före barn
    const byId = new Map(parsed.items.map((i) => [i.id, i]));
    const depth = (id: string): number => { let d = 0; for (let c = byId.get(id); c?.parent_id; c = byId.get(c.parent_id)) d++; return d; };
    const ordered = [...parsed.items].sort((a, b) => depth(a.id) - depth(b.id) || a.sort_order - b.sort_order);
    const idMap = new Map<string, string>();
    for (const it of ordered) {
      const { id, assignee, parent_id, ...rest } = it;
      if (rest.fields) { const mapped: NonNullable<Item["fields"]> = {}; for (const [k, v] of Object.entries(rest.fields)) { const nk = fieldMap.get(k); if (nk) mapped[nk] = v; } rest.fields = Object.keys(mapped).length ? mapped : undefined; }
      // Flera ansvariga kan stå i samma cell (A; B eller A/B). Första som är en känd användare blir ansvarig, resten (och okända) hamnar i beskrivningen.
      let assignee_id: string | null = null;
      const left: string[] = [];
      for (const nm of (assignee ?? "").split(/\s*[;|/]\s*/).map((x) => x.trim()).filter(Boolean)) {
        const uid = byName.get(nm.toLowerCase());
        if (uid && !assignee_id) assignee_id = uid; else { left.push(nm); if (!uid) unknown.add(nm); }
      }
      if (left.length) rest.description = [rest.description.trimEnd(), `${sv.ex.meta.assignees}: ${left.join("; ")}`].filter(Boolean).join("\n\n").slice(0, 5000);
      const made = await store.createItem({ ...rest, sort_order: rest.sort_order + sortBase, workspace_id: workspaceId, project_id: project.id, parent_id: parent_id ? idMap.get(parent_id)! : null, assignee_id });
      idMap.set(id, made.id); createdItems.push(made.id);
    }
    const skippedDeps: string[] = [];
    for (const d of parsed.deps) {
      try { createdDeps.push((await store.createDependency({ workspace_id: workspaceId, from_item_id: idMap.get(d.from)!, to_item_id: idMap.get(d.to)!, type: "finish_to_start" })).id); }
      catch { skippedDeps.push(`${byId.get(d.from)?.title ?? d.from} -> ${byId.get(d.to)?.title ?? d.to}`); }
    }
    if (unknown.size) warnings.push(sv.ex.unknownAssignees([...unknown].join(", ")));
    const firstTop = [...parsed.items].filter((i) => !i.parent_id).sort((a, b) => a.sort_order - b.sort_order)[0];
    const firstItemId = firstTop ? idMap.get(firstTop.id) ?? null : null;
    if (existing) {
      const back = originalMode === "none" ? existing : await store.updateProject(project.id, { dependency_mode: originalMode });
      return { project: back, created: parsed.items.length, skippedDeps, warnings, firstItemId, merged: true };
    }
    const final = parsed.dependency_mode === "none" ? project : await store.updateProject(project.id, { dependency_mode: parsed.dependency_mode });
    store.clearHistory();
    return { project: final, created: parsed.items.length, skippedDeps, warnings, firstItemId, merged: false };
  } catch (e) {
    if (existing) {
      // Rulla tillbaka: de nya beroendena, sedan de nya posterna (barn före föräldrar), och projektets beroendeläge
      for (const id of createdDeps) await store.deleteDependency(id).catch(() => undefined);
      for (const id of [...createdItems].reverse()) await store.deleteItem(id).catch(() => undefined);
      await store.updateProject(project.id, { dependency_mode: originalMode, fields: originalFields ?? [] }).catch(() => undefined);
    } else await store.deleteProject(project.id).catch(() => undefined);
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
