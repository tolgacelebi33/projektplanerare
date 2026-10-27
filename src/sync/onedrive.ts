/** Datafilen i användarens egen OneDrive (Microsoft Graph). Ett enda JSON-dokument; eTag skyddar mot att skriva över en nyare version. */
const GRAPH = "https://graph.microsoft.com/v1.0";
const FILE = "/me/drive/root:/Projektplanerare/data.json";
/** shortcut: enkel uppladdning klarar högst 4 MB, större filer kräver uppladdningssession; bygg den om datan växer förbi gränsen. */
export const MAX_BYTES = 4 * 1024 * 1024;

export class SyncError extends Error {
  constructor(readonly code: "auth" | "conflict" | "locked" | "toobig" | "http", message: string) { super(message); }
}

export interface Remote { etag: string; text: string }
type Fetch = typeof fetch;

const fail = (r: Response): never => {
  if (r.status === 401 || r.status === 403) throw new SyncError("auth", `Inloggningen gäller inte längre (${r.status}).`);
  if (r.status === 412 || r.status === 409) throw new SyncError("conflict", "Filen i OneDrive har ändrats av någon annan.");
  if (r.status === 423) throw new SyncError("locked", "Filen är låst just nu. Försök igen strax.");
  throw new SyncError("http", `OneDrive svarade ${r.status}.`);
};

/** Läser filen. `null` om den inte finns än. */
export async function readRemote(token: string, f: Fetch = fetch): Promise<Remote | null> {
  const h = { Authorization: `Bearer ${token}` };
  const meta = await f(`${GRAPH}${FILE}`, { headers: h });
  if (meta.status === 404) return null;
  if (!meta.ok) fail(meta);
  const etag = ((await meta.json()) as { eTag: string }).eTag;
  const body = await f(`${GRAPH}${FILE}:/content`, { headers: h });
  if (!body.ok) fail(body);
  return { etag, text: await body.text() };
}

/** Skriver filen. `etag` = versionen vi bygger på (null = filen får inte finnas). Ger den nya eTag. */
export async function writeRemote(token: string, text: string, etag: string | null, f: Fetch = fetch): Promise<string> {
  if (new Blob([text]).size > MAX_BYTES) throw new SyncError("toobig", "Datan är för stor för enkel uppladdning (över 4 MB).");
  const r = await f(`${GRAPH}${FILE}:/content`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(etag ? { "If-Match": etag } : { "If-None-Match": "*" }) },
    body: text,
  });
  if (!r.ok) fail(r);
  return ((await r.json()) as { eTag: string }).eTag;
}
