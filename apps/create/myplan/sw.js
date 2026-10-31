/* Only public app assets are cached. Photos and schedules live in account-scoped
   IndexedDB; authenticated requests and Supabase responses never enter this cache. */
const VERSION='myplan-static-v1';
const base=new URL('./',self.location.href);
const assets=['./','index.html','styles.css','icon.svg','src/main.js','src/model.js','src/illustrations.js','src/images.js','src/print.js','src/storage.js','vendor/jspdf.umd.min.js','vendor/NotoSans-Regular.ttf','vendor/supabase.js','vendor/supabase.umd.js'].map(path=>new URL(path,base).href);
const shared=['/shared/config.js','/shared/subdomain-nav.js','/shared/kapework-shell.js','/shared/kapework-shell.css'].map(path=>new URL(path,base).href);
const allowed=new Set([...assets,...shared]);
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll([...allowed]))));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('myplan-static-')&&key!==VERSION).map(key=>caches.delete(key)))),self.clients.claim()])));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||!allowed.has(event.request.url)||event.request.headers.has('Authorization'))return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok){const copy=response.clone();event.waitUntil(caches.open(VERSION).then(cache=>cache.put(event.request,copy)));}
    return response;
  }).catch(()=>caches.match(event.request)));
});
