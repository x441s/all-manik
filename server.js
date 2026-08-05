// ============================================================
//  server.js — Rumah Belajar All Manik
//  Beranda publik + Dashboard (Admin, Guru, Orang Tua)
//
//  Dapat dijalankan sebagai server biasa (node server.js)
//  ATAU sebagai Netlify Function (lewat netlify/functions/api.js).
// ============================================================
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { all, get, run, pool, isPostgres, init } = require('./db');

const app = express();

// ------------------------------------------------------------
//  Konfigurasi dasar
// ------------------------------------------------------------
// Lokal: asset ada di root proyek. Netlify: build menyalin asset ke
// netlify/functions/_assets (karena __dirname berubah saat dibundle).
function appRoot() {
  const netlifyAssets = path.join(__dirname, '_assets');
  return fs.existsSync(netlifyAssets) ? netlifyAssets : __dirname;
}
const ROOT = appRoot();

app.set('view engine', 'ejs');
app.set('views', path.join(ROOT, 'views'));
app.use(express.static(path.join(ROOT, 'public')));
app.use(express.urlencoded({ extended: true }));

const sessionOptions = {
  secret: process.env.SESSION_SECRET || 'all-manik-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 },
};

// Sesi persisten di Postgres untuk produksi (serverless); MemoryStore untuk lokal
if (isPostgres) {
  const PgSession = require('connect-pg-simple')(session);
  sessionOptions.store = new PgSession({
    pool,
    tableName: 'sessions',
    createTableIfMissing: true,
  });
}
app.use(session(sessionOptions));

// ------------------------------------------------------------
//  Helper & middleware
// ------------------------------------------------------------
const ROLE_LABEL = { admin: 'Administrator', guru: 'Guru', orangtua: 'Orang Tua' };

const homeFor = (role) => ({ admin: '/admin', guru: '/guru', orangtua: '/orangtua' }[role] || '/');

// Tersedia untuk semua template EJS
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.ROLE_LABEL = ROLE_LABEL;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.now = new Date();
  next();
});

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

// Bungkus route async agar error tidak merusak proses
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Batasi akses berdasarkan peran
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    if (!roles.includes(req.session.user.role)) {
      return res.redirect(homeFor(req.session.user.role));
    }
    next();
  };
}

// ------------------------------------------------------------
//  Beranda (publik)
// ------------------------------------------------------------
app.get('/', asyncHandler(async (req, res) => {
  const infos = await all('SELECT * FROM info_pendidikan ORDER BY dibuat_pada DESC');
  const tips = await all('SELECT * FROM tips_trik ORDER BY dibuat_pada DESC');
  const promos = await all('SELECT * FROM promo WHERE aktif = 1 ORDER BY dibuat_pada DESC');
  res.render('beranda', { pageTitle: 'Beranda', infos, tips, promos });
}));

// ------------------------------------------------------------
//  Autentikasi
// ------------------------------------------------------------
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect(homeFor(req.session.user.role));
  res.render('login', { pageTitle: 'Masuk' });
});

app.post('/login', asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = await get('SELECT * FROM users WHERE email = ?', [email]);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    setFlash(req, 'error', 'Email atau kata sandi salah. Coba lagi.');
    return res.redirect('/login');
  }

  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  res.redirect(homeFor(user.role));
}));

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ------------------------------------------------------------
//  Dashboard Admin  (konten masih kosong — menunggu pengembangan)
// ------------------------------------------------------------
app.get('/admin', requireRole('admin'), (req, res) => {
  res.render('dashboard/admin', { pageTitle: 'Dashboard Admin', active: 'home' });
});

// ------------------------------------------------------------
//  Dashboard Guru — Ringkasan
// ------------------------------------------------------------
app.get('/guru', requireRole('guru'), asyncHandler(async (req, res) => {
  const guruId = req.session.user.id;
  const jadwalCount = (await get('SELECT COUNT(*) AS n FROM jadwal WHERE guru_id = ?', [guruId])).n;
  const materiCount = (await get('SELECT COUNT(*) AS n FROM materi WHERE guru_id = ?', [guruId])).n;
  const tugasCount = (await get('SELECT COUNT(*) AS n FROM tugas WHERE guru_id = ?', [guruId])).n;
  const siswaCount = (await get('SELECT COUNT(*) AS n FROM siswa')).n;

  const jadwalHariIni = await all(`
    SELECT j.*, k.nama AS kelas
    FROM jadwal j
    LEFT JOIN kelas k ON k.id = j.kelas_id
    WHERE j.guru_id = ? AND j.hari = ?
    ORDER BY j.jam_mulai
  `, [guruId, dayName(new Date())]);

  const materiTerbaru = await all(`
    SELECT m.*, k.nama AS kelas FROM materi m
    LEFT JOIN kelas k ON k.id = m.kelas_id
    WHERE m.guru_id = ? ORDER BY m.dibuat_pada DESC LIMIT 5
  `, [guruId]);

  const tugasTerbaru = await all(`
    SELECT t.*, k.nama AS kelas FROM tugas t
    LEFT JOIN kelas k ON k.id = t.kelas_id
    WHERE t.guru_id = ? ORDER BY t.dibuat_pada DESC LIMIT 5
  `, [guruId]);

  res.render('dashboard/guru', {
    pageTitle: 'Dashboard Guru', active: 'home',
    jadwalCount, materiCount, tugasCount, siswaCount,
    jadwalHariIni, materiTerbaru, tugasTerbaru,
  });
}));

