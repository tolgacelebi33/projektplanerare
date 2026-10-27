/** Inloggning mot användarens egen Entra (MSAL, kod + PKCE). Laddas först när synk används, så vanlig start inte påverkas. */
import type { IPublicClientApplication } from "@azure/msal-browser";

export interface SyncConfig { clientId: string; tenantId: string }
const KEY = "projektplanerare.sync";
const SCOPES = ["Files.ReadWrite"];
export interface SyncState extends Partial<SyncConfig> { etag?: string; hash?: string; last?: string; auto?: boolean }

/** Program-ID och katalog-ID är inte hemliga (de syns i vilken inloggningsadress som helst); de ligger här så att ny enhet inte behöver skriva in dem. */
export const DEFAULTS: SyncConfig = { clientId: "3d00acf1-28f5-4413-9ee9-977966512e3d", tenantId: "19c8ee62-a8e6-4d23-bb19-d5076555d8a2" };
export const configOf = (s: SyncState): SyncConfig => ({ clientId: s.clientId || DEFAULTS.clientId, tenantId: s.tenantId || DEFAULTS.tenantId });
export const LOGGED_IN_KEY = "projektplanerare.syncLoggedIn";

export const loadSync = (): SyncState => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as SyncState; } catch { return {}; } };
export const saveSync = (s: SyncState): void => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignoreras: synken får då bara be om inställningarna igen */ } };

let app: { key: string; p: Promise<IPublicClientApplication> } | null = null;
const client = (c: SyncConfig) => {
  const key = `${c.tenantId}/${c.clientId}`;
  if (app?.key !== key) app = { key, p: import("@azure/msal-browser").then((m) => m.createStandardPublicClientApplication({
    auth: { clientId: c.clientId, authority: `https://login.microsoftonline.com/${c.tenantId}`, redirectUri: `${location.origin}/` },
    cache: { cacheLocation: "localStorage" },
  })) };
  return app.p;
};

/** Anropas vid start: tar emot svaret när användaren kommer tillbaka från inloggningen. */
export async function finishLogin(c: SyncConfig): Promise<boolean> {
  const a = await client(c);
  const r = await a.handleRedirectPromise();
  if (r?.account) a.setActiveAccount(r.account);
  else if (!a.getActiveAccount() && a.getAllAccounts()[0]) a.setActiveAccount(a.getAllAccounts()[0]);
  return !!a.getActiveAccount();
}
export async function login(c: SyncConfig): Promise<void> { await (await client(c)).loginRedirect({ scopes: SCOPES }); }
export async function logout(c: SyncConfig): Promise<void> { const a = await client(c); const acc = a.getActiveAccount(); if (acc) await a.clearCache({ account: acc }); }
export async function accountName(c: SyncConfig): Promise<string | null> { return (await client(c)).getActiveAccount()?.username ?? null; }
/** Ger en giltig token, eller kastar så att användaren får logga in igen. */
export async function token(c: SyncConfig): Promise<string> {
  const a = await client(c); const account = a.getActiveAccount();
  if (!account) throw new Error("Inte inloggad.");
  try { return (await a.acquireTokenSilent({ scopes: SCOPES, account })).accessToken; }
  catch { await a.acquireTokenRedirect({ scopes: SCOPES, account }); throw new Error("Loggar in igen..."); }
}
