// Service Worker — Inspeccion de Labores v3.2
// Optimizado para iOS Safari y Android Chrome

var CACHE_NAME = "inspeccion-labores-v3.9";
var APP_SHELL = [
  "/inspeccion-labores/",
  "/inspeccion-labores/index.html",
  "/inspeccion-labores/manifest.json"
];

// Instalacion: cachear shell de la app
self.addEventListener("install", function(e){
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return Promise.allSettled(
        APP_SHELL.map(function(url){
          return cache.add(url).catch(function(err){
            console.warn("No se pudo cachear:", url, err);
          });
        })
      );
    }).then(function(){
      return self.skipWaiting();
    })
  );
});

// Activacion: limpiar caches viejos y tomar control inmediato
self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys().then(function(names){
      return Promise.all(
        names.filter(function(n){ return n !== CACHE_NAME; })
             .map(function(n){ return caches.delete(n); })
      );
    }).then(function(){
      return self.clients.claim();
    })
  );
});

// Fetch: estrategia Network First para la app, cache fallback offline
self.addEventListener("fetch", function(e){
  var url = e.request.url;

  // NUNCA interceptar peticiones a Google o CDNs externos
  if(url.indexOf("google") !== -1 ||
     url.indexOf("googleapis") !== -1 ||
     url.indexOf("cloudflare") !== -1 ||
     url.indexOf("github.com") !== -1 ||
     e.request.method !== "GET"){
    return;
  }

  // Para la app local: Network First con fallback a cache
  e.respondWith(
    fetch(e.request).then(function(response){
      // Si la respuesta es buena, actualizamos el cache
      if(response && response.status === 200 && response.type === "basic"){
        var responseClone = response.clone();
        caches.open(CACHE_NAME).then(function(cache){
          cache.put(e.request, responseClone);
        });
      }
      return response;
    }).catch(function(){
      // Sin red: servir desde cache
      return caches.match(e.request).then(function(cached){
        if(cached) return cached;
        // Fallback a index.html para rutas de la app
        return caches.match("/inspeccion-labores/") ||
               caches.match("/inspeccion-labores/index.html");
      });
    })
  );
});

// Mensaje para forzar actualizacion desde la app
self.addEventListener("message", function(e){
  if(e.data && e.data.action === "skipWaiting"){
    self.skipWaiting();
  }
});
