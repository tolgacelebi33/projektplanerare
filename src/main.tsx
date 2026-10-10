import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../design/tokens.css";
import "./styles.css";
import { App } from "./App";
import { applyTheme, getTheme } from "./theme";
import { setLang, storedLang } from "./i18n/sv";

setLang(storedLang()); // html lang följer språket
applyTheme(getTheme()); // före första rendering, så att inget tema blinkar förbi

// ?strict=0 stänger av StrictMode (för att isolera dubbelmonterings-effekter vid felsökning och mätning)
const strict = new URLSearchParams(location.search).get("strict") !== "0";
createRoot(document.getElementById("root")!).render(strict ? <StrictMode><App /></StrictMode> : <App />);
