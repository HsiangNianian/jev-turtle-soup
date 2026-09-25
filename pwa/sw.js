/* Replaced with the build's revision and exact asset list by vite.config.ts. */
const CACHE_NAME = 'turtle-soup-shell:' + __PWA_BUILD__
const PRECACHE_URLS = __PWA_URLS__
const CACHE_PREFIX = 'turtle-soup-shell:'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      ),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    // Online HTML is always fresh; the cached shell is only for a failed network.
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME)
        const shell = await cache.match('/')
        return shell || Response.error()
      }),
    )
    return
  }

  // Only build assets and install icons are cached. API responses, user data,
  // third-party fonts, and arbitrary URLs always follow the normal network path.
  if (PRECACHE_URLS.includes(url.pathname)) {
    event.respondWith(
      caches
        .open(CACHE_NAME)
        .then((cache) => cache.match(url.pathname))
        .then((cached) => cached || fetch(request)),
    )
  }
})
