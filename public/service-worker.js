// public/service-worker.js

const CACHE_NAME = 'symphony-sync-v1';
const ASSETS_TO_CACHE = [
    '/', // Caches the root path (index.html)
    '/index.html',
    '/style.css',
    '/main.js',
    '/manifest.json',
    // Caching all audio files based on your directory listing
    '/audio/garageDrums.mp3',
    '/audio/keys.mp3',
    '/audio/techBass.mp3',
    '/audio/techDrums.mp3',
    '/audio/track1.mp3',
    '/audio/track2.mp3',
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
                // Use {cache: "reload"} to ensure you get the latest version from the network upon install
                return Promise.all(
                    ASSETS_TO_CACHE.map(url => {
                        return cache.add(new Request(url, {cache: 'reload'}));
                    })
                );
            })
            .catch(err => {
                console.error('[Service Worker] Failed to cache:', err);
            })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // Return cached asset, or fetch from network if not in cache
                return response || fetch(event.request);
            })
            .catch(err => {
                console.error('[Service Worker] Fetch failed:', err);
            })
    );
});

self.addEventListener('activate', (event) => {
    console.log('[Service Worker] Activating Service Worker ....', CACHE_NAME);
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    console.log('[Service Worker] Deleting old cache: ' + key);
                    return caches.delete(key);
                }
            }));
        })
    );
    return self.clients.claim();
});