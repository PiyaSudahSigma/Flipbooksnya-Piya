/*
 * PiyaReader — pembaca flipbook 3D (PDF.js + StPageFlip).
 *
 * Alur:
 *   1. Ambil berkas terenkripsi dari books/ (sesuai data/catalog.json)
 *   2. Dekripsi di memori dengan password sesi (PiyaCrypto / AES-GCM)
 *   3. Render halaman PDF secara lazy menjadi gambar (canvas -> blob URL)
 *   4. Tampilkan dengan efek balik halaman 3D (StPageFlip)
 *
 * PDF hasil dekripsi hanya hidup di memori browser selama sesi baca dan
 * tidak pernah disimpan permanen. Blob URL direvoke saat halaman dibuang.
 */
(function (root) {
  'use strict';

  var RENDER_CACHE_MAX = 14;      // jumlah halaman yang dipertahankan di memori
  var PRELOAD_RADIUS = 3;         // render halaman di sekitar halaman aktif
  var ZOOM_STEPS = [1, 1.25, 1.5, 2];
  var FLIP_TIME_MS = 700;

  var state = {
    active: false,
    book: null,
    pdfDoc: null,
    totalPages: 0,
    pageAspect: 0.707, // lebar/tinggi halaman PDF
    pageFlip: null,
    mode: 'flip', // 'flip' | 'scroll'
    currentPage: 0, // 0-based index halaman yang tampil
    zoomIndex: 0,
    pages: [], // [{slot, imgEl, url, rendered, loading}]
    renderChain: Promise.resolve(),
    scrollObserver: null,
    destroyed: true
  };

  var els = {};

  function assetUrl(rel) {
    return new URL((root.PIYA_ASSET_BASE || './') + rel, document.baseURI).href;
  }

  function setPdfWorker() {
    if (root.pdfjsLib && root.pdfjsLib.GlobalWorkerOptions) {
      root.pdfjsLib.GlobalWorkerOptions.workerSrc = assetUrl('assets/vendor/pdfjs/pdf.worker.min.js');
    }
  }

  function longEdge() {
    var w = root.innerWidth || 1200;
    return w < 640 ? 1100 : 1500;
  }

  /* ---------------- UI shell ---------------- */

  /**
   * Pastikan elemen stage/scroll ada di DOM.
   * (PageFlip.destroy() MENGHAPUS elemen induknya dari DOM — harus dibuat ulang.)
   * Overlay loading dipertahankan.
   */
  function rebuildStageDom() {
    var wrap = document.getElementById('reader-stage-wrap');
    var loading = document.getElementById('reader-loading');
    wrap.innerHTML = '';
    els.stage = document.createElement('div');
    els.stage.id = 'reader-stage';
    els.stage.className = 'reader-stage';
    els.scrollBox = document.createElement('div');
    els.scrollBox.id = 'reader-scroll';
    els.scrollBox.className = 'reader-scroll';
    els.scrollBox.hidden = true;
    wrap.appendChild(els.stage);
    wrap.appendChild(els.scrollBox);
    if (loading) wrap.appendChild(loading);
    wrap.classList.remove('scroll-mode');
    els.stageWrap = wrap;
    els.loading = loading;
  }

  function cacheEls() {
    els.view = document.getElementById('view-reader');
    els.title = document.getElementById('reader-title');
    els.loading = document.getElementById('reader-loading');
    els.loadingText = document.getElementById('reader-loading-text');
    els.pageInput = document.getElementById('reader-page-input');
    els.pageTotal = document.getElementById('reader-page-total');
    els.zoomLevel = document.getElementById('reader-zoom-level');
    els.modeBtn = document.getElementById('reader-mode-toggle');
    var stage = document.getElementById('reader-stage');
    if (!stage) {
      rebuildStageDom();
    } else {
      els.stageWrap = document.getElementById('reader-stage-wrap');
      els.stage = stage;
      els.scrollBox = document.getElementById('reader-scroll');
    }
  }

  function showLoading(text) {
    if (!els.loading) return;
    els.loadingText.textContent = text;
    els.loading.hidden = false;
  }

  function hideLoading() {
    if (els.loading) els.loading.hidden = true;
  }

  function updatePageIndicator() {
    if (els.pageInput && document.activeElement !== els.pageInput) {
      els.pageInput.value = String(Math.min(state.currentPage + 1, state.totalPages || 1));
    }
    if (els.pageTotal) els.pageTotal.textContent = String(state.totalPages);
  }

  function applyZoom() {
    var z = ZOOM_STEPS[state.zoomIndex];
    if (state.mode === 'flip') {
      if (els.stage) els.stage.style.width = Math.round(z * 100) + '%';
      if (state.pageFlip) {
        try { state.pageFlip.update(); } catch (e) { /* abaikan */ }
      }
    } else if (els.scrollBox) {
      var widthPct = Math.round(Math.min(z, 1.5) * 100);
      var pageEls = els.scrollBox.querySelectorAll('.scroll-page');
      for (var i = 0; i < pageEls.length; i++) {
        pageEls[i].style.width = widthPct + '%';
      }
    }
  }

  function updateZoomIndicator() {
    if (els.zoomLevel) els.zoomLevel.textContent = Math.round(ZOOM_STEPS[state.zoomIndex] * 100) + '%';
    applyZoom();
  }

  /* ---------------- pipeline render lazy ---------------- */

  function markRendered(n, url) {
    var slot = state.pages[n];
    if (!slot) return;
    if (slot.url) URL.revokeObjectURL(slot.url);
    slot.url = url;
    slot.rendered = true;
    slot.imgEl.src = url;
    slot.slot.classList.add('is-rendered');
  }

  function evictPages() {
    var current = state.currentPage;
    var rendered = [];
    for (var i = 0; i < state.pages.length; i++) {
      if (state.pages[i] && state.pages[i].rendered) rendered.push(i);
    }
    if (rendered.length <= RENDER_CACHE_MAX) return;
    rendered.sort(function (a, b) {
      return Math.abs(b - current) - Math.abs(a - current);
    });
    var toRemove = rendered.slice(0, rendered.length - RENDER_CACHE_MAX);
    for (var j = 0; j < toRemove.length; j++) {
      var slot = state.pages[toRemove[j]];
      if (!slot) continue;
      if (slot.url) URL.revokeObjectURL(slot.url);
      slot.url = null;
      slot.rendered = false;
      slot.imgEl.removeAttribute('src');
      slot.slot.classList.remove('is-rendered');
    }
  }

  /**
   * Render satu halaman PDF ke blob URL, antre serial agar browser tidak berat.
   */
  function renderPage(n) {
    var slot = state.pages[n];
    if (!slot || slot.rendered || slot.loading) return;
    slot.loading = state.renderChain.then(function () {
      if (state.destroyed || !state.pdfDoc || slot.rendered) return;
      return state.pdfDoc.getPage(n + 1).then(function (pdfPage) {
        if (state.destroyed) return;
        var vp1 = pdfPage.getViewport({ scale: 1 });
        var scale = longEdge() / Math.max(vp1.width, vp1.height);
        var viewport = pdfPage.getViewport({ scale: scale });
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        var ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return pdfPage.render({ canvasContext: ctx, viewport: viewport }).promise
          .then(function () {
            return new Promise(function (resolve) {
              canvas.toBlob(function (blob) {
                if (!blob) {
                  // fallback jika webp tidak didukung
                  canvas.toBlob(resolve, 'image/jpeg', 0.9);
                } else {
                  resolve(blob);
                }
              }, 'image/webp', 0.92);
            });
          })
          .then(function (blob) {
            canvas.width = 0;
            canvas.height = 0;
            if (state.destroyed || !blob) return;
            markRendered(n, URL.createObjectURL(blob));
            evictPages();
          });
      });
    }).catch(function (err) {
      if (!state.destroyed) console.warn('Gagal merender halaman', n + 1, err);
    }).then(function () {
      slot.loading = null;
    });
    state.renderChain = slot.loading.then(function () {}, function () {});
  }

  function renderAround(center) {
    var i;
    for (i = Math.max(0, center - PRELOAD_RADIUS); i <= Math.min(state.totalPages - 1, center + PRELOAD_RADIUS + 2); i++) {
      renderPage(i);
    }
  }

  /* ---------------- mode flip (StPageFlip) ---------------- */

  function makePageSlot(index) {
    var slot = document.createElement('div');
    slot.className = 'page-slot';
    slot.innerHTML = '<span class="page-placeholder">' + (index + 1) + '</span>';
    var img = document.createElement('img');
    img.className = 'page-img';
    img.alt = 'Halaman ' + (index + 1);
    img.decoding = 'async';
    slot.appendChild(img);
    state.pages[index] = { slot: slot, imgEl: img, url: null, rendered: false, loading: null };
    return slot;
  }

  function buildFlipMode(startPage) {
    // bersihkan stage, buat struktur baru (PageFlip memodifikasi DOM-nya)
    els.stage.hidden = false;
    els.scrollBox.hidden = true;
    els.stageWrap.classList.remove('scroll-mode');
    els.stage.innerHTML = '';
    els.stage.style.width = '';

    var frag = document.createDocumentFragment();
    var i;
    for (i = 0; i < state.totalPages; i++) {
      var pageEl = document.createElement('div');
      pageEl.className = 'page';
      if (i === 0 || i === state.totalPages - 1) pageEl.setAttribute('data-density', 'hard');
      pageEl.appendChild(makePageSlot(i));
      frag.appendChild(pageEl);
    }
    els.stage.appendChild(frag);

    var baseHeight = 1100;
    var baseWidth = Math.round(baseHeight * state.pageAspect);

    var pageFlip = new root.St.PageFlip(els.stage, {
      width: baseWidth,
      height: baseHeight,
      size: 'stretch',
      minWidth: 260,
      maxWidth: 3000,
      minHeight: 360,
      maxHeight: 3000,
      drawShadow: true,
      flippingTime: FLIP_TIME_MS,
      usePortrait: true,
      showCover: true,
      autoSize: true,
      maxShadowOpacity: 0.5,
      mobileScrollSupport: true,
      swipeDistance: 30,
      showPageCorners: true,
      startPage: Math.min(Math.max(startPage, 0), state.totalPages - 1)
    });

    pageFlip.loadFromHTML(els.stage.querySelectorAll('.page'));
    state.pageFlip = pageFlip;

    // Sinkronisasi resmi posisi halaman: event 'flip' (dipicu setiap spread tampil)
    pageFlip.on('flip', function (e) {
      state.currentPage = e.data | 0;
      updatePageIndicator();
      renderAround(state.currentPage);
    });
    pageFlip.on('changeOrientation', function () {
      renderAround(state.currentPage);
    });

    applyZoom();
    try { pageFlip.update(); } catch (e) { /* abaikan */ }
  }

  /* ---------------- mode gulir (fallback ringan) ---------------- */

  function buildScrollMode(startPage) {
    els.stage.hidden = true;
    els.scrollBox.hidden = false;
    els.stageWrap.classList.add('scroll-mode');
    els.scrollBox.innerHTML = '';
    state.pages = [];

    var widthPct = Math.round(Math.min(ZOOM_STEPS[state.zoomIndex], 1.5) * 100);
    var frag = document.createDocumentFragment();
    var i;
    for (i = 0; i < state.totalPages; i++) {
      var wrap = document.createElement('div');
      wrap.className = 'scroll-page';
      wrap.style.width = widthPct + '%';
      wrap.id = 'scroll-page-' + i;
      var slot = makePageSlot(i);
      slot.style.aspectRatio = state.pageAspect ? String(state.pageAspect) : '0.707';
      wrap.appendChild(slot);
      frag.appendChild(wrap);
    }
    els.scrollBox.appendChild(frag);

    // render saat mendekati viewport scroller
    if ('IntersectionObserver' in root) {
      var io = new root.IntersectionObserver(function (entries) {
        for (var k = 0; k < entries.length; k++) {
          if (entries[k].isIntersecting) {
            var idx = parseInt(entries[k].target.id.replace('scroll-page-', ''), 10);
            renderAround(idx);
            state.currentPage = idx;
            updatePageIndicator();
          }
        }
      }, { root: els.stageWrap, rootMargin: '800px 0px', threshold: 0.01 });
      var nodes = els.scrollBox.querySelectorAll('.scroll-page');
      for (var j = 0; j < nodes.length; j++) io.observe(nodes[j]);
      state.scrollObserver = io;
    } else {
      renderAround(startPage);
    }

    updatePageIndicator();
    var target = document.getElementById('scroll-page-' + startPage);
    if (target) target.scrollIntoView();
  }

  function teardownMode() {
    if (state.scrollObserver) {
      state.scrollObserver.disconnect();
      state.scrollObserver = null;
    }
    if (state.pageFlip) {
      try { state.pageFlip.destroy(); } catch (e) { /* abaikan */ }
      state.pageFlip = null;
    }
    // destroy() menghapus elemen stage dari DOM — buat ulang
    rebuildStageDom();
    // bebaskan blob
    for (var i = 0; i < state.pages.length; i++) {
      if (state.pages[i] && state.pages[i].url) URL.revokeObjectURL(state.pages[i].url);
    }
    state.pages = [];
  }

  /* ---------------- navigasi ---------------- */

  function goToPage(n) {
    n = Math.min(Math.max(n, 0), Math.max(state.totalPages - 1, 0));
    if (state.mode === 'flip' && state.pageFlip) {
      state.pageFlip.flip(n);
    } else if (els.scrollBox) {
      var target = document.getElementById('scroll-page-' + n);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    state.currentPage = n;
    updatePageIndicator();
    renderAround(n);
  }

  function nextPage() {
    if (state.mode === 'flip' && state.pageFlip) {
      // perkirakan target untuk pre-render; posisi resmi via event 'flip'
      var step = 2; // landscape: spread dua halaman (cover tetap satu)
      try {
        if (state.pageFlip.getOrientation() === 'portrait') step = 1;
      } catch (e) { /* abaikan */ }
      renderAround(Math.min(state.currentPage + step, state.totalPages - 1));
      state.pageFlip.flipNext();
    } else {
      goToPage(state.currentPage + 1);
    }
  }

  function prevPage() {
    if (state.mode === 'flip' && state.pageFlip) {
      var step = 2;
      try {
        if (state.pageFlip.getOrientation() === 'portrait') step = 1;
      } catch (e) { /* abaikan */ }
      renderAround(Math.max(state.currentPage - step, 0));
      state.pageFlip.flipPrev();
    } else {
      goToPage(state.currentPage - 1);
    }
  }

  /* ---------------- binding kontrol ---------------- */

  function onFullscreenChange() {
    if (state.pageFlip) {
      setTimeout(function () {
        try { state.pageFlip.update(); } catch (e) { /* abaikan */ }
      }, 80);
    }
  }

  function bindControls() {
    var prevBtn = document.getElementById('reader-prev');
    var nextBtn = document.getElementById('reader-next');
    var zoomIn = document.getElementById('reader-zoom-in');
    var zoomOut = document.getElementById('reader-zoom-out');
    var fsBtn = document.getElementById('reader-fullscreen');

    prevBtn.onclick = prevPage;
    nextBtn.onclick = nextPage;

    zoomIn.onclick = function () {
      if (state.zoomIndex < ZOOM_STEPS.length - 1) {
        state.zoomIndex++;
        updateZoomIndicator();
      }
    };
    zoomOut.onclick = function () {
      if (state.zoomIndex > 0) {
        state.zoomIndex--;
        updateZoomIndicator();
      }
    };

    fsBtn.onclick = function () {
      var target = els.view;
      if (!document.fullscreenElement) {
        if (target.requestFullscreen) target.requestFullscreen();
      } else if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);

    els.pageInput.onchange = function () {
      var v = parseInt(els.pageInput.value, 10);
      if (!isNaN(v)) goToPage(v - 1);
    };
    els.pageInput.onkeydown = function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        els.pageInput.blur();
      }
    };

    els.modeBtn.onclick = function () {
      var n = state.currentPage;
      teardownMode();
      if (state.mode === 'flip') {
        state.mode = 'scroll';
        els.modeBtn.textContent = 'Mode buku';
        els.modeBtn.title = 'Kembali ke mode flipbook 3D';
        buildScrollMode(n);
      } else {
        state.mode = 'flip';
        els.modeBtn.textContent = 'Mode gulir';
        els.modeBtn.title = 'Baca dengan mode gulir (lebih ringan)';
        buildFlipMode(n);
      }
      updateZoomIndicator();
    };

    state.onKeyDown = function (e) {
      if (!state.active) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); nextPage(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prevPage(); }
      else if (e.key === '+' || e.key === '=') { zoomIn.onclick(); }
      else if (e.key === '-') { zoomOut.onclick(); }
    };
    document.addEventListener('keydown', state.onKeyDown);
  }

  function unbindControls() {
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    if (state.onKeyDown) {
      document.removeEventListener('keydown', state.onKeyDown);
      state.onKeyDown = null;
    }
    var ids = ['reader-prev', 'reader-next', 'reader-zoom-in', 'reader-zoom-out', 'reader-fullscreen', 'reader-page-input'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el) el.onclick = null;
    }
    if (els.modeBtn) els.modeBtn.onclick = null;
  }

  /* ---------------- API publik ---------------- */

  /**
   * Buka buku.
   * @param {object} book - entri katalog {id,title,file,...}
   * @param {string} password
   * @param {{onBack?:Function, onError?:Function}} handlers
   */
  function open(book, password, handlers) {
    close();
    cacheEls();
    state.active = true;
    state.destroyed = false;
    state.book = book;
    var session = (state.session = {});
    state.mode = 'flip';
    state.zoomIndex = 0;
    state.currentPage = 0;

    els.title.textContent = book.title || book.id;
    if (els.modeBtn) {
      els.modeBtn.textContent = 'Mode gulir';
      els.modeBtn.title = 'Baca dengan mode gulir (lebih ringan)';
    }
    bindControls();

    var backBtn = document.getElementById('reader-back');
    backBtn.onclick = function () {
      close();
      if (handlers && handlers.onBack) handlers.onBack();
    };

    showLoading('Mengambil berkas buku…');

    return fetch(assetUrl(book.file), { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('FILE_NOT_FOUND');
        return res.arrayBuffer();
      })
      .then(function (encBuf) {
        if (state.session !== session) return;
        showLoading('Mendekripsi buku…');
        return root.PiyaCrypto.decryptPdf(encBuf, password);
      })
      .then(function (result) {
        if (!result || state.session !== session) return;
        showLoading('Menyiapkan halaman…');
        setPdfWorker();
        if (!root.pdfjsLib) throw new Error('PDFJS_MISSING');
        return root.pdfjsLib.getDocument({ data: result.bytes.slice(0) }).promise.then(function (doc) {
          if (state.session !== session) { doc.destroy(); return; }
          state.pdfDoc = doc;
          state.totalPages = doc.numPages;
          return doc.getPage(1).then(function (p1) {
            if (state.session !== session) return;
            var vp = p1.getViewport({ scale: 1 });
            state.pageAspect = vp.width / vp.height;
            updatePageIndicator();
            buildFlipMode(0);
            hideLoading();
            renderAround(0);
            updateZoomIndicator();
          });
        });
      })
      .catch(function (err) {
        if (state.session !== session) return; // sesi sudah ditutup/diganti
        hideLoading();
        var msg;
        if (err && err.message === 'FILE_NOT_FOUND') {
          msg = 'File buku tidak ditemukan. Pastikan berkas sudah diunggah ke folder books/ dan path di data/catalog.json benar.';
        } else if (err && err.message === 'PDFJS_MISSING') {
          msg = 'Library PDF.js gagal dimuat. Periksa aset vendor.';
        } else if (err && /Dekripsi gagal/.test(err.message || '')) {
          msg = 'Dekripsi gagal: password salah atau berkas rusak.';
        } else {
          msg = 'Gagal membuka buku: ' + (err && err.message ? err.message : 'kesalahan tidak diketahui');
        }
        if (handlers && handlers.onError) handlers.onError(msg);
        close();
      });
  }

  function close() {
    state.destroyed = true;
    state.active = false;
    state.session = null;
    unbindControls();
    if (state.scrollObserver) {
      state.scrollObserver.disconnect();
      state.scrollObserver = null;
    }
    if (state.pageFlip) {
      try { state.pageFlip.destroy(); } catch (e) { /* abaikan */ }
      state.pageFlip = null;
    }
    for (var i = 0; i < state.pages.length; i++) {
      if (state.pages[i] && state.pages[i].url) URL.revokeObjectURL(state.pages[i].url);
    }
    state.pages = [];
    if (state.pdfDoc) {
      try { state.pdfDoc.destroy(); } catch (e) { /* abaikan */ }
      state.pdfDoc = null;
    }
    state.totalPages = 0;
    state.renderChain = Promise.resolve();
    // stage mungkin sudah dihapus PageFlip.destroy() — bangun ulang untuk sesi berikutnya
    if (document.getElementById('reader-stage-wrap')) rebuildStageDom();
  }

  root.PiyaReader = {
    open: open,
    close: close,
    goToPage: goToPage,
    nextPage: nextPage,
    prevPage: prevPage
  };
})(typeof self !== 'undefined' ? self : this);
