import { describe, expect, it } from "vitest";
import { decide, hashOf } from "../src/sync/engine";
import { readRemote, writeRemote, SyncError } from "../src/sync/onedrive";
import { syncOnce, type Io, type SyncStore } from "../src/sync/run";
import type { Snapshot } from "../src/data/MemoryStore";

const snap = (n: number) => ({ projects: [], items: [], dependencies: [], users: [], seq: n }) as unknown as Snapshot;
const base = (s: Snapshot, etag: string) => ({ etag, hash: hashOf(JSON.stringify(s)) });

describe("decide", () => {
  it("följer tabellen", () => {
    const b = { etag: "e1", hash: "h" };
    expect(decide(b, "h", null)).toBe("push");
    expect(decide(null, "h", "e1")).toBe("first");
    expect(decide(b, "h", "e1")).toBe("none");
    expect(decide(b, "x", "e1")).toBe("push");
    expect(decide(b, "h", "e2")).toBe("pull");
    expect(decide(b, "x", "e2")).toBe("conflict");
  });
});

describe("syncOnce", () => {
  const mk = (local: Snapshot, remote: { etag: string; text: string } | null, writeErr?: SyncError) => {
    const st = { cur: local, replaced: null as Snapshot | null };
    const store: SyncStore = { snapshot: () => st.cur, replaceAll: async (s) => { st.cur = s; st.replaced = s; } };
    const writes: (string | null)[] = [];
    const io: Io = { token: async () => "t", read: async () => remote, write: async (_t, _x, e) => { writes.push(e); if (writeErr) throw writeErr; return "e9"; } };
    return { st, store, io, writes };
  };
  it("första uppladdningen kräver att filen inte finns", async () => {
    const m = mk(snap(1), null);
    const r = await syncOnce(m.store, null, m.io);
    expect(r.result.kind).toBe("pushed"); expect(m.writes).toEqual([null]);
  });
  it("frågar när båda sidor har data och enheten aldrig synkats, och skriver inget", async () => {
    const m = mk(snap(1), { etag: "e1", text: "{}" });
    const r = await syncOnce(m.store, null, m.io);
    expect(r.result).toEqual({ kind: "choose", why: "first" }); expect(m.writes).toEqual([]); expect(m.st.replaced).toBeNull();
  });
  it("hämtar när bara molnet ändrats", async () => {
    const m = mk(snap(1), { etag: "e2", text: JSON.stringify({ format: "projektplanerare-sync", snapshot: snap(2) }) });
    const r = await syncOnce(m.store, base(snap(1), "e1"), m.io);
    expect(r.result.kind).toBe("pulled"); expect(m.st.cur).toEqual(snap(2)); expect(r.base?.etag).toBe("e2");
  });
  it("frågar vid konflikt och vid 412 under skrivning", async () => {
    const a = mk(snap(3), { etag: "e2", text: "{}" });
    expect((await syncOnce(a.store, base(snap(1), "e1"), a.io)).result).toEqual({ kind: "choose", why: "conflict" });
    const b = mk(snap(3), { etag: "e1", text: "{}" }, new SyncError("conflict", "x"));
    expect((await syncOnce(b.store, base(snap(1), "e1"), b.io)).result).toEqual({ kind: "choose", why: "conflict" });
  });
  it("val 'local' skriver med molnets eTag", async () => {
    const m = mk(snap(3), { etag: "e2", text: "{}" });
    const r = await syncOnce(m.store, null, m.io, "local");
    expect(r.result.kind).toBe("pushed"); expect(m.writes).toEqual(["e2"]);
  });
});

describe("Graph-anrop", () => {
  const res = (status: number, body: unknown = {}, text = "") => ({ status, ok: status < 300, json: async () => body, text: async () => text }) as Response;
  it("404 = ingen fil", async () => { expect(await readRemote("t", (async () => res(404)) as typeof fetch)).toBeNull(); });
  it("läser eTag och innehåll", async () => {
    let n = 0; const f = (async () => (n++ ? res(200, {}, "txt") : res(200, { eTag: "E" }))) as typeof fetch;
    expect(await readRemote("t", f)).toEqual({ etag: "E", text: "txt" });
  });
  it("skriver med If-Match / If-None-Match och mappar felkoder", async () => {
    const seen: Record<string, string>[] = [];
    const f = (async (_u: string, o: RequestInit) => { seen.push(o.headers as Record<string, string>); return res(200, { eTag: "N" }); }) as unknown as typeof fetch;
    expect(await writeRemote("t", "x", "E1", f)).toBe("N"); await writeRemote("t", "x", null, f);
    expect(seen[0]["If-Match"]).toBe("E1"); expect(seen[1]["If-None-Match"]).toBe("*");
    for (const [s, c] of [[412, "conflict"], [423, "locked"], [401, "auth"]] as const)
      await expect(writeRemote("t", "x", "E", (async () => res(s)) as typeof fetch)).rejects.toMatchObject({ code: c });
    await expect(writeRemote("t", "x".repeat(4 * 1024 * 1024 + 1), null, f)).rejects.toMatchObject({ code: "toobig" });
  });
});
