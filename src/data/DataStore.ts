import type { DependencyMode, Dependency, Item, Project, User } from "./types";

/** UI pratar bara med detta gränssnitt. Alla anrop är asynkrona. */
export interface DataStore {
  listProjects(): Promise<Project[]>;
  /** Medlemmar som kan vara ansvariga. Platshållare tills fas 4. */
  listUsers(): Promise<User[]>;
  createProject(p: Omit<Project, "id" | "created_at">): Promise<Project>;
  updateProject(id: string, patch: { name?: string; dependency_mode?: DependencyMode }): Promise<Project>;
  /** Tar bort projektet med alla poster och beroenden. */
  deleteProject(id: string): Promise<void>;
  listItems(projectId: string): Promise<Item[]>;
  createItem(item: Omit<Item, "id">): Promise<Item>;
  updateItem(id: string, patch: Partial<Omit<Item, "id" | "workspace_id" | "project_id">>): Promise<Item>;
  deleteItem(id: string): Promise<void>;
  listDependencies(projectId: string): Promise<Dependency[]>;
  createDependency(dep: Omit<Dependency, "id">): Promise<Dependency>;
  deleteDependency(id: string): Promise<void>;
}
