import { sv } from "../i18n/sv";
import { CorruptError, LocalStorageBackend, MemoryBackend, SCHEMA, type Backend, type Stored } from "./backends";
import { MemoryStore, type Snapshot } from "./MemoryStore";
import { validateItemShape } from "./rules";
import type { Fixture } from "./types";

/** Den första versionens lagring (localStorage) som läses en gång och flyttas till den nya. Den gamla kopian raderas aldrig av appen. */
export interface Legacy {
  read(): string | null;
  /** Sparar undan trasig gammal data. */
  backup(raw: string): void;
  /** Anropas när flytten är kontrollerad. */
  migrated(): void;
  /** Reserv om den nya lagringen inte går att kontrollera: fortsätt spara som förut. */
  fallback(): Backend;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Innehållet sparas via en `Backend` (IndexedDB som standard, localStorage som reserv) bakom samma DataStore-gränssnitt som MemoryStore.
 * Laddningen är asynkron (`ready`). Första gången läggs exempelprojektet in. Data som inte går att läsa skrivs aldrig över: den sparas undan,
 * en varning visas och exempeldata läggs in. Går det inte att läsa alls (fel, inte trasig data) sparas ingenting, för att inte skriva över det som finns.
 * Ångra-historiken sparas tillsammans med innehållet och finns kvar efter omladdning.
 */
export class PersistentStore extends MemoryStore {
  /** Satt om något gick fel vid inläsning. Visas för användaren. */
  loadWarning: string | null = null;
  /** Satt om senaste sparningen misslyckades (full lagring, blockerad). Data finns då bara i minnet. */
  saveError: string | null = null;
  /** Webbläsaren har lovat att inte rensa lagringen av sig själv (sätts av appen när den frågat). */
  persistGranted: boolean | null = null;
  override ready: Promise<void>;
  private backend!: Backend;
  private loaded = false;
  private rescued = false;
  private rev = 0;
  private readOnly = false;
  private latest: Stored | null = null;
  private saving = false;
  private pending: Promise<void> = Promise.resolve();

  constructor(seed: Fixture, private getBackend: () => Promise<Backend> | Backend, private legacy: Legacy | null = null) {
    super(seed);
    this.ready = this.init();
  }

