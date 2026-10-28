/* Private financial records and authenticated pages are never cached. */
const CACHE='perkkeep-public-v1';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['/offline.html','/icons/icon-192.png','/icons/icon-512.png'])));self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k.startsWith('perkkeep-')).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',event=>{if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));});
