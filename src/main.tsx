import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../design/tokens.css";
import "./styles.css";
import { App } from "./App";
import { Gate } from "./sync/Gate";
import { applyTheme, getTheme } from "./theme";
import { setLang, storedLang } from "./i18n/sv";

setLang(storedLang()); // html lang följer språket
applyTheme(getTheme()); // före första rendering, så att inget tema blinkar förbi

// Offline-stöd (bara i den publicerade versionen: i utvecklingsläget skulle ett sparat minne ge gamla filer)
if (import.meta.env.PROD && "serviceWorker" in navigator) window.addEventListener("load", () => { void navigator.serviceWorker.register("/sw.js").catch(() => undefined); });

// ?strict=0 stänger av StrictMode (för att isolera dubbelmonterings-effekter vid felsökning och mätning)
const strict = new URLSearchParams(location.search).get("strict") !== "0";
createRoot(document.getElementById("root")!).render(strict ? <StrictMode><Gate><App /></Gate></StrictMode> : <Gate><App /></Gate>);