  /** Kastar om data inte har rätt form eller bryter datamodellens regler. */
  static check(s: Snapshot) {
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

  /** Både den nya formen ({ snapshot, history }) och den första versionens (bara innehållet) godtas. */
  private static normalize(raw: unknown): { snapshot: Snapshot; history: unknown } {
    const o = raw as { snapshot?: Snapshot; history?: unknown } | null;
    const snapshot = (o && o.snapshot ? o.snapshot : raw) as Snapshot;
    PersistentStore.check(snapshot);
    return { snapshot, history: o && o.snapshot ? o.history : undefined };
  }

  private stored(): Stored {
    return { schema: SCHEMA, rev: ++this.rev, saved_at: new Date().toISOString(), snapshot: this.snapshot(), history: this.getHistory() };
  }

  private async init(): Promise<void> {
    try { this.backend = await this.getBackend(); }
    catch (e) { this.backend = new MemoryBackend(); this.readOnly = true; this.loadWarning = sv.persist.readFailed(msg(e)); this.finish(); return; }
    if (this.backend.note) this.loadWarning = this.backend.note;

    let raw: unknown = null;
    try { raw = await this.backend.load(); raw = this.newer(raw); }
    catch (e) {
      if (e instanceof CorruptError) { await this.setAside(e.raw, e.message); }
      else { this.readOnly = true; this.loadWarning = sv.persist.readFailed(msg(e)); this.finish(); return; } // skriv aldrig över något som inte gick att läsa
    }

    if (raw !== null) {
      try {
        const { snapshot, history } = PersistentStore.normalize(raw);
        this.rev = (raw as { rev?: number }).rev ?? 0; // löpnumret fortsätter där det slutade
        this.restore(snapshot); this.setHistory(history);
        this.finish(this.rescued); // en återställd reservkopia sparas i den vanliga lagringen
        return;
      }
      catch (e) { await this.setAside(raw, msg(e)); }
    } else if (this.legacy) {
      const old = this.legacy.read();
      if (old !== null) {
        let valid: { snapshot: Snapshot; history: unknown } | null = null;
        try { valid = PersistentStore.normalize(JSON.parse(old)); }
        catch (e) { this.legacy.backup(old); this.loadWarning = sv.persist.corrupt("projektplanerare.data.v1", msg(e)); } // trasig gammal data: undan, börja om
        if (valid) {
          try {
            this.restore(valid.snapshot); this.setHistory(valid.history);
            await this.backend.save(this.stored());
            const back = PersistentStore.normalize(await this.backend.load()); // det som sparades ska gå att läsa tillbaka lika
            if (JSON.stringify(back.snapshot) !== JSON.stringify(valid.snapshot)) throw new Error("verifiering misslyckades");
            this.legacy.migrated();
          } catch (e) {
            // flytten kunde inte kontrolleras: fortsätt spara i den gamla lagringen, som är orörd
            this.loadWarning = sv.persist.migrationFailed(msg(e));
            this.backend = this.legacy.fallback();
          }
          this.finish(); return;
        }
      }
    }
    // inget sparat, eller trasigt: exempeldata (som redan ligger i minnet från konstruktorn) sparas som första tillstånd
    this.finish(true);
  }

  /**
   * Reservkopian (se Backend.rescueSync) gäller om den är nyare än det sparade: då avbröts en sparning av en omladdning. Den rensas när den lästs.
   * Går den inte att tolka ignoreras den (det sparade gäller).
   */
  private newer(saved: unknown): unknown {
    const rescue = this.backend.loadRescue?.() ?? null;
    if (rescue === null) return saved;
    try {
      PersistentStore.normalize(rescue);
      const num = (x: unknown) => (x && typeof x === "object" && typeof (x as { rev?: unknown }).rev === "number" ? (x as { rev: number }).rev : null);
      const at = (x: unknown) => (x && typeof x === "object" && "saved_at" in x ? String((x as { saved_at: unknown }).saved_at) : "");
      // Löpnumret avgör (tidsstämpeln räcker inte: samma millisekund), tidsstämpeln om något av dem saknar löpnummer
      const rescueIsNewer = num(rescue) !== null && num(saved) !== null ? num(rescue)! > num(saved)! : at(rescue) >= at(saved);
      if (saved === null || rescueIsNewer) { this.rescued = true; return rescue; }
    } catch { /* trasig reservkopia: ignoreras */ }
    this.backend.clearRescue?.();
    return saved;
  }

  /** Trasig data sparas undan, aldrig över. */
  private async setAside(raw: unknown, reason: string) {
    await this.backend.saveBackup(raw);
    this.loadWarning = sv.persist.corrupt(`${this.backend.kind === "localstorage" ? "projektplanerare.data.v1" : "projektplanerare"}`, reason);
  }

  private finish(writeInitial = false) {
    this.loaded = true;
    if (writeInitial && !this.readOnly) this.afterWrite();
    this.notify();
  }

  protected override afterWrite(): void {
    if (!this.loaded || this.readOnly) return;
    this.latest = this.stored();
    if (this.saving) return; // en sparning pågår: den tar det senaste läget när den är klar
    this.saving = true;
    this.pending = (async () => {
      try {
        while (this.latest) {
          const s = this.latest; this.latest = null;
          try { await this.backend.save(s); if (!this.latest) this.backend.clearRescue?.(); if (this.saveError) { this.saveError = null; this.notify(); } }
          catch (e) { this.saveError = `${sv.panel.errors.unknown} ${msg(e)}`; this.notify(); }
        }
      } finally { this.saving = false; }
    })();
  }

  /**
   * Anropas när sidan göms eller stängs: finns osparade ändringar (en sparning pågår eller väntar) skrivs det senaste läget synkront till reservplatsen,
   * eftersom en asynkron sparning kan avbrytas av en omladdning (då skulle bara en äldre mellanversion ligga kvar).
   */
  rescueSync(): void {
    if (!this.loaded || this.readOnly || (!this.saving && !this.latest)) return;
    this.backend.rescueSync?.(this.stored());
  }

  /** Väntar tills allt som ändrats är sparat. */
  flush(): Promise<void> { return this.pending; }
}

export { LocalStorageBackend };
