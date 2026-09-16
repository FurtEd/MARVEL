const CACHE_NAME = 'marvel-offline-v1';

const ASSETS = [
  './',
  './index.html',
  './process.js',
  './manifest.json',
  './icon.png',

  // Build (WASM motor és JS wrapper)
  './build/marvel.js',
  './build/marvel.wasm',

  // CSS stílusok (figyelve a nagy T betűkre a DataTables-nél!)
  './css/bootstrap.min.css',
  './datatables/css/jquery.dataTables.min.css',
  './datatables/css/jquery.dataTables_themeroller.css',
  './datatables/images/sort_asc.png',
  './datatables/images/sort_desc.png',
  './datatables/images/sort_both.png',
  './datatables/images/sort_asc_disabled.png',
  './datatables/images/sort_desc_disabled.png',

  // JavaScript fájlok (pontosan a meglévő verziókkal)
  './js/jquery-3.7.1.min.js',
  './js/bootstrap.bundle.min.js',
  './datatables/js/jquery.dataTables.min.js',
  './js/vue.global.js',

  // Betűtípusok
  './fonts/glyphicons-halflings-regular.woff2'
];

// 1. Fájlok beolvasása a gyorsítótárba
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('All files saved to offline storage!');
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// 2. Aktiválás: Régi cache-ek törlése
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. Fetch: Offline kiszolgálás a gyorsítótárból
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});