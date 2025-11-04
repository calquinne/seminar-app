/* ========================================================================== */
/* Seminar Cloud App – Service Worker (sca-sw.js)
/* Firebase-safe + Offline caching + Update notifier
/* ========================================================================== */

// ⚙️ Version your cache so updates invalidate old content
const CACHE_NAME = "seminar-cloud-cache-v3"; // Bumped version to v3

const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./scripts/main.js",
  "./scripts/ui.js",
  "./scripts/auth.js",
  "./scripts/firestore.js",
  "./scripts/record.js",
  "./manifest.json",
  "https://cdn.tailwindcss.com",
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
];

/* -------------------------------------------------------------------------- */
/* INSTALL – Pre-cache core app shell
/* -------------------------------------------------------------------------- */
self.addEventListener("install", (event) => {
  console.log("[SW] Installing and caching app shell...");
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log("[SW] Caching assets...");
        
        // ✅ UPDATED: Handle cross-origin (CORS) requests
        const cachePromises = ASSETS_TO_CACHE.map(asset => {
          if (asset.startsWith('http')) {
            // For cross-origin assets, we must use 'no-cors'
            // This caches an "opaque" response, but it works
            return cache.add(new Request(asset, { mode: 'no-cors' })).catch(err => {
              console.warn(`[SW] Failed to cache (CORS) ${asset}:`, err);
            });
          } else {
            // For local assets, cache normally
            return cache.add(asset).catch(err => {
              console.warn(`[SW] Failed to cache (local) ${asset}:`, err);
            });
          }
        });
        
        return Promise.all(cachePromises);
      })
      .then(() => self.skipWaiting())
      .then(() => self.clients.claim())
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
      .then((keys) => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => {
        console.log("[SW] Old caches removed");
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
    url.hostname.includes("googleapis.com") || // Broader rule for google apis
    url.hostname.includes("securetoken.googleapis.com")
  ) {
    console.log("[SW] Skipping auth request (network only):", url.href);
    return; // Let the browser handle it
  }

  // ✅ Cache-first strategy for static assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // If we have a cached response, return it
      if (cachedResponse) {
        return cachedResponse;
      }

      // Fetch from network and cache it
      return fetch(event.request)
        .then((networkResponse) => {
          // Check for valid, cacheable responses
          if (
            event.request.method === "GET" && 
            networkResponse && 
            networkResponse.status === 200 && 
            networkResponse.type === 'basic' // Only cache same-origin assets
          ) {
            const cloned = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
          }
          return networkResponse;
        })
        .catch(() => {
          // Fallback to cached index.html for navigation requests
          if (event.request.mode === "navigate") {
            return caches.match("./index.html");
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