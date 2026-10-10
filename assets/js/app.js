/*
 * Piya App — router tampilan (login -> koleksi -> reader) & perekat modul.
 * Satu halaman (SPA sederhana) supaya password sesi cukup hidup di memori
 * selama tab terbuka, tanpa penyimpanan lokal.
 */
(function (root) {
  'use strict';

  var views = {};
  var currentView = null;
  var pendingHash = null;

  function showView(name) {
    if (currentView === name) return;
    var keys = Object.keys(views);
    for (var i = 0; i < keys.length; i++) {
      views[keys[i]].hidden = keys[i] !== name;
    }
    currentView = name;
    if (name !== 'reader') {
      root.PiyaReader.close();
    }
    if (name !== 'login') {
      window.scrollTo(0, 0);
    }
  }

  function navigate(hash) {
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    } else {
      handleRoute();
    }
  }

  function handleRoute() {
    var hash = window.location.hash || '';
    if (!root.PiyaAuth.isLoggedIn()) {
      // simpan tujuan agar bisa dilanjutkan setelah login (deep-link)
      if (/^#\/read\/.+/.test(hash)) pendingHash = hash;
      showView('login');
      return;
    }
    var m = hash.match(/^#\/read\/(.+)$/);
    if (m) {
      openBook(decodeURIComponent(m[1]));
    } else {
      showView('library');
      refreshLibrary();
    }
  }

  /* ---------------- login ---------------- */

  function initLogin() {
    var form = document.getElementById('login-form');
    var input = document.getElementById('login-password');
    var toggle = document.getElementById('login-toggle-pw');
    var error = document.getElementById('login-error');
    var submit = document.getElementById('login-submit');

    toggle.addEventListener('click', function () {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = show ? 'Sembunyikan' : 'Tampilkan';
      toggle.setAttribute('aria-pressed', show ? 'true' : 'false');
      input.focus();
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      error.hidden = true;
      submit.disabled = true;
      submit.textContent = 'Memeriksa…';
      root.PiyaAuth.login(input.value).then(function (res) {
        submit.disabled = false;
        submit.textContent = 'Masuk';
        if (res.ok) {
          input.value = '';
          var target = pendingHash || '#/library';
          pendingHash = null;
          navigate(target); // hashchange (atau handleRoute langsung) membuka tujuan
        } else {
          error.textContent = res.message || 'Password salah.';
          error.hidden = false;
          input.focus();
          input.select();
        }
      });
    });
  }

  /* ---------------- koleksi ---------------- */

  function refreshLibrary() {
    var grid = document.getElementById('library-grid');
    var status = document.getElementById('library-status');
    var query = document.getElementById('library-search').value;
    status.textContent = 'Memuat koleksi…';
    root.PiyaLibrary.loadCatalog()
      .then(function (catalog) {
        var books = root.PiyaLibrary.filterBooks(catalog.books, query);
        root.PiyaLibrary.renderBooks(grid, books, {
          onRead: function (id) {
            navigate('#/read/' + encodeURIComponent(id));
          }
        });
        if (!catalog.books.length) {
          status.textContent = 'Katalog kosong.';
        } else if (!books.length) {
          status.textContent = 'Tidak ada buku yang cocok dengan pencarian.';
        } else {
          status.textContent = books.length + ' buku';
        }
      })
      .catch(function (err) {
        grid.innerHTML = '';
        var div = document.createElement('div');
        div.className = 'empty-state';
        div.innerHTML =
          '<p class="empty-title">Katalog tidak dapat dimuat</p>' +
          '<p class="empty-desc">' + root.PiyaLibrary.escapeHtml(err.message || String(err)) + '</p>';
        grid.appendChild(div);
        status.textContent = '';
      });
  }

  function initLibrary() {
    var search = document.getElementById('library-search');
    var logoutBtn = document.getElementById('logout-btn');

    search.addEventListener('input', function () {
      refreshLibrary();
    });
    logoutBtn.addEventListener('click', function () {
      root.PiyaAuth.logout();
      navigate('#/library');
      showView('login');
    });
  }

  /* ---------------- reader ---------------- */

  function openBook(id) {
    if (!root.PiyaAuth.isLoggedIn()) {
      navigate('#/library');
      showView('login');
      return;
    }
    showView('reader');
    root.PiyaLibrary.loadCatalog()
      .then(function (catalog) {
        var book = null;
        for (var i = 0; i < catalog.books.length; i++) {
          if (catalog.books[i].id === id) { book = catalog.books[i]; break; }
        }
        if (!book) throw new Error('Buku tidak ditemukan di katalog: ' + id);
        return root.PiyaReader.open(book, root.PiyaAuth.getPassword(), {
          onBack: function () {
            navigate('#/library');
          },
          onError: function (msg) {
            alert(msg);
            navigate('#/library');
          }
        });
      })
      .catch(function (err) {
        alert(err.message || String(err));
        navigate('#/library');
      });
  }

  /* ---------------- utilitas umum ---------------- */

  function initChrome() {
    // set tahun footer
    var y = document.getElementById('footer-year');
    if (y) y.textContent = String(new Date().getFullYear());
  }

  function init() {
    views.login = document.getElementById('view-login');
    views.library = document.getElementById('view-library');
    views.reader = document.getElementById('view-reader');

    initLogin();
    initLibrary();
    initChrome();

    window.addEventListener('hashchange', handleRoute);
    root.PiyaAuth.onChange(function (loggedIn) {
      if (!loggedIn) {
        showView('login');
      }
    });

    handleRoute();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof self !== 'undefined' ? self : this);
