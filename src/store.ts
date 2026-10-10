import { exampleAround, largeFixture, smallFixture } from "./data/fixtures";
import { todayISO } from "./data/dates";
import { MemoryStore } from "./data/MemoryStore";
import { PersistentStore } from "./data/PersistentStore";

export interface AppStore { store: MemoryStore; persistent: boolean; workspaceId: string }

/**
 * Med ?fixture=small|large används provdata i minnet (för tester och demo, sparas inte).
 * Utan parameter används lagring i webbläsaren, och exempelprojektet läggs in första gången.
 */
export function createStore(params: URLSearchParams): AppStore {
  const fix = params.get("fixture");
  const latency = Number(params.get("latency") ?? (fix ? 50 : 0));
  if (fix) {
    const fixture = fix === "large" ? largeFixture() : smallFixture();
    return {
      store: new MemoryStore(fixture, { latencyMs: latency, failOnCall: params.get("fail") === "1" ? (_n, m) => m === "listItems" : undefined }),
      persistent: false, workspaceId: fixture.workspace.id,
    };
  }
  const seed = exampleAround(todayISO()); // exempelprojektet kring dagens datum, så att inget är försenat från start
  return { store: new PersistentStore("projektplanerare.data.v1", seed), persistent: true, workspaceId: seed.workspace.id };
}
