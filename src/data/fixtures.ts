import { addDays, diffDays } from "./dates";
import type { Dependency, Fixture, Item, ItemType, Priority, Status, User } from "./types";

const WS = "ws_1";
const PROJ = "proj_1";

/** Platshållare för medlemmar (fas 4 ersätter med riktig auth). */
export const FIXTURE_USERS: User[] = [
  { id: "u_anna", name: "Anna Lind" },
  { id: "u_erik", name: "Erik Berg" },
  { id: "u_maria", name: "Maria Holm" },
];

const ASSIGNEES = ["u_anna", "u_erik", "u_maria", null] as const;
const PRIORITIES: Priority[] = ["normal", "normal", "high", "low", "urgent"];

function workspace() {
  return { id: WS, name: "Privat", created_at: "2026-01-01T00:00:00.000Z" };
}

type Row = [id: string, parent: string | null, type: ItemType, title: string, start: string, end: string, status: Status];

function toItems(rows: Row[], project = PROJ): Item[] {
  return rows.map(([id, parent, type, title, start, end, status], i) => ({
    id, workspace_id: WS, project_id: project, parent_id: parent, type, title, start, end, status,
    assignee_id: ASSIGNEES[i % ASSIGNEES.length], description: i % 3 === 0 ? `Beskrivning för ${title.toLowerCase()}.` : "",
    priority: PRIORITIES[i % PRIORITIES.length], progress: status === "done" ? 100 : status === "in_progress" ? 40 : 0, sort_order: i,
  }));
}

function toDeps(pairs: [string, string][]): Dependency[] {
  return pairs.map(([a, b], i) => ({
    id: `d${i + 1}`, workspace_id: WS, from_item_id: a, to_item_id: b, type: "finish_to_start" as const,
  }));
}

/** Liten fixture: 20 items, 3 nivåer, 8 beroenden, 2 milstolpar, alla statusar. */
export function smallFixture(): Fixture {
  const rows: Row[] = [
    ["i1", null, "epic", "Förstudie", "2026-03-02", "2026-03-13", "done"],
    ["i2", "i1", "task", "Kravinsamling", "2026-03-02", "2026-03-06", "done"],
    ["i3", "i1", "task", "Konkurrentanalys", "2026-03-09", "2026-03-13", "done"],
    ["i4", null, "epic", "Design", "2026-03-16", "2026-04-10", "in_progress"],
    ["i5", "i4", "epic", "Visuell identitet", "2026-03-16", "2026-03-27", "in_progress"],
    ["i6", "i5", "task", "Moodboard", "2026-03-16", "2026-03-20", "done"],
    ["i7", "i5", "task", "Färg och typografi", "2026-03-23", "2026-03-27", "in_progress"],
    ["i8", "i4", "epic", "Gränssnitt", "2026-03-24", "2026-04-09", "blocked"],
    ["i9", "i8", "task", "Wireframes", "2026-03-24", "2026-04-01", "blocked"],
    ["i10", "i8", "task", "Prototyp", "2026-04-02", "2026-04-09", "not_started"],
    ["i11", "i4", "milestone", "Design godkänd", "2026-04-10", "2026-04-10", "not_started"],
    ["i12", null, "epic", "Utveckling", "2026-04-13", "2026-05-15", "not_started"],
    ["i13", "i12", "epic", "Frontend", "2026-04-13", "2026-05-08", "not_started"],
    ["i14", "i13", "task", "Komponentbibliotek", "2026-04-13", "2026-04-24", "not_started"],
    ["i15", "i13", "task", "Sidor", "2026-04-27", "2026-05-08", "not_started"],
    ["i16", "i12", "task", "Backend och API", "2026-04-13", "2026-05-15", "not_started"],
    ["i17", "i12", "milestone", "Kod klar", "2026-05-15", "2026-05-15", "not_started"],
    ["i18", null, "epic", "Lansering", "2026-05-18", "2026-05-29", "not_started"],
    ["i19", "i18", "task", "Test", "2026-05-18", "2026-05-22", "not_started"],
    ["i20", "i18", "task", "Driftsättning", "2026-05-26", "2026-05-29", "not_started"],
  ];
  const deps = toDeps([
    ["i3", "i6"], ["i6", "i9"], ["i9", "i10"], ["i10", "i11"],
    ["i11", "i14"], ["i14", "i15"], ["i15", "i17"], ["i17", "i19"],
  ]);
  return {
    workspace: workspace(),
    project: { id: PROJ, workspace_id: WS, name: "Webbplatslansering", created_at: "2026-01-01T00:00:00.000Z" },
    items: toItems(rows),
    dependencies: deps,
    users: FIXTURE_USERS,
  };
}

/** Deterministisk pseudoslump (mulberry32) så att stor fixture alltid ser lika ut. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stor fixture: 6 x 4 x 3 epics och 3 tasks per lägsta epic = 318 items, 4 nivåer.
 * Beroenden: 72 inom lägsta epics + 24 mellan syskon-epics = 96, alla slut-till-start och datumkonsistenta.
 */
