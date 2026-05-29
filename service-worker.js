self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {

  const url = new URL(event.request.url);

  if (
    event.request.method === 'POST' &&
    url.pathname === '/share-handler'
  ) {

    event.respondWith(handleShare(event.request));
  }
});

async function handleShare(request) {

  const formData = await request.formData();

  const file = formData.get('image');

  if (!file) {
    return Response.redirect('/share.html', 303);
  }

  const imageUrl = URL.createObjectURL(file);

  return Response.redirect(
    '/share.html?image=' + encodeURIComponent(imageUrl),
    303
  );
}
