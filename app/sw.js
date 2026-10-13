/* Service Worker - Financial Daily Report (versi server, /app/)
   Membuat aplikasi bisa dibuka offline (app shell + pustaka CDN).

   ATURAN PENTING: yang disimpan hanya file aplikasi dan pustaka dari CDN.
   Permintaan ke Supabase (data & login) dan Google (Drive & login) TIDAK
   PERNAH disimpan, supaya data selalu terbaru dan data satu akun tidak
   pernah tampil ke akun lain di HP yang sama. */

const CACHE_NAME = 'findaily-uji-v7-0-0-a1';

// File inti aplikasi (same-origin), relatif terhadap /app/
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './favicon.png',
  './apple-touch-icon.png',
  '../fd-auth.js'
];

// Pustaka CDN tanpa sidik jari (disimpan apa adanya)
const CDN_LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

// Pustaka CDN yang dimuat dengan sidik jari (SRI): wajib disimpan dalam mode CORS
const CDN_LIBS_CORS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js'
];

// Host luar yang BOLEH disimpan
const CACHEABLE_HOSTS = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

// Boleh disimpan? (fungsi murni, juga dipakai untuk pengujian)
function fdShouldCache(urlString, method, headers) {
  if (method !== 'GET') return false;
  let url;
  try { url = new URL(urlString); } catch (e) { return false; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (headers && (headers.get ? headers.get('Authorization') : headers.Authorization)) return false;
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in')) return false;
  if (url.origin === self.location.origin) return true;
  return CACHEABLE_HOSTS.includes(url.hostname);
}

// ===== INSTALL: simpan app shell + pustaka CDN =====
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(APP_SHELL.map((url) =>
        cache.add(url).catch((err) => console.log('[SW] gagal simpan:', url, err))
      ));
      await Promise.all(CDN_LIBS.map((url) =>
        fetch(url, { mode: 'no-cors' }).then((res) => cache.put(url, res)).catch(() => {})
      ));
      await Promise.all(CDN_LIBS_CORS.map((url) =>
        fetch(url, { mode: 'cors', credentials: 'omit' }).then((res) => { if (res.ok) return cache.put(url, res); }).catch(() => {})
      ));
    })
  );
  // skipWaiting TIDAK dipanggil di sini: SW baru menunggu pengguna menekan "Update".
});

// Perintah dari halaman untuk segera mengaktifkan SW baru
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ===== ACTIVATE: hapus simpanan versi lama =====
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ===== FETCH: simpanan dulu, lalu jaringan (hanya untuk yang boleh disimpan) =====
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!fdShouldCache(req.url, req.method, req.headers)) return; // biarkan browser langsung ke jaringan

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy).catch(() => {}));
          }
          return res;
        })
        .catch(() => {
          if (req.mode === 'navigate') return caches.match('./index.html');
        });
    })
  );
});
