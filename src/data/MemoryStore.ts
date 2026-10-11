import type { DataStore } from "./DataStore";
import { RuleError, earliestStart, rederiveEpics, shiftSuccessors, validateBaseline, validateCommentText, validateDependency, validateFieldDefs, validateItemShape, validateParent, validateSavedViews } from "./rules";
import { addDays } from "./dates";
import { extendSeries } from "./actions";
import { PLACEHOLDER_RENAMES, placeholderOldName } from "./fixtures";
import { countersFor, validCounters, type Counters, emptyCounters, itemCode, nextNumber, parseProjectCode, projectCode } from "./codes";
import { applyPatch, isPatchList, json, makePatch, type Entry, type Patch } from "./patch";
import { ACTIVITY_LIMITS, COMMENT_LIMITS, PROJECT_HEALTH, STATUS_UPDATE_LIMITS, type Activity, type ProjectHealth, type StatusUpdate } from "./types";
import { depDraft, describeChange } from "./activity";
import type { Baseline, Comment, Dependency, DependencyMode, FieldDef, Fixture, Item, Project, SavedView, User } from "./types";

/** Allt lagret håller, för att kunna sparas och återställas. */
export interface Snapshot {
  projects: Project[]; items: Item[]; dependencies: Dependency[]; users: User[]; seq: number;
  /** Senast utdelade projektnummer (för koder). Saknas i äldre sparad data. */
  project_seq?: number;
  /** Hur långt varje posttyps följd har kommit, per projekt. Ligger utanför ångra-historiken: ett nummer som delats ut går aldrig tillbaka. */
  counters?: Record<string, Counters>;
  /** Kommentarer. Ligger utanför ångra-historiken. */
  comments?: Comment[];
  /** Loggen (historik över ändringar). Ligger utanför ångra-historiken. */
  activity?: Activity[];
  /** Projektens statusuppdateringar. Ligger utanför ångra-historiken. */
  status_updates?: StatusUpdate[];
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
  /** Senast utdelade projektnummer. Går aldrig tillbaka, inte ens när projekt tas bort eller steg ångras. */
  protected projectSeq = 0;
  /** Enkla regler som användaren slagit på i Inställningar (se settings.ts). Gäller alla skrivningar, så vyerna behöver inte veta om dem. */
  rules: { doneSetsProgress: boolean; seriesNext: boolean } = { doneSetsProgress: false, seriesNext: false };
  protected counters = new Map<string, Counters>();
  /** Kommentarer: ingen ångra-historik (Ångra tar aldrig bort en kommentar), och de finns kvar om en post tas bort (så att Ångra kan ge tillbaka posten med sina kommentarer). */
  protected comments: Comment[] = [];
  /** Loggen: vad som hänt med posterna, vem och när. Skrivs av lagret vid varje ändring, ligger utanför ångra-historiken, och finns kvar om en post tas bort (visas inte medan den saknas). */
  protected activity: Activity[] = [];
  /** Projektstatus: historik över hälsa och text per projekt (den senaste gäller). Utanför ångra-historiken, tas bort med projektet. */
  protected statusUpdates: StatusUpdate[] = [];
  private activityCount = new Map<string, number>();
  /** Den som gör ändringarna just nu (sätts av appen från "Skriv som"). Tomt namn visas som okänd. */
  actor: { id: string | null; name: string } = { id: null, name: "" };
  /** Av under en import som för med sig sin egen logg, så att den inte får en "skapad"-rad för varje post. */
  logging = true;
  private logBase = new Map<string, Item | undefined>(); // posternas läge vid förra loggningen: det som ändrats sedan dess loggas vid nästa skrivning
  private direct = new Set<string>(); // poster som en skrivning gällde direkt (resten som ändras är följder: flyttade efterföljare, omräknade grupper)
  private calls = 0;
  /** Logg över skrivanrop, används av tester för att bevisa att UI går via storen. */
  readonly writes: { method: string; args: unknown[] }[] = [];

