/* =====================================================================
   FINDAILY - sambungan ke Supabase (dipakai /masuk/ dan /app/)
   Kunci di bawah adalah kunci PUBLIK (publishable): aman berada di sini.
   Jangan pernah menaruh kunci rahasia (sb_secret_ / service_role) di file ini.

   v7.0.0-uji.4: sesi login dibagi dengan service worker lewat IndexedDB,
   supaya catatan offline bisa terkirim walau aplikasi tertutup (Android).
   ===================================================================== */
(function () {
    'use strict';

    var FD_SUPABASE_URL = 'https://tuuvczsfjigfaahqdmnv.supabase.co';
    var FD_SUPABASE_KEY = 'sb_publishable_zF2OPmjYVJqgSeLnch1urw_F5ZrnAKu';

    // Pemantau masuk dengan nama pengguna; di server memakai email semu ini.
    // HARUS sama dengan PEMANTAU_PREFIX / PEMANTAU_DOMAIN di Edge Function kelola-pemantau.
    var FD_PEMANTAU_PREFIX = 'pmt.';
    var FD_PEMANTAU_DOMAIN = 'bintangwahyu.my.id';
    var USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;

    var LOGIN_URL = '/masuk/';
    var APP_URL = '/app/';
    var MEMBER_KEY = 'fd_member';
    var STORAGE_KEY = 'fd-auth';           // tempat pustaka Supabase menyimpan sesi
    var DATA_KEYS = ['financialData', 'financialConfig', 'irfanData', 'irfanConfig', 'kasSetoran', 'fd_sync_snap'];

    if (!window.supabase || !window.supabase.createClient) {
        console.error('[FD] Pustaka Supabase belum termuat.');
        return;
    }

    // ---------- IndexedDB kecil (dipakai bersama service worker) ----------
    var idb = (function () {
        function open() {
            return new Promise(function (res, rej) {
                if (!window.indexedDB) { rej(new Error('IndexedDB tidak tersedia')); return; }
                var r = indexedDB.open('findaily', 1);
                r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); };
                r.onsuccess = function () { res(r.result); };
                r.onerror = function () { rej(r.error); };
            });
        }
        function run(mode, fn) {
            return open().then(function (db) {
                return new Promise(function (res, rej) {
                    var tx = db.transaction('kv', mode), store = tx.objectStore('kv'), out;
                    var req = fn(store);
                    if (req) req.onsuccess = function () { out = req.result; };
                    tx.oncomplete = function () { db.close(); res(out); };
                    tx.onerror = tx.onabort = function () { db.close(); rej(tx.error); };
                });
            });
        }
        return {
            get: function (k) { return run('readonly', function (s) { return s.get(k); }).catch(function () { return undefined; }); },
            set: function (k, v) { return run('readwrite', function (s) { return s.put(v, k); }).catch(function () {}); },
            del: function (k) { return run('readwrite', function (s) { return s.delete(k); }).catch(function () {}); }
        };
    })();

    function rawSession() { try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; } }
    function parse(raw) { try { return JSON.parse(raw); } catch (e) { return null; } }

    // Service worker mungkin sudah memperpanjang kunci saat aplikasi tertutup.
    // Pakai sesi itu kalau lebih baru, SEBELUM pustaka Supabase membaca sesi.
    async function adoptNewerSession() {
        try {
            var rec = await idb.get('session');
            var cur = parse(rawSession());
            if (!rec || !rec.raw || !cur) return false;         // belum/sudah keluar di HP ini: jangan dihidupkan lagi
            var curUser = cur.user && cur.user.id;
            if (rec.user_id && curUser && rec.user_id !== curUser) return false;
            if ((rec.expires_at || 0) > (cur.expires_at || 0)) {
                localStorage.setItem(STORAGE_KEY, rec.raw);
                return true;
            }
        } catch (e) { /* tetap lanjut dengan sesi yang ada */ }
        return false;
    }

    // Salin sesi terbaru ke IndexedDB supaya service worker bisa memakainya
    function mirrorSession() {
        var raw = rawSession(), s = parse(raw);
        if (!s || !s.access_token) return idb.del('session');
        return idb.set('session', { raw: raw, expires_at: s.expires_at || 0, user_id: (s.user && s.user.id) || null, saved: Date.now(), source: 'app' });
    }

    function readMember() {
        try { return JSON.parse(localStorage.getItem(MEMBER_KEY) || 'null'); } catch (e) { return null; }
    }
    function saveMember(m) {
        if (m) localStorage.setItem(MEMBER_KEY, JSON.stringify(m)); else localStorage.removeItem(MEMBER_KEY);
    }

    // Pindah halaman (satu pintu, supaya mudah diuji)
    function go(url) {
        if (typeof window.__fdNavigate === 'function') return window.__fdNavigate(url);
        location.replace(url);
    }

    var FD = {
        sb: null,
        LOGIN_URL: LOGIN_URL,
        APP_URL: APP_URL,
        idb: idb,
        go: go,
        // Email untuk login: email asli (admin) atau nama pengguna pemantau. null = format nama pengguna tidak sah.
        loginEmail: function (id) {
            id = String(id || '').trim();
            if (id.indexOf('@') !== -1) return id;
            var u = id.toLowerCase();
            return USERNAME_RE.test(u) ? FD_PEMANTAU_PREFIX + u + '@' + FD_PEMANTAU_DOMAIN : null;
        },
        readMember: readMember,
        saveMember: saveMember
    };
    window.FD = FD;

    FD.ready = (async function () {
        await adoptNewerSession();
        var sb = window.supabase.createClient(FD_SUPABASE_URL, FD_SUPABASE_KEY, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                flowType: 'implicit',
                storageKey: STORAGE_KEY
            }
        });
        FD.sb = sb;
        idb.set('config', { url: FD_SUPABASE_URL, key: FD_SUPABASE_KEY });
        sb.auth.onAuthStateChange(function (event) {
            // pustaka menyimpan sesi dulu, baru memberi kabar: salin sesudahnya
            setTimeout(function () {
                if (event === 'SIGNED_OUT') { idb.del('session'); idb.del('outbox'); }
                else mirrorSession();
            }, 0);
        });
        return sb;
    })();

    // Ambil keanggotaan akun ini dari server. Hasil: objek anggota, null (tidak terdaftar), atau melempar error jaringan.
    FD.fetchMember = async function (user) {
        var sb = await FD.ready;
        var res = await sb.from('anggota')
            .select('instansi_id, peran, nama, username, instansi:instansi_id ( nama )')
            .eq('user_id', user.id)
            .eq('aktif', true)
            .order('dibuat_pada', { ascending: true })
            .limit(1);
        if (res.error) throw res.error;
        var row = res.data && res.data[0];
        if (!row) return null;
        return {
            user_id: user.id,
            email: user.email || '',
            instansi_id: row.instansi_id,
            instansi_nama: (row.instansi && row.instansi.nama) || '',
            peran: row.peran,
            nama: row.nama || row.username || user.email || '',
            foto: (user.user_metadata && (user.user_metadata.avatar_url || user.user_metadata.picture)) || '',
            diperbarui: new Date().toISOString()
        };
    };

    // Terjemahkan pesan error Supabase ke bahasa yang dimengerti pengguna
    FD.friendlyError = function (err) {
        var msg = (err && (err.message || err.error_description || err.msg)) || String(err || '');
        var low = msg.toLowerCase();
        if (!navigator.onLine || low.indexOf('failed to fetch') !== -1 || low.indexOf('network') !== -1)
            return 'Tidak ada koneksi internet. Sambungkan internet, lalu coba lagi.';
        if (low.indexOf('invalid login credentials') !== -1)
            return 'Email/nama pengguna atau password salah.';
        if (low.indexOf('banned') !== -1)
            return 'Akses akun ini sudah dicabut. Hubungi admin instansimu.';
        if (low.indexOf('email not confirmed') !== -1)
            return 'Akun ini belum dikonfirmasi. Minta admin mengonfirmasi akun di Supabase.';
        if (low.indexOf('rate limit') !== -1 || low.indexOf('too many') !== -1)
            return 'Terlalu banyak percobaan. Tunggu beberapa menit, lalu coba lagi.';
        if (low.indexOf('password should be') !== -1 || low.indexOf('at least') !== -1)
            return 'Password terlalu pendek. Gunakan minimal 8 karakter.';
        return 'Terjadi kesalahan: ' + msg;
    };

    // Dipakai halaman /app/: pastikan sudah login dan terdaftar di instansi.
    // Bekerja saat offline: memakai sesi dan data keanggotaan yang tersimpan di HP.
    FD.requireAuth = async function () {
        var sb = await FD.ready;
        var s = await sb.auth.getSession();
        var session = s && s.data && s.data.session;
        if (!session) { saveMember(null); go(LOGIN_URL); return null; }

        var cached = readMember();
        if (cached && cached.user_id !== session.user.id) { cached = null; saveMember(null); }

        if (navigator.onLine) {
            try {
                var fresh = await FD.fetchMember(session.user);
                if (!fresh) { await FD.signOut('Akun ini tidak lagi terdaftar di instansi mana pun.'); return null; }
                saveMember(fresh);
                return fresh;
            } catch (e) {
                if (cached) return cached;          // server tidak terjangkau: pakai data tersimpan
                throw e;
            }
        }
        if (cached) return cached;
        go(LOGIN_URL);
        return null;
    };

    // Keluar dari akun di HP ini saja (HP lain yang memakai akun sama tidak ikut keluar).
    // Data keuangan di HP ikut dihapus: semuanya aman di server.
    FD.signOut = async function (reason) {
        try { var sb = await FD.ready; await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* tetap lanjut */ }
        saveMember(null);
        DATA_KEYS.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
        await idb.del('session'); await idb.del('outbox'); await idb.del('outboxResult');
        if (reason) sessionStorage.setItem('fd_logout_reason', reason);
        go(LOGIN_URL);
    };

    FD.roleLabel = function (peran) {
        return peran === 'admin' ? 'Admin' : (peran === 'pemantau' ? 'Pemantau' : '');
    };
})();
