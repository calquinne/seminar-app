/* ========================================================================== */
/* Seminar Cloud App – Service Worker (sca-sw.js)
/* Firebase-safe + Offline caching + Update notifier
/* ========================================================================== */

// ⚙️ Version your cache so updates invalidate old content
const CACHE_NAME = "seminar-cloud-cache-v1"; // Bump this to v2, v3 etc. when you deploy changes

// ✅ Files to pre-cache
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
        console.log("[SW] Caching assets:", ASSETS_TO_CACHE);
        return Promise.all(
          ASSETS_TO_CACHE.map(asset => {
            return cache.add(asset).catch(err => {
              console.warn(`[SW] Failed to cache ${asset}:`, err);
            });
          })
        );
      })
      .then(() => self.skipWaiting()) // ✅ Immediately activate new SW
      .catch((err) => console.error("[SW] Install error:", err))
  );
});

/* -------------------------------------------------------------------------- */
/* ACTIVATE – Cleanup old caches + claim clients
/* -------------------------------------------------------------------------- */
self.addEventListener("activate", (event) => {
  console.log("[SW] Activating and cleaning old caches...");
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => {
        console.log("[SW] Old caches removed");
        return self.clients.claim(); // Take control immediately
      })
  );
});

/* -------------------------------------------------------------------------- */
/* FETCH – Safe caching with Firebase Auth bypass
/* -------------------------------------------------------------------------- */
self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  // 🚫 Skip Firebase Auth and Google identity endpoints to prevent redirect loops
  if (
    url.includes("/__/auth/") ||
    url.includes("accounts.google.com") ||
    url.includes("googleapis.com/identitytoolkit") ||
    url.includes("securetoken.googleapis.com")
  ) {
    console.log("[SW] Skipping Firebase Auth request (network only):", url);
    return; // Let the browser handle it (network first)
  }

  // ✅ Cache-first strategy for static assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      // Fetch from network and cache it for next time
      return fetch(event.request)
        .then((networkResponse) => {
          // Check for valid, cacheable responses
          if (
            event.request.method === "GET" && 
            networkResponse && 
            networkResponse.status === 200 && 
            (networkResponse.type === 'basic' || networkResponse.type === 'cors') // Cache CDN assets
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
/* 🔄 UPDATE NOTIFIER – Tell clients when a new SW is ready
/* -------------------------------------------------------------------------- */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    console.log("[SW] Received SKIP_WAITING message. Activating new version.");
    self.skipWaiting();
  }
});