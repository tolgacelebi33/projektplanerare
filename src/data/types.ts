export type ISODate = string; // YYYY-MM-DD, ren dag utan tidszon

export type Role = "owner" | "admin" | "member" | "viewer";
export type ItemType = "epic" | "milestone" | "task";
export type Status = "not_started" | "in_progress" | "done" | "blocked";
export type Priority = "low" | "normal" | "high" | "urgent";

/** Plats för medlemmar tills fas 4 (auth och roller). Bara id och visningsnamn. */
export interface User { id: string; name: string; /** Timmar per vecka (för belastningen i timmar). Saknas: ingen kapacitet satt. */ capacity?: number }
export const MAX_CAPACITY = 168;
export const ESTIMATE_MAX = 10_000;
export const MAX_CO_ASSIGNEES = 10;

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
  /** Projektets egna statusar (i visad ordning). Saknas de gäller de fyra grundstatusarna. */
  statuses?: StatusDef[];
  /** Baslinje: planens datum vid en tidpunkt, för att se glidning. Posterna är nycklar (id). */
  baseline?: Baseline;
  /** Läsbar kod (PRJ0001). Delas ut av lagret, aldrig av användaren, och återanvänds aldrig. */
  code?: string;
}

/** En kommentar på en post. Egen post (inte en lista på posten), så att den kan synkas och sammanfogas senare. Ett svar har `parent_id` (en nivå). */
export interface Comment {
  id: string; workspace_id: string; project_id: string; item_id: string;
  parent_id: string | null;
  /** Författaren (person) eller null. `author_name` är namnet när kommentaren skrevs, så att den går att läsa även om personen tas bort. */
  author_id: string | null; author_name: string;
  text: string;
  created_at: string; edited_at?: string;
}
/**
 * Historik över vad som hänt med en post (loggen). Skrivs av lagret, aldrig för hand, och kan inte ändras. Strukturerad (inte färdig text), så att den
 * visas på det språk som är valt. `field` är vad som ändrats, `from` och `to` värdena (status och prioritet som nyckel), `other` titeln på en annan post
 * (beroenden), `dir` om den andra posten är föregångare (pred) eller efterföljare (succ).
 */
export type ActivityKind = "created" | "changed" | "moved" | "dep_added" | "dep_changed" | "dep_removed";
export interface Activity {
  id: string; workspace_id: string; project_id: string; item_id: string;
  at: string;
  /** Den som gjorde ändringen och namnet då (personen kan tas bort senare). Tomt namn: okänd. */
  actor_id: string | null; actor_name: string;
  kind: ActivityKind;
  field?: string; from?: string; to?: string;
  other?: string; dir?: "pred" | "succ"; dep_type?: DependencyType; lag?: number;
  /** Ändringen gjordes av en regel (en efterföljare som flyttades, en grupps datum som räknades om) och inte direkt på posten. */
  auto?: boolean;
  /** Ändringen kom av Ångra eller Gör om. */
  undo?: boolean;
}
export const ACTIVITY_LIMITS = { perItem: 300, total: 100_000 } as const;

/** Projektets hälsa. Den aktuella är den senaste statusuppdateringen. Uppdateringarna är en historik (som loggen): de skrivs, de ändras inte. */
export type ProjectHealth = "on_track" | "at_risk" | "off_track" | "on_hold" | "done";
export const PROJECT_HEALTH: ProjectHealth[] = ["on_track", "at_risk", "off_track", "on_hold", "done"];
export interface StatusUpdate {
  id: string; workspace_id: string; project_id: string;
  at: string; actor_id: string | null; actor_name: string;
  health: ProjectHealth; text: string;
}
export const STATUS_UPDATE_LIMITS = { text: 1000, perProject: 200 } as const;

/**
 * Mall: en post, eller en grupp med hela sitt innehåll, som kan skapas igen på ett annat datum. Datumen sparas som avstånd från rotens start.
 * Status, framsteg, ansvarig, kommentarer och logg följer inte med (en ny kopia börjar om). Beroenden mellan posterna i mallen följer med.
 */
export interface TemplateNode {
  key: string; parent: string | null; type: ItemType; title: string;
  offset: number; len: number; priority: Priority; description: string;
  color?: GroupColor | "none" | null; labels?: string[]; checklist?: string[];
}
export interface TemplateDep { from: string; to: string; type: DependencyType; lag?: number }
export interface Template { id: string; workspace_id: string; name: string; created_at: string; nodes: TemplateNode[]; deps: TemplateDep[] }
export const TEMPLATE_LIMITS = { count: 50, nodes: 500, name: 60 } as const;

export const COMMENT_LIMITS = { text: 2000, perItem: 500, total: 50_000 } as const;

export interface Baseline { saved_at: string; items: Record<string, { start: string; end: string }> }
export const MAX_BASELINE_ITEMS = 50_000;

/**
 * Egen status: ett namn som hör till en av de fyra grundkategorierna (Ej påbörjad, Pågår, Klar, Blockerad). Kategorin styr allt som beror på status
 * (försenat, klart, belastning, färg och symbol), namnet är det man ser och väljer. Id lika med kategorins nyckel är grundstatusen.
 */
export interface StatusDef { id: string; name: string; category: Status }
export const STATUS_LIMITS = { count: 30, name: 40 } as const;

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
  id: string; name: string; view: "gantt" | "wheel" | "board" | "calendar" | "week" | "workload" | "portfolio" | "report"; zoom: "day" | "week" | "month"; boardGroup: string; columns: string[]; filter: SavedViewFilter;
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
  /** Fler ansvariga utöver `assignee_id` (den första). Samma person står aldrig två gånger. */
  assignees?: string[];
  /** Uppskattning i timmar (0 till 10 000). Saknas: ingen uppskattning. */
  estimate?: number | null;
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
  /** Id för en egen status i projektet (se `Project.statuses`). `status` är dess kategori. Saknas: grundstatusen. */
  custom_status?: string | null;
  /** Gemensamt id för posterna i en återkommande serie (en milstolpe som upprepas). Varje tillfälle är en egen post som kan göras klar för sig. */
  series?: string | null;
  /** Hur ofta serien upprepas. Samma på alla poster i serien. */
  recur?: Recurrence | null;
  /** Läsbar kod (till exempel MIL0001-0041). Delas ut av lagret när posten skapas och kan inte ändras. */
  code?: string;
  /** Kod eller ID som posten hade i en importerad fil eller en kopierad post. Bara en hänvisning, ingen nyckel. */
  ref?: string;
  sort_order: number;
}

export type DependencyType = "finish_to_start" | "start_to_start" | "finish_to_finish" | "start_to_finish";
export const DEPENDENCY_TYPES: DependencyType[] = ["finish_to_start", "start_to_start", "finish_to_finish", "start_to_finish"];
export const MAX_LAG = 365;
export interface Dependency {
  id: string;
  workspace_id: string;
  from_item_id: string;
  to_item_id: string;
  /** Slut-start (standard), start-start, slut-slut eller start-slut. */
  type: DependencyType;
  /** Fördröjning i hela dagar (negativt = försprång). Saknas: 0. */
  lag?: number;
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
