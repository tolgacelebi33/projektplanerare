export type ISODate = string; // YYYY-MM-DD, ren dag utan tidszon

export type Role = "owner" | "admin" | "member" | "viewer";
export type ItemType = "epic" | "milestone" | "task";
export type Status = "not_started" | "in_progress" | "done" | "blocked";
export type Priority = "low" | "normal" | "high" | "urgent";

/** Plats för medlemmar tills fas 4 (auth och roller). Bara id och visningsnamn. */
export interface User { id: string; name: string }

export interface Workspace { id: string; name: string; created_at: string }
export interface Membership { workspace_id: string; user_id: string; role: Role }
/** Vad som händer med efterföljare när en föregångare flyttas: "shift" flyttar dem framåt vid behov (som Asana och monday), "none" gör ingenting. */
export type DependencyMode = "shift" | "none";
export interface Project { id: string; workspace_id: string; name: string; created_at: string; dependency_mode?: DependencyMode }

/** Gruppens färg (Svedbergs palett). Okänd/saknad = automatisk (efter gruppens plats), "none" = ingen. */
export type GroupColor = "gron" | "rod" | "koppar" | "brons" | "guld" | "bla" | "stal";
export const GROUP_COLORS: GroupColor[] = ["gron", "rod", "koppar", "brons", "guld", "bla", "stal"];

export interface Item {
  id: string;
  workspace_id: string;
  project_id: string;
  parent_id: string | null;
  type: ItemType;
  title: string;
  start: ISODate; // första dagen (inklusive)
  end: ISODate; // sista dagen (inklusive)
  status: Status;
  assignee_id: string | null;
  description: string;
  priority: Priority;
  /** Framsteg i hela procent, 0-100. Fristående från status. */
  progress: number;
  /** Gruppens färg, bara meningsfull för en grupp (epic). Saknas eller null: automatisk färg efter plats. "none": ingen färg. */
  color?: GroupColor | "none" | null;
  sort_order: number;
}

export interface Dependency {
  id: string;
  workspace_id: string;
  from_item_id: string;
  to_item_id: string;
  type: "finish_to_start";
}

export interface Fixture {
  workspace: Workspace;
  project: Project;
  items: Item[];
  dependencies: Dependency[];
  users: User[];
}
