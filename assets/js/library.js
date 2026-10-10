/*
 * PiyaLibrary — memuat katalog buku, render koleksi, pencarian.
 * Katalog: data/catalog.json (metadata bersifat publik; isi PDF terenkripsi).
 */
(function (root) {
  'use strict';

  var catalogCache = null;

  function assetUrl(rel) {
    return new URL((root.PIYA_ASSET_BASE || './') + rel, document.baseURI).href;
  }

  /**
   * Muat data/catalog.json.
   * @returns {Promise<{version:number, books:Array}>}
   */
  function loadCatalog() {
    if (catalogCache) return Promise.resolve(catalogCache);
    return fetch(assetUrl('data/catalog.json'), { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('Katalog tidak ditemukan (data/catalog.json).');
        return res.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.books)) throw new Error('Struktur katalog tidak valid.');
        catalogCache = data;
        return data;
      });
  }

  function clearCache() {
    catalogCache = null;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalize(s) {
    return String(s || '').toLowerCase();
  }

  function filterBooks(books, query) {
    var q = normalize(query).trim();
    if (!q) return books.slice();
    return books.filter(function (b) {
      return normalize(b.title).indexOf(q) >= 0 || normalize(b.description).indexOf(q) >= 0;
    });
  }

  /**
   * Render grid koleksi ke dalam container.
   * @param {HTMLElement} container
   * @param {Array} books
   * @param {{onRead: (id:string)=>void}} handlers
   */
  function renderBooks(container, books, handlers) {
    container.innerHTML = '';
    if (!books.length) {
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML =
        '<p class="empty-title">Belum ada buku</p>' +
        '<p class="empty-desc">Koleksi masih kosong. Pemilik website dapat menambahkan buku melalui halaman ' +
        '<strong>tools/manage-library.html</strong>, lalu mengunggah hasilnya ke repository dan melakukan push.</p>';
      container.appendChild(empty);
      return;
    }
    var frag = document.createDocumentFragment();
    books.forEach(function (b) {
      var card = document.createElement('article');
      card.className = 'book-card';
      var coverSrc = b.cover ? assetUrl(b.cover) : '';
      var coverHtml = coverSrc
        ? '<img class="book-cover" src="' + escapeHtml(coverSrc) + '" alt="Cover ' + escapeHtml(b.title) + '" loading="lazy">'
        : '<div class="book-cover book-cover-placeholder" aria-hidden="true"><span>' + escapeHtml((b.title || '?').charAt(0)) + '</span></div>';
      var pages = b.pages ? '<span class="meta-item">' + escapeHtml(b.pages) + ' halaman</span>' : '';
      var desc = b.description
        ? '<p class="book-desc">' + escapeHtml(b.description) + '</p>'
        : '<p class="book-desc book-desc-empty">Tidak ada deskripsi.</p>';
      card.innerHTML =
        coverHtml +
        '<div class="book-info">' +
        '<h3 class="book-title">' + escapeHtml(b.title) + '</h3>' +
        desc +
        '<div class="book-meta">' + pages + '</div>' +
        '<button type="button" class="btn btn-primary btn-read">Baca Sekarang</button>' +
        '</div>';
      card.querySelector('.btn-read').addEventListener('click', function () {
        if (handlers && handlers.onRead) handlers.onRead(b.id);
      });
      frag.appendChild(card);
    });
    container.appendChild(frag);
  }

  root.PiyaLibrary = {
    loadCatalog: loadCatalog,
    clearCache: clearCache,
    filterBooks: filterBooks,
    renderBooks: renderBooks,
    escapeHtml: escapeHtml,
    assetUrl: assetUrl
  };
})(typeof self !== 'undefined' ? self : this);
