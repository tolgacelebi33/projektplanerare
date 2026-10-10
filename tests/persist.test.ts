import { describe, expect, it } from "vitest";
import { smallFixture } from "../src/data/fixtures";
import { MemoryStore } from "../src/data/MemoryStore";
import { PersistentStore, type Legacy } from "../src/data/PersistentStore";
import { LocalStorageBackend, MemoryBackend, type Backend } from "../src/data/backends";
import type { Item } from "../src/data/types";

const fakeStorage = (initial: Record<string, string> = {}) => {
  const m = new Map(Object.entries(initial));
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
};
const base = (o: Partial<Item>): Omit<Item, "id"> => ({
  workspace_id: "ws_1", project_id: "proj_1", parent_id: null, type: "task", title: "Ny", start: "2026-06-01", end: "2026-06-05",
  status: "not_started", assignee_id: null, description: "", priority: "normal", progress: 0, sort_order: 100, ...o,
});
/** Öppnar en lagrad butik och väntar på att den är inläst (som appen gör). */
const open = async (backend: Backend, seed = smallFixture(), legacy: Legacy | null = null) => { const s = new PersistentStore(seed, () => backend, legacy); await s.ready; return s; };

describe("PersistentStore", () => {
  it("första gången läggs exempelprojektet in och sparas, med versionsnummer", async () => {
    const be = new MemoryBackend();
    const s = await open(be);
    await s.flush();
    expect((await s.listItems("proj_1")).length).toBe(20);
    expect((be.data as { schema: number }).schema).toBe(1);
    expect(s.loadWarning).toBeNull();
  });
  it("ändringar överlever en ny instans (omladdning)", async () => {
    const be = new MemoryBackend();
    const a = await open(be);
    await a.updateItem("i7", { title: "Ändrad", progress: 90, priority: "urgent", description: "Text" });
    const created = await a.createItem(base({ parent_id: "i18", title: "Efteråt" }));
    await a.createDependency({ workspace_id: "ws_1", from_item_id: "i2", to_item_id: "i3", type: "finish_to_start" });
    await a.deleteItem("i20");
    const p = await a.createProject({ workspace_id: "ws_1", name: "Mitt eget" });
    await a.flush();
    const b = await open(be); // ny instans = omladdning
    const items = await b.listItems("proj_1");
    const i7 = items.find((i) => i.id === "i7")!;
    expect([i7.title, i7.progress, i7.priority, i7.description]).toEqual(["Ändrad", 90, "urgent", "Text"]);
    expect(items.some((i) => i.id === created.id)).toBe(true);
    expect(items.some((i) => i.id === "i20")).toBe(false);
    expect((await b.listDependencies("proj_1")).some((d) => d.from_item_id === "i2" && d.to_item_id === "i3")).toBe(true);
    expect((await b.listProjects()).map((x) => x.name)).toContain("Mitt eget");
    // nya id fortsätter räknas upp och krockar inte med sparade
    const again = await b.createItem(base({ title: "Ännu en" }));
    expect(new Set([...items.map((i) => i.id), again.id]).size).toBe(items.length + 1);
    expect(p.id).toBeTruthy();
  });
  it("härledda epic-datum sparas också", async () => {
    const be = new MemoryBackend();
    const f = smallFixture(); f.project = { ...f.project, dependency_mode: "none" }; // isolerar härledningen från flytt av efterföljare
    const a = await open(be, f);
    await a.updateItem("i14", { end: "2026-06-30" });
    await a.flush();
    const b = await open(be);
    expect((await b.listItems("proj_1")).find((i) => i.id === "i12")!.end).toBe("2026-06-30");
  });
  it("ångra-historiken sparas och finns kvar efter omladdning, och ångra fungerar då", async () => {
    const be = new MemoryBackend();
    const a = await open(be);
    await a.updateItem("i2", { title: "Första" });
    await new Promise((r) => setTimeout(r, 300));
    await a.updateItem("i2", { title: "Andra" });
    await a.flush();
    const b = await open(be);
    expect(b.canUndo).toBe(true);
    await b.undo();
    expect((await b.listItems("proj_1")).find((i) => i.id === "i2")!.title).toBe("Första");
    expect(b.canRedo).toBe(true);
    await b.flush();
    const c = await open(be); // även gör om-läget sparas
    expect(c.canRedo).toBe(true);
    await c.redo();
    expect((await c.listItems("proj_1")).find((i) => i.id === "i2")!.title).toBe("Andra");
  });
  it("skadad data skrivs aldrig över: säkerhetskopia, varning och exempeldata (localStorage)", async () => {
    const st = fakeStorage({ k: "{ det här är inte json" });
    const s = await open(new LocalStorageBackend("k", st));
    expect(s.loadWarning).toMatch(/skadad/);
    expect(st.m.get("k.backup")).toBe("{ det här är inte json");
    expect((await s.listItems("proj_1")).length).toBe(20);
  });
  it("data som bryter reglerna räknas som skadad (t.ex. slut före start) och sparas undan (minne)", async () => {
    const f = smallFixture();
    const snap = new MemoryStore(f).snapshot();
    snap.items[1] = { ...snap.items[1], start: "2026-03-10", end: "2026-03-01" };
    const be = new MemoryBackend({ schema: 1, saved_at: "x", snapshot: snap });
    const s = await open(be, f);
    expect(s.loadWarning).toMatch(/skadad/);
    expect(be.backup).not.toBeNull();
    expect((await s.listItems("proj_1")).length).toBe(20);
  });
  it("misslyckad sparning (full lagring) ger saveError men appen fortsätter i minnet, och felet försvinner när det går igen", async () => {
    const be = new MemoryBackend();
    const s = await open(be);
    await s.flush();
    be.failSave = "kvoten full";
    await s.updateItem("i2", { title: "Kvar i minnet" });
    await s.flush();
    expect(s.saveError).toMatch(/kvoten full/);
    expect((await s.listItems("proj_1")).find((i) => i.id === "i2")!.title).toBe("Kvar i minnet");
    be.failSave = null;
    await s.updateItem("i2", { title: "Sparas igen" });
    await s.flush();
    expect(s.saveError).toBeNull();
    expect((be.data as { snapshot: { items: { id: string; title: string }[] } }).snapshot.items.find((i) => i.id === "i2")!.title).toBe("Sparas igen");
  });
  it("läsfel (inte trasig data) ger varning och ingenting skrivs, så att det som finns inte skrivs över", async () => {
    const be = new MemoryBackend({ keep: "orört" });
    be.failLoad = "blockerad";
    const s = await open(be);
    expect(s.loadWarning).toMatch(/blockerad/);
    expect((await s.listItems("proj_1")).length).toBe(20); // exempeldata i minnet
    await s.updateItem("i2", { title: "Ska inte sparas" });
    await s.flush();
    expect(be.saves).toBe(0);
    expect(be.data).toEqual({ keep: "orört" });
  });
  it("många snabba ändringar ger få sparningar, och den sista är komplett", async () => {
    class Slow extends MemoryBackend { override async save(s: Parameters<MemoryBackend["save"]>[0]) { await new Promise((r) => setTimeout(r, 15)); await super.save(s); } } // som en riktig databas: tar tid
    const be = new Slow();
    const s = await open(be);
    await s.flush();
    const before = be.saves;
    for (let i = 0; i < 30; i++) await s.updateItem("i2", { title: `Titel ${i}` });
    await s.flush();
    expect(be.saves - before).toBeLessThan(30);
    expect((be.data as { snapshot: { items: { id: string; title: string }[] } }).snapshot.items.find((i) => i.id === "i2")!.title).toBe("Titel 29");
  });
});

