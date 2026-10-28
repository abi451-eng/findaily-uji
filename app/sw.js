/* Service Worker - Financial Daily Report (versi server, /app/)
   Membuat aplikasi bisa dibuka offline (app shell + pustaka CDN).

   ATURAN PENTING: yang disimpan hanya file aplikasi dan pustaka dari CDN.
   Permintaan ke Supabase (data & login) dan Google (Drive & login) TIDAK
   PERNAH disimpan, supaya data selalu terbaru dan data satu akun tidak
   pernah tampil ke akun lain di HP yang sama. */

const CACHE_NAME = 'findaily-uji-v7-1-0-a14';

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
  './img/app-bg-desktop.webp',
  './img/app-bg-mobile.webp',
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


/* =====================================================================
   KIRIM SAAT APLIKASI TERTUTUP (Background Sync, Android/Chrome)
   Aplikasi menulis "kotak keluar" (outbox) dan sesi login ke IndexedDB.
   Saat internet kembali, Android membangunkan service worker ini lewat
   event 'sync', lalu isi kotak keluar dikirim ke Supabase.
   - Hanya bertindak kalau aplikasi benar-benar tertutup (tidak ada jendela).
   - Kunci masuk diperpanjang di sini bila perlu; kunci baru disimpan kembali
     ke IndexedDB, dan aplikasi memakainya saat dibuka (lihat fd-auth.js).
   ===================================================================== */
const FD_SYNC_TAG = 'fd-push';

function fdIdb(mode, fn) {
  return new Promise((res, rej) => {
    const r = indexedDB.open('findaily', 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); };
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const db = r.result, tx = db.transaction('kv', mode), req = fn(tx.objectStore('kv'));
      let out;
      if (req) req.onsuccess = () => { out = req.result; };
      tx.oncomplete = () => { db.close(); res(out); };
      tx.onerror = tx.onabort = () => { db.close(); rej(tx.error); };
    };
  });
}
const fdGet = (k) => fdIdb('readonly', (s) => s.get(k));
const fdSet = (k, v) => fdIdb('readwrite', (s) => s.put(v, k));
const fdDel = (k) => fdIdb('readwrite', (s) => s.delete(k));

// Kunci masuk yang masih berlaku. null = tidak bisa (harus login lewat aplikasi).
// Melempar error kalau jaringan putus, supaya Android mencoba lagi nanti.
async function fdToken(cfg, rec, force) {
  const s = JSON.parse(rec.raw || '{}');
  const now = Math.floor(Date.now() / 1000);
  if (!force && s.access_token && (s.expires_at || 0) > now + 60) return s.access_token;
  if (!s.refresh_token) return null;
  const res = await fetch(cfg.url + '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    headers: { apikey: cfg.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: s.refresh_token })
  });
  if (!res.ok) return null;
  const ns = await res.json();
  if (!ns.expires_at && ns.expires_in) ns.expires_at = now + ns.expires_in;
  if (!ns.user) ns.user = s.user;
  await fdSet('session', { raw: JSON.stringify(ns), expires_at: ns.expires_at || 0, user_id: (ns.user && ns.user.id) || rec.user_id || null, saved: Date.now(), source: 'sw' });
  return ns.access_token;
}

function fdSend(cfg, token, op) {
  return fetch(cfg.url + '/rest/v1/' + op.path, {
    method: op.m,
    headers: {
      apikey: cfg.key,
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      Prefer: op.m === 'POST' ? 'resolution=merge-duplicates,return=representation' : 'return=representation'
    },
    body: op.body ? JSON.stringify(op.body) : undefined
  });
}

async function fdBackgroundPush() {
  // Aplikasi masih terbuka? Biarkan aplikasi sendiri yang mengirim.
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (wins.length) return 'aplikasi-terbuka';

  const [cfg, rec, box] = await Promise.all([fdGet('config'), fdGet('session'), fdGet('outbox')]);
  if (!cfg || !rec || !box || !box.ops || !box.ops.length) return 'kosong';
  if (rec.user_id && box.user_id && rec.user_id !== box.user_id) return 'beda-akun';

  let token = await fdToken(cfg, rec, false);
  if (!token) { await fdSet('outboxResult', { ok: false, at: Date.now(), error: 'login' }); return 'perlu-login'; }

  for (const op of box.ops) {
    let res = await fdSend(cfg, token, op);                       // jaringan putus: melempar, Android coba lagi
    if (res.status === 401) {
      token = await fdToken(cfg, await fdGet('session'), true);
      if (!token) { await fdSet('outboxResult', { ok: false, at: Date.now(), error: 'login' }); return 'perlu-login'; }
      res = await fdSend(cfg, token, op);
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      await fdSet('outboxResult', { ok: false, at: Date.now(), error: res.status + ' ' + txt.slice(0, 200) });
      return 'ditolak';                                            // aplikasi menangani saat dibuka
    }
    if (op.expect) {
      const rows = await res.json().catch(() => []);
      if (!Array.isArray(rows) || rows.length < op.expect) {
        await fdSet('outboxResult', { ok: false, at: Date.now(), error: 'izin' });
        return 'ditolak';
      }
    }
  }
  // Hapus kotak keluar hanya kalau aplikasi belum menulis yang lebih baru selama pengiriman
  const cur = await fdGet('outbox');
  if (cur && cur.at === box.at) await fdDel('outbox');
  await fdSet('outboxResult', { ok: true, at: Date.now(), count: box.count });
  return 'terkirim';
}

self.addEventListener('sync', (event) => {
  if (event.tag === FD_SYNC_TAG) event.waitUntil(fdBackgroundPush());
});
