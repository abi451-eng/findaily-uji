// =====================================================================
// FINDAILY - Edge Function "baca-catatan"
// Membaca foto LAPORAN CATATAN HARIAN BKCM dengan Claude dan mengembalikan isinya
// dalam bentuk terstruktur. Hanya admin aktif instansi yang boleh memanggil.
// TIDAK menyimpan foto, TIDAK mencetak isi permintaan / gambar ke log.
// Kunci ANTHROPIC_API_KEY dibaca dari Secrets Supabase (tidak pernah ada di kode).
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function secretKey(): string | undefined {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    if (keys && keys['default']) return keys['default'];
  } catch (_e) { /* pakai kunci versi lama */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? undefined;
}

const MAX_B64 = 2_800_000; // kira-kira 2 MB berkas
const JENIS_OK = ['image/jpeg', 'image/png', 'image/webp'];
// Model membaca dulu (berpikir) sebelum memanggil tool: beri ruang token yang cukup.
const MAX_TOKENS = 16000;
const BATAS_WAKTU_MS = 110_000;

const INSTRUKSI = `Kamu membaca FOTO lembar "LAPORAN CATATAN HARIAN" milik Warung Bakso Kota Cak Man (BKCM).
Lembar ini formulir tercetak yang diisi tulisan tangan. Foto bisa miring, menyamping (diputar 90 derajat), atau terbalik: bacalah sesuai arah tulisannya.

SUSUNAN FORMULIR (kolom: No. | URAIAN | PEMASUKAN | PENGELUARAN):
1 MODAL (abaikan)
2 PENJUALAN: baris BAKSO, MINUMAN, ICE CREAM, LAIN-LAIN (nominal di kolom PEMASUKAN)
3 OPERASIONAL: baris BELANJA SORE, BELANJA PAGI (nominal di kolom PENGELUARAN)
  Di bawahnya ada baris kosong yang bisa diisi tangan: NAMA barang ditulis di tengah, NOMINAL di kolom PENGELUARAN
  (contoh: "Kecap ABC" 650.000, "Giling daging" 800.000).
4 TOTAL PENJUALAN, 5 TOTAL PENGELUARAN, 6 SALDO
7 PEMBAYARAN: QRIS, EDC, TRANSFER, TOTAL
8 SALDO AKHIR, 9 PPN, 10 DISETORKAN
Kepala lembar: "HARI: <nama hari> <tanggal>", contoh "HARI: Minggu 19.04.2026" (format tanggal DD.MM.YYYY).
Di luar tabel kadang ada catatan rekap ojek online mingguan, contoh:
"Tgl 13-19. Grab: Rp 162.200, Gojek: Rp 155.200, Total: Rp 317.400".

ATURAN MEMBACA:
- Semua nominal adalah rupiah bulat. Titik adalah pemisah ribuan ("1.932.000" = 1932000). "Rp" diabaikan.
- Kolom yang kosong atau tidak diisi: null. Jangan mengarang angka.
- Angka yang dicoret: pakai angka pengganti yang ditulis di dekatnya, dan catat di "keraguan".
- SALDO dan SALDO AKHIR boleh negatif (bisa ditulis dengan tanda minus atau di kolom PENGELUARAN): laporkan sebagai angka negatif.
- Untuk setiap baris pengeluaran, tentukan "jenis":
  "belanja_pagi" untuk baris BELANJA PAGI, "belanja_sore" untuk BELANJA SORE,
  "daging" untuk baris tambahan yang namanya mengandung kata "daging" (misalnya "Giling daging"),
  "lainnya" untuk baris tambahan lain. Jangan masukkan TOTAL PENGELUARAN atau DISETORKAN sebagai baris pengeluaran.
- Formulir ini punya hubungan hitungan yang saling mengunci. Pakai untuk memastikan digit yang meragukan:
  rincian penjualan = TOTAL PENJUALAN; jumlah baris pengeluaran = TOTAL PENGELUARAN;
  PPN = 10% TOTAL PENJUALAN; DISETORKAN = SALDO AKHIR + PPN; Grab + Gojek = Total ojek online.
  Kalau satu digit meragukan dan hanya satu bacaan yang membuat hitungan cocok, pakai bacaan itu dan catat di "keraguan".
  Kalau angka yang TERTULIS memang tidak cocok satu sama lain (kesalahan hitung di kertas), laporkan apa adanya.
- Isi "keraguan" untuk setiap angka yang tulisannya tidak jelas, dengan kolom dan alasan singkat.
- Laporkan HANYA lewat tool "catat_laporan", panggil tepat satu kali. Jangan menulis jawaban di luar tool.`;