describe("reservkopia vid omladdning mitt i en sparning", () => {
  class Hang extends MemoryBackend { hang = false; override async save(s: Parameters<MemoryBackend["save"]>[0]) { if (this.hang) await new Promise(() => undefined); await super.save(s); } }
  const title = async (s: PersistentStore) => (await s.listItems("proj_1")).find((i) => i.id === "i2")!.title;

  it("ändringar som inte hann sparas finns kvar efter omladdning, via reservkopian, och reservkopian rensas när allt sparats", async () => {
    const be = new Hang();
    const a = await open(be); await a.flush();
    be.hang = true; // sparningen blir aldrig klar, som när sidan laddas om mitt i
    await a.updateItem("i2", { title: "Hann inte sparas" });
    a.rescueSync();
    expect((be.data as { snapshot: { items: { id: string; title: string }[] } }).snapshot.items.find((i) => i.id === "i2")!.title).not.toBe("Hann inte sparas"); // det sparade är äldre
    be.hang = false;
    const b = await open(be); // omladdning
    expect(await title(b)).toBe("Hann inte sparas");
    await b.flush();
    expect(be.rescue).toBeNull(); // städat
    expect((be.data as { snapshot: { items: { id: string; title: string }[] } }).snapshot.items.find((i) => i.id === "i2")!.title).toBe("Hann inte sparas"); // nu även i den vanliga lagringen
  });
  it("en äldre reservkopia än det sparade ignoreras och rensas", async () => {
    const be = new Hang();
    const a = await open(be); await a.flush();
    be.hang = true; await a.updateItem("i2", { title: "Gammal" }); a.rescueSync(); be.hang = false;
    const old = be.rescue;
    const c = await open(new MemoryBackend(structuredClone(be.data))); // oberoende lagring med det sparade
    void c;
    // ett nyare sparat läge än reservkopian
    const b = await open(be); await b.updateItem("i2", { title: "Nyare sparat" }); await b.flush();
    be.rescue = old; // lägg tillbaka den gamla reservkopian
    const d = await open(be);
    expect(await title(d)).toBe("Nyare sparat");
    expect(be.rescue).toBeNull();
  });
  it("ingen reservkopia skrivs när inget är osparat, och en trasig reservkopia ignoreras", async () => {
    const be = new MemoryBackend();
    const a = await open(be); await a.flush();
    a.rescueSync();
    expect(be.rescue).toBeNull();
    be.rescue = { snapshot: { trasigt: true }, saved_at: "9999" };
    const b = await open(be);
    expect((await b.listItems("proj_1")).length).toBe(20);
    expect(b.loadWarning).toBeNull();
    expect(be.rescue).toBeNull();
  });
});

