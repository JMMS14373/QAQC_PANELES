/* Service worker — QAQC Paneles
   Cachea el "app shell" para que el formulario abra y funcione sin conexión
   en el celular/tablet del inspector después de la primera visita.
   Sube CACHE_NAME cada vez que cambies index.html/manifest/iconos para forzar
   que los dispositivos ya instalados recojan la versión nueva. */

const CACHE_NAME = "qaqc-paneles-v13";

const APP_SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./fonts/wqy-zenhei-subset.b64.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // SheetJS (cdnjs) y otras librerías externas de terceros: dejar pasar sin interceptar,
  // para no interferir con la carga diferida de la exportación/importación de Excel.
  if (req.url.indexOf("cdnjs.cloudflare.com") !== -1) return;

  // Navegación (abrir/recargar la app): red primero, si falla usa la copia en caché.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", res.clone()));
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // Mismo origen (app shell, iconos): caché primero, red como respaldo y actualización.
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone()));
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  } else {
    // Origen externo (Google Fonts): red primero; si no hay conexión, usa lo cacheado
    // de una visita anterior. Si nunca se cacheó, la tipografía cae a la del sistema
    // (definida en el CSS), así que no bloquea la app.
    event.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req))
    );
  }
});
