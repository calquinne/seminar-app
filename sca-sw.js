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
/* FETCH – Safe caching with Firebase Auth bypass
/* -------------------------------------------------------------------------- */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // ✅ UPDATED: Stricter rules from the new analysis
  if (
    url.pathname.startsWith("/__/auth/") ||
    url.pathname.startsWith("/__/firebase/init.js") || // Added this
    url.hostname.includes("accounts.google.com") ||
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("securetoken.googleapis.com")
  ) {
    console.log("[SW] Skipping auth request (network only):", url.href);
    return; // Let the browser handle it
  }
// 🚨 NEW: Always bypass Firebase Storage uploads
if (url.hostname.includes("firebasestorage.googleapis.com")) {
  console.log("[SW] Skipping Firebase Storage request:", url.href);
  return;   // Let the browser do its normal thing
}

  // Cache-first strategy
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
          return caches.match(`./index.html?v=${APP_VERSION}`); // Match versioned index
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