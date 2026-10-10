import type { Snapshot } from "./MemoryStore";
import type { Patch } from "./patch";

/** Det som sparas: innehållet, ångra-historiken och en version av dataformatet (för framtida migreringar). */
export interface Stored {
  schema: number;
  /** Löpnummer som ökar för varje sparning. Avgör vilken kopia som är nyast (tidsstämpeln har bara millisekunders upplösning). */
  rev?: number;
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
  /**
   * Säkerhetsnät för när sidan stängs eller laddas om medan en sparning pågår: skriver det osparade läget synkront (det enda som hinner före en omladdning)
   * till en reservplats. Vid nästa start läses reservkopian in om den är nyare än det sparade, och rensas. Bästa möjliga: kan misslyckas om utrymmet är slut.
   */
  rescueSync?(s: Stored): void;
  loadRescue?(): unknown | null;
  clearRescue?(): void;
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
  rescue: unknown | null = null;
  rescueSync(s: Stored) { this.rescue = structuredClone(s); }
  loadRescue() { return this.rescue === null ? null : structuredClone(this.rescue); }
  clearRescue() { this.rescue = null; }
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
  // localStorage skriver redan synkront, så reservkopian är bara en vanlig sparning direkt
  rescueSync(s: Stored) { try { this.storage.setItem(this.key, JSON.stringify(s)); } catch { /* ignoreras */ } }
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
  // Reservkopian ligger i localStorage (synkront, så den hinner före en omladdning), som en JSON-sträng
  private static RESCUE = "projektplanerare.rescue";
  rescueSync(s: Stored) { try { localStorage.setItem(IdbBackend.RESCUE, JSON.stringify(s)); } catch { /* utrymmet slut: bästa möjliga */ } }
  loadRescue(): unknown | null { try { const r = localStorage.getItem(IdbBackend.RESCUE); return r === null ? null : (JSON.parse(r) as unknown); } catch { return null; } }
  clearRescue() { try { localStorage.removeItem(IdbBackend.RESCUE); } catch { /* ignoreras */ } }
}
