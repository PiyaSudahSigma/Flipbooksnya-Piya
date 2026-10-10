/*
 * PiyaCrypto — enkripsi & dekripsi PDF di browser (Web Crypto API)
 *
 * Format berkas terenkripsi ".piyapdf" (binary container):
 *
 *   Offset 0   : magic  "PIYAENC1"  (8 byte ASCII)
 *   Offset 8   : headerLength (uint32 big-endian)
 *   Offset 12  : header JSON (UTF-8), berisi parameter enkripsi:
 *                {
 *                  "fmt" : "piyapdf/1",
 *                  "cipher": "AES-GCM",
 *                  "kdf" : "PBKDF2-SHA256",
 *                  "iter": 210000,
 *                  "salt": "<base64 16 byte acak per file>",
 *                  "iv"  : "<base64 12 byte acak per file>",
 *                  "name": "nama-asli.pdf",
 *                  "mime": "application/pdf",
 *                  "ext" : "pdf"
 *                }
 *   Sisa byte  : ciphertext AES-256-GCM (tag otentikasi 128-bit menyusul
 *                ciphertext, format bawaan Web Crypto API)
 *
 * Kunci diturunkan dari password memakai PBKDF2-HMAC-SHA256 dengan salt acak
 * per file. Password TIDAK PERNAH disimpan; hanya salt + iv + parameter KDF
 * yang disimpan di header agar dekripsi bisa dilakukan ulang.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PiyaCrypto = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAGIC = 'PIYAENC1';
  var MAGIC_BYTES = new Uint8Array([0x50, 0x49, 0x59, 0x41, 0x45, 0x4e, 0x43, 0x31]); // "PIYAENC1"
  var HEADER_OFFSET = 12; // 8 byte magic + 4 byte panjang header
  var ITERATIONS = 210000; // PBKDF2 iterations (layak & tetap nyaman di HP)
  var SALT_LEN = 16;
  var IV_LEN = 12;
  var KEY_BITS = 256;
  var FORMAT = 'piyapdf/1';

  function getCrypto() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
      return globalThis.crypto;
    }
    if (typeof require === 'function') {
      try {
        return require('crypto').webcrypto;
      } catch (e) { /* abaikan */ }
    }
    throw new Error('Web Crypto API tidak tersedia. Gunakan browser modern (HTTPS).');
  }

  function getSubtle() {
    return getCrypto().subtle;
  }

  /* ---------------- utilitas byte / base64 ---------------- */

  function toB64(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var CHUNK = 0x8000;
    var s = '';
    for (var i = 0; i < u8.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    }
    return btoa(s);
  }

  function fromB64(str) {
    var bin = atob(str);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function utf8Encode(str) {
    return new TextEncoder().encode(str);
  }

  function utf8Decode(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
  }

  function concatBytes(a, b) {
    var out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  function randomBytes(len) {
    var buf = new Uint8Array(len);
    getCrypto().getRandomValues(buf);
    return buf;
  }

  function timingSafeEqualBytes(a, b) {
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  /* ---------------- KDF + AES-GCM ---------------- */

  /**
   * Turunkan kunci AES-GCM dari password + salt via PBKDF2-SHA256.
   */
  function deriveKey(password, saltBytes, iterations) {
    var subtle = getSubtle();
    var passBytes = utf8Encode(String(password));
    return subtle
      .importKey('raw', passBytes, 'PBKDF2', false, ['deriveKey'])
      .then(function (baseKey) {
        return subtle.deriveKey(
          { name: 'PBKDF2', salt: saltBytes, iterations: iterations || ITERATIONS, hash: 'SHA-256' },
          baseKey,
          { name: 'AES-GCM', length: KEY_BITS },
          false,
          ['encrypt', 'decrypt']
        );
      });
  }

  /**
   * Turunkan 32 byte verifikator (untuk data/auth.json), bukan kunci.
   */
  function deriveVerifier(password, saltBytes, iterations) {
    var subtle = getSubtle();
    var passBytes = utf8Encode(String(password));
    return subtle
      .importKey('raw', passBytes, 'PBKDF2', false, ['deriveBits'])
      .then(function (baseKey) {
        return subtle.deriveBits(
          { name: 'PBKDF2', salt: saltBytes, iterations: iterations || ITERATIONS, hash: 'SHA-256' },
          baseKey,
          KEY_BITS
        );
      })
      .then(function (bits) {
        return new Uint8Array(bits);
      });
  }

  /* ---------------- kontainer .piyapdf ---------------- */

  function buildHeader(meta, saltBytes, ivBytes, iterations) {
    return {
      fmt: FORMAT,
      cipher: 'AES-GCM',
      kdf: 'PBKDF2-SHA256',
      iter: iterations || ITERATIONS,
      salt: toB64(saltBytes),
      iv: toB64(ivBytes),
      name: (meta && meta.name) || 'document.pdf',
      mime: (meta && meta.mime) || 'application/pdf',
      ext: (meta && meta.ext) || 'pdf'
    };
  }

  /**
   * Enkripsi byte PDF menjadi kontainer .piyapdf.
   * @param {ArrayBuffer|Uint8Array} plainBytes - isi PDF asli
   * @param {string} password
   * @param {{name?:string, mime?:string, ext?:string}} meta
   * @returns {Promise<ArrayBuffer>}
   */
  function encryptPdf(plainBytes, password, meta) {
    var plain = plainBytes instanceof Uint8Array ? plainBytes : new Uint8Array(plainBytes);
    var salt = randomBytes(SALT_LEN);
    var iv = randomBytes(IV_LEN);
    var iterations = ITERATIONS;
    var headerObj = buildHeader(meta, salt, iv, iterations);
    var headerBytes = utf8Encode(JSON.stringify(headerObj));

    return deriveKey(password, salt, iterations)
      .then(function (key) {
        return getSubtle().encrypt({ name: 'AES-GCM', iv: iv }, key, plain);
      })
      .then(function (cipherBuf) {
        var cipher = new Uint8Array(cipherBuf);
        var out = new Uint8Array(HEADER_OFFSET + headerBytes.length + cipher.length);
        out.set(MAGIC_BYTES, 0);
        // uint32 big-endian panjang header
        out[8] = (headerBytes.length >>> 24) & 0xff;
        out[9] = (headerBytes.length >>> 16) & 0xff;
        out[10] = (headerBytes.length >>> 8) & 0xff;
        out[11] = headerBytes.length & 0xff;
        out.set(headerBytes, HEADER_OFFSET);
        out.set(cipher, HEADER_OFFSET + headerBytes.length);
        return out.buffer;
      });
  }

  /**
   * Baca header kontainer tanpa mendekripsi isi.
   * @returns {{header: object, headerLength: number, ciphertext: Uint8Array}}
   */
  function parseContainer(containerBytes) {
    var buf = containerBytes instanceof Uint8Array ? containerBytes : new Uint8Array(containerBytes);
    if (buf.length < HEADER_OFFSET + 16) {
      throw new Error('Berkas terlalu kecil atau bukan kontainer Piya Flipbook.');
    }
    for (var i = 0; i < MAGIC_BYTES.length; i++) {
      if (buf[i] !== MAGIC_BYTES[i]) {
        throw new Error('Format berkas tidak dikenali (magic header tidak cocok).');
      }
    }
    var headerLength = (buf[8] << 24) | (buf[9] << 16) | (buf[10] << 8) | buf[11];
    if (headerLength <= 0 || HEADER_OFFSET + headerLength > buf.length) {
      throw new Error('Header berkas rusak.');
    }
    var header;
    try {
      header = JSON.parse(utf8Decode(buf.subarray(HEADER_OFFSET, HEADER_OFFSET + headerLength)));
    } catch (e) {
      throw new Error('Header berkas rusak (JSON tidak valid).');
    }
    if (header.fmt !== FORMAT) {
      throw new Error('Versi format berkas tidak didukung: ' + header.fmt);
    }
    return {
      header: header,
      headerLength: headerLength,
      ciphertext: buf.subarray(HEADER_OFFSET + headerLength)
    };
  }

  /**
   * Dekripsi kontainer .piyapdf menjadi byte PDF asli.
   * @returns {Promise<{bytes: Uint8Array, header: object}>}
   */
  function decryptPdf(containerBytes, password) {
    var parsed;
    try {
      parsed = parseContainer(containerBytes);
    } catch (e) {
      return Promise.reject(e);
    }
    var header = parsed.header;
    var salt, iv;
    try {
      salt = fromB64(header.salt);
      iv = fromB64(header.iv);
    } catch (e) {
      return Promise.reject(new Error('Parameter enkripsi pada berkas rusak.'));
    }
    return deriveKey(password, salt, header.iter)
      .then(function (key) {
        return getSubtle().decrypt({ name: 'AES-GCM', iv: iv }, key, parsed.ciphertext);
      })
      .then(function (plainBuf) {
        return { bytes: new Uint8Array(plainBuf), header: header };
      })
      .catch(function (err) {
        // AES-GCM gagal otentikasi => password salah ATAU berkas korup.
        throw new Error('Dekripsi gagal. Password salah atau berkas rusak/terpotong.');
      });
  }

  /* ---------------- verifikator login (data/auth.json) ---------------- */

  /**
   * Buat konfigurasi auth.json untuk sebuah password.
   * Catatan: ini hanya "gerbang" tampilan login, BUKAN keamanan dokumen.
   * Keamanan dokumen datang dari enkripsi AES-GCM pada file di books/.
   */
  function makeAuthConfig(password) {
    var salt = randomBytes(SALT_LEN);
    var iterations = ITERATIONS;
    return deriveVerifier(password, salt, iterations).then(function (ver) {
      return {
        comment:
          'Verifikator password login Piya Flipbook. Bukan keamanan dokumen — ' +
          'dokumen dilindungi enkripsi AES-GCM di books/.',
        algo: 'PBKDF2-SHA256',
        iter: iterations,
        salt: toB64(salt),
        verifier: toB64(ver)
      };
    });
  }

  /**
   * Cek password login terhadap isi data/auth.json.
   * @returns {Promise<boolean>}
   */
  function verifyPassword(password, authConfig) {
    if (!authConfig || !authConfig.salt || !authConfig.verifier) {
      return Promise.resolve(false);
    }
    var salt, expected;
    try {
      salt = fromB64(authConfig.salt);
      expected = fromB64(authConfig.verifier);
    } catch (e) {
      return Promise.resolve(false);
    }
    return deriveVerifier(password, salt, authConfig.iter || ITERATIONS)
      .then(function (ver) {
        return timingSafeEqualBytes(ver, expected);
      })
      .catch(function () {
        return false;
      });
  }

  /* ---------------- deteksi format ---------------- */

  function isPiyapdf(bytes) {
    var buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (buf.length < MAGIC_BYTES.length) return false;
    for (var i = 0; i < MAGIC_BYTES.length; i++) {
      if (buf[i] !== MAGIC_BYTES[i]) return false;
    }
    return true;
  }

  return {
    MAGIC: MAGIC,
    FORMAT: FORMAT,
    ITERATIONS: ITERATIONS,
    toB64: toB64,
    fromB64: fromB64,
    randomBytes: randomBytes,
    deriveKey: deriveKey,
    encryptPdf: encryptPdf,
    decryptPdf: decryptPdf,
    parseContainer: parseContainer,
    isPiyapdf: isPiyapdf,
    makeAuthConfig: makeAuthConfig,
    verifyPassword: verifyPassword
  };
});
