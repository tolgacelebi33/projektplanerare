import type { DataStore } from "./DataStore";
import { RuleError, rederiveEpics, shiftSuccessors, validateDependency, validateItemShape, validateParent } from "./rules";
import { addDays } from "./dates";
import { applyPatch, isPatchList, json, makePatch, type Entry, type Patch } from "./patch";
import type { Dependency, DependencyMode, Fixture, Item, Project, User } from "./types";

/** Allt lagret håller, för att kunna sparas och återställas. */
export interface Snapshot {
  projects: Project[]; items: Item[]; dependencies: Dependency[]; users: User[]; seq: number;
}

export interface MemoryStoreOptions {
  latencyMs?: number;
  /** Anrop (1-baserat räknat över alla anrop) som ska misslyckas, för test av felläge. */
  failOnCall?: (n: number, method: string) => boolean;
}

/** En Map som anmäler varje ändring (med det gamla värdet) innan den görs, så att ångra-historiken bara behöver titta på det som ändrats. */
class TrackedMap<V> extends Map<string, V> {
  onTouch: (key: string, old: V | undefined) => void = () => {};
  override set(k: string, v: V) { this.onTouch(k, super.get(k)); return super.set(k, v); }
  override delete(k: string) { if (super.has(k)) this.onTouch(k, super.get(k)); return super.delete(k); }
  override clear() { for (const [k, v] of this) this.onTouch(k, v); super.clear(); }
}
type Kind = "projects" | "items" | "deps";
const KINDS: Kind[] = ["projects", "items", "deps"];

export class MemoryStore implements DataStore {
  private suppress = true; // ändringar under uppbyggnad och inläsning ger ingen historik
  protected projects = this.track<Project>("projects");
  protected items = this.track<Item>("items");
  protected deps = this.track<Dependency>("deps");
  protected users: User[] = [];
  protected seq = 0;
  private calls = 0;
  /** Logg över skrivanrop, används av tester för att bevisa att UI går via storen. */
  readonly writes: { method: string; args: unknown[] }[] = [];

  constructor(fixture?: Fixture, private opts: MemoryStoreOptions = {}) {
    if (fixture) {
      this.projects.set(fixture.project.id, fixture.project);
      fixture.items.forEach((i) => this.items.set(i.id, { ...i }));
      fixture.dependencies.forEach((d) => this.deps.set(d.id, { ...d }));
      this.users = fixture.users.map((u) => ({ ...u }));
    }
    this.suppress = false;
  }

  private track<V>(kind: Kind): TrackedMap<V> {
    const m = new TrackedMap<V>();
    m.onTouch = (key, old) => this.touch(kind, key, old);
    return m;
  }

  private async tick(method: string): Promise<void> {
    this.calls += 1;
    if (this.opts.latencyMs) await new Promise((r) => setTimeout(r, this.opts.latencyMs));
    else await Promise.resolve();
    if (this.opts.failOnCall?.(this.calls, method)) throw new Error(`Simulerat fel i ${method}`);
  }

  private modeOf(projectId: string): DependencyMode { return this.projects.get(projectId)?.dependency_mode ?? "shift"; }

  /** Efter att datum ändrats: flytta efterföljare framåt (om projektet har det läget) och räkna om epics ovanför alla som ändrats. */
  private afterDatesChanged(changedIds: string[]) {
    const first = changedIds.map((id) => this.items.get(id)).find(Boolean);
    const moved = first && this.modeOf(first.project_id) === "shift" ? shiftSuccessors(this.items, [...this.deps.values()], changedIds) : [];
    rederiveEpics(this.items, [...changedIds, ...moved].map((id) => this.items.get(id)?.parent_id ?? null));
  }

  /** Klar när lagringen är inläst. Direkt för minneslagring, asynkron för lagring i webbläsaren. */
  ready: Promise<void> = Promise.resolve();
  /** Anropas efter varje lyckad skrivning. Underklasser sparar här. */
  protected afterWrite(): void {}
  /** Meddelar lyssnare (UI) att något ändrats utan en skrivning, t.ex. att lagringen blev inläst eller att en sparning misslyckades. */
  protected notify(): void { this.listeners.forEach((l) => l()); }

