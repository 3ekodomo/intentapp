const CACHE_NAME = 'gh-uploader-v1';

self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    // Intercept the Web Share Target POST request
    if (event.request.method === 'POST' && event.request.url.endsWith('/share')) {
        event.respondWith((async () => {
            const formData = await event.request.formData();
            const files = formData.getAll('shared_images');
            
            // Open the main page
            const cache = await caches.open('shared-files-cache');
            
            // Temporarily store the shared files in cache as responses
            for (let i = 0; i < files.length; i++) {
                await cache.put(`/shared-file-${i}`, new Response(files[i]));
            }
            
            // Redirect to the main app interface
            return Response.redirect('./index.html?shared=true', 303);
        })());
        return;
    }

    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});
