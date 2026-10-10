import { sv } from "../i18n/sv";
import { MemoryStore, type Snapshot } from "./MemoryStore";
import { validateItemShape } from "./rules";
import type { Fixture } from "./types";

/**
 * Lagring i webbläsaren (localStorage) bakom samma DataStore-gränssnitt som MemoryStore.
 * Första gången (eller efter att data rensats) läggs exempelprojektet in. Skadad lagrad data skrivs aldrig över:
 * den flyttas till en säkerhetskopia under `<nyckel>.backup` och exempeldata läggs in, och `loadWarning` talar om det.
 */
export class PersistentStore extends MemoryStore {
  /** Satt om något gick fel vid inläsning. Visas för användaren. */
  loadWarning: string | null = null;
  /** Satt om senaste sparningen misslyckades (full lagring, blockerad). Data finns då bara i minnet. */
  saveError: string | null = null;

  constructor(private key: string, seed: Fixture, private storage: Pick<Storage, "getItem" | "setItem"> = localStorage) {
    super(seed);
    let raw: string | null = null;
    try { raw = storage.getItem(key); } catch (e) { this.loadWarning = sv.persist.unreadable(String(e)); }
    if (raw !== null) {
      try {
        const snap = JSON.parse(raw) as Snapshot;
        PersistentStore.check(snap);
        this.restore(snap);
        return;
      } catch (e) {
        try { storage.setItem(`${key}.backup`, raw); } catch { /* ingen plats för säkerhetskopia */ }
        this.loadWarning = sv.persist.corrupt(key, e instanceof Error ? e.message : String(e));
      }
    }
    this.afterWrite(); // första gången: spara exempeldata
  }

  /** Kastar om data inte har rätt form eller bryter datamodellens regler. */
  private static check(s: Snapshot) {
    if (!s || !Array.isArray(s.projects) || !Array.isArray(s.items) || !Array.isArray(s.dependencies) || !Array.isArray(s.users) || typeof s.seq !== "number")
      throw new Error(sv.persist.badShape);
    const ids = new Set(s.items.map((i) => i.id));
    if (ids.size !== s.items.length) throw new Error(sv.persist.dupIds);
    for (const i of s.items) {
      validateItemShape(i);
      if (i.parent_id !== null && !ids.has(i.parent_id)) throw new Error(sv.persist.parentMissing(i.id));
    }
    for (const d of s.dependencies) if (!ids.has(d.from_item_id) || !ids.has(d.to_item_id)) throw new Error(sv.persist.depMissing(d.id));
  }

  protected override afterWrite(): void {
    if (!this.key) return; // körs från basklassens konstruktor innan fälten är satta
    try {
      this.storage.setItem(this.key, JSON.stringify(this.snapshot()));
      this.saveError = null;
    } catch (e) {
      this.saveError = `Det gick inte att spara: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
}