describe("flytt från den första versionens lagring (localStorage)", () => {
  const mkLegacy = (raw: string | null) => {
    const state = { backedUp: null as string | null, migrated: false, fallbackBackend: new MemoryBackend() };
    const legacy: Legacy = { read: () => raw, backup: (r) => { state.backedUp = r; }, migrated: () => { state.migrated = true; }, fallback: () => state.fallbackBackend };
    return { state, legacy };
  };
  const oldFormat = (mutate?: (snap: ReturnType<MemoryStore["snapshot"]>) => void) => { const snap = new MemoryStore(smallFixture()).snapshot(); snap.items[2] = { ...snap.items[2], title: "Från gamla" }; mutate?.(snap); return JSON.stringify(snap); };

  it("gammal sparad data flyttas, kontrolleras och markeras flyttad, och den gamla kopian rörs inte", async () => {
    const raw = oldFormat();
    const { state, legacy } = mkLegacy(raw);
    const be = new MemoryBackend();
    const s = await open(be, smallFixture(), legacy);
    expect(state.migrated).toBe(true);
    expect(state.backedUp).toBeNull();
    expect((await s.listItems("proj_1"))[2].title).toBe("Från gamla");
    expect((be.data as { snapshot: { items: { title: string }[] } }).snapshot.items[2].title).toBe("Från gamla"); // finns i nya lagringen
    expect(s.loadWarning).toBeNull();
  });
  it("finns data i nya lagringen används den, inte den gamla", async () => {
    const be = new MemoryBackend();
    const first = await open(be); await first.updateItem("i2", { title: "Ny lagring" }); await first.flush();
    const { state, legacy } = mkLegacy(oldFormat());
    const s = await open(be, smallFixture(), legacy);
    expect((await s.listItems("proj_1")).find((i) => i.id === "i2")!.title).toBe("Ny lagring");
    expect(state.migrated).toBe(false);
  });
  it("trasig gammal data sparas undan, varning visas och exempeldata läggs in", async () => {
    const { state, legacy } = mkLegacy("{ trasig");
    const be = new MemoryBackend();
    const s = await open(be, smallFixture(), legacy);
    expect(state.backedUp).toBe("{ trasig");
    expect(s.loadWarning).toMatch(/skadad/);
    expect((await s.listItems("proj_1")).length).toBe(20);
    expect(state.migrated).toBe(false);
  });
  it("går flytten inte att kontrollera fortsätter appen spara i den gamla lagringen, med varning", async () => {
    const { state, legacy } = mkLegacy(oldFormat());
    class Lossy extends MemoryBackend { override async save(s: Parameters<MemoryBackend["save"]>[0]) { await super.save({ ...s, snapshot: { ...s.snapshot, items: s.snapshot.items.slice(1) } }); } }
    const s = await open(new Lossy(), smallFixture(), legacy);
    expect(s.loadWarning).toMatch(/kunde inte kontrolleras/);
    expect(state.migrated).toBe(false);
    expect((await s.listItems("proj_1")).length).toBe(20); // innehållet från gamla kopian finns i minnet
    await s.updateItem("i2", { title: "Sparas i reserven" }); await s.flush();
    expect(state.fallbackBackend.saves).toBeGreaterThan(0);
  });
  it("en reservbackend med notis visas som varning", async () => {
    const be = new LocalStorageBackend("k", fakeStorage()); be.note = "Reserv";
    const s = await open(be);
    expect(s.loadWarning).toBe("Reserv");
  });
});

