/**
 * Service worker.
 *
 * Two caching strategies, chosen by what the request is:
 *
 *   navigations   network first, cache as fallback. A new build must be able to
 *                 reach players; serving a stale shell forever is how a PWA
 *                 ends up permanently three versions behind.
 *   assets        cache first. Vite hashes filenames, so an asset URL is
 *                 immutable — if the name matches, the bytes match.
 *
 * The result: the game launches instantly on a repeat visit, plays fully
 * offline, and still picks up a deploy on the next online load.
 */

const VERSION = 'aegis-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

/**
 * Pull the hashed bundle URLs out of the shell and cache them at install time.
 *
 * Without this the worker only ever caches assets it *sees requested*, and it
 * does not control the page on the visit that registers it — so the first visit
 * cached nothing but the shell, and a player who went offline after one visit
 * got an index.html referencing scripts that were not there. "Plays fully
 * offline" was true on the third load and not before.
 *
 * Reading the shell rather than a generated manifest keeps this honest across
 * builds: whatever the current index.html references is what gets cached.
 */
async function precacheFromShell(cache) {
  try {
    const response = await fetch('./index.html', { cache: 'reload' });
    if (!response.ok) return;
    const html = await response.text();
    await cache.put('./index.html', new Response(html, { headers: response.headers }));

    const urls = new Set();
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const href = m[1];
      if (!href || href.startsWith('http') || href.startsWith('data:')) continue;
      if (!/\.(js|css|woff2?|png|webmanifest)$/.test(href)) continue;
      urls.add(new URL(href, self.location.href).toString());
    }
    await Promise.allSettled([...urls].map((url) => cache.add(url)));
  } catch {
    // Offline at install time, or a shell we could not read. The fetch handler
    // still fills the cache as the player uses the game.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      // `addAll` rejects the whole batch if any single entry 404s, which would
      // leave the worker uninstalled over a missing icon.
      await Promise.allSettled(SHELL.map((url) => shell.add(url)));
      await precacheFromShell(await caches.open(ASSET_CACHE));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(SHELL_CACHE).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() =>
          caches
            .match('./index.html', { ignoreVary: true })
            .then((hit) => hit ?? caches.match('./', { ignoreVary: true })),
        ),
    );
    return;
  }

  event.respondWith(
    // `ignoreVary` matters: an entry added by URL at install time was fetched
    // with `Accept: */*`, while the page asks for the same file with
    // `Accept: text/css`. With Vary respected those are different entries, and
    // the cache hit that exists is never found — which is exactly how "plays
    // fully offline" turned into a blank page with a cache full of the right
    // files.
    caches.match(request, { ignoreVary: true }).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        // Only cache successful, complete responses. An opaque or partial
        // response cached here would be served back as a broken asset forever.
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          void caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});

// Lets the page ask a waiting worker to take over immediately.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting();
});
