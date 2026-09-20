// Financial responses are never cached; the service worker supplies only an offline notice.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') event.respondWith(fetch(event.request).catch(() => new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Squires offline</title><body style="font:18px system-ui;padding:32px;background:#f5f7f6;color:#173b31"><h1>You are offline</h1><p>Reconnect to see your latest household finances.</p><button onclick="location.reload()" style="padding:14px">Try again</button></body></html>', { headers: { 'Content-Type': 'text/html' } })));
});
