import type { Template, StatusDef, Activity, Baseline, ProjectHealth, StatusUpdate, Comment, DependencyMode, Dependency, FieldDef, Item, Project, SavedView, User } from "./types";

/** UI pratar bara med detta gränssnitt. Alla anrop är asynkrona. */
export interface DataStore {
  /** Skrivningarna i `fn` blir ett enda ångra-steg. Lagringar utan ångra kan utelämna den (då körs `fn` som den är). */
  batch?<T>(fn: () => Promise<T>): Promise<T>;
  listProjects(): Promise<Project[]>;
  /** Medlemmar som kan vara ansvariga. Platshållare tills fas 4. */
  listUsers(): Promise<User[]>;
  createProject(p: Omit<Project, "id" | "created_at">): Promise<Project>;
  updateProject(id: string, patch: { name?: string; dependency_mode?: DependencyMode; fields?: FieldDef[]; views?: SavedView[]; baseline?: Baseline | null; statuses?: StatusDef[] | null }): Promise<Project>;
  /** Tar bort projektet med alla poster och beroenden. */
  deleteProject(id: string): Promise<void>;
  listItems(projectId: string): Promise<Item[]>;
  createItem(item: Omit<Item, "id">): Promise<Item>;
  updateItem(id: string, patch: Partial<Omit<Item, "id" | "workspace_id" | "project_id">>): Promise<Item>;
  deleteItem(id: string): Promise<void>;
  listDependencies(projectId: string): Promise<Dependency[]>;
  createDependency(dep: Omit<Dependency, "id">): Promise<Dependency>;
  /** Meddelar när något ändrats (valfritt: lagret i minnet och i webbläsaren har det). */
  subscribe?(listener: () => void): () => void;
  listStatusUpdates(): Promise<StatusUpdate[]>;
  addStatusUpdate(input: { project_id: string; health: ProjectHealth; text: string; at?: string; actor_name?: string }): Promise<StatusUpdate>;
  listTemplates(): Promise<Template[]>;
  saveTemplate(input: { name: string; item_id: string }): Promise<Template>;
  deleteTemplate(id: string): Promise<void>;
  createFromTemplate(templateId: string, opts: { project_id: string; parent_id: string | null; start: string; title?: string }): Promise<string[]>;
  listActivity(projectId: string): Promise<Activity[]>;
  listComments(projectId: string): Promise<Comment[]>;
  addComment(input: { item_id: string; text: string; author_id: string | null; author_name?: string; parent_id?: string | null; created_at?: string }): Promise<Comment>;
  editComment(id: string, text: string): Promise<Comment>;
  deleteComment(id: string): Promise<number>;
  updateDependency(id: string, patch: { type?: Dependency["type"]; lag?: number }): Promise<Dependency>;
  deleteDependency(id: string): Promise<void>;
}
