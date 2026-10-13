# Findaily Uji Coba (Tahap 2a)

## Isi paket
| Berkas | Fungsi |
|---|---|
| `index.html` | Alamat utama, sementara diarahkan ke `/masuk/` (tahap 3: landing page) |
| `masuk/index.html` | Halaman masuk, lupa password, buat password baru |
| `app/index.html` | Aplikasi (v6.3.1 + penjaga login), versi v7.0.0-uji.1 |
| `app/sw.js` | Service worker baru: tidak pernah menyimpan data Supabase/Google |
| `app/manifest.json` | Supaya aplikasi bisa dipasang di layar HP |
| `fd-auth.js` | Sambungan ke Supabase (kunci publik saja) |
| `vercel.json` | Alamat selalu berakhiran `/`, service worker selalu dicek terbaru |

## Sebelum upload
Salin 3 ikon dari repo lama ke folder `app/`:
`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`

## Langkah pemasangan
1. GitHub: buat repo baru (misalnya `findaily-uji`), upload SEMUA ISI folder ini dengan susunan foldernya.
2. Vercel: Add New > Project > Import repo itu > Framework Preset: Other > Deploy. Catat alamatnya.
3. Supabase: Authentication > URL Configuration
   - Site URL: alamat Vercel tadi (misalnya `https://findaily-uji.vercel.app`)
   - Redirect URLs: tambahkan `https://findaily-uji.vercel.app/masuk/`

## Daftar uji
- [ ] Buka alamat utama, otomatis pindah ke halaman masuk
- [ ] Masuk dengan password salah, muncul "Email atau password salah."
- [ ] Masuk dengan email + password admin, aplikasi terbuka
- [ ] Pojok kanan atas: nama kamu dan peran "Admin"
- [ ] Setting > Akun: nama, peran, instansi, email tampil
- [ ] Tutup aplikasi, buka lagi: langsung masuk tanpa login ulang
- [ ] Mode pesawat, buka lagi: aplikasi tetap terbuka
- [ ] Tombol Keluar: kembali ke halaman masuk
- [ ] Lupa password: email reset terkirim, tautannya membuka halaman "Buat password baru"

Catatan: data di alamat uji masih kosong dan masih tersimpan di HP saja.
Untuk mencoba dengan data, pakai Restore backup JSON. Data baru pindah ke server di langkah 2b.
