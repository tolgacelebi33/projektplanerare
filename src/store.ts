import { exampleAround, largeFixture, smallFixture } from "./data/fixtures";
import { todayISO } from "./data/dates";
import { IdbBackend, LocalStorageBackend, type Backend } from "./data/backends";
import { MemoryStore } from "./data/MemoryStore";
import { PersistentStore, type Legacy } from "./data/PersistentStore";
import { sv } from "./i18n/sv";

export interface AppStore { store: MemoryStore; persistent: boolean; workspaceId: string }

/** Den första versionens lagringsnyckel (localStorage). Läses en gång vid flytt till IndexedDB och raderas aldrig av appen. */
const LEGACY_KEY = "projektplanerare.data.v1";
const MIGRATED_KEY = "projektplanerare.idb.migrated";

/** IndexedDB om den går att använda, annars localStorage med en notis om att den rymmer mindre. */
async function openBackend(): Promise<Backend> {
  try { return await IdbBackend.open(); }
  catch { const b = new LocalStorageBackend(LEGACY_KEY); b.note = sv.persist.fallback; return b; }
}

const legacy: Legacy = {
  read: () => { try { return localStorage.getItem(LEGACY_KEY); } catch { return null; } },
  backup: (raw) => { try { localStorage.setItem(`${LEGACY_KEY}.backup`, raw); } catch { /* ingen plats */ } },
  migrated: () => { try { localStorage.setItem(MIGRATED_KEY, new Date().toISOString()); } catch { /* ignoreras */ } },
  fallback: () => new LocalStorageBackend(LEGACY_KEY),
};

/**
 * Med ?fixture=small|large används provdata i minnet (för tester och demo, sparas inte).
 * Utan parameter används lagring i webbläsaren (IndexedDB), och exempelprojektet läggs in första gången.
 */
export function createStore(params: URLSearchParams): AppStore {
  const fix = params.get("fixture");
  const latency = Number(params.get("latency") ?? (fix ? 50 : 0));
  if (fix) {
    const fixture = fix === "large" ? largeFixture() : smallFixture();
    return {
      store: new MemoryStore(fixture, { latencyMs: latency, failOnCall: params.get("fail") === "1" ? (_n, m) => m === "listItems" : undefined }),
      persistent: false, workspaceId: fixture.workspace.id,
    };
  }
  const seed = exampleAround(todayISO()); // exempelprojektet kring dagens datum, så att inget är försenat från start
  const store = new PersistentStore(seed, openBackend, legacy);
  // Be webbläsaren att inte rensa lagringen av sig själv, och spara det som väntar när fliken göms eller stängs (så gott det går)
  void store.ready.then(async () => {
    try { store.persistGranted = (await navigator.storage?.persist?.()) ?? null; } catch { store.persistGranted = null; }
    (store as unknown as { notify(): void }).notify();
  });
  if (typeof window !== "undefined") {
    const flush = () => void store.flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  }
  return { store, persistent: true, workspaceId: seed.workspace.id };
}

/** Exakt en instans per sida (React kan köra initieringen två gånger, och två butiker som sparar samtidigt vore farligt). */
let cached: AppStore | null = null;
export function getApp(params: URLSearchParams): AppStore {
  if (!cached) cached = createStore(params);
  return cached;
}