  // Ångra och gör om. Varje skrivning sparar en ändringspost (bara det som skilde, se patch.ts) tillbaka till läget före den. Skrivningar som
  // kommer tätt efter varandra (en handling i UI kan bli flera anrop, t.ex. skapa + döpa om, eller ta bort ett helt innehåll) räknas som ett steg.
  // Projekt skapas och tas bort utan att kunna ångras: historiken nollställs då, så att ett steg aldrig pekar på ett projekt som UI inte känner till.
  // Posterna som ändras anmäls av `TrackedMap` med sitt gamla värde, så en skrivning kostar tid i förhållande till det som ändrades, inte till projektets storlek.
  private undoStack: Patch[] = [];
  private redoStack: Patch[] = [];
  private lastCommitAt = 0;
  private listeners = new Set<() => void>();
  /** Det öppna stegets utgångsläge: postens värde före första ändringen i steget (undefined = fanns inte), och posternas ordning vid stegets start. */
  private stepOld: Record<Kind, Map<string, unknown>> = { projects: new Map(), items: new Map(), deps: new Map() };
  private stepKeys: Record<Kind, string[]> | null = null;
  private stepIndex: Partial<Record<Kind, Map<string, number>>> = {};
  private stepOpen = false;
  private stepPushed = false;
  private touched = false;
  static readonly GROUP_MS = 250;
  static readonly MAX_STEPS = 100;

  private closeStep() { this.stepOpen = false; this.stepPushed = false; this.touched = false; this.stepKeys = null; this.stepIndex = {}; this.stepOld = { projects: new Map(), items: new Map(), deps: new Map() }; }

  private touch(kind: Kind, key: string, old: unknown): void {
    if (this.suppress) return;
    if (!this.touched) { // första ändringen sedan senaste skrivningen: hör den till samma steg eller börjar ett nytt?
      this.touched = true;
      const continuing = this.stepOpen && this.stepPushed && this.undoStack.length > 0 && performance.now() - this.lastCommitAt <= MemoryStore.GROUP_MS;
      if (!continuing) {
        this.stepOld = { projects: new Map(), items: new Map(), deps: new Map() };
        this.stepKeys = { projects: [...this.projects.keys()], items: [...this.items.keys()], deps: [...this.deps.keys()] };
        this.stepIndex = {};
        this.stepOpen = true; this.stepPushed = false;
      }
    }
    if (!this.stepOld[kind].has(key)) this.stepOld[kind].set(key, old);
  }

  /** Ändringsposten från läget nu tillbaka till stegets utgångsläge. */
  private stepPatch(): Patch {
    const maps: Record<Kind, Map<string, { id: string }>> = { projects: this.projects as never, items: this.items as never, deps: this.deps as never };
    const out: Record<Kind, Entry<never>[]> = { projects: [], items: [], deps: [] };
    for (const kind of KINDS) {
      const readd: { e: Entry<never>; at: number }[] = [];
      for (const [id, prev] of this.stepOld[kind] as Map<string, { id: string } | undefined>) {
        const cur = maps[kind].get(id);
        if (prev === undefined) { if (cur !== undefined) out[kind].push([id, null]); }
        else if (cur === undefined) {
          const idx = (this.stepIndex[kind] ??= new Map(this.stepKeys![kind].map((k, i) => [k, i] as const)));
          readd.push({ e: [id, { ...prev } as never, idx.get(id)], at: idx.get(id) ?? Infinity });
        } else if (json(prev) !== json(cur)) out[kind].push([id, { ...prev } as never]);
      }
      readd.sort((a, b) => a.at - b.at); // poster som ska tillbaka läggs in i ordning, så att varje plats stämmer
      out[kind].unshift(...readd.map((r) => r.e));
    }
    return { projects: out.projects, items: out.items, dependencies: out.deps, users: [] };
  }

