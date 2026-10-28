// Tes fungsi murni fitur "Isi dari foto" (fdFotoPetakan & fdFotoCek).
// Memotong blok FD-FOTO-PURE dari app/index.html lalu menjalankannya di vm.
// Jalankan: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const A = '/* FD-FOTO-PURE-START */', B = '/* FD-FOTO-PURE-END */';
const i = html.indexOf(A), j = html.indexOf(B);
assert.ok(i !== -1 && j > i, 'blok FD-FOTO-PURE tidak ditemukan di app/index.html');
assert.equal(html.indexOf(A, i + 1), -1, 'penanda FD-FOTO-PURE-START muncul lebih dari sekali');
const ctx = vm.createContext({});
vm.runInContext(html.slice(i + A.length, j), ctx);
const { fdFotoPetakan, fdFotoCek, fdFotoPetakanSemua } = ctx;
// Objek dari dalam vm punya prototipe lain: salin dulu agar bisa dibandingkan deepEqual
const plain = (o) => JSON.parse(JSON.stringify(o));
const kode = (cek) => plain(cek).map((c) => c.kode);
const tingkat = (cek, t) => plain(cek).filter((c) => c.tingkat === t).map((c) => c.kode);
const konteks = (y, m, d, extra = {}) => ({ ppnRate: 10, tanggalForm: { y, m, d }, adaDataTanggalIni: false, medianPenjualanBulan: null, ...extra });

const kosongBayar = { qris: null, edc: null, transfer: null, total: null };

// Lembar nyata 19 April 2026
const F1 = {
  tanggal: '2026-04-19', nama_hari: 'Minggu',
  penjualan: { bakso: 1932000, minuman: 329000, ice_cream: 4000, lain_lain: null },
  total_penjualan: 2265000,
  pengeluaran: [
    { nama: 'Belanja Sore', jumlah: 94000, jenis: 'belanja_sore' },
    { nama: 'Belanja Pagi', jumlah: 50000, jenis: 'belanja_pagi' },
    { nama: 'Kecap ABC', jumlah: 650000, jenis: 'lainnya' },
    { nama: 'Giling daging', jumlah: 800000, jenis: 'daging' }
  ],
  total_pengeluaran: 1594000, saldo: 671000,
  pembayaran: { ...kosongBayar },
  saldo_akhir: 671000, ppn: 226500, disetorkan: 897500,
  ojol: { periode: '13-19', gojek: 155200, grab: 162200, total: 317400 },
  keraguan: []
};

test('F1 - lembar 19 April 2026 (data nyata)', () => {
  const nilai = fdFotoPetakan(F1);
  assert.deepEqual(plain(nilai.kolom), {
    totalPenjualan: 2265000, tunai: 671000, qris: 0, edc: 0, transfer: 0,
    belanjaPagi: 50000, belanjaSore: 94000, daging: 800000, dll: 650000, keterangan: 'KECAP ABC',
    gojek: 155200, grab: 162200
  });
  assert.equal('pesanan' in nilai.kolom, false);
  assert.deepEqual(plain(nilai.ragu), []);
  const cek = fdFotoCek(F1, nilai, konteks(2026, 4, 19));
  assert.deepEqual(kode(cek), ['SEMUA_COCOK']);
  assert.equal(cek[0].tingkat, 'ok');
});

