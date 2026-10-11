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
export interface Project {
  id: string; workspace_id: string; name: string; created_at: string; dependency_mode?: DependencyMode;
  /** Egna fält för projektets poster (definitionerna; värdena ligger på posterna). */
  fields?: FieldDef[];
  /** Sparade vyer (vy, filter, kolumner, gruppering under ett namn). */
  views?: SavedView[];
}

export type FieldType = "text" | "number" | "date" | "select";
/** Ett eget fält. `options` är rullistans val (bara för `select`), `card` att värdet visas på korten. */
export interface FieldDef { id: string; name: string; type: FieldType; options?: string[]; card?: boolean }
export type FieldValue = string | number | null;
export const FIELD_TYPES: FieldType[] = ["text", "number", "date", "select"];
export const FIELD_LIMITS = { fields: 20, name: 40, options: 30, option: 40, text: 500, views: 30, viewName: 60 } as const;

export interface SavedViewFilter {
  query: string; hideDone: boolean; statuses: Status[]; priorities: Priority[]; assignees: string[]; labels: string[];
  /** Val per rullistefält (id): någon av de valda. */
  fields: Record<string, string[]>;
  quick: { overdue: boolean; thisWeek: boolean; noAssignee: boolean; undated: boolean };
}
/** En sparad vy: allt som bestämmer hur projektet visas. `columns` är kolumnerna i listan (egna fält som "f:id"). */
export interface SavedView {
  id: string; name: string; view: "gantt" | "wheel" | "board"; zoom: "day" | "week" | "month"; boardGroup: string; columns: string[]; filter: SavedViewFilter;
}

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
  /** Plats i kolumnen i boardvyn (lägre först). Saknas: efter de med plats, i listans ordning. */
  board_rank?: number | null;
  /** Värden för projektets egna fält, per fält-id. */
  fields?: Record<string, FieldValue>;
  /** Etiketter (fri text, samma namn får samma färg). */
  labels?: string[];
  /** Checklista: delmoment som kan bockas av. */
  checklist?: ChecklistEntry[];
  /** Länkar (http, https eller mailto). */
  links?: LinkEntry[];
  /** Uppdateringslogg: dagbok för posten, äldst först. */
  log?: LogEntry[];
  /** Datumen är platshållare från en import (posten saknade datum). Tas bort när datumen ändras eller användaren väljer att behålla dem. */
  undated?: boolean;
  /** Gemensamt id för posterna i en återkommande serie (en milstolpe som upprepas). Varje tillfälle är en egen post som kan göras klar för sig. */
  series?: string | null;
  /** Hur ofta serien upprepas. Samma på alla poster i serien. */
  recur?: Recurrence | null;
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

export const RECURRENCES = ["weekly", "biweekly", "monthly", "quarterly"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export interface ChecklistEntry { id: string; text: string; done: boolean }
export interface LinkEntry { title: string; url: string }
export interface LogEntry { at: string; text: string }

/** Gränser, så att en post aldrig blir ohanterligt stor och en importerad fil inte kan fylla lagringen. */
export const LIMITS = { labels: 20, labelLength: 40, checklist: 100, checklistText: 200, links: 20, linkTitle: 100, linkUrl: 2000, log: 200, logText: 2000 } as const;
