import { useEffect, useState, type ReactNode } from "react";
import { LOGGED_IN_KEY, configOf, finishLogin, loadSync, login } from "./auth";
import { sv } from "../i18n/sv";

/** Spärr före appen i den publicerade versionen: bara ett konto i organisationens katalog släpps in. Ingen spärr lokalt (utveckling, tester). shortcut: grinden ligger i webbläsaren, sidans filer är fortfarande publika; äkta skydd kräver en server framför. */
export const gateOn = (): boolean => !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && !new URLSearchParams(location.search).has("fixture");

export function Gate({ children }: { children: ReactNode }) {
  const [st, setSt] = useState<"check" | "out" | "in">(gateOn() ? "check" : "in");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (st !== "check") return;
    finishLogin(configOf(loadSync())).then((ok) => setSt(ok ? "in" : "out")).catch((e) => { setErr(e instanceof Error ? e.message : String(e)); setSt("out"); });
  }, [st]);
  if (st === "in") return <>{children}</>;
  const t = sv.gate;
  return (
    <main className="gate" role="main">
      <h1>Projektplanerare</h1>
      {st === "check" ? <p role="status">{t.checking}</p> : (<>
        <p>{t.intro}</p>
        <button type="button" className="mini mini-primary" onClick={() => { try { localStorage.setItem(LOGGED_IN_KEY, "1"); } catch { /* ignoreras */ } void login(configOf(loadSync())).catch((e) => setErr(String(e))); }}>{t.login}</button>
        {err && <p role="alert" className="people-error">{err}</p>}
      </>)}
    </main>
  );
}
