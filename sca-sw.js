/* ========================================================================== */
/* Seminar Cloud App – Service Worker (sca-sw.js)
/* v7: Corrects CORS cache. This is the final version.
/* ========================================================================== */

// ✅ BUMPED: Version your cache so updates invalidate old content
const CACHE_NAME = "seminar-cloud-cache-v7";

const ASSETS_TO_CACHE = [
  "./",
  "./index.html?v=7",
  "./scripts/main.js?v=7",
  "./scripts/ui.js?v=7",
  "./scripts/auth.js?v=7",
  "./scripts/firestore.js?v=7",
  "./scripts/record.js?v=7",
  "./manifest.json?v=7",
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
            // ✅ UPDATED: Manually fetch and cache cross-origin requests
            // This is the correct way to cache 'no-cors' requests
            return fetch(new Request(assetUrl, { mode: 'no-cors' }))
              .then(response => {
                return cache.put(assetUrl, response);
              })
              .catch(err => {
                console.warn(`[SW] Failed to cache (CORS) ${assetUrl}:`, err);
              });
          } else {
            // Local asset
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
        return self.clients.claim(); // ✅ Immediate control
      })
  );
});

/* -------------------------------------------------------------------------- */
/* FETCH – Safe caching with Firebase Auth bypass
/* -------------------------------------------------------------------------- */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 🚫 Skip Firebase Auth and Google identity endpoints
  if (
    url.pathname.startsWith("/__/auth/") ||
    url.hostname.includes("accounts.google.com") ||
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("securetoken.googleapis.com")
  ) {
    console.log("[SW] Skipping auth request (network only):", url.href);
    return;
  }

  // ✅ Cache-first strategy for static assets
  event.respondWith(
    caches.match(event.request).then(async (cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      try {
        const networkResponse = await fetch(event.request);
        if (
          event.request.method === "GET" && 
          networkResponse && 
          networkResponse.status === 200 && 
          networkResponse.type === 'basic'
        ) {
          const cloned = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
        }
        return networkResponse;
      } catch (err) {
        if (event.request.mode === "navigate") {
          return caches.match("./index.html?v=7"); // Make sure to match the cached version
        }
      }
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