const NUM = { type: ['integer', 'null'] };
const TOOL = {
  name: 'catat_laporan',
  description: 'Mengembalikan isi lembar LAPORAN CATATAN HARIAN apa adanya dalam bentuk terstruktur.',
  input_schema: {
    type: 'object',
    properties: {
      tanggal: { type: ['string', 'null'], description: 'Tanggal di kepala lembar, format YYYY-MM-DD' },
      nama_hari: { type: ['string', 'null'], description: 'Nama hari yang tertulis, contoh "Minggu"' },
      penjualan: { type: 'object', properties: { bakso: NUM, minuman: NUM, ice_cream: NUM, lain_lain: NUM } },
      total_penjualan: NUM,
      pengeluaran: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            nama: { type: 'string' },
            jumlah: { type: 'integer' },
            jenis: { type: 'string', enum: ['belanja_pagi', 'belanja_sore', 'daging', 'lainnya'] }
          },
          required: ['nama', 'jumlah', 'jenis']
        }
      },
      total_pengeluaran: NUM,
      saldo: NUM,
      pembayaran: { type: 'object', properties: { qris: NUM, edc: NUM, transfer: NUM, total: NUM } },
      saldo_akhir: NUM,
      ppn: NUM,
      disetorkan: NUM,
      ojol: {
        type: ['object', 'null'],
        properties: { periode: { type: ['string', 'null'] }, gojek: NUM, grab: NUM, total: NUM }
      },
      catatan_lain: { type: ['string', 'null'] },
      keraguan: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kolom: { type: 'string', enum: ['tanggal', 'nama_hari', 'penjualan_rincian', 'total_penjualan', 'belanja_pagi',
              'belanja_sore', 'daging', 'lainnya', 'total_pengeluaran', 'saldo', 'qris', 'edc', 'transfer',
              'saldo_akhir', 'ppn', 'disetorkan', 'gojek', 'grab'] },
            alasan: { type: 'string' }
          },
          required: ['kolom', 'alasan']
        }
      }
    },
    required: ['tanggal', 'penjualan', 'total_penjualan', 'pengeluaran', 'pembayaran', 'saldo_akhir', 'ppn', 'keraguan']
  }
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { kode: 'METODE', error: 'Metode tidak didukung.' });

  const url = Deno.env.get('SUPABASE_URL');
  const key = secretKey();
  if (!url || !key) return reply(500, { kode: 'SERVER', error: 'Kunci server tidak tersedia.' });
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1) Siapa pemanggilnya?
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return reply(401, { kode: 'BELUM_MASUK', error: 'Belum masuk.' });
  const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
  if (whoErr || !who?.user) return reply(401, { kode: 'SESI_TIDAK_BERLAKU', error: 'Sesi tidak berlaku. Silakan masuk ulang.' });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch (_e) { return reply(400, { kode: 'DATA_TIDAK_VALID', error: 'Data tidak valid.' }); }
  const instansiId = String(body.instansi_id ?? '');
  const b64 = String(body.gambar_base64 ?? '');
  const mediaType = String(body.media_type ?? 'image/jpeg');
  if (!instansiId || !b64) return reply(400, { kode: 'DATA_TIDAK_VALID', error: 'Foto belum dikirim.' });

  // 2) Pemanggil harus admin aktif di instansi itu
  const { data: me } = await admin.from('anggota').select('peran, aktif')
    .eq('instansi_id', instansiId).eq('user_id', who.user.id).maybeSingle();
  if (!me || !me.aktif || me.peran !== 'admin') return reply(403, { kode: 'BUKAN_ADMIN', error: 'Hanya admin yang bisa memakai fitur ini.' });

  // 3) Kunci AI, jenis & ukuran gambar, batas harian
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return reply(503, { kode: 'BELUM_AKTIF', error: 'Fitur baca foto belum diaktifkan: kunci AI belum dipasang di server.' });
  if (!JENIS_OK.includes(mediaType)) return reply(400, { kode: 'JENIS_GAMBAR', error: 'Jenis gambar tidak didukung.' });
  if (b64.length > MAX_B64) return reply(400, { kode: 'GAMBAR_TERLALU_BESAR', error: 'Foto terlalu besar. Coba foto ulang.' });

  const limit = Number(Deno.env.get('FD_AI_DAILY_LIMIT') ?? '20') || 20;
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin.from('ai_pemakaian').select('id', { count: 'exact', head: true })
    .eq('instansi_id', instansiId).gte('waktu', since);
  if ((count ?? 0) >= limit) {
    return reply(429, { kode: 'BATAS_HARIAN', error: 'Batas ' + limit + ' foto per 24 jam sudah tercapai. Isi manual dulu, atau coba lagi besok.' });
  }

  const model = Deno.env.get('FD_AI_MODEL') || 'claude-haiku-5-5';
  const catat = (status: string, extra: Record<string, unknown> = {}) =>
    admin.from('ai_pemakaian').insert({ instansi_id: instansiId, user_id: who.user.id, model, status, ...extra }).then(() => {}, () => {});

  // 4) Panggil Claude. tool_choice "auto" (bukan dipaksa): model Claude terbaru
  //    menolak tool_choice "tool"; instruksi meminta tepat satu panggilan tool.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), BATAS_WAKTU_MS);
  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        system: INSTRUKSI,
        tools: [TOOL],
        tool_choice: { type: 'auto' },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
            { type: 'text', text: 'Baca lembar laporan ini dan laporkan isinya lewat tool catat_laporan.' }
          ]
        }]
      })
    });
  } catch (_e) {
    clearTimeout(timer);
    await catat('gagal', { keterangan: 'jaringan/timeout' });
    return reply(502, { kode: 'AI_GAGAL', error: 'Layanan AI tidak menjawab. Coba lagi sebentar.' });
  }
  clearTimeout(timer);

  if (!res.ok) {
    await catat('gagal', { keterangan: 'http ' + res.status });
    if (res.status === 401 || res.status === 403) return reply(502, { kode: 'KUNCI_AI_SALAH', error: 'Kunci AI di server tidak valid. Hubungi pengelola aplikasi.' });
    if (res.status === 429 || res.status === 529) return reply(502, { kode: 'AI_SIBUK', error: 'Layanan AI sedang sibuk. Coba lagi beberapa saat lagi.' });
    return reply(502, { kode: 'AI_GAGAL', error: 'Gagal membaca foto. Coba lagi.' });
  }

  // deno-lint-ignore no-explicit-any
  let data: any;
  try { data = await res.json(); } catch (_e) {
    await catat('gagal', { keterangan: 'jawaban tidak terbaca' });
    return reply(502, { kode: 'AI_GAGAL', error: 'Gagal membaca foto. Coba lagi.' });
  }
  const usage = { input_tokens: data?.usage?.input_tokens ?? null, output_tokens: data?.usage?.output_tokens ?? null };
  if (data?.stop_reason === 'refusal') {
    await catat('gagal', { ...usage, keterangan: 'refusal' });
    return reply(502, { kode: 'TIDAK_TERBACA', error: 'Foto tidak bisa dibaca. Coba foto ulang lembar catatannya saja.' });
  }
  const blok = (data?.content ?? []).find((b: { type: string; name?: string }) => b.type === 'tool_use' && b.name === 'catat_laporan');
  if (!blok || !blok.input || typeof blok.input !== 'object') {
    await catat('gagal', { ...usage, keterangan: 'tanpa tool_use (' + String(data?.stop_reason ?? '-') + ')' });
    return reply(502, { kode: 'TIDAK_TERBACA', error: 'Foto tidak terbaca. Coba foto ulang dengan cahaya cukup.' });
  }
  await catat('ok', usage);
  return reply(200, { ok: true, model, hasil: blok.input });
});
