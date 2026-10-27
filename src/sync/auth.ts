/** Inloggning mot användarens egen Entra (MSAL, kod + PKCE). Laddas först när synk används, så vanlig start inte påverkas. */
import type { IPublicClientApplication } from "@azure/msal-browser";

export interface SyncConfig { clientId: string; tenantId: string }
const KEY = "projektplanerare.sync";
const SCOPES = ["Files.ReadWrite"];
export interface SyncState extends Partial<SyncConfig> { etag?: string; hash?: string; last?: string; auto?: boolean }

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