test('F2 - 18 April 2026 (banyak barang lainnya, tanpa ojol)', () => {
  const h = {
    tanggal: '2026-04-18', nama_hari: 'Sabtu',
    penjualan: { bakso: null, minuman: null, ice_cream: null, lain_lain: null },
    total_penjualan: 1220000,
    pengeluaran: [
      { nama: 'Belanja Pagi', jumlah: 50000, jenis: 'belanja_pagi' },
      { nama: 'Belanja Sore', jumlah: 522000, jenis: 'belanja_sore' },
      { nama: 'Giling daging', jumlah: 1126000, jenis: 'daging' },
      { nama: 'Lampu', jumlah: 150000, jenis: 'lainnya' },
      { nama: 'Gula merah', jumlah: 200000, jenis: 'lainnya' },
      { nama: 'Saos ABC', jumlah: 207000, jenis: 'lainnya' }
    ],
    total_pengeluaran: 2255000, pembayaran: { ...kosongBayar }, saldo_akhir: 91000, ppn: 122000, ojol: null, keraguan: []
  };
  const nilai = fdFotoPetakan(h);
  assert.equal(nilai.kolom.dll, 557000);
  assert.equal(nilai.kolom.keterangan, 'LAMPU, GULA MERAH & SAOS ABC');
  assert.equal(nilai.kolom.daging, 1126000);
  assert.equal('gojek' in nilai.kolom, false);
  assert.equal('grab' in nilai.kolom, false);
  const cek = fdFotoCek(h, nilai, konteks(2026, 4, 18));
  assert.deepEqual(tingkat(cek, 'error'), []);
});

test('F3 - 13 April 2026 (Saldo Akhir negatif, tidak mengikuti rumus)', () => {
  const h = {
    tanggal: '2026-04-13', nama_hari: 'Senin',
    penjualan: {}, total_penjualan: 991000,
    pengeluaran: [
      { nama: 'Belanja Pagi', jumlah: 50000, jenis: 'belanja_pagi' },
      { nama: 'Belanja Sore', jumlah: 403000, jenis: 'belanja_sore' },
      { nama: 'Giling daging', jumlah: 725000, jenis: 'daging' }
    ],
    total_pengeluaran: 1178000, pembayaran: { qris: null, edc: 656700, transfer: null, total: null },
    saldo_akhir: -118700, ppn: 99100, keraguan: []
  };
  const nilai = fdFotoPetakan(h);
  assert.equal(nilai.kolom.tunai, -118700);
  assert.equal(nilai.kolom.edc, 656700);
  const cek = fdFotoCek(h, nilai, konteks(2026, 4, 13));
  assert.equal(kode(cek).some((k) => /SALDO/.test(k)), false, 'tidak boleh ada cek soal saldo');
  assert.deepEqual(tingkat(cek, 'error'), []);
});

test('F4 - angka PPN tertukar ke total penjualan', () => {
  const h = { tanggal: '2026-09-07', penjualan: {}, total_penjualan: 183000, pengeluaran: [], pembayaran: {}, saldo_akhir: 0, ppn: 183000, keraguan: [] };
  const cek = fdFotoCek(h, fdFotoPetakan(h), konteks(2026, 9, 7));
  assert.ok(tingkat(cek, 'error').includes('PPN_TERTUKAR'));
  assert.equal(kode(cek).includes('PPN_BEDA'), false);
});

test('F5 - non-tunai melebihi penjualan', () => {
  const h = { tanggal: '2025-12-16', penjualan: {}, total_penjualan: 454400, pengeluaran: [], pembayaran: { edc: 2462900 }, saldo_akhir: 0, ppn: 45440, keraguan: [] };
  const cek = fdFotoCek(h, fdFotoPetakan(h), konteks(2025, 12, 16));
  assert.ok(tingkat(cek, 'error').includes('NONTUNAI_LEBIH'));
});

test('F6 - tanggal & hari', () => {
  const a = fdFotoCek(F1, fdFotoPetakan(F1), konteks(2026, 4, 20));
  assert.ok(kode(a).includes('TGL_BEDA'));
  const tb = a.find((c) => c.kode === 'TGL_BEDA');
  assert.match(tb.pesan, /19 April 2026/);

  const hb = { ...F1, nama_hari: 'Senin' };
  assert.ok(kode(fdFotoCek(hb, fdFotoPetakan(hb), konteks(2026, 4, 19))).includes('HARI_BEDA'));

  const hc = { ...F1, tanggal: null };
  assert.ok(kode(fdFotoCek(hc, fdFotoPetakan(hc), konteks(2026, 4, 19))).includes('TGL_KOSONG'));
});

