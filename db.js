// ============================================================
//  db.js — Lapisan database ganda (dual-driver)
//
//  • Tanpa env DATABASE_URL  → SQLite (node:sqlite bawaan Node), untuk lokal
//  • Dengan env DATABASE_URL → PostgreSQL (pg), untuk produksi (Netlify)
//
//  Keduanya menyediakan interface async yang sama:
//    all(sql, params)        → array baris
//    get(sql, params)        → satu baris atau null
//    run(sql, params)        → { changes, lastInsertRowid? }
//    runReturning(sql, param)→ insert yang mengembalikan id
//  Semua SQL memakai placeholder `?` (dikonversi ke $1..$n untuk Postgres).
// ============================================================
const path = require('node:path');

const isPostgres = Boolean(process.env.DATABASE_URL);

// ------------------------------------------------------------
//  SQLite — driver bawaan Node (node:sqlite)
// ------------------------------------------------------------
function createSqliteDriver() {
  const fs = require('node:fs');
  const { DatabaseSync } = require('node:sqlite');

  const DATA_DIR = path.join(__dirname, 'data');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const db = new DatabaseSync(path.join(DATA_DIR, 'rumah-belajar.db'));
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  return {
    isPostgres: false,
    pool: null,
    _raw: db,
    async all(sql, params = []) { return db.prepare(sql).all(...params); },
    async get(sql, params = []) { return db.prepare(sql).get(...params) || null; },
    async run(sql, params = []) {
      const info = db.prepare(sql).run(...params);
      return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
    },
    async runReturning(sql, params = []) {
      const info = db.prepare(sql).run(...params);
      return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
    },
  };
}

// ------------------------------------------------------------
//  PostgreSQL — driver pg
// ------------------------------------------------------------
function createPgDriver() {
  const { Pool } = require('pg');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL_DISABLE ? false : { rejectUnauthorized: false },
  });

  // Ubah placeholder `?` menjadi `$1..$n` yang dipakai Postgres
  function numbered(sql) {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  }

  return {
    isPostgres: true,
    pool,
    async all(sql, params = []) {
      const r = await pool.query(numbered(sql), params);
      return r.rows;
    },
    async get(sql, params = []) {
      const r = await pool.query(numbered(sql), params);
      return r.rows[0] || null;
    },
    async run(sql, params = []) {
      const r = await pool.query(numbered(sql), params);
      return { changes: r.rowCount };
    },
    async runReturning(sql, params = []) {
      const r = await pool.query(numbered(sql) + ' RETURNING id', params);
      return { changes: r.rowCount, lastInsertRowid: Number(r.rows[0].id) };
    },
  };
}

const driver = isPostgres ? createPgDriver() : createSqliteDriver();
const { all, get, run, runReturning, pool } = driver;

