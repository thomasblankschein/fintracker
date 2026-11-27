// Minimaler Service Worker: Die App-Hülle (HTML, JS, CSS, Icons) wird gecacht, damit die App auch ohne
// Netz startet und Einträge in die Warteschlange legen kann. Die API (/api/) wird NIE gecacht.
const CACHE = "fintracker-mobile-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const res = await fetch("/", { cache: "reload" });
      const html = await res.clone().text();
      // Vorab alles laden, worauf die Startseite verweist (gehashte Dateien unter /assets)
      const urls = new Set(["/", "/manifest.webmanifest", "/icons/apple-touch-icon.png", "/icons/icon-192.png"]);
      for (const m of html.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)) urls.add(m[1]);
      await cache.put("/", res);
      await Promise.all(
        [...urls]
          .filter((u) => u !== "/")
          .map((u) => cache.add(u).catch(() => undefined))
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
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
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req.mode === "navigate" ? "/" : req, res.clone());
          return res;
        })
        .catch(() => undefined);
      return cached ?? (await network) ?? new Response("Offline", { status: 503 });
    })()
  );
});
