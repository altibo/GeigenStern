// Offline shell: caches the app on install (network-first for pages, cache-first for assets).
const PREFIX = `geigenstern:${self.registration.scope}:`;
const CACHE = `${PREFIX}ea1489ab6099`;
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./assets/index-Cl4s374r.js", "./assets/index-CmFgv5BI.css", "./assets/nunito-BwcTM8Z6.woff2"];
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL.map((p) => new URL(p, self.location.href).href));
      await self.skipWaiting();
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE && key.startsWith(PREFIX)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (event.request.mode === "navigate") {
        try {
          return await fetch(event.request);
        } catch {
          return (await cache.match(new URL("./", self.location.href).href)) || Response.error();
        }
      }
      return (await cache.match(event.request, { ignoreSearch: true })) || fetch(event.request);
    })(),
  );
});
