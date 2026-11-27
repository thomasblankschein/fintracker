// Minimaler Service Worker: Die App-Hülle (HTML, JS, CSS, Icons) wird gecacht, damit die App auch ohne
// Netz startet und Einträge in die Warteschlange legen kann. Die API (/api/) wird NIE gecacht.
const CACHE = "fintracker-mobile-v2";
// Gespeicherte Server-Zugangsdaten (Basic-Auth) legt die Seite hier ab; localStorage ist im Service Worker nicht lesbar.
const CREDS_CACHE = "fintracker-mobile-creds";

// Eigene Netzabfragen des Service Workers (Vorab-Laden, Aktualisieren im Hintergrund) tragen die Zugangsdaten mit,
// sonst würde ein Proxy mit Basic-Auth davor sie mit 401 abweisen und die App-Hülle nie aktualisiert.
async function authInit() {
  try {
    const hit = await (await caches.open(CREDS_CACHE)).match("/__creds");
    if (!hit) return null;
    const { user, password } = await hit.json();
    let bin = "";
    new TextEncoder().encode(user + ":" + password).forEach((b) => (bin += String.fromCharCode(b)));
    return { headers: { Authorization: "Basic " + btoa(bin) }, credentials: "omit" };
  } catch {
    return null;
  }
}

async function netFetch(req, extra) {
  const init = await authInit();
  if (!init) return fetch(req, extra); // ohne gespeicherte Zugangsdaten unverändert (Browser-Zugangsdaten gelten weiter)
  return fetch(typeof req === "string" ? req : req.url, { ...init, ...extra });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const res = await netFetch("/", { cache: "reload" });
      // Eine 401-Seite (Basic-Auth/Proxy) darf nicht als App-Hülle gecacht werden
      if (!res.ok) throw new Error("Shell nicht abrufbar: " + res.status);
      const html = await res.clone().text();
      // Vorab alles laden, worauf die Startseite verweist (gehashte Dateien unter /assets)
      const urls = new Set(["/", "/manifest.webmanifest", "/icons/apple-touch-icon.png", "/icons/icon-192.png"]);
      for (const m of html.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)) urls.add(m[1]);
      await cache.put("/", res);
      await Promise.all(
        [...urls]
          .filter((u) => u !== "/")
          .map((u) =>
            netFetch(u)
              .then((r) => (r.ok ? cache.put(u, r) : undefined))
              .catch(() => undefined)
          )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE && key !== CREDS_CACHE) await caches.delete(key);
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Stale-while-revalidate: sofort aus dem Cache antworten, im Hintergrund aktualisieren
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req.mode === "navigate" ? "/" : req);
      const network = netFetch(req)
        .then((res) => {
          if (res.ok) cache.put(req.mode === "navigate" ? "/" : req, res.clone());
          return res;
        })
        .catch(() => undefined);
      return cached ?? (await network) ?? new Response("Offline", { status: 503 });
    })()
  );
});
