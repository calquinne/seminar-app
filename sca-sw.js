/* ========================================================================== */
/* Seminar Cloud App – Service Worker (sca-sw.js)
/*v13: cache version alignment */
/* ========================================================================== */

// Sync with main.js version manually
const APP_VERSION = "v13";
const CACHE_NAME = `seminar-cloud-cache-${APP_VERSION}`;

// ✅ UPDATED: All local assets are versioned
const ASSETS_TO_CACHE = [
  "./",
  `./index.html?v=${APP_VERSION}`,
  `./scripts/main.js?v=${APP_VERSION}`,
  `./scripts/ui.js?v=${APP_VERSION}`,
  `./scripts/auth.js?v=${APP_VERSION}`,
  `./scripts/firestore.js?v=${APP_VERSION}`,
  `./scripts/record.js?v=${APP_VERSION}`,
  `./manifest.json?v=${APP_VERSION}`,
  "https://cdn.tailwindcss.com",
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
];



/* -------------------------------------------------------------------------- */
/* INSTALL – Pre-cache core app shell
/* -------------------------------------------------------------------------- */
self.addEventListener("install", (event) => {
  console.log(`[SW] Installing and caching app shell (${CACHE_NAME})...`);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log("[SW] Caching assets...");
        
        const cachePromises = ASSETS_TO_CACHE.map(assetUrl => {
          if (assetUrl.startsWith('http')) {
            return fetch(new Request(assetUrl, { mode: 'no-cors' }))
              .then(response => cache.put(assetUrl, response))
              .catch(err => {
                console.warn(`[SW] Failed to cache (CORS) ${assetUrl}:`, err);
              });
          } else {
            return cache.add(assetUrl).catch(err => {
              console.warn(`[SW] Failed to cache (local) ${assetUrl}:`, err);
            });
          }
        });
        
        return Promise.all(cachePromises);
      })
      .then(() => {
        console.log("[SW] Precache complete, skipping waiting...");
        return self.skipWaiting();
      })
      .catch((err) => console.error("[SW] Install error:", err))
  );
});

/* -------------------------------------------------------------------------- */
/* ACTIVATE – Cleanup old caches
/* -------------------------------------------------------------------------- */
self.addEventListener("activate", (event) => {
  console.log("[SW] Activating and cleaning old caches...");
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log("[SW] Deleting old cache:", k);
          return caches.delete(k);
        })
      ))
      .then(() => {
        console.log("[SW] Old caches removed, claiming clients...");
        return self.clients.claim();
      })
  );
});

/* -------------------------------------------------------------------------- */
/* FETCH – HARD BYPASS Firebase & Google APIs (CRITICAL FIX)
   Firebase Storage resumable uploads CANNOT pass through a SW.
   Any interception causes 412 / storage-unknown.
-------------------------------------------------------------------------- */
self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  // 🚫 ABSOLUTE BYPASS — do NOT touch, log, cache, or inspect
  if (
    url.includes("firebasestorage.googleapis.com") ||
    url.includes("googleapis.com") ||
    url.includes("gstatic.com") ||
    url.includes("firebaseinstallations.googleapis.com") ||
    url.includes("securetoken.googleapis.com") ||
    url.includes("/__/firebase/")
  ) {
    return; // let browser handle natively
  }

  // ✅ ONLY cache your own app shell
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          if (
            event.request.method === "GET" &&
            response &&
            response.status === 200 &&
            response.type === "basic"
          ) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) =>
              cache.put(event.request, clone)
            );
          }
          return response;
        })
        .catch(() => {
          if (event.request.mode === "navigate") {
            return caches.match(`./index.html?v=${APP_VERSION}`);
          }
        });
    })
  );
});

/* -------------------------------------------------------------------------- */
/* UPDATE NOTIFIER – Listen for message from UI
/* -------------------------------------------------------------------------- */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    console.log("[SW] Received SKIP_WAITING message. Activating new version.");
    self.skipWaiting();
  }
});