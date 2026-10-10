import { useCallback, useEffect, useState } from "react";
import type { DataStore } from "../data/DataStore";
import type { Dependency, Item } from "../data/types";

export type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: Item[]; deps: Dependency[] };

/** Alla läsningar går via DataStore. Biblioteken får aldrig fixturen direkt. */
export function useProjectData(store: DataStore, projectId: string | null) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (projectId === null) { setState({ kind: "ready", items: [], deps: [] }); return; }
    let cancelled = false;
    setState({ kind: "loading" });
    Promise.all([store.listItems(projectId), store.listDependencies(projectId)])
      .then(([items, deps]) => {
        if (cancelled) return;
        performance.mark("data-ready");
        setState({ kind: "ready", items, deps });
      })
      .catch((e: unknown) => !cancelled && setState({ kind: "error", message: e instanceof Error ? e.message : String(e) }));
    return () => { cancelled = true; };
  }, [store, projectId, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  /** Tyst omhämtning: visar inte "Laddar" och behåller det som syns tills nya data finns. Används efter drag och sparning. */
  const refresh = useCallback(async () => {
    if (projectId === null) return;
    try {
      const [items, deps] = await Promise.all([store.listItems(projectId), store.listDependencies(projectId)]);
      setState({ kind: "ready", items, deps });
    } catch { /* kvarvarande data är fortfarande giltiga, fel visas vid nästa vanliga laddning */ }
  }, [store, projectId]);
  return { state, reload, refresh };
}