  private commit(resetHistory = false): void {
    const now = performance.now();
    if (resetHistory) { this.undoStack = []; this.redoStack = []; this.closeStep(); }
    else if (this.touched) {
      const back = this.stepPatch();
      const empty = !back.projects.length && !back.items.length && !back.dependencies.length;
      // En skrivning som inte ändrar något (t.ex. samma status igen) ger inget ångra-steg, och ett steg som blivit tomt (ändringen gjordes ogjord inom samma handling) tas bort
      if (empty) { if (this.stepPushed) this.undoStack.pop(); this.closeStep(); }
      else {
        if (this.stepPushed) this.undoStack[this.undoStack.length - 1] = back; else { this.undoStack.push(back); this.stepPushed = true; }
        if (this.undoStack.length > MemoryStore.MAX_STEPS) this.undoStack.shift();
        this.redoStack = [];
        this.touched = false;
      }
    }
    this.lastCommitAt = now;
    this.afterWrite();
    this.listeners.forEach((l) => l());
  }
  /** Nollställer historiken (efter en import, som annars skulle ångras post för post). */
  clearHistory(): void { this.undoStack = []; this.redoStack = []; this.closeStep(); this.afterWrite(); this.listeners.forEach((l) => l()); }
  /** Historiken som data, för att sparas tillsammans med innehållet. */
  getHistory(): { undo: Patch[]; redo: Patch[] } { return { undo: this.undoStack, redo: this.redoStack }; }
  /** Läser tillbaka en sparad historik. Ogiltig form ignoreras (ingen historik). */
  setHistory(h: unknown): void {
    const x = h as { undo?: unknown; redo?: unknown } | null;
    if (x && isPatchList(x.undo) && isPatchList(x.redo)) { this.undoStack = x.undo.slice(-MemoryStore.MAX_STEPS); this.redoStack = x.redo.slice(-MemoryStore.MAX_STEPS); }
    else { this.undoStack = []; this.redoStack = []; }
    this.listeners.forEach((l) => l());
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  subscribe(l: () => void): () => void { this.listeners.add(l); return () => { this.listeners.delete(l); }; }

  private async travel(from: Patch[], to: Patch[]): Promise<boolean> {
    const patch = from.pop();
    if (!patch) return false;
    const now = this.snapshot();
    const target = applyPatch(now, patch);
    to.push(makePatch(target, now)); // från målläget tillbaka till nuläget, för att kunna gå åt andra hållet
    const seq = this.seq;
    this.restore(target);
    this.seq = Math.max(seq, target.seq); // id återanvänds aldrig
    this.lastCommitAt = 0; this.closeStep();
    this.afterWrite();
    this.listeners.forEach((l) => l());
    return true;
  }
  async undo(): Promise<boolean> { await this.tick("undo"); return this.travel(this.undoStack, this.redoStack); }
  async redo(): Promise<boolean> { await this.tick("redo"); return this.travel(this.redoStack, this.undoStack); }

  snapshot(): Snapshot {
    return {
      // Poster delas, inte kopieras: lagret byter ut en post vid ändring och ändrar den aldrig på plats (restore() kopierar vid inläsning)
      projects: [...this.projects.values()],
      items: [...this.items.values()],
      dependencies: [...this.deps.values()],
      users: this.users.map((u) => ({ ...u })),
      seq: this.seq,
    };
  }

  restore(snap: Snapshot): void {
    this.suppress = true;
    this.projects = this.track<Project>("projects"); snap.projects.forEach((p) => this.projects.set(p.id, { ...p }));
    this.items = this.track<Item>("items"); snap.items.forEach((i) => this.items.set(i.id, { ...i }));
    this.deps = this.track<Dependency>("deps"); snap.dependencies.forEach((d) => this.deps.set(d.id, { ...d }));
    this.users = snap.users.map((u) => ({ ...u }));
    this.seq = snap.seq;
    this.suppress = false;
    this.closeStep();
  }

  private checkAssignee(item: Item) {
    if (item.assignee_id !== null && !this.users.some((u) => u.id === item.assignee_id))
      throw new RuleError("bad_assignee", `Ansvarig finns inte: ${item.assignee_id}`);
  }

  private nextId(prefix: string) {
    this.seq += 1;
    return `${prefix}_new${this.seq}`;
  }

  async listProjects() {
    await this.tick("listProjects");
    return [...this.projects.values()];
  }
  async listUsers() {
    await this.tick("listUsers");
    return this.users.map((u) => ({ ...u }));
  }
  async createProject(p: Omit<Project, "id" | "created_at">) {
    await this.tick("createProject");
    const proj = { ...p, id: this.nextId("p"), created_at: new Date().toISOString() };
    this.projects.set(proj.id, proj);
    this.commit(true);
    return proj;
  }
  async updateProject(id: string, patch: { name?: string; dependency_mode?: DependencyMode }) {
    await this.tick("updateProject");
    const cur = this.projects.get(id);
    if (!cur) throw new RuleError("not_found", `Projekt ${id} finns inte`);
    const name = (patch.name ?? cur.name).trim();
    if (!name) throw new RuleError("empty_title", "Projektnamn saknas");
    if (name.length > 100) throw new RuleError("title_too_long", "Projektnamnet är för långt");
    if (patch.dependency_mode !== undefined && patch.dependency_mode !== "shift" && patch.dependency_mode !== "none") throw new RuleError("bad_mode", "Ogiltigt beroendeläge");
    const next = { ...cur, name, dependency_mode: patch.dependency_mode ?? cur.dependency_mode ?? "shift" };
    this.projects.set(id, next);
    this.writes.push({ method: "updateProject", args: [id, patch] });
    this.commit();
    return { ...next };
  }
  async deleteProject(id: string) {
    await this.tick("deleteProject");
    if (!this.projects.has(id)) throw new RuleError("not_found", `Projekt ${id} finns inte`);
    const gone = new Set([...this.items.values()].filter((i) => i.project_id === id).map((i) => i.id));
    for (const itemId of gone) this.items.delete(itemId);
    for (const d of [...this.deps.values()]) if (gone.has(d.from_item_id) || gone.has(d.to_item_id)) this.deps.delete(d.id);
    this.projects.delete(id);
    this.writes.push({ method: "deleteProject", args: [id] });
    this.commit(true);
  }
  async listItems(projectId: string) {
    await this.tick("listItems");
    return [...this.items.values()].filter((i) => i.project_id === projectId).map((i) => ({ ...i }));
  }
  async createItem(item: Omit<Item, "id">) {
    await this.tick("createItem");
    const created: Item = { ...item, id: this.nextId("i") };
    this.checkAssignee(created);
    validateItemShape(created);
    validateParent(created, this.items);
    this.items.set(created.id, created);
    rederiveEpics(this.items, [created.parent_id]);
    this.writes.push({ method: "createItem", args: [item] });
    this.commit();
    return { ...created };
  }
  async updateItem(id: string, patch: Partial<Omit<Item, "id" | "workspace_id" | "project_id">>) {
    await this.tick("updateItem");
    const cur = this.items.get(id);
    if (!cur) throw new RuleError("not_found", `Item ${id} finns inte`);
    const next: Item = { ...cur, ...patch };
    if (cur.undated && (next.start !== cur.start || next.end !== cur.end) && patch.undated === undefined) delete next.undated; // nya datum: posten är schemalagd
    // I läget "shift" får en uppgift inte flyttas till att börja före att dess föregångare är klar (som Asana och monday i strikt läge).
    if (next.start !== cur.start && next.start < cur.start && cur.type !== "epic" && this.modeOf(cur.project_id) === "shift") {
      const ends = [...this.deps.values()].filter((d) => d.to_item_id === id).map((d) => this.items.get(d.from_item_id)).filter((p): p is Item => !!p && p.type !== "epic").map((p) => p.end);
      if (ends.length) {
        const need = addDays(ends.sort().at(-1)!, 1);
        if (next.start < need) throw new RuleError("before_predecessor", `Kan inte börja före att föregångaren är klar. Tidigast ${need}.`, { date: need });
      }
    }
    // Epics med innehåll får sina datum ur barnen och kan inte sättas direkt
    if (cur.type === "epic" && (next.start !== cur.start || next.end !== cur.end) && [...this.items.values()].some((i) => i.parent_id === id))
      throw new RuleError("epic_dates_derived", "Datum för en epic med innehåll räknas ur innehållet");
    this.checkAssignee(next);
    validateItemShape(next);
    validateParent(next, this.items);
    this.items.set(id, next);
    const datesChanged = next.start !== cur.start || next.end !== cur.end;
    if (datesChanged) this.afterDatesChanged([id]); // flytta efterföljare och räkna om epics ovanför alla som ändrats
    rederiveEpics(this.items, [cur.parent_id, next.parent_id]); // gammal och ny förälder (vid flytt), och dess förfäder
    this.writes.push({ method: "updateItem", args: [id, patch] });
    this.commit();
    return { ...next };
  }
  async deleteItem(id: string) {
    await this.tick("deleteItem");
    if ([...this.items.values()].some((i) => i.parent_id === id))
      throw new RuleError("has_children", "Item har barn");
    const parentId = this.items.get(id)?.parent_id ?? null;
    this.items.delete(id);
    rederiveEpics(this.items, [parentId]);
    for (const d of [...this.deps.values()]) if (d.from_item_id === id || d.to_item_id === id) this.deps.delete(d.id);
    this.writes.push({ method: "deleteItem", args: [id] });
    this.commit();
  }
  async listDependencies(projectId: string) {
    await this.tick("listDependencies");
    return [...this.deps.values()].filter((d) => this.items.get(d.from_item_id)?.project_id === projectId);
  }
  async createDependency(dep: Omit<Dependency, "id">) {
    await this.tick("createDependency");
    const created: Dependency = { ...dep, id: this.nextId("d") };
    validateDependency(created, this.items, [...this.deps.values()]);
    this.deps.set(created.id, created);
    this.afterDatesChanged([created.from_item_id]); // ett nytt beroende som redan bryts flyttar efterföljaren
    this.writes.push({ method: "createDependency", args: [dep] });
    this.commit();
    return created;
  }
  async deleteDependency(id: string) {
    await this.tick("deleteDependency");
    this.deps.delete(id);
    this.writes.push({ method: "deleteDependency", args: [id] });
    this.commit();
  }
}