// ------------------------------------------------------------
//  Dashboard Guru — Jadwal Mengajar
// ------------------------------------------------------------
app.get('/guru/jadwal', requireRole('guru'), asyncHandler(async (req, res) => {
  const jadwal = await all(`
    SELECT j.*, k.nama AS kelas FROM jadwal j
    LEFT JOIN kelas k ON k.id = j.kelas_id
    WHERE j.guru_id = ? ORDER BY
      CASE j.hari
        WHEN 'Senin' THEN 1 WHEN 'Selasa' THEN 2 WHEN 'Rabu' THEN 3
        WHEN 'Kamis' THEN 4 WHEN 'Jumat' THEN 5 WHEN 'Sabtu' THEN 6 ELSE 7
      END, j.jam_mulai
  `, [req.session.user.id]);

  const kelas = await all('SELECT * FROM kelas ORDER BY nama');
  res.render('dashboard/guru_jadwal', { pageTitle: 'Jadwal Mengajar', active: 'jadwal', jadwal, kelas });
}));

app.post('/guru/jadwal', requireRole('guru'), asyncHandler(async (req, res) => {
  const { kelas_id, hari, jam_mulai, jam_selesai, mapel } = req.body;
  await run(`
    INSERT INTO jadwal (kelas_id, hari, jam_mulai, jam_selesai, mapel, guru_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [kelas_id, hari, jam_mulai, jam_selesai, mapel, req.session.user.id]);
  setFlash(req, 'success', 'Jadwal berhasil ditambahkan.');
  res.redirect('/guru/jadwal');
}));

app.post('/guru/jadwal/:id/delete', requireRole('guru'), asyncHandler(async (req, res) => {
  await run('DELETE FROM jadwal WHERE id = ? AND guru_id = ?', [req.params.id, req.session.user.id]);
  setFlash(req, 'success', 'Jadwal dihapus.');
  res.redirect('/guru/jadwal');
}));

// ------------------------------------------------------------
//  Dashboard Guru — Materi
// ------------------------------------------------------------
app.get('/guru/materi', requireRole('guru'), asyncHandler(async (req, res) => {
  const materi = await all(`
    SELECT m.*, k.nama AS kelas FROM materi m
    LEFT JOIN kelas k ON k.id = m.kelas_id
    WHERE m.guru_id = ? ORDER BY m.dibuat_pada DESC
  `, [req.session.user.id]);
  const kelas = await all('SELECT * FROM kelas ORDER BY nama');
  res.render('dashboard/guru_materi', { pageTitle: 'Materi', active: 'materi', materi, kelas });
}));

app.post('/guru/materi', requireRole('guru'), asyncHandler(async (req, res) => {
  const { kelas_id, mapel, judul, isi, file_url } = req.body;
  await run(`
    INSERT INTO materi (kelas_id, mapel, judul, isi, file_url, guru_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [kelas_id || null, mapel, judul, isi || null, file_url || null, req.session.user.id]);
  setFlash(req, 'success', 'Materi berhasil ditambahkan.');
  res.redirect('/guru/materi');
}));

app.post('/guru/materi/:id/delete', requireRole('guru'), asyncHandler(async (req, res) => {
  await run('DELETE FROM materi WHERE id = ? AND guru_id = ?', [req.params.id, req.session.user.id]);
  setFlash(req, 'success', 'Materi dihapus.');
  res.redirect('/guru/materi');
}));

// ------------------------------------------------------------
//  Dashboard Guru — Tugas
// ------------------------------------------------------------
app.get('/guru/tugas', requireRole('guru'), asyncHandler(async (req, res) => {
  const tugas = await all(`
    SELECT t.*, k.nama AS kelas FROM tugas t
    LEFT JOIN kelas k ON k.id = t.kelas_id
    WHERE t.guru_id = ? ORDER BY COALESCE(t.tenggat, t.dibuat_pada)
  `, [req.session.user.id]);
  const kelas = await all('SELECT * FROM kelas ORDER BY nama');
  res.render('dashboard/guru_tugas', { pageTitle: 'Tugas', active: 'tugas', tugas, kelas });
}));

app.post('/guru/tugas', requireRole('guru'), asyncHandler(async (req, res) => {
  const { kelas_id, mapel, judul, deskripsi, tenggat } = req.body;
  await run(`
    INSERT INTO tugas (kelas_id, mapel, judul, deskripsi, tenggat, guru_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [kelas_id || null, mapel, judul, deskripsi || null, tenggat || null, req.session.user.id]);
  setFlash(req, 'success', 'Tugas berhasil ditambahkan.');
  res.redirect('/guru/tugas');
}));

app.post('/guru/tugas/:id/delete', requireRole('guru'), asyncHandler(async (req, res) => {
  await run('DELETE FROM tugas WHERE id = ? AND guru_id = ?', [req.params.id, req.session.user.id]);
  setFlash(req, 'success', 'Tugas dihapus.');
  res.redirect('/guru/tugas');
}));

// ------------------------------------------------------------
//  Dashboard Orang Tua
// ------------------------------------------------------------
app.get('/orangtua', requireRole('orangtua'), asyncHandler(async (req, res) => {
  const ortuId = req.session.user.id;

  const anak = await all(`
    SELECT s.*, k.nama AS kelas FROM siswa s
    LEFT JOIN kelas k ON k.id = s.kelas_id
    WHERE s.orangtua_id = ?
  `, [ortuId]);

  const kelasIds = anak.map((a) => a.kelas_id).filter(Boolean);

  let jadwal = [];
  let materi = [];
  let tugas = [];
  if (kelasIds.length) {
    const placeholders = kelasIds.map(() => '?').join(',');
    jadwal = await all(`
      SELECT j.*, k.nama AS kelas, u.name AS guru FROM jadwal j
      LEFT JOIN kelas k ON k.id = j.kelas_id
      LEFT JOIN users u ON u.id = j.guru_id
      WHERE j.kelas_id IN (${placeholders})
      ORDER BY CASE j.hari WHEN 'Senin' THEN 1 WHEN 'Selasa' THEN 2 WHEN 'Rabu' THEN 3
        WHEN 'Kamis' THEN 4 WHEN 'Jumat' THEN 5 WHEN 'Sabtu' THEN 6 ELSE 7 END, j.jam_mulai
    `, kelasIds);

    materi = await all(`
      SELECT m.*, k.nama AS kelas, u.name AS guru FROM materi m
      LEFT JOIN kelas k ON k.id = m.kelas_id
      LEFT JOIN users u ON u.id = m.guru_id
      WHERE m.kelas_id IN (${placeholders})
      ORDER BY m.dibuat_pada DESC LIMIT 10
    `, kelasIds);

    tugas = await all(`
      SELECT t.*, k.nama AS kelas, u.name AS guru FROM tugas t
      LEFT JOIN kelas k ON k.id = t.kelas_id
      LEFT JOIN users u ON u.id = t.guru_id
      WHERE t.kelas_id IN (${placeholders})
      ORDER BY COALESCE(t.tenggat, t.dibuat_pada)
    `, kelasIds);
  }

  res.render('dashboard/orangtua', {
    pageTitle: 'Dashboard Orang Tua', active: 'home', anak, jadwal, materi, tugas,
  });
}));

// ------------------------------------------------------------
//  Penanganan error
// ------------------------------------------------------------
app.use((err, req, res, next) => {
  console.error('[Error]', err);
  if (res.headersSent) return next(err);
  res.status(500).send('Terjadi kesalahan pada server. Silakan coba lagi.');
});

// ------------------------------------------------------------
//  Mulai server (hanya saat dijalankan langsung)
// ------------------------------------------------------------
function dayName(date) {
  const nama = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  return nama[date.getDay()];
}

async function boot() {
  await init();
  if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`\n🏠 Rumah Belajar All Manik berjalan di http://localhost:${PORT} (${isPostgres ? 'PostgreSQL' : 'SQLite'})\n`);
    });
  }
}

// Netlify Function memerlukan app di-export; init dilakukan di fungsi itu
if (require.main === module) {
  boot().catch((e) => { console.error('Gagal memulai:', e); process.exit(1); });
}

module.exports = app;
module.exports.boot = boot;
