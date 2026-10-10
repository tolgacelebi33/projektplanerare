import type { Snapshot } from "./MemoryStore";
import type { Patch } from "./patch";

/** Det som sparas: innehållet, ångra-historiken och en version av dataformatet (för framtida migreringar). */
export interface Stored {
  schema: number;
  saved_at: string;
  snapshot: Snapshot;
  history?: { undo: Patch[]; redo: Patch[] };
}
export const SCHEMA = 1;

/** Lagringen innehöll något som inte går att läsa (t.ex. trasig JSON). `raw` är det som fanns, så att det kan sparas undan. */
export class CorruptError extends Error { constructor(public raw: unknown, msg = "skadad data") { super(msg); } }

/** Där data bor. Alla anrop är asynkrona så att IndexedDB (och en framtida server) kan använda samma gränssnitt som localStorage. */
export interface Backend {
  readonly kind: "indexeddb" | "localstorage" | "memory";
  /** Sätts om backend är en reserv (t.ex. IndexedDB saknas), så att det kan visas för användaren. */
  note?: string;
  /** Null om inget är sparat. Kastar CorruptError om det som finns inte går att tolka. */
  load(): Promise<unknown | null>;
  save(s: Stored): Promise<void>;
  /** Sparar undan data som inte gick att läsa, så att den aldrig skrivs över. */
  saveBackup(raw: unknown): Promise<void>;
}

/** Lagring i minnet (tester, och när ingenting annat går). Kan simulera fel. */
export class MemoryBackend implements Backend {
  readonly kind = "memory" as const;
  data: unknown | null; backup: unknown | null = null; saves = 0; failSave: string | null = null; failLoad: string | null = null;
  constructor(initial: unknown | null = null) { this.data = initial; }
  async load() { if (this.failLoad) throw new Error(this.failLoad); return this.data === null ? null : structuredClone(this.data); }
  async save(s: Stored) { if (this.failSave) throw new Error(this.failSave); this.data = structuredClone(s); this.saves++; }
  async saveBackup(raw: unknown) { this.backup = raw; }
}

/** localStorage (ca 5 MB): reserv när IndexedDB saknas, och källan vid migrering från den första versionen. */
export class LocalStorageBackend implements Backend {
  readonly kind = "localstorage" as const;
  note?: string;
  constructor(private key: string, private storage: Pick<Storage, "getItem" | "setItem"> = localStorage) {}
  async load() {
    const raw = this.storage.getItem(this.key);
    if (raw === null) return null;
    try { return JSON.parse(raw) as unknown; } catch { throw new CorruptError(raw); }
  }
  async save(s: Stored) { this.storage.setItem(this.key, JSON.stringify(s)); }
  async saveBackup(raw: unknown) { try { this.storage.setItem(`${this.key}.backup`, typeof raw === "string" ? raw : JSON.stringify(raw)); } catch { /* ingen plats för säkerhetskopia */ } }
}

const STORE = "kv";
/** IndexedDB: mycket större utrymme än localStorage, och lagrar objekt direkt. Ett värde under nyckeln "state", trasig data under "state.backup". */
export class IdbBackend implements Backend {
  readonly kind = "indexeddb" as const;
  private constructor(private db: IDBDatabase) { db.onversionchange = () => db.close(); }
  static open(name = "projektplanerare", timeoutMs = 5000): Promise<IdbBackend> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB finns inte")); return; }
      const timer = setTimeout(() => reject(new Error("IndexedDB svarade inte")), timeoutMs);
      let req: IDBOpenDBRequest;
      try { req = indexedDB.open(name, 1); } catch (e) { clearTimeout(timer); reject(e); return; }
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => { clearTimeout(timer); resolve(new IdbBackend(req.result)); };
      req.onerror = () => { clearTimeout(timer); reject(req.error ?? new Error("IndexedDB kunde inte öppnas")); };
      req.onblocked = () => { clearTimeout(timer); reject(new Error("IndexedDB är blockerad av en annan flik")); };
    });
  }
  private run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      let result: T;
      req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? req.error ?? new Error("IndexedDB-fel"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB avbröt skrivningen"));
    });
  }
  async load() { const v = await this.run("readonly", (s) => s.get("state")); return v === undefined ? null : v; }
  async save(s: Stored) { await this.run("readwrite", (st) => st.put(s, "state")); }
  async saveBackup(raw: unknown) { try { await this.run("readwrite", (st) => st.put(raw, "state.backup")); } catch { /* ignoreras */ } }
}
