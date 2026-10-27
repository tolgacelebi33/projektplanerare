/** Beslutet i synken: jämför vad som ändrats lokalt och i molnet sedan senaste synk. Skriver aldrig över något av sig själv när båda sidor ändrats. */
export interface Base { etag: string; hash: string }
export type Plan = "none" | "push" | "pull" | "conflict" | "first";

/** `base`: läget vid senaste lyckade synk på den här enheten (null = aldrig synkad). `remoteEtag`: null = filen finns inte. */
export function decide(base: Base | null, localHash: string, remoteEtag: string | null): Plan {
  if (remoteEtag === null) return "push";
  if (!base) return "first";
  const local = localHash !== base.hash, remote = remoteEtag !== base.etag;
  return local && remote ? "conflict" : local ? "push" : remote ? "pull" : "none";
}

export const hashOf = (s: string): string => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return `${s.length}:${h}`; };

export const FORMAT = "projektplanerare-sync";
export const wrap = (snapshot: unknown): string => JSON.stringify({ format: FORMAT, version: 1, saved_at: new Date().toISOString(), snapshot });
export function unwrap(text: string): unknown {
  const o = JSON.parse(text) as { format?: string; snapshot?: unknown };
  if (o.format !== FORMAT || !o.snapshot) throw new Error("Filen i OneDrive är inte en Projektplanerare-fil.");
  return o.snapshot;
}
