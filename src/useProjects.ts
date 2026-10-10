import { useCallback, useEffect, useState } from "react";
import type { DataStore } from "./data/DataStore";
import type { DependencyMode, Project } from "./data/types";

const KEY = "projektplanerare.project";

/** Projektlista och valt projekt. Valet kommer ihåg till nästa gång. */
export function useProjects(store: DataStore, workspaceId: string) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (prefer?: string | null) => {
    try {
      const list = await store.listProjects();
      let saved: string | null = null;
      try { saved = localStorage.getItem(KEY); } catch { /* blockerad lagring */ }
      setProjects(list);
      setProjectId((cur) => {
        const want = prefer ?? cur ?? saved;
        return list.find((p) => p.id === want)?.id ?? list[0]?.id ?? null;
      });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [store]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (projectId) try { localStorage.setItem(KEY, projectId); } catch { /* ignoreras */ } }, [projectId]);

  return {
    projects, projectId, error, reload: (prefer?: string | null) => load(prefer),
    select: (id: string) => setProjectId(id),
    create: async (name: string) => { const p = await store.createProject({ workspace_id: workspaceId, name: name.trim() || "Nytt projekt" }); await load(p.id); return p; },
    rename: async (id: string, name: string) => { await store.updateProject(id, { name }); await load(id); },
    setDependencyMode: async (id: string, mode: DependencyMode) => { await store.updateProject(id, { dependency_mode: mode }); await load(id); },
    remove: async (id: string) => { await store.deleteProject(id); await load(null); },
  };
}
