const CACHE_NAME = 'morse-app-v1';
const assets = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/icon.jpg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(assets);
    })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});