/*
 * Offline-stöd. Appen och dess filer sparas när man besökt sidan en gång online, så att den startar utan nät (datan ligger i webbläsaren).
 * - Sidans HTML hämtas från nätet först (så en ny version kommer direkt), och den sparade används om nätet saknas.
 * - Filer under /assets och /icons har namn med innehållsstämpel och ändras aldrig: de hämtas från minnet först.
 * - Allt annat (till exempel anrop till andra adresser) rörs inte.
 * Byt VERSION för att tömma minnet.
 */
const VERSION = "pp-v1";
const SHELL = "/";

self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.add(SHELL).catch(() => undefined)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(SHELL, copy)); return res; }).catch(() => caches.match(SHELL).then((r) => r ?? Response.error())));
    return;
  }
  if (/^\/(assets|icons|fonts)\//.test(url.pathname) || url.pathname === "/manifest.webmanifest") {
    e.respondWith(caches.match(req).then((hit) => hit ?? fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; })));
  }
});
