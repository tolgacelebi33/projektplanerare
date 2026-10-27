import type { Snapshot } from "../data/MemoryStore";
import { decide, hashOf, unwrap, wrap, type Base } from "./engine";
import { SyncError, readRemote, writeRemote, type Remote } from "./onedrive";

export interface SyncStore { snapshot(): Snapshot; replaceAll(s: Snapshot): Promise<void> }
export interface Io { token(): Promise<string>; read(t: string): Promise<Remote | null>; write(t: string, text: string, etag: string | null): Promise<string> }
export const realIo = (token: () => Promise<string>): Io => ({ token, read: (t) => readRemote(t), write: (t, x, e) => writeRemote(t, x, e) });

/** `none`/`pushed`/`pulled`: klart. `choose`: båda sidor har data som skiljer sig, användaren väljer (anropa igen med `choice`). */
export type Result = { kind: "none" | "pushed" | "pulled" } | { kind: "choose"; why: "first" | "conflict" };
export interface Outcome { result: Result; base: Base | null }

/** Använder aldrig `choice` av sig själv: utan val skrivs inget över när båda sidor har data. Försäkrar sig med eTag att molnet inte ändrats under tiden. */
export async function syncOnce(store: SyncStore, base: Base | null, io: Io, choice?: "local" | "remote"): Promise<Outcome> {
  const tok = await io.token();
  const remote = await io.read(tok);
  const localText = JSON.stringify(store.snapshot());
  const hash = hashOf(localText);
  const plan = choice ? (remote ? (choice === "local" ? "push" : "pull") : "push") : decide(base, hash, remote?.etag ?? null);
  if (plan === "none") return { result: { kind: "none" }, base };
  if (plan === "first" || plan === "conflict") return { result: { kind: "choose", why: plan }, base };
  if (plan === "pull") {
    await store.replaceAll(unwrap(remote!.text) as Snapshot);
    return { result: { kind: "pulled" }, base: { etag: remote!.etag, hash: hashOf(JSON.stringify(store.snapshot())) } };
  }
  try {
    const etag = await io.write(tok, wrap(store.snapshot()), remote?.etag ?? null);
    return { result: { kind: "pushed" }, base: { etag, hash } };
  } catch (e) {
    if (e instanceof SyncError && e.code === "conflict") return { result: { kind: "choose", why: "conflict" }, base };
    throw e;
  }
}