  constructor(fixture?: Fixture, private opts: MemoryStoreOptions = {}) {
    if (fixture) {
      this.projects.set(fixture.project.id, fixture.project);
      fixture.items.forEach((i) => this.items.set(i.id, { ...i }));
      fixture.dependencies.forEach((d) => this.deps.set(d.id, { ...d }));
      this.users = fixture.users.map((u) => ({ ...u }));
      this.backfillCodes();
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
  private holding = 0; // pågående batch: alla skrivningar i den är ett ångra-steg, hur lång tid de än tar
  static readonly GROUP_MS = 250;
  static readonly MAX_STEPS = 100;

  private closeStep() { this.stepOpen = false; this.stepPushed = false; this.touched = false; this.stepKeys = null; this.stepIndex = {}; this.stepOld = { projects: new Map(), items: new Map(), deps: new Map() }; }

  private touch(kind: Kind, key: string, old: unknown): void {
    if (this.suppress) return;
    if (kind === "items" && !this.logBase.has(key)) this.logBase.set(key, old as Item | undefined);
    if (!this.touched) { // första ändringen sedan senaste skrivningen: hör den till samma steg eller börjar ett nytt?
      this.touched = true;
      const continuing = this.stepOpen && this.stepPushed && this.undoStack.length > 0 && (this.holding > 0 || performance.now() - this.lastCommitAt <= MemoryStore.GROUP_MS);
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

  private userNameOf = (id: string | null): string => (id ? this.users.find((u) => u.id === id)?.name ?? "" : "");
  private titleOf = (id: string | null): string => (id ? this.items.get(id)?.title ?? "" : "");

  /** Lägger till en rad i loggen (och håller gränserna: högst 300 per post, 100 000 totalt, äldst först bort). */
  private log(item: Item | undefined, d: Omit<Activity, "id" | "workspace_id" | "project_id" | "item_id" | "at" | "actor_id" | "actor_name">, extra: { auto?: boolean; undo?: boolean; at?: string } = {}): void {
    if (!item) return;
    this.seq += 1;
    this.activity.push({ id: `a_new${this.seq}`, workspace_id: item.workspace_id, project_id: item.project_id, item_id: item.id, at: extra.at ?? new Date().toISOString(), actor_id: this.actor.id, actor_name: this.actor.name, ...d, ...(extra.auto ? { auto: true } : {}), ...(extra.undo ? { undo: true } : {}) });
    const n = (this.activityCount.get(item.id) ?? 0) + 1;
    this.activityCount.set(item.id, n);
    if (n > ACTIVITY_LIMITS.perItem) { const at = this.activity.findIndex((a) => a.item_id === item.id); if (at >= 0) { this.activity.splice(at, 1); this.activityCount.set(item.id, n - 1); } }
    if (this.activity.length > ACTIVITY_LIMITS.total) { const gone = this.activity.splice(0, this.activity.length - ACTIVITY_LIMITS.total); for (const g of gone) this.activityCount.set(g.item_id, Math.max(0, (this.activityCount.get(g.item_id) ?? 1) - 1)); }
  }
  private rebuildActivityCount() { this.activityCount = new Map(); for (const a of this.activity) this.activityCount.set(a.item_id, (this.activityCount.get(a.item_id) ?? 0) + 1); }

  /** Loggar det som ändrats sedan förra skrivningen: det som en skrivning gällde direkt, och det som blev följden (flyttade efterföljare, omräknade grupper, markerat som automatiskt). */
  private flushActivity(): void {
    const base = this.logBase, direct = this.direct;
    this.logBase = new Map(); this.direct = new Set();
    if (!this.logging) return;
    for (const [id, before] of base) {
      const after = this.items.get(id);
      for (const d of describeChange(before, after, this.userNameOf, this.titleOf)) this.log(after, d, { auto: !direct.has(id) });
    }
  }

  private commit(resetHistory = false): void {
    this.flushActivity();
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
  /** Alla skrivningar i `fn` blir ett enda ångra-steg (en handling i UI som skriver flera poster), oavsett hur långt det går mellan dem. */
  async batch<T>(fn: () => Promise<T>): Promise<T> {
    this.closeStep(); // börjar ett nytt steg
    this.holding++;
    try { return await fn(); } finally { this.holding--; this.lastCommitAt = performance.now(); }
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
    const seq = this.seq, projectSeq = this.projectSeq, counters = this.counters, comments = this.comments, activity = this.activity, statusUpdates = this.statusUpdates;
    const was = new Map(this.items);
    this.logBase = new Map(); this.direct = new Set();
    this.restore(target);
    this.comments = comments; // Ångra och Gör om rör aldrig kommentarerna
    this.statusUpdates = statusUpdates; // projektstatusen också
    this.activity = activity; this.rebuildActivityCount(); // och loggen står kvar, med själva Ångra som nya rader
    for (const [id, after] of this.items) { // vad Ångra eller Gör om ändrade, i loggen
      const before = was.get(id);
      if (before === after) continue;
      for (const d of describeChange(before, after, this.userNameOf, this.titleOf)) this.log(after, d, { undo: true });
    }
    this.projectSeq = Math.max(projectSeq, this.projectSeq); // projektnummer och räkneverk går aldrig tillbaka, inte heller vid ångra
    for (const [pid, c] of counters) {
      const cur = this.counters.get(pid);
      if (this.projects.has(pid)) this.counters.set(pid, cur ? { epic: Math.max(cur.epic, c.epic), milestone: Math.max(cur.milestone, c.milestone), task: Math.max(cur.task, c.task) } : c);
    }
    this.seq = Math.max(seq, target.seq); // id återanvänds aldrig
    this.backfillCodes(); // ett steg från före kodernas tid kan ge tillbaka poster utan kod
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
      project_seq: this.projectSeq,
      counters: Object.fromEntries(this.counters),
      comments: this.comments,
      activity: this.activity,
      status_updates: this.statusUpdates,
    };
  }

  restore(snap: Snapshot): void {
    this.suppress = true;
    this.projects = this.track<Project>("projects"); snap.projects.forEach((p) => this.projects.set(p.id, { ...p }));
    this.items = this.track<Item>("items"); snap.items.forEach((i) => this.items.set(i.id, { ...i }));
    this.deps = this.track<Dependency>("deps"); snap.dependencies.forEach((d) => this.deps.set(d.id, { ...d }));
    this.users = snap.users.map((u) => ({ ...u }));
    this.seq = snap.seq;
    this.comments = (snap.comments ?? []).map((c) => ({ ...c }));
    this.activity = (snap.activity ?? []).map((a) => ({ ...a })); this.rebuildActivityCount();
    this.statusUpdates = (snap.status_updates ?? []).map((u) => ({ ...u }));
    this.projectSeq = snap.project_seq ?? 0;
    this.counters = new Map();
    for (const [pid, c] of Object.entries(snap.counters ?? {})) if (this.projects.has(pid) && validCounters(c)) this.counters.set(pid, { ...c });
    this.suppress = false;
    this.closeStep();
  }

  private checkAssignee(item: Item) {
    if (item.assignee_id !== null && !this.users.some((u) => u.id === item.assignee_id))
      throw new RuleError("bad_assignee", `Ansvarig finns inte: ${item.assignee_id}`);
  }

  /**
   * Ger projekt och poster som saknar kod en kod (äldre data, och steg som ångras till före kodernas tid). Projekt i listans ordning, poster i listans
   * ordning (sort_order) per posttyp. Ger ingen historik: det är ett fält som läggs till, inte en ändring användaren gjort. Returnerar om något ändrades.
   */
  backfillCodes(): boolean {
    const prev = this.suppress; this.suppress = true;
    let changed = false;
    try {
      for (const p of this.projects.values()) { const n = parseProjectCode(p.code); if (n !== null && n > this.projectSeq) this.projectSeq = n; }
      for (const p of [...this.projects.values()]) {
        let proj = p;
        if (parseProjectCode(proj.code) === null) { this.projectSeq = nextNumber(this.projectSeq); proj = { ...proj, code: projectCode(this.projectSeq) }; }
        const pn = parseProjectCode(proj.code)!;
        const items = [...this.items.values()].filter((i) => i.project_id === proj.id);
        const counters = countersFor(this.counters.get(proj.id), items, pn);
        const todo = items.filter((i) => !i.code).sort((a, b) => a.sort_order - b.sort_order || (a.id < b.id ? -1 : 1));
        for (const i of todo) { counters[i.type] = nextNumber(counters[i.type]); this.items.set(i.id, { ...i, code: itemCode(i.type, pn, counters[i.type]) }); changed = true; }
        if (proj !== p) { this.projects.set(proj.id, proj); changed = true; }
        if (JSON.stringify(counters) !== JSON.stringify(this.counters.get(proj.id))) { this.counters.set(proj.id, counters); changed = true; }
      }
    } finally { this.suppress = prev; }
    return changed;
  }

  /**
   * Byter platshållarnamnen från provdatan (Anna Lind, Erik Berg, Maria Holm) mot de verkliga, men bara de som fortfarande har sitt ursprungsnamn
   * (en person användaren redan döpt om rörs inte). Id är oförändrade, så tilldelningar följer med. Ger ingen historik. Returnerar om något ändrades.
   */
  renamePlaceholderUsers(): boolean {
    let changed = false;
    this.users = this.users.map((u) => {
      const to = PLACEHOLDER_RENAMES[u.id];
      if (to && u.name === placeholderOldName(u.id) && !this.users.some((o) => o.name === to)) { changed = true; return { ...u, name: to }; }
      return u;
    });
    return changed;
  }

  private checkUserName(name: string, exceptId?: string): string {
    const n = name.trim();
    if (!n) throw new RuleError("empty_name", "Namn saknas");
    if (n.length > 60) throw new RuleError("name_too_long", "Namnet är för långt (högst 60 tecken)");
    if (this.users.some((u) => u.id !== exceptId && u.name.toLowerCase() === n.toLowerCase())) throw new RuleError("duplicate_name", "Det finns redan en person med det namnet");
    return n;
  }
  async addUser(name: string): Promise<User> {
    await this.tick("addUser");
    if (this.users.length >= 50) throw new RuleError("too_many_users", "Högst 50 personer");
    const user = { id: this.nextId("u"), name: this.checkUserName(name) };
    this.users = [...this.users, user];
    this.commit();
    return { ...user };
  }
  async renameUser(id: string, name: string): Promise<User> {
    await this.tick("renameUser");
    const cur = this.users.find((u) => u.id === id);
    if (!cur) throw new RuleError("not_found", "Personen finns inte");
    const next = { ...cur, name: this.checkUserName(name, id) };
    this.users = this.users.map((u) => (u.id === id ? next : u));
    this.commit();
    return { ...next };
  }
  /** Poster som hade personen blir utan ansvarig i alla projekt. Ångra-historiken töms (ett steg skulle annars kunna ge tillbaka en ansvarig som inte finns). */
  async removeUser(id: string): Promise<number> {
    await this.tick("removeUser");
    if (!this.users.some((u) => u.id === id)) throw new RuleError("not_found", "Personen finns inte");
    let n = 0;
    for (const i of [...this.items.values()]) if (i.assignee_id === id) { this.items.set(i.id, { ...i, assignee_id: null }); n++; }
    this.users = this.users.filter((u) => u.id !== id);
    this.commit(true);
    return n;
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
    this.projectSeq = nextNumber(this.projectSeq);
    const proj = { ...p, id: this.nextId("p"), created_at: new Date().toISOString(), code: projectCode(this.projectSeq) };
    this.projects.set(proj.id, proj);
    this.counters.set(proj.id, emptyCounters());
    this.commit(true);
    return proj;
  }
  async updateProject(id: string, patch: { name?: string; dependency_mode?: DependencyMode; fields?: FieldDef[]; views?: SavedView[]; baseline?: Baseline | null }) {
    await this.tick("updateProject");
    const cur = this.projects.get(id);
    if (!cur) throw new RuleError("not_found", `Projekt ${id} finns inte`);
    const name = (patch.name ?? cur.name).trim();
    if (!name) throw new RuleError("empty_title", "Projektnamn saknas");
    if (name.length > 100) throw new RuleError("title_too_long", "Projektnamnet är för långt");
    if (patch.dependency_mode !== undefined && patch.dependency_mode !== "shift" && patch.dependency_mode !== "none") throw new RuleError("bad_mode", "Ogiltigt beroendeläge");
    if (patch.fields !== undefined) validateFieldDefs(patch.fields);
    if (patch.views !== undefined) validateSavedViews(patch.views);
    if (patch.baseline) validateBaseline(patch.baseline);
    const next: Project = { ...cur, name, dependency_mode: patch.dependency_mode ?? cur.dependency_mode ?? "shift", ...(patch.fields !== undefined ? { fields: patch.fields } : {}), ...(patch.views !== undefined ? { views: patch.views } : {}) };
    if (patch.baseline === null) delete next.baseline; else if (patch.baseline) next.baseline = patch.baseline;
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
    this.counters.delete(id);
    this.comments = this.comments.filter((c) => c.project_id !== id);
    this.activity = this.activity.filter((a) => a.project_id !== id); this.rebuildActivityCount();
    this.statusUpdates = this.statusUpdates.filter((u) => u.project_id !== id);
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
    this.direct.add(created.id);
    delete created.code; // koden delas alltid ut här, aldrig av den som skapar
    const proj = this.projects.get(created.project_id);
    let counters: Counters | null = null;
    if (proj) {
      const pn = parseProjectCode(proj.code);
      if (pn !== null) {
        const saved = this.counters.get(proj.id);
        counters = validCounters(saved) ? { ...saved } : countersFor(null, [...this.items.values()].filter((i) => i.project_id === proj.id), pn);
        counters[created.type] = nextNumber(counters[created.type]);
        created.code = itemCode(created.type, pn, counters[created.type]);
      }
    }
    this.checkAssignee(created);
    validateItemShape(created);
    validateParent(created, this.items);
    this.items.set(created.id, created);
    if (counters && proj) this.counters.set(proj.id, counters);
    rederiveEpics(this.items, [created.parent_id]);
    this.writes.push({ method: "createItem", args: [item] });
    this.commit();
    return { ...created };
  }
  async updateItem(id: string, patch: Partial<Omit<Item, "id" | "workspace_id" | "project_id">>) {
    await this.tick("updateItem");
    const cur = this.items.get(id);
    if (!cur) throw new RuleError("not_found", `Item ${id} finns inte`);
    if (patch.code !== undefined && patch.code !== cur.code) throw new RuleError("code_fixed", "Koden kan inte ändras");
    this.direct.add(id);
    const next: Item = { ...cur, ...patch };
    // Regel: när status blir Klar sätts framsteget till 100 (om framsteg inte ändras i samma skrivning)
    if (this.rules.doneSetsProgress && patch.status === "done" && cur.status !== "done" && patch.progress === undefined && cur.type !== "epic") next.progress = 100;
    if (cur.undated && (next.start !== cur.start || next.end !== cur.end) && patch.undated === undefined) delete next.undated; // nya datum: posten är schemalagd
    // I läget "shift" får en uppgift inte flyttas så att ett beroende bryts (som Asana och monday i strikt läge): slut-start och start-start gäller starten,
    // slut-slut och start-slut gäller slutet, och fördröjningen räknas med. Det är bara en kant som flyttas tidigare som kontrolleras.
    if ((next.start < cur.start || next.end < cur.end) && cur.type !== "epic" && this.modeOf(cur.project_id) === "shift") {
      let need = "";
      for (const d of this.deps.values()) {
        if (d.to_item_id !== id) continue;
        const p = this.items.get(d.from_item_id);
        if (!p || p.type === "epic") continue;
        const startEdge = d.type === "finish_to_start" || d.type === "start_to_start";
        if (startEdge ? next.start >= cur.start : next.end >= cur.end) continue;
        const e = earliestStart(p, next, d);
        if (next.start < e && e > need) need = e;
      }
      if (need) throw new RuleError("before_predecessor", `Kan inte flyttas före vad beroendet tillåter. Tidigast ${need}.`, { date: need });
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
    // Regel: när ett tillfälle i en serie blir klart skapas nästa efter det sista (samma ångra-steg, eftersom det sker direkt efter)
    if (this.rules.seriesNext && cur.status !== "done" && next.status === "done" && next.series && next.recur) {
      try { await extendSeries(this, [...this.items.values()].filter((i) => i.project_id === next.project_id), next, 1); } catch { /* serien är full eller regeln gick inte att tillämpa: statusändringen står kvar */ }
    }
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
  async listComments(projectId: string): Promise<Comment[]> {
    await this.tick("listComments");
    return this.comments.filter((c) => c.project_id === projectId && this.items.has(c.item_id)).map((c) => ({ ...c })).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
  }
  async addComment(input: { item_id: string; text: string; author_id: string | null; author_name?: string; parent_id?: string | null; created_at?: string }): Promise<Comment> {
    await this.tick("addComment");
    const item = this.items.get(input.item_id);
    if (!item) throw new RuleError("not_found", "Posten finns inte");
    const text = validateCommentText(input.text);
    const author = input.author_id === null ? null : this.users.find((u) => u.id === input.author_id);
    if (author === undefined) throw new RuleError("bad_author", "Författaren finns inte");
    const parent = input.parent_id ? this.comments.find((c) => c.id === input.parent_id) : null;
    if (input.parent_id && (!parent || parent.item_id !== item.id || parent.parent_id !== null)) throw new RuleError("bad_parent", "Det går bara att svara på en kommentar på samma post (en nivå)");
    if (this.comments.length >= COMMENT_LIMITS.total || this.comments.filter((c) => c.item_id === item.id).length >= COMMENT_LIMITS.perItem) throw new RuleError("too_many_comments", `Högst ${COMMENT_LIMITS.perItem} kommentarer per post`);
    this.seq += 1;
    const c: Comment = { id: `c_new${this.seq}`, workspace_id: item.workspace_id, project_id: item.project_id, item_id: item.id, parent_id: parent?.id ?? null, author_id: author?.id ?? null, author_name: author?.name ?? (input.author_name ?? "").slice(0, 60), text, created_at: input.created_at ?? new Date().toISOString() };
    this.comments = [...this.comments, c];
    this.commit();
    return { ...c };
  }
  async editComment(id: string, text: string): Promise<Comment> {
    await this.tick("editComment");
    const cur = this.comments.find((c) => c.id === id);
    if (!cur) throw new RuleError("not_found", "Kommentaren finns inte");
    const next: Comment = { ...cur, text: validateCommentText(text), edited_at: new Date().toISOString() };
    this.comments = this.comments.map((c) => (c.id === id ? next : c));
    this.commit();
    return { ...next };
  }
  /** Tar bort kommentaren och svaren på den. Returnerar antal borttagna. */
  async deleteComment(id: string): Promise<number> {
    await this.tick("deleteComment");
    if (!this.comments.some((c) => c.id === id)) throw new RuleError("not_found", "Kommentaren finns inte");
    const before = this.comments.length;
    this.comments = this.comments.filter((c) => c.id !== id && c.parent_id !== id);
    this.commit();
    return before - this.comments.length;
  }
  /** Alla projektens statusuppdateringar, äldst först. */
  async listStatusUpdates(): Promise<StatusUpdate[]> {
    await this.tick("listStatusUpdates");
    return this.statusUpdates.filter((u) => this.projects.has(u.project_id)).map((u) => ({ ...u })).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
  }
  /** En ny statusuppdatering: hälsa och (valfri) text, av den som är vald nu. Den senaste gäller som projektets status. */
  async addStatusUpdate(input: { project_id: string; health: ProjectHealth; text: string; at?: string; actor_name?: string }): Promise<StatusUpdate> {
    await this.tick("addStatusUpdate");
    const project = this.projects.get(input.project_id);
    if (!project) throw new RuleError("not_found", "Projektet finns inte");
    if (!PROJECT_HEALTH.includes(input.health)) throw new RuleError("bad_health", "Ogiltig projektstatus");
    const text = input.text.trim();
    if (text.length > STATUS_UPDATE_LIMITS.text) throw new RuleError("update_too_long", `Texten är längre än ${STATUS_UPDATE_LIMITS.text} tecken`);
    this.seq += 1;
    const u: StatusUpdate = { id: `s_new${this.seq}`, workspace_id: project.workspace_id, project_id: project.id, at: input.at ?? new Date().toISOString(), actor_id: input.actor_name === undefined ? this.actor.id : null, actor_name: input.actor_name ?? this.actor.name, health: input.health, text };
    this.statusUpdates = [...this.statusUpdates, u];
    const mine = this.statusUpdates.filter((x) => x.project_id === project.id);
    if (mine.length > STATUS_UPDATE_LIMITS.perProject) { const drop = mine[0].id; this.statusUpdates = this.statusUpdates.filter((x) => x.id !== drop); }
    this.commit();
    return { ...u };
  }
  /** Loggen för ett projekts poster (de som finns), äldst först. */
  async listActivity(projectId: string): Promise<Activity[]> {
    await this.tick("listActivity");
    return this.activity.filter((a) => a.project_id === projectId && this.items.has(a.item_id)).map((a) => ({ ...a })).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
  }
  /** Lägger in loggrader från en fil (import, återställning): oförändrade, med personens namn som det stod. Anropas bara av importen. */
  addActivityRaw(item_id: string, a: Omit<Activity, "id" | "workspace_id" | "project_id" | "item_id">): void {
    const item = this.items.get(item_id);
    if (!item) return;
    this.seq += 1;
    this.activity.push({ ...a, id: `a_new${this.seq}`, workspace_id: item.workspace_id, project_id: item.project_id, item_id });
    this.activityCount.set(item_id, (this.activityCount.get(item_id) ?? 0) + 1);
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
    this.logDep("dep_added", created);
    this.afterDatesChanged([created.from_item_id]); // ett nytt beroende som redan bryts flyttar efterföljaren
    this.writes.push({ method: "createDependency", args: [dep] });
    this.commit();
    return created;
  }
  /** Ändrar typ och/eller fördröjning. Efterföljaren flyttas om beroendet nu bryts (i läget shift). */
  async updateDependency(id: string, patch: { type?: Dependency["type"]; lag?: number }) {
    await this.tick("updateDependency");
    const cur = this.deps.get(id);
    if (!cur) throw new RuleError("not_found", `Beroende ${id} finns inte`);
    const next: Dependency = { ...cur, ...(patch.type !== undefined ? { type: patch.type } : {}), ...(patch.lag !== undefined ? { lag: patch.lag } : {}) };
    if (next.lag === 0) delete next.lag;
    validateDependency(next, this.items, [...this.deps.values()].filter((d) => d.id !== id));
    this.deps.set(id, next);
    this.logDep("dep_changed", next);
    this.afterDatesChanged([next.from_item_id]);
    this.writes.push({ method: "updateDependency", args: [id, patch] });
    this.commit();
    return { ...next };
  }
  /** Ett beroende syns i loggen på båda posterna: hos efterföljaren är den andra en föregångare, hos föregångaren en efterföljare. */
  private logDep(kind: "dep_added" | "dep_changed" | "dep_removed", d: Dependency): void {
    if (!this.logging) return;
    const from = this.items.get(d.from_item_id), to = this.items.get(d.to_item_id);
    if (!from || !to) return;
    this.log(to, depDraft(kind, from.title, "pred", d.type, d.lag));
    this.log(from, depDraft(kind, to.title, "succ", d.type, d.lag));
  }
  async deleteDependency(id: string) {
    await this.tick("deleteDependency");
    const gone = this.deps.get(id);
    if (gone) this.logDep("dep_removed", gone);
    this.deps.delete(id);
    this.writes.push({ method: "deleteDependency", args: [id] });
    this.commit();
  }
}