test('F7 - ojol', () => {
  const ha = { ...F1, ojol: { periode: '13-19', gojek: 155200, grab: 162200, total: 317000 } };
  assert.ok(kode(fdFotoCek(ha, fdFotoPetakan(ha), konteks(2026, 4, 19))).includes('OJOL_TOTAL_BEDA'));

  const hb = { ...F1, tanggal: '2026-04-18', nama_hari: 'Sabtu' };
  const cek = fdFotoCek(hb, fdFotoPetakan(hb), konteks(2026, 4, 18));
  assert.ok(tingkat(cek, 'info').includes('OJOL_BUKAN_MINGGU'));
});

test('F8 - keraguan & kolom kosong', () => {
  const ha = { ...F1, keraguan: [{ kolom: 'total_penjualan' }, { kolom: 'saldo_akhir' }] };
  const na = fdFotoPetakan(ha);
  assert.ok(na.ragu.includes('totalPenjualan'));
  assert.ok(na.ragu.includes('tunai'));
  assert.ok(kode(fdFotoCek(ha, na, konteks(2026, 4, 19))).includes('RAGU'));

  const hb = { ...F1, saldo_akhir: null, saldo: 500000, disetorkan: null };
  const nb = fdFotoPetakan(hb);
  assert.equal(nb.kolom.tunai, 500000);
  assert.ok(nb.ragu.includes('tunai'));
});

test('F9 - penjualan jauh di bawah biasanya', () => {
  const h = { ...F1, penjualan: {}, total_penjualan: 400000, ppn: 40000, disetorkan: null };
  const cek = fdFotoCek(h, fdFotoPetakan(h), konteks(2026, 4, 19, { medianPenjualanBulan: 2000000 }));
  assert.ok(kode(cek).includes('PENJUALAN_KECIL'));
});

test('Tambahan - jenis tak sah, total kosong, nama dobel', () => {
  const h = {
    tanggal: '2026-04-19', penjualan: { bakso: 1000000, minuman: 200000 }, total_penjualan: null,
    pengeluaran: [
      { nama: 'giling daging sapi', jumlah: 300000, jenis: 'x' },
      { nama: 'Belanja pagi', jumlah: 50000, jenis: '' },
      { nama: ' kecap  abc ', jumlah: 10000, jenis: 'lainnya' },
      { nama: 'Kecap ABC', jumlah: 5000, jenis: 'lainnya' },
      { nama: 'Gas', jumlah: 20000, jenis: 'lainnya' }
    ],
    pembayaran: {}, saldo_akhir: null, saldo: null, ppn: null, keraguan: [{ kolom: 'tanggal' }, { kolom: 'ppn' }]
  };
  const n = fdFotoPetakan(h);
  assert.equal(n.kolom.totalPenjualan, 1200000);
  assert.ok(n.ragu.includes('totalPenjualan'));
  assert.equal('tunai' in n.kolom, false);
  assert.equal(n.kolom.daging, 300000);
  assert.equal(n.kolom.belanjaPagi, 50000);
  assert.equal(n.kolom.dll, 35000);
  assert.equal(n.kolom.keterangan, 'KECAP ABC & GAS');
  assert.deepEqual(plain(n.ragu), ['totalPenjualan']);
  assert.ok(n.info.some((x) => x.kode === 'RAGU_TANGGAL'));
});

// v7.3: nota daging (contoh nyata: Kios Daging Sapi Barokah Jaya, 29/10/2026, Jumlah Rp. 752.000)
const NOTA = { hari: 29, bulan: 10, tahun: 2026, total: 752000, ragu_total: false, ragu_tanggal: false };
const hanyaNota = (n = NOTA) => ({ ada_lembar: false, tanggal: null, penjualan: {}, total_penjualan: null, pengeluaran: [], pembayaran: {},
  saldo_akhir: null, ppn: null, nota_daging: n, keraguan: [] });

