/*
 * PiyaAuth — sesi login password-saja.
 *
 * Catatan keamanan:
 * - Password disimpan HANYA di memori (variabel JS) selama tab terbuka.
 *   Tidak ada localStorage/sessionStorage untuk password.
 * - Setelah reload halaman, pengguna harus login ulang (disengaja).
 * - Pemeriksaan password di sini hanyalah "gerbang tampilan". File JS yang
 *   dikirim ke browser bisa diperiksa pengunjung. Perlindungan dokumen yang
 *   sebenarnya adalah enkripsi AES-GCM pada file di books/ (lihat crypto.js).
 */
(function (root) {
  'use strict';

  var state = {
    loggedIn: false,
    password: null // hanya di memori
  };
  var listeners = [];

  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](state.loggedIn); } catch (e) { /* abaikan */ }
    }
  }

  function onChange(fn) {
    listeners.push(fn);
    return function () {
      var idx = listeners.indexOf(fn);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }

  /**
   * Coba login dengan password terhadap data/auth.json.
   * @returns {Promise<{ok: boolean, message?: string}>}
   */
  function login(password) {
    var url = new URL((root.PIYA_ASSET_BASE || './') + 'data/auth.json', document.baseURI).href;
    return fetch(url, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('LOAD');
        return res.json();
      })
      .then(function (cfg) {
        return root.PiyaCrypto.verifyPassword(password, cfg);
      })
      .then(function (ok) {
        if (ok) {
          state.loggedIn = true;
          state.password = String(password);
          emit();
          return { ok: true };
        }
        return { ok: false, message: 'Password salah. Coba lagi.' };
      })
      .catch(function (err) {
        if (err && err.message === 'LOAD') {
          return {
            ok: false,
            message: 'Gagal memuat data/auth.json. Pastikan website dijalankan lewat server (bukan file://) dan file data/ sudah diunggah.'
          };
        }
        return { ok: false, message: 'Terjadi kesalahan saat memverifikasi password.' };
      });
  }

  function logout() {
    state.loggedIn = false;
    state.password = null;
    emit();
  }

  function isLoggedIn() {
    return state.loggedIn;
  }

  /**
   * Password sesi untuk derive kunci dekripsi buku (butuh saat membaca).
   * Jangan simpan hasilnya di mana pun.
   */
  function getPassword() {
    return state.password;
  }

  root.PiyaAuth = {
    login: login,
    logout: logout,
    isLoggedIn: isLoggedIn,
    getPassword: getPassword,
    onChange: onChange
  };
})(typeof self !== 'undefined' ? self : this);
