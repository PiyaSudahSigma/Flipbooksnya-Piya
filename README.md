# Piya Flipbook

Website flipbook digital untuk membaca koleksi PDF dengan efek membalik halaman 3D, di-deploy **gratis** di GitHub Pages. Sederhana, ringan, responsif, dan mudah dikelola — sepenuhnya statis tanpa backend.

![Teknologi](https://img.shields.io/badge/HTML-CSS-JS-informational) ![Enkripsi](https://img.shields.io/badge/enkripsi-AES--256--GCM-success) ![Hosting](https://img.shields.io/badge/hosting-GitHub%20Pages-blue)

## Fitur

- **Login password saja** (tanpa username) dengan tombol tampilkan/sembunyikan password.
- **Koleksi buku** dengan cover, judul, deskripsi, jumlah halaman, pencarian, dan tombol *Baca Sekarang*.
- **Reader flipbook 3D**: animasi balik halaman realistis, lipatan/spine di tengah, bayangan 3D, cover kaku, drag & swipe, dua halaman di layar lebar / satu halaman di HP.
- Navigasi lengkap: halaman sebelumnya/berikutnya, nomor halaman, lompat ke halaman, zoom, fullscreen, kembali ke koleksi.
- **Mode gulir** sebagai alternatif ringan jika perangkat kurang mendukung efek 3D.
- **Enkripsi AES-256-GCM** (Web Crypto API) dengan **PBKDF2-SHA256** — file PDF dienkripsi *sebelum* dipublikasikan, didekripsi hanya di memori browser.
- **Utilitas lokal**: `tools/manage-library.html` (enkripsi PDF + susun katalog) dan `tools/change-password.html` (ganti password + enkripsi ulang).
- Render halaman **lazy** + pengelolaan memori (halaman jauh dibuang otomatis) untuk dokumen tebal.

## Model keamanan — baca ini dulu

Situs statis di GitHub Pages **bukan** tempat untuk autentikasi server-side. Pahami hal berikut dengan jujur:

1. **Gerbang login hanyalah tampilan.** Kode JavaScript yang dikirim ke browser bisa dibuka siapa pun. Seseorang yang mengetahui URL file tidak dapat membaca *isi* buku tanpa password (file terenkripsi), tetapi login form-nya sendiri bukan "keamanan" dalam arti kriptografi.
2. **Perlindungan dokumen yang sebenarnya adalah enkripsi.** Setiap file di `books/` adalah kontainer `.piyapdf` berisi PDF yang sudah dienkripsi AES-256-GCM. Tanpa password, file tersebut hanya acak byte — tidak bisa dibaca, tidak bisa dilihat cover-nya.
3. **`data/auth.json` hanya memuat verifikator login** (salt + hash PBKDF2), bukan password. Itu pun bisa ditebak secara offline jika password lemah.
4. **Password lemah = enkripsi lemah.** Meski AES-256 kuat, penyerang bisa menebak password terhadap file terenkripsi. **Ganti password bawaan `piya 123` dengan password panjang dan unik sebelum mengunggah dokumen pribadi/rahasia.**
5. **PDF asli tidak boleh di-commit.** Selalu unggah hanya `.piyapdf`. Simpan PDF asli sebagai cadangan di luar repository (disk lokal/external).
6. Tidak ada data yang dikirim ke layanan eksternal. Semua proses (login check, enkripsi, dekripsi, render) terjadi di browser.

## Struktur proyek

```
Flipbooksnya-Piya/
├── index.html                  # Halaman utama (login + koleksi + reader)
├── .nojekyll
├── assets/
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js              # Router & perekat modul
│   │   ├── auth.js             # Sesi login (password hanya di memori)
│   │   ├── crypto.js           # AES-GCM + PBKDF2, format .piyapdf
│   │   ├── library.js          # Katalog, pencarian, kartu buku
│   │   └── flipbook.js         # Reader PDF.js + StPageFlip
│   └── vendor/
│       ├── pdfjs/              # PDF.js (render PDF)
│       └── page-flip/          # StPageFlip (animasi balik halaman)
├── books/
│   ├── <id-buku>.piyapdf       # PDF terenkripsi (JANGAN taruh PDF asli)
│   └── covers/
│       └── <id-buku>.jpg       # cover buku
├── data/
│   ├── catalog.json            # Metadata koleksi (judul, deskripsi, dll.)
│   └── auth.json               # Verifikator password login
├── tools/
│   ├── manage-library.html     # Tambah/enkripsi buku (lokal, di browser)
│   └── change-password.html    # Ganti password + enkripsi ulang (lokal)
└── README.md
```

Semua path memakai URL relatif, sehingga situs tetap bekerja pada alamat proyek seperti `https://username.github.io/nama-repository/` **maupun** pada domain root.

## Instalasi ke GitHub Pages

1. **Buat repository baru** di GitHub (misal `Flipbooksnya-Piya`), lalu masukkan seluruh source code ini:
   ```bash
   git clone https://github.com/USERNAME/Flipbooksnya-Piya.git
   cd Flipbooksnya-Piya
   # salin seluruh file proyek ke sini
   git add .
   git commit -m "Piya Flipbook: source code awal"
   git push
   ```
2. **Aktifkan GitHub Pages**: buka tab *Settings* → *Pages* → *Source* pilih **Deploy from a branch** → branch `main`, folder `/ (root)` → Save.
3. Tunggu ± 1 menit, lalu buka `https://USERNAME.github.io/Flipbooksnya-Piya/`.
4. **Uji login** dengan password bawaan `piya 123`.
5. **Segera ganti password** (lihat bagian *Mengganti password*) sebelum menambahkan dokumen privat.

> Catatan: karena seluruh file di atas adalah file statis biasa, GitHub Actions tidak diperlukan. (Jika Anda ingin memakai workflow Pages sendiri, source code tetap kompatibel — pastikan folder `books/`, `data/`, dan `assets/` terbawa apa adanya.)

## Menambahkan buku (enkripsi PDF)

Jangan pernah meng-commit PDF asli. Gunakan utilitas **`tools/manage-library.html`** — berjalan di browser, file tidak dikirim ke mana pun:

1. Buka `https://USERNAME.github.io/Flipbooksnya-Piya/tools/manage-library.html`  
   (atau jalankan lokal: `python3 -m http.server 8080` di folder proyek, lalu buka `http://localhost:8080/tools/manage-library.html`).
2. Muat `data/catalog.json` yang ada (atau klik *Katalog Baru* untuk buku pertama).
3. Pilih PDF, isi judul & deskripsi, tentukan ID file, masukkan **password perpustakaan** (sama dengan password login), pilih cover (opsional — jika kosong, cover diambil dari halaman pertama PDF).
4. Klik **Enkripsi & Siapkan Unduhan**. Browser mengunduh:
   - `ID-BUKU.piyapdf` → simpan ke `books/`
   - `ID-BUKU.jpg` (cover) → simpan ke `books/covers/`
   - `catalog.json` → simpan ke `data/` (timpa yang lama)
5. Commit & push:
   ```bash
   git add books data
   git commit -m "Tambah buku: <judul>"
   git push
   ```
6. Tunggu GitHub Pages terbarui (± 1 menit), buka website, buku sudah ada di koleksi.

**Mengganti buku:** proses ulang PDF dengan ID yang sama, timpa file-nya, lalu push.  
**Menghapus buku:** hapus entri di daftar katalog (tombol *Hapus*), unduh `catalog.json` baru, hapus juga file `books/ID-BUKU.piyapdf` + `books/covers/ID-BUKU.jpg`, lalu push.

> Perubahan di halaman utilitas **tidak otomatis tersimpan online**. Website berubah hanya setelah `git commit` & `git push`.

## Mengganti password & enkripsi ulang

Gunakan **`tools/change-password.html`** (lokal, di browser):

1. **Backup dulu**: salin folder `books/` dan PDF asli Anda ke tempat aman.
2. Buka halaman utilitas (via GitHub Pages atau localhost seperti di atas).
3. Isi password lama, password baru, dan konfirmasi (harus cocok).
4. Pilih seluruh file `books/*.piyapdf` (multi-select), dan `data/catalog.json` (opsional).
5. Klik **Proses: Dekripsi & Enkripsi Ulang**. Browser akan:
   - mendekripsi tiap file dengan password lama,
   - **mengenkripsi ulang isi PDF** dengan password baru (salt & IV baru yang acak) — bukan sekadar mengganti teks di konfigurasi,
   - mengunduh ulang file `.piyapdf` dengan nama yang sama,
   - membuat **`auth.json` baru** (verifikator login untuk password baru),
   - (opsional) `catalog.json` yang telah diperbarui.
6. Timpa file lama di repository dengan hasil unduhan:
   - `books/*.piyapdf` (timpa yang lama),
   - `data/auth.json` (WAJIB — agar login memakai password baru),
   - `data/catalog.json` (jika ikut diunduh).
7. Commit & push:
   ```bash
   git add books data
   git commit -m "Ganti password koleksi"
   git push
   ```
8. Uji login di website dengan password baru.

Utilitas ini tidak menyimpan password di localStorage dan tidak mengirim password/dokumen ke layanan eksternal.

## Format berkas `.piyapdf` (terdokumentasi)

Kontainer biner sederhana yang dibuat/dibaca oleh `assets/js/crypto.js`:

| Offset | Isi |
|--------|-----|
| 0 | Magic `PIYAENC1` (8 byte ASCII) |
| 8 | `headerLength` — uint32 big-endian |
| 12 | Header JSON (UTF-8) |
| 12 + headerLength | Ciphertext AES-256-GCM (tag otentikasi 128-bit menyusul ciphertext) |

Contoh header:

```json
{
  "fmt": "piyapdf/1",
  "cipher": "AES-GCM",
  "kdf": "PBKDF2-SHA256",
  "iter": 210000,
  "salt": "…base64 16 byte acak per file…",
  "iv": "…base64 12 byte unik per file…",
  "name": "dokumen-asli.pdf",
  "mime": "application/pdf",
  "ext": "pdf"
}
```

- Kunci: PBKDF2-HMAC-SHA256, 210 000 iterasi, salt 16 byte acak per file → kunci AES-256-GCM.
- IV 12 byte acak unik per proses enkripsi (tidak pernah dipakai ulang karena selalu dibuat baru).
- `data/auth.json` memuat verifikator login: PBKDF2(password, salt_auth) dibandingkan secara *constant-time* — bukan password itu sendiri.

## Pengujian yang disarankan setelah deploy

1. Login dengan password salah → muncul pesan error; password benar → masuk koleksi.
2. Tambahkan 1 buku kecil lewat `tools/manage-library.html`, push, cek cover/judul/halaman tampil.
3. Buka buku: cek efek balik halaman 3D, drag sudut halaman, swipe di HP, dua halaman di layar lebar.
4. Coba navigasi: tombol prev/next, lompat halaman, zoom, fullscreen, tombol Koleksi.
5. Buka di HP: layout, mode satu halaman, dan sentuhan.
6. Ganti password lewat `tools/change-password.html`, push, uji login lama (harus gagal) dan login baru (harus berhasil) serta membuka buku.
7. Akses lewat URL subpath proyek (`https://username.github.io/nama-repository/`) — semua aset harus termuat.

## Pemecahan masalah

| Gejala | Penyebab / solusi |
|--------|-------------------|
| Pesan "File buku tidak ditemukan" | Berkas belum diunggah ke `books/` atau path `file` di `catalog.json` salah (harus `books/….piyapdf`). |
| Pesan "Dekripsi gagal" | Password salah, atau file terpotong/rusak saat unduh/commit — ulangi dengan file backup. |
| Login gagal padahal password benar | `data/auth.json` belum diganti setelah ganti password, atau file tidak ter-commit. |
| Halaman tools tidak bisa render cover PDF | Tools butuh akses `http(s)`. Jalankan `python3 -m http.server 8080` atau buka via GitHub Pages. |
| Buku tidak muncul setelah push | GitHub Pages masih build; tunggu ± 1 menit, hard-refresh (Ctrl+Shift+R). |
| Efek 3D lambat di HP | Gunakan tombol **Mode gulir** untuk pembacaan yang lebih ringan. |

## Teknologi

- [PDF.js](https://mozilla.github.io/pdf.js/) (Apache-2.0) — render PDF di browser.
- [StPageFlip](https://github.com/Nodlik/StPageFlip) (MIT) — animasi balik halaman 3D.
- Web Crypto API — PBKDF2-SHA256 + AES-256-GCM (tanpa library pihak ketiga).
- HTML/CSS/JavaScript murni — kompatibel dengan hosting statis GitHub Pages.

## Lisensi

Kode proyek ini bebas digunakan untuk kebutuhan pribadi Anda. Perhatikan lisensi masing-masing library di `assets/vendor/`.
