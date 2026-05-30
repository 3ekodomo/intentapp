const CACHE_NAME = 'gh-uploader-v2';

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(['./', './index.html', './app.js', './manifest.json']);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    // Intercept Web Share Target
    if (event.request.method === 'POST' && event.request.url.endsWith('/share')) {
        event.respondWith((async () => {
            const formData = await event.request.formData();
            const files = formData.getAll('shared_images');
            const cache = await caches.open('shared-files-cache');
            for (let i = 0; i < files.length; i++) {
                await cache.put(`/shared-file-${i}`, new Response(files[i]));
            }
            return Response.redirect('./index.html?shared=true', 303);
        })());
        return;
    }

    // Standard offline caching strategy
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});
