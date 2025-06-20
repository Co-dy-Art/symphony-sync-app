// public/service-worker.js

const CACHE_NAME = 'symphony-sync-v1';
const ASSETS_TO_CACHE = [
    '/', // Caches the root path (index.html)
    '/index.html',
    '/style.css',
    '/main.js',
    '/manifest.json',
    '/audio/track1.mp3', // Make sure these paths match your audio files
    '/audio/track2.mp3', // Add all your audio files here!
    // Add any necessary icons here if you've added them
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png'
];

self.addEventListener('install', (event) => {
    console.log('[Service Worker] Installing Service Worker ...', CACHE_NAME);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Caching all content');
                return cache.addAll(ASSETS_TO_CACHE);
            })
            .catch(err => {
                console.error('[Service Worker] Failed to cache:', err);
            })
    );
});

self.addEventListener('fetch', (event) => {
    // console.log('[Service Worker] Fetching resource: ' + event.request.url);
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                if (response) {
                    // console.log('[Service Worker] Found in cache: ' + event.request.url);
                    return response; // Return cached asset
                }
                // console.log('[Service Worker] Not in cache, fetching from network: ' + event.request.url);
                return fetch(event.request); // Fetch from network if not in cache
            })
            .catch(err => {
                console.error('[Service Worker] Fetch failed:', err);
                // You could return an offline page here
            })
    );
});

self.addEventListener('activate', (event) => {
    console.log('[Service Worker] Activating Service Worker ....', CACHE_NAME);
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key === CACHE_NAME) {
                    return;
                }
                console.log('[Service Worker] Deleting old cache: ' + key);
                return caches.delete(key);
            }));
        })
    );
    // This immediately takes control of the page once activated
    return self.clients.claim();
});