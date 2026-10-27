import { useCallback, useEffect, useRef, useState } from "react";
import { LOGGED_IN_KEY, accountName, configOf, finishLogin, loadSync, login, logout, saveSync, token, type SyncConfig, type SyncState } from "./auth";
import { realIo, syncOnce, type SyncStore, type Result } from "./run";
import { SyncError } from "./onedrive";

export interface SyncUi {
  cfg: SyncConfig; state: SyncState; account: string | null; busy: boolean; msg: { kind: "error" | "info"; text: string } | null; choose: "first" | "conflict" | null;
  setCfg(c: SyncConfig): void; setAuto(on: boolean): void; login(): void; logout(): void; run(choice?: "local" | "remote"): Promise<void>;
}

/** `backup`: sparar en säkerhetskopia innan lokal data ersätts av molnets. Efter en hämtning laddas sidan om så att alla vyer visar det nya. */
export function useSync(store: SyncStore & { flush(): Promise<void> }, backup: () => Promise<unknown>, texts: Record<"none" | "pushed" | "pulled", string>): SyncUi {
  const [state, setState] = useState<SyncState>(loadSync);
  const cfg = configOf(state);
  const [account, setAccount] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<SyncUi["msg"]>(null);
  const [choose, setChoose] = useState<SyncUi["choose"]>(null);
  const live = useRef({ state, cfg }); live.current = { state, cfg };
  const patch = (p: Partial<SyncState>) => { const n = { ...live.current.state, ...p }; saveSync(n); setState(n); live.current.state = n; };

  const run = useCallback(async (choice?: "local" | "remote") => {
    const { state: s, cfg: c } = live.current;
    setBusy(true); setMsg(null);
    try {
      if (choice === "remote") await backup();
      await store.flush();
      const o = await syncOnce(store, s.etag && s.hash ? { etag: s.etag, hash: s.hash } : null, realIo(() => token(c)), choice);
      const r: Result = o.result;
      if (r.kind === "choose") { setChoose(r.why); return; }
      setChoose(null);
      patch({ etag: o.base?.etag, hash: o.base?.hash, last: new Date().toISOString().slice(0, 16).replace("T", " ") });
      setMsg({ kind: "info", text: texts[r.kind] });
      if (r.kind === "pulled") setTimeout(() => location.reload(), 600);
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof SyncError || e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, backup]);

  // Vid start: ta emot svaret från inloggningen och synka en gång om kontot är kopplat.
  useEffect(() => {
    if (!localStorage.getItem(LOGGED_IN_KEY)) return;
    let dead = false;
    void (async () => {
      try {
        if (!(await finishLogin(live.current.cfg)) || dead) return;
        setAccount(await accountName(live.current.cfg));
        await run();
      } catch (e) { if (!dead) setMsg({ kind: "error", text: e instanceof Error ? e.message : String(e) }); }
    })();
    return () => { dead = true; };
  }, [run]);

  useEffect(() => {
    if (!state.auto || !account) return;
    const id = setInterval(() => { if (!document.hidden && !busy) void run(); }, 60_000);
    return () => clearInterval(id);
  }, [state.auto, account, busy, run]);

  return {
    cfg, state, account, busy, msg, choose,
    setCfg: (c) => patch({ clientId: c.clientId.trim(), tenantId: c.tenantId.trim() }),
    setAuto: (on) => patch({ auto: on }),
    login: () => { try { localStorage.setItem(LOGGED_IN_KEY, "1"); } catch { /* ignoreras */ } void login(cfg).catch((e) => setMsg({ kind: "error", text: String(e) })); },
    logout: () => { try { localStorage.removeItem(LOGGED_IN_KEY); } catch { /* ignoreras */ } void logout(cfg).then(() => { setAccount(null); patch({ etag: undefined, hash: undefined, last: undefined, auto: false }); location.reload(); }); },
    run,
  };
}