describe("hierarki och projekt", () => {
  const mk = () => new MemoryStore(smallFixture());
  it("bara en epic kan vara förälder", async () => {
    await expect(mk().updateItem("i2", { parent_id: "i3" })).rejects.toMatchObject({ code: "parent_not_epic" });
    await expect(mk().createItem(base({ parent_id: "i6" }))).rejects.toMatchObject({ code: "parent_not_epic" });
  });
  it("flytta en post till en annan epic räknar om båda", async () => {
    const s = mk();
    await s.updateItem("i20", { parent_id: "i4" });
    const items = await s.listItems("proj_1");
    expect(items.find((i) => i.id === "i4")!.end).toBe("2026-05-29");
    expect(items.find((i) => i.id === "i18")!.end).toBe("2026-05-22");
  });
  it("flytta en epic med innehåll in i en annan epic går, men inte in i sig själv eller sitt eget innehåll", async () => {
    const s = mk();
    await expect(s.updateItem("i4", { parent_id: "i5" })).rejects.toMatchObject({ code: "parent_cycle" });
    await expect(s.updateItem("i4", { parent_id: "i4" })).rejects.toMatchObject({ code: "parent_cycle" });
    await s.updateItem("i8", { parent_id: "i12" }); // Gränssnitt (med barn) flyttas till Utveckling
    const items = await s.listItems("proj_1");
    expect(items.find((i) => i.id === "i9")!.parent_id).toBe("i8"); // barnen följer med
    expect(items.find((i) => i.id === "i12")!.start).toBe("2026-03-24");
  });
  it("byt namn och ta bort projekt (med poster och beroenden)", async () => {
    const s = mk();
    await s.updateProject("proj_1", { name: "  Nytt namn " });
    expect((await s.listProjects())[0].name).toBe("Nytt namn");
    await expect(s.updateProject("proj_1", { name: "  " })).rejects.toMatchObject({ code: "empty_title" });
    const other = await s.createProject({ workspace_id: "ws_1", name: "Annat" });
    await s.deleteProject("proj_1");
    expect((await s.listProjects()).map((p) => p.id)).toEqual([other.id]);
    expect(await s.listItems("proj_1")).toEqual([]);
    expect(await s.listDependencies("proj_1")).toEqual([]);
  });
});

describe("sparningar samlas", () => {
  it("många skrivningar i följd blir få sparningar, och allt är sparat efter flush", async () => {
    const be = new MemoryBackend();
    const s = await open(be);
    await s.flush();
    const before = be.saves;
    for (let i = 0; i < 300; i++) await s.createItem(base({ title: `Post ${i}`, sort_order: 1000 + i }));
    await s.flush();
    expect(be.saves - before).toBeLessThanOrEqual(3);
    expect(((be.data as { snapshot: { items: unknown[] } }).snapshot.items).length).toBe(20 + 300);
  });
  it("en ändring som väntar på att sparas finns i reservkopian när sidan stängs, och sparas ändå", async () => {
    const be = new MemoryBackend();
    const s = await open(be);
    await s.flush();
    await s.createItem(base({ title: "Väntar" }));
    expect(((be.data as { snapshot: { items: { title: string }[] } }).snapshot.items).some((i) => i.title === "Väntar")).toBe(false); // ännu inte sparad: sparningen väntar en stund
    s.rescueSync();
    expect(JSON.stringify(be.rescue)).toContain("Väntar");
    await s.flush();
    expect(JSON.stringify(be.data)).toContain("Väntar");
  });
  it("ingen väntan när fördröjningen är 0", async () => {
    const be = new MemoryBackend();
    const s = new PersistentStore(smallFixture(), () => be, null, 0);
    await s.ready; await s.flush();
    await s.createItem(base({ title: "Direkt" }));
    await s.flush();
    expect(JSON.stringify(be.data)).toContain("Direkt");
  });
});
