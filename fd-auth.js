/* =====================================================================
   FINDAILY - sambungan ke Supabase (dipakai /masuk/ dan /app/)
   Kunci di bawah adalah kunci PUBLIK (publishable): aman berada di sini.
   Jangan pernah menaruh kunci rahasia (sb_secret_ / service_role) di file ini.
   ===================================================================== */
(function () {
    'use strict';

    var FD_SUPABASE_URL = 'https://tuuvczsfjigfaahqdmnv.supabase.co';
    var FD_SUPABASE_KEY = 'sb_publishable_zF2OPmjYVJqgSeLnch1urw_F5ZrnAKu';

    var LOGIN_URL = '/masuk/';
    var APP_URL = '/app/';
    var MEMBER_KEY = 'fd_member';

    if (!window.supabase || !window.supabase.createClient) {
        console.error('[FD] Pustaka Supabase belum termuat.');
        return;
    }

    var sb = window.supabase.createClient(FD_SUPABASE_URL, FD_SUPABASE_KEY, {
        auth: {
            persistSession: true,      // tetap login walau aplikasi ditutup
            autoRefreshToken: true,
            detectSessionInUrl: true,  // untuk tautan reset password dari email
            flowType: 'implicit',      // tautan email tetap jalan walau dibuka di browser lain
            storageKey: 'fd-auth'
        }
    });

    // Pindah halaman (satu pintu, supaya mudah diuji)
    function go(url) {
        if (typeof window.__fdNavigate === 'function') return window.__fdNavigate(url);
        location.replace(url);
    }

    function readMember() {
        try { return JSON.parse(localStorage.getItem(MEMBER_KEY) || 'null'); } catch (e) { return null; }
    }
    function saveMember(m) {
        if (m) localStorage.setItem(MEMBER_KEY, JSON.stringify(m)); else localStorage.removeItem(MEMBER_KEY);
    }

    // Ambil keanggotaan akun ini dari server. Hasil: objek anggota, null (tidak terdaftar), atau melempar error jaringan.
    async function fetchMember(user) {
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
            diperbarui: new Date().toISOString()
        };
    }

    // Terjemahkan pesan error Supabase ke bahasa yang dimengerti pengguna
    function friendlyError(err) {
        var msg = (err && (err.message || err.error_description || err.msg)) || String(err || '');
        var low = msg.toLowerCase();
        if (!navigator.onLine || low.indexOf('failed to fetch') !== -1 || low.indexOf('network') !== -1)
            return 'Tidak ada koneksi internet. Sambungkan internet, lalu coba lagi.';
        if (low.indexOf('invalid login credentials') !== -1)
            return 'Email atau password salah.';
        if (low.indexOf('email not confirmed') !== -1)
            return 'Akun ini belum dikonfirmasi. Minta admin mengonfirmasi akun di Supabase.';
        if (low.indexOf('rate limit') !== -1 || low.indexOf('too many') !== -1)
            return 'Terlalu banyak percobaan. Tunggu beberapa menit, lalu coba lagi.';
        if (low.indexOf('password should be') !== -1 || low.indexOf('at least') !== -1)
            return 'Password terlalu pendek. Gunakan minimal 8 karakter.';
        return 'Terjadi kesalahan: ' + msg;
    }

    // Dipakai halaman /app/: pastikan sudah login dan terdaftar di instansi.
    // Bekerja saat offline: memakai sesi dan data keanggotaan yang tersimpan di HP.
    async function requireAuth() {
        var s = await sb.auth.getSession();
        var session = s && s.data && s.data.session;
        if (!session) { saveMember(null); go(LOGIN_URL); return null; }

        var cached = readMember();
        if (cached && cached.user_id !== session.user.id) { cached = null; saveMember(null); }

        if (navigator.onLine) {
            try {
                var fresh = await fetchMember(session.user);
                if (!fresh) { await signOut('Akun ini tidak lagi terdaftar di instansi mana pun.'); return null; }
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
    }

    // Keluar dari akun di HP ini saja (HP lain yang memakai akun sama tidak ikut keluar)
    async function signOut(reason) {
        try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* tetap lanjut */ }
        saveMember(null);
        ['financialData', 'financialConfig', 'irfanData', 'irfanConfig', 'kasSetoran', 'fd_sync_snap']
            .forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
        if (reason) sessionStorage.setItem('fd_logout_reason', reason);
        go(LOGIN_URL);
    }

    function roleLabel(peran) {
        return peran === 'admin' ? 'Admin' : (peran === 'pemantau' ? 'Pemantau' : '');
    }

    window.FD = {
        sb: sb,
        LOGIN_URL: LOGIN_URL,
        APP_URL: APP_URL,
        fetchMember: fetchMember,
        readMember: readMember,
        saveMember: saveMember,
        requireAuth: requireAuth,
        signOut: signOut,
        friendlyError: friendlyError,
        roleLabel: roleLabel,
        go: go
    };
})();