// ------------------------------------------------------------
//  Skema database per mesin
// ------------------------------------------------------------
const SCHEMA_SQLITE = `
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin','guru','orangtua')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS kelas (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    nama    TEXT NOT NULL,
    tingkat TEXT
  );

  CREATE TABLE IF NOT EXISTS siswa (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nis         TEXT UNIQUE,
    nama        TEXT NOT NULL,
    kelas_id    INTEGER REFERENCES kelas(id) ON DELETE SET NULL,
    orangtua_id INTEGER REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS jadwal (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kelas_id    INTEGER REFERENCES kelas(id) ON DELETE CASCADE,
    hari        TEXT NOT NULL,
    jam_mulai   TEXT NOT NULL,
    jam_selesai TEXT NOT NULL,
    mapel       TEXT NOT NULL,
    guru_id     INTEGER REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS materi (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kelas_id    INTEGER REFERENCES kelas(id) ON DELETE SET NULL,
    mapel       TEXT NOT NULL,
    judul       TEXT NOT NULL,
    isi         TEXT,
    file_url    TEXT,
    guru_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    dibuat_pada TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tugas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kelas_id    INTEGER REFERENCES kelas(id) ON DELETE SET NULL,
    mapel       TEXT NOT NULL,
    judul       TEXT NOT NULL,
    deskripsi   TEXT,
    tenggat     TEXT,
    guru_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    dibuat_pada TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS info_pendidikan (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    judul       TEXT NOT NULL,
    isi         TEXT,
    kategori    TEXT,
    dibuat_pada TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tips_trik (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    judul       TEXT NOT NULL,
    isi         TEXT,
    kategori    TEXT,
    dibuat_pada TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS promo (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    judul           TEXT NOT NULL,
    deskripsi       TEXT,
    potongan        TEXT,
    berlaku_sampai  TEXT,
    aktif           INTEGER NOT NULL DEFAULT 1,
    dibuat_pada     TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

// Postgres: SERIAL id, default waktu via to_char agar format sama dgn SQLite
const SCHEMA_POSTGRES = `
  CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin','guru','orangtua')),
    created_at    TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  );

  CREATE TABLE IF NOT EXISTS kelas (
    id      SERIAL PRIMARY KEY,
    nama    TEXT NOT NULL,
    tingkat TEXT
  );

  CREATE TABLE IF NOT EXISTS siswa (
    id          SERIAL PRIMARY KEY,
    nis         TEXT UNIQUE,
    nama        TEXT NOT NULL,
    kelas_id    INTEGER REFERENCES kelas(id) ON DELETE SET NULL,
    orangtua_id INTEGER REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS jadwal (
    id          SERIAL PRIMARY KEY,
    kelas_id    INTEGER REFERENCES kelas(id) ON DELETE CASCADE,
    hari        TEXT NOT NULL,
    jam_mulai   TEXT NOT NULL,
    jam_selesai TEXT NOT NULL,
    mapel       TEXT NOT NULL,
    guru_id     INTEGER REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS materi (
    id          SERIAL PRIMARY KEY,
    kelas_id    INTEGER REFERENCES kelas(id) ON DELETE SET NULL,
    mapel       TEXT NOT NULL,
    judul       TEXT NOT NULL,
    isi         TEXT,
    file_url    TEXT,
    guru_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    dibuat_pada TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  );

  CREATE TABLE IF NOT EXISTS tugas (
    id          SERIAL PRIMARY KEY,
    kelas_id    INTEGER REFERENCES kelas(id) ON DELETE SET NULL,
    mapel       TEXT NOT NULL,
    judul       TEXT NOT NULL,
    deskripsi   TEXT,
    tenggat     TEXT,
    guru_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    dibuat_pada TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  );

  CREATE TABLE IF NOT EXISTS info_pendidikan (
    id          SERIAL PRIMARY KEY,
    judul       TEXT NOT NULL,
    isi         TEXT,
    kategori    TEXT,
    dibuat_pada TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  );

  CREATE TABLE IF NOT EXISTS tips_trik (
    id          SERIAL PRIMARY KEY,
    judul       TEXT NOT NULL,
    isi         TEXT,
    kategori    TEXT,
    dibuat_pada TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  );

  CREATE TABLE IF NOT EXISTS promo (
    id              SERIAL PRIMARY KEY,
    judul           TEXT NOT NULL,
    deskripsi       TEXT,
    potongan        TEXT,
    berlaku_sampai  TEXT,
    aktif           INTEGER NOT NULL DEFAULT 1,
    dibuat_pada     TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  );
`;

// ------------------------------------------------------------
//  Seed data demo (hanya jika tabel users masih kosong)
// ------------------------------------------------------------
async function seed() {
  const count = await get('SELECT COUNT(*) AS n FROM users');
  if (Number(count.n) > 0) return;

  const ins = 'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)';
  await run(ins, ['Administrator', 'admin@allmanik.id', await bcryptHash('admin123'), 'admin']);
  await run(ins, ['Bu Rina Puspita', 'guru@allmanik.id', await bcryptHash('guru123'), 'guru']);
  await run(ins, ['Ibu Sari Wulandari', 'ortu@allmanik.id', await bcryptHash('ortu123'), 'orangtua']);

  const k1 = Number((await runReturning('INSERT INTO kelas (nama, tingkat) VALUES (?, ?)', ['Kelas 1A', '1'])).lastInsertRowid);
  await runReturning('INSERT INTO kelas (nama, tingkat) VALUES (?, ?)', ['Kelas 1B', '1']);

  const s = 'INSERT INTO siswa (nis, nama, kelas_id, orangtua_id) VALUES (?, ?, ?, ?)';
  await run(s, ['1001', 'Ahmad Fauzi', k1, 3]);
  await run(s, ['1002', 'Siti Nurhaliza', k1, 3]);

  const j = 'INSERT INTO jadwal (kelas_id, hari, jam_mulai, jam_selesai, mapel, guru_id) VALUES (?, ?, ?, ?, ?, ?)';
  const jadwalData = [
    ['Senin', '07:00', '08:30', 'Matematika'],
    ['Senin', '08:30', '10:00', 'Bahasa Indonesia'],
    ['Selasa', '07:00', '08:30', 'IPA'],
    ['Rabu', '08:00', '09:30', 'IPS'],
    ['Kamis', '07:00', '08:30', 'Matematika'],
    ['Jumat', '07:00', '08:00', 'Olahraga'],
  ];
  for (const [hari, mulai, selesai, mapel] of jadwalData) {
    await run(j, [k1, hari, mulai, selesai, mapel, 2]);
  }

  const m = 'INSERT INTO materi (kelas_id, mapel, judul, isi, guru_id) VALUES (?, ?, ?, ?, ?)';
  await run(m, [k1, 'Matematika', 'Bilangan Bulat', 'Ringkasan bilangan bulat: positif, negatif, dan operasi hitung.', 2]);
  await run(m, [k1, 'Bahasa Indonesia', 'Teks Deskripsi', 'Ciri-ciri teks deskripsi dan contoh paragraf deskripsi.', 2]);
  await run(m, [k1, 'IPA', 'Sistem Tata Surya', 'Pengenalan planet-planet dan urutannya dari matahari.', 2]);

  const t = 'INSERT INTO tugas (kelas_id, mapel, judul, deskripsi, tenggat, guru_id) VALUES (?, ?, ?, ?, ?, ?)';
  await run(t, [k1, 'Matematika', 'Latihan Soal Pecahan', 'Kerjakan soal latihan halaman 45–48 pada buku paket.', '2026-08-12', 2]);
  await run(t, [k1, 'Bahasa Indonesia', 'Menulis Paragraf Deskripsi', 'Buat satu paragraf deskripsi tentang lingkungan rumah, minimal 5 kalimat.', '2026-08-15', 2]);
  await run(t, [k1, 'IPA', 'Poster Sistem Tata Surya', 'Buat poster sistem tata surya di kertas A3.', '2026-08-20', 2]);

  const info = 'INSERT INTO info_pendidikan (judul, isi, kategori) VALUES (?, ?, ?)';
  await run(info, ['Pendaftaran Siswa Baru 2026/2027 Dibuka', 'Penerimaan peserta didik baru untuk tahun ajaran 2026/2027 telah dibuka.', 'Pendaftaran']);
  await run(info, ['Kurikulum Merdeka Berjalan Penuh', 'Semua jenjang kelas kini menggunakan Kurikulum Merdeka dengan pembelajaran berbasis proyek.', 'Kurikulum']);
  await run(info, ['Beasiswa untuk Siswa Berprestasi', 'Tersedia beasiswa bagi siswa dengan prestasi akademik maupun non-akademik.', 'Beasiswa']);

  const tips = 'INSERT INTO tips_trik (judul, isi, kategori) VALUES (?, ?, ?)';
  await run(tips, ['Teknik Pomodoro untuk Belajar Fokus', 'Belajar 25 menit, istirahat 5 menit. Ulangi 4 kali, lalu istirahat panjang 15–30 menit.', 'Fokus']);
  await run(tips, ['Membuat Catatan yang Efektif', 'Gunakan metode Cornell: kolom inti di kanan, pertanyaan di kiri, ringkasan di bawah.', 'Catatan']);
  await run(tips, ['Mengerjakan Ujian dengan Tenang', 'Baca semua soal dulu, kerjakan yang paling mudah, lalu kembali ke soal sulit.', 'Ujian']);

  const p = 'INSERT INTO promo (judul, deskripsi, potongan, berlaku_sampai, aktif) VALUES (?, ?, ?, ?, 1)';
  await run(p, ['Paket Les Matematika', 'Diskon khusus pendaftar baru untuk kelas intensif Matematika.', '20%', '2026-08-31']);
  await run(p, ['Bimbingan Belajar UTBK', 'Potongan biaya pendaftaran program bimbingan UTBK.', '15%', '2026-08-31']);
  await run(p, ['Konsultasi Guru Gratis', 'Konsultasi belajar satu sesi gratis untuk anggota baru.', '100%', '2026-09-15']);

  console.log(`✔ Data demo berhasil di-seed ke ${isPostgres ? 'PostgreSQL' : 'SQLite'}.`);
}

// hash async agar seed aman di kedua driver
function bcryptHash(s) {
  return require('bcryptjs').hash(s, 10);
}

// ------------------------------------------------------------
//  Inisialisasi
// ------------------------------------------------------------
async function init() {
  const schema = isPostgres ? SCHEMA_POSTGRES : SCHEMA_SQLITE;
  if (isPostgres) {
    await run('SELECT 1'); // pastikan koneksi hidup
    // pg tidak punya exec multi-statement; jalankan per pernyataan
    const statements = schema
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await pool.query(stmt);
    }
  } else {
    driver._raw.exec(schema);
  }
  await seed();
}

module.exports = { all, get, run, runReturning, pool, isPostgres, init };
