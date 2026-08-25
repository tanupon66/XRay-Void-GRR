const CACHE='xray-grr-v6-lowest-grr';
const ASSETS=['./','./index.html','./styles.css','./ui.css','./parser-shim.js','./core.js','./app.js','./optimizer.js','./ui.js','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).then(resp=>{if(new URL(e.request.url).origin===location.origin){const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}return resp}).catch(()=>caches.match(e.request))) });