export function largeFixture(): Fixture {
  const rand = rng(42);
  const statuses: Status[] = ["not_started", "in_progress", "done", "blocked"];
  const items: Item[] = [];
  const deps: Dependency[] = [];
  let n = 0;
  const push = (parent: string | null, type: ItemType, title: string, start: string, end: string, status: Status) => {
    const id = `L${++n}`;
    items.push({
      id, workspace_id: WS, project_id: "proj_big", parent_id: parent, type, title, start, end, status,
      assignee_id: ASSIGNEES[n % ASSIGNEES.length], description: "", priority: PRIORITIES[n % PRIORITIES.length],
      progress: status === "done" ? 100 : status === "in_progress" ? 40 : 0, sort_order: n,
    });
    return id;
  };
  const span = (id: string, start: string, end: string) => {
    const it = items.find((x) => x.id === id)!;
    it.start = start; it.end = end;
  };
  const baseStart = "2026-01-05";
  for (let a = 0; a < 6; a++) {
    const l1 = push(null, "epic", `Program ${a + 1}`, baseStart, baseStart, "in_progress");
    let l1End = baseStart;
    for (let b = 0; b < 4; b++) {
      const l2Start = addDays(baseStart, b * 14);
      const l2 = push(l1, "epic", `Delprojekt ${a + 1}.${b + 1}`, l2Start, l2Start, "in_progress");
      let cursor = l2Start;
      let prevGroupLast: string | null = null;
      for (let c = 0; c < 3; c++) {
        const l3 = push(l2, "epic", `Arbetspaket ${a + 1}.${b + 1}.${c + 1}`, cursor, cursor, "in_progress");
        const groupStart = cursor;
        let tCursor = cursor;
        const taskIds: string[] = [];
        for (let d = 0; d < 3; d++) {
          const len = 2 + Math.floor(rand() * 6);
          const end = addDays(tCursor, len - 1);
          const status = statuses[Math.floor(rand() * 4)];
          taskIds.push(push(l3, "task", `Uppgift ${a + 1}.${b + 1}.${c + 1}.${d + 1}`, tCursor, end, status));
          tCursor = addDays(end, 3);
        }
        const groupEnd = items.find((x) => x.id === taskIds[2])!.end;
        span(l3, groupStart, groupEnd);
        deps.push({ id: `d${deps.length + 1}`, workspace_id: WS, from_item_id: taskIds[0], to_item_id: taskIds[1], type: "finish_to_start" });
        if (c === 1 && prevGroupLast) {
          deps.push({ id: `d${deps.length + 1}`, workspace_id: WS, from_item_id: prevGroupLast, to_item_id: taskIds[0], type: "finish_to_start" });
        }
        prevGroupLast = taskIds[2];
        cursor = addDays(groupEnd, 4);
      }
      const l2End = addDays(cursor, -4);
      span(l2, l2Start, l2End);
      if (diffDays(l1End, l2End) > 0) l1End = l2End;
    }
    span(l1, baseStart, l1End);
  }
  return {
    workspace: workspace(),
    project: { id: "proj_big", workspace_id: WS, name: "Stor fixture", created_at: "2026-01-01T00:00:00.000Z" },
    items,
    dependencies: deps,
    users: FIXTURE_USERS,
  };
}

/**
 * Exempelprojektet förskjutet så att "Färg och typografi" (pågår) startar två dagar före `today`: det som är klart ligger före idag, det som pågår
 * omfattar idag och resten ligger framåt. Alla datum flyttas lika mycket, så längder, beroenden och epics härledda datum är intakta.
 * Provdatan med fasta datum (smallFixture) används av testerna och förblir oförändrad.
 */
export function exampleAround(today: string): Fixture {
  const f = smallFixture();
  const delta = diffDays("2026-03-23", addDays(today, -2));
  return { ...f, items: f.items.map((i) => ({ ...i, start: addDays(i.start, delta), end: addDays(i.end, delta) })) };
}

/** Mycket stor fixture för skalprov: `count` poster i grupper om 50 uppgifter, med ett beroende per uppgift (kedja inom gruppen). Bara för tester (?fixture=huge&n=3000). */
export function hugeFixture(count: number): Fixture {
  const rand = rng(7);
  const statuses: Status[] = ["not_started", "in_progress", "done", "blocked"];
  const items: Item[] = [];
  const deps: Dependency[] = [];
  let n = 0;
  const per = 50;
  const groups = Math.max(1, Math.ceil(count / (per + 1)));
  for (let g = 0; g < groups && items.length < count; g++) {
    const gid = `H${++n}`;
    const gStart = addDays("2026-01-05", g * 3);
    items.push({ id: gid, workspace_id: WS, project_id: "proj_big", parent_id: null, type: "epic", title: `Grupp ${g + 1}`, start: gStart, end: gStart, status: "in_progress", assignee_id: null, description: "", priority: "normal", progress: 0, sort_order: n });
    let cursor = gStart, prev: string | null = null;
    for (let t = 0; t < per && items.length < count; t++) {
      const id = `H${++n}`, end = addDays(cursor, 1 + Math.floor(rand() * 5)), status = statuses[Math.floor(rand() * 4)];
      items.push({ id, workspace_id: WS, project_id: "proj_big", parent_id: gid, type: "task", title: `Uppgift ${g + 1}.${t + 1}`, start: cursor, end, status, assignee_id: ASSIGNEES[n % ASSIGNEES.length], description: "", priority: PRIORITIES[n % PRIORITIES.length], progress: status === "done" ? 100 : 0, sort_order: n });
      if (prev) deps.push({ id: `d${deps.length + 1}`, workspace_id: WS, from_item_id: prev, to_item_id: id, type: "finish_to_start" });
      prev = id; cursor = addDays(end, 1);
    }
    const kids = items.filter((i) => i.parent_id === gid);
    const head = items.find((i) => i.id === gid)!;
    head.start = kids[0].start; head.end = kids[kids.length - 1].end;
  }
  return { workspace: workspace(), project: { id: "proj_big", workspace_id: WS, name: "Skalprov", created_at: "2026-01-01T00:00:00.000Z" }, items, dependencies: deps, users: FIXTURE_USERS };
}