test('N1 - hanya nota daging: isi kolom Daging saja', () => {
  const n = fdFotoPetakanSemua(hanyaNota(), 2026);
  assert.equal(n.mode, 'nota');
  assert.deepEqual(plain(n.kolom), { daging: 752000 });
  assert.deepEqual(plain(n.tanggal), { y: 2026, m: 10, d: 29 });
  const a = fdFotoCek(hanyaNota(), n, konteks(2026, 10, 29, { adaDataTanggalIni: true }));
  assert.deepEqual(kode(a), ['NOTA_DIPAKAI', 'NOTA_ADA_DATA', 'SEMUA_COCOK']);
  const b = fdFotoCek(hanyaNota(), n, konteks(2026, 10, 28));
  assert.ok(kode(b).includes('NOTA_TGL_FORM'));
  assert.equal(kode(b).includes('NOTA_DATA_BARU'), false);
  assert.equal(kode(b).includes('TGL_KOSONG'), false);
});

test('N2 - nota: tahun tidak tertulis, total tidak terbaca, ragu', () => {
  const n = fdFotoPetakanSemua(hanyaNota({ hari: 29, bulan: 10, tahun: null, total: null }), 2026);
  assert.deepEqual(plain(n.tanggal), { y: 2026, m: 10, d: 29 });
  assert.equal('daging' in n.kolom, false);
  const c = fdFotoCek(hanyaNota(), n, konteks(2026, 10, 29));
  assert.ok(tingkat(c, 'error').includes('NOTA_TOTAL_KOSONG'));
  assert.ok(kode(c).includes('NOTA_TAHUN'));
  const r = fdFotoPetakanSemua(hanyaNota({ ...NOTA, ragu_total: true }), 2026);
  assert.deepEqual(plain(r.ragu), ['daging']);
  assert.equal(fdFotoPetakanSemua(hanyaNota(null), 2026).mode, 'kosong');
});

test('N3 - lembar + nota tanggal sama: nota menang atas daging lembar', () => {
  const h = { ...F1, ada_lembar: true, nota_daging: { hari: 19, bulan: 4, tahun: 2026, total: 820000 } };
  const n = fdFotoPetakanSemua(h, 2026);
  assert.equal(n.mode, 'keduanya');
  assert.equal(n.kolom.daging, 820000);
  assert.equal(n.kolom.totalPenjualan, 2265000);
  const c = fdFotoCek(h, n, konteks(2026, 4, 19));
  assert.ok(tingkat(c, 'peringatan').includes('DAGING_BEDA'));
  const same = { ...h, nota_daging: { hari: 19, bulan: 4, tahun: 2026, total: 800000 } };
  assert.ok(kode(fdFotoCek(same, fdFotoPetakanSemua(same, 2026), konteks(2026, 4, 19))).includes('NOTA_DIPAKAI'));
});

test('N4 - lembar + nota beda tanggal: nota tidak dipakai', () => {
  const h = { ...F1, ada_lembar: true, nota_daging: NOTA };
  const n = fdFotoPetakanSemua(h, 2026);
  assert.equal(n.kolom.daging, 800000);
  assert.deepEqual(plain(n.tanggal), { y: 2026, m: 4, d: 19 });
  assert.ok(tingkat(fdFotoCek(h, n, konteks(2026, 4, 19)), 'error').includes('NOTA_TGL_LAIN'));
});

test('N5 - hasil lama tanpa ada_lembar tetap dianggap lembar', () => {
  const n = fdFotoPetakanSemua(F1, 2026);
  assert.equal(n.mode, 'lembar');
  assert.deepEqual(kode(fdFotoCek(F1, n, konteks(2026, 4, 19))), ['SEMUA_COCOK']);
});
