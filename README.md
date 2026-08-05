# 🏠 Rumah Belajar All Manik

Platform belajar untuk **siswa, guru, dan orang tua** — beranda publik berisi info pendidikan, tips & trik belajar, dan promo, ditambah dashboard terpisah untuk **Admin**, **Guru** (jadwal, materi, tugas), dan **Orang Tua** (pantauan anak). Responsif untuk **mobile, tablet, dan desktop**.

## 🚀 Menjalankan Secara Lokal

```bash
npm install
npm start          # atau: npm run dev (auto-reload)
```

Buka **http://localhost:3000**

> **Database ganda (dual-driver):**
> - Tanpa pengaturan apa pun → **SQLite** (bawaan Node `node:sqlite`, data di `data/rumah-belajar.db`).
> - Dengan env `DATABASE_URL` → **PostgreSQL** (untuk produksi/Netlify).

## 🔑 Akun Demo

| Peran     | Email              | Sandi     |
| --------- | ------------------ | --------- |
| Admin     | `admin@allmanik.id` | `admin123` |
| Guru      | `guru@allmanik.id`  | `guru123`  |
| Orang Tua | `ortu@allmanik.id`  | `ortu123`  |

> Ganti sandi ini sebelum produksi. Kredensial **tidak ditampilkan** di halaman login.

## 📁 Struktur Proyek

```
├── server.js                 # Aplikasi Express + auth + routing (export app untuk serverless)
├── db.js                     # Dual-driver: SQLite (lokal) / PostgreSQL (produksi) + seed
├── views/                    # Template EJS (beranda, login, dashboard)
├── public/                   # CSS responsif + JS
├── netlify/
│   ├── functions/api.js      # Entry Netlify Function (serverless-http)
│   └── prepare.js            # Build: salin views/public ke folder fungsi
├── netlify.toml              # Konfigurasi build, bundler, redirect
├── data/                     # Database SQLite (otomatis, hanya lokal)
└── package.json              # Scripts: start, dev, build
```

---

## ☁️ Deploy ke Netlify (migrasi penuh)

Alur: **GitHub** (simpan kode) → **Postgres** (database produksi) → **Netlify** (hosting).

### 1️⃣ Push ke GitHub

```bash
git init
git add .
git commit -m "Rumah Belajar All Manik - Netlify ready"
git branch -M main
git remote add origin https://github.com/NAMAKAMU/rumah-belajar-all-manik.git
git push -u origin main
```

### 2️⃣ Siapkan database Postgres (gratis)

1. Daftar di **[Neon](https://neon.tech)** atau **[Supabase](https://supabase.com)** (email saja, tanpa kartu kredit).
2. Buat project/database baru. Salin **connection string** `postgresql://...`.
   > Neon: pakai koneksi *pooled* (berakhiran `-pooler`). Supabase: pakai *connection string* mode "Transaction".

### 3️⃣ Sambungkan ke Netlify

1. Buka **app.netlify.com** → *Add new site* → *Import an existing project* → pilih repo GitHub Anda.
2. Isi **Environment variables** (Site settings → Environment variables):
   - `DATABASE_URL` → connection string Postgres dari langkah 2
   - `SESSION_SECRET` → string rahasia acak (mis. `openssl rand -hex 32`)
3. Build sudah terkonfigurasi otomatis lewat `netlify.toml` (command `npm run build`, fungsi `netlify/functions`).
4. Klik **Deploy**.

### ⚙️ Bagaimana cara kerjanya

- `netlify.toml` mengarahkan **semua URL** ke aplikasi Express yang dibungkus `serverless-http` di `netlify/functions/api.js`.
- Script build `netlify/prepare.js` menyalin `views/` dan `public/` ke folder fungsi, karena saat dibundle `__dirname` berubah.
- Saat ada `DATABASE_URL`, aplikasi otomatis memakai **Postgres** + session tersimpan di tabel `sessions` (via `connect-pg-simple`), sehingga login tetap hidup di serverless.

### ✅ Checklist setelah deploy

- [ ] Deploy sukses & situs terbuka
- [ ] Halaman beranda menampilkan info/tips/promo
- [ ] Login **guru** → dashboard guru berfungsi (tambah/hapus jadwal, materi, tugas)
- [ ] Login **orang tua** → melihat data anak
- [ ] Login **admin** → dashboard admin
- [ ] Data masih ada setelah beberapa menit (uji persistensi Postgres)

---

## 🐛 Dukungan / Catatan

- **Data demo** otomatis masuk hanya jika tabel `users` kosong.
- Sandi di-hash dengan `bcryptjs`.
- Ubah `SESSION_SECRET` menjadi nilai rahasia sebelum produksi.
