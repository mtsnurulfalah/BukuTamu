/**
 * api.js
 * Wrapper fetch ke Google Apps Script Web App.
 * Semua komunikasi frontend → GAS melewati fungsi callGAS().
 * ─────────────────────────────────────────────────────────
 * Penggunaan:
 *   const result = await callGAS('addTamu', { namaLengkap: '...', ... });
 *   if (result.status === 'ok') { ... }
 */

/**
 * Kirim request POST ke GAS Web App.
 * GAS tidak mendukung CORS preflight untuk custom headers,
 * sehingga kita kirim sebagai text/plain dengan body JSON.
 *
 * @param {string} action  - Nama action (sesuai switch di Code.gs)
 * @param {Object} payload - Data tambahan selain action
 * @returns {Promise<{status: string, message: string, data: any}>}
 */
async function callGAS(action, payload = {}) {
  const body = JSON.stringify({ action, ...payload });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT);

  try {
    const response = await fetch(CONFIG.GAS_URL, {
      method : 'POST',
      // GAS Web App (deployed as "Anyone") butuh mode no-cors ATAU
      // kita gunakan fetch biasa — GAS menerima Content-Type text/plain
      // agar tidak trigger CORS preflight OPTIONS.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
      signal : controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const json = await response.json();
    return json;

  } catch (err) {
    clearTimeout(timer);

    if (err.name === 'AbortError') {
      return {
        status : 'error',
        message: 'Koneksi timeout. Periksa koneksi internet Anda dan coba lagi.',
        data   : null,
      };
    }

    // Network error (offline, DNS gagal, dsb.)
    return {
      status : 'error',
      message: 'Tidak dapat terhubung ke server. Periksa koneksi internet Anda.',
      data   : null,
    };
  }
}

// ── Toast Notification ───────────────────────────────────────
/**
 * Tampilkan toast notification di bawah layar.
 * @param {string} message
 * @param {'default'|'success'|'danger'} type
 * @param {number} duration - ms (default 3000)
 */
function showToast(message, type = 'default', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast${type !== 'default' ? ` toast--${type}` : ''}`;
  toast.textContent = message;
  toast.setAttribute('role', 'status');

  container.appendChild(toast);

  // Auto-remove setelah duration
  setTimeout(() => {
    toast.remove();
  }, duration);
}

// ── Button Loading State Helpers ─────────────────────────────
/**
 * Set tombol ke state loading (disabled + spinner).
 * @param {HTMLButtonElement} btn
 */
function setButtonLoading(btn) {
  btn.classList.add('loading');
  btn.disabled = true;
}

/**
 * Reset tombol dari state loading.
 * @param {HTMLButtonElement} btn
 * @param {boolean} disabled - apakah tetap disabled setelah loading
 */
function resetButtonLoading(btn, disabled = false) {
  btn.classList.remove('loading');
  btn.disabled = disabled;
}

// ── Format Helpers ────────────────────────────────────────────
/**
 * Format tanggal ISO (YYYY-MM-DD) ke tampilan lokal (DD/MM/YYYY).
 * @param {string} iso
 * @returns {string}
 */
function formatTanggalDisplay(iso) {
  if (!iso) return '—';
  const parts = String(iso).split(/[-\/]/);
  if (parts.length === 3 && parts[0].length === 4) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return iso;
}

/**
 * Escape HTML untuk mencegah XSS saat menyisipkan string ke innerHTML.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Ambil nilai display yang aman (fallback ke '—' jika kosong).
 * @param {*} val
 * @returns {string}
 */
function displayVal(val) {
  if (val === null || val === undefined || val === '') return '—';
  return escapeHtml(String(val));
}

/**
 * Normalisasi URL Google Drive agar bisa dimuat sebagai <img src>.
 *
 * Google Drive mengembalikan halaman HTML (bukan binary gambar) untuk format:
 *   - drive.google.com/file/d/FILE_ID/view
 *   - drive.google.com/open?id=FILE_ID
 *   - drive.google.com/uc?id=FILE_ID
 *
 * Format yang bisa dimuat langsung sebagai <img>:
 *   https://lh3.googleusercontent.com/d/FILE_ID
 *
 * URL non-Drive dikembalikan apa adanya.
 *
 * @param {string} url
 * @returns {string} URL yang sudah dinormalisasi
 */
function normalizeLogoUrl(url) {
  if (!url) return url;

  try {
    const u = new URL(url);

    // Hanya proses URL Google Drive
    if (!u.hostname.includes('drive.google.com') &&
        !u.hostname.includes('docs.google.com')) {
      return url;
    }

    let fileId = null;

    // Format: /file/d/FILE_ID/view  atau  /file/d/FILE_ID
    const fileMatch = u.pathname.match(/\/file\/d\/([^\/]+)/);
    if (fileMatch) fileId = fileMatch[1];

    // Format: ?id=FILE_ID  atau  uc?id=FILE_ID
    if (!fileId && u.searchParams.get('id')) {
      fileId = u.searchParams.get('id');
    }

    // Format: /d/FILE_ID (Google Docs/Sheets share link)
    if (!fileId) {
      const dMatch = u.pathname.match(/\/d\/([^\/]+)/);
      if (dMatch) fileId = dMatch[1];
    }

    if (fileId) {
      return `https://lh3.googleusercontent.com/d/${fileId}`;
    }
  } catch (_) {
    // URL tidak valid — kembalikan apa adanya
  }

  return url;
}

// ── Scroll Lock (anti-jumping saat modal dibuka) ──────────────
/**
 * Kunci scroll body saat modal/sheet dibuka.
 *
 * Strategi berlapis:
 * 1. scrollbar-gutter: stable di <html> mencegah layout shift di browser modern
 *    (Chrome 94+, Firefox 97+, Safari 15.4+) — tidak perlu kompensasi apapun.
 * 2. Untuk browser yang tidak mendukung scrollbar-gutter, kita hitung lebar
 *    scrollbar dan set --scrollbar-width sebagai padding-right kompensasi.
 */
function lockScroll() {
  if (document.body.classList.contains('modal-open')) return;

  // Hanya hitung dan set padding-right jika scrollbar-gutter belum di-support
  const supportsScrollbarGutter = CSS.supports('scrollbar-gutter', 'stable');
  if (!supportsScrollbarGutter) {
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.style.setProperty('--scrollbar-width', scrollbarWidth + 'px');
  } else {
    document.documentElement.style.setProperty('--scrollbar-width', '0px');
  }

  document.body.classList.add('modal-open');
}

/**
 * Lepas kunci scroll body saat semua modal/sheet ditutup.
 */
function unlockScroll() {
  // Tunda cek hingga setelah DOM update (classList.remove sudah terjadi)
  requestAnimationFrame(() => {
    const stillOpen = document.querySelector(
      '.modal-backdrop.active, .bottom-sheet.active'
    );
    if (stillOpen) return;

    document.body.classList.remove('modal-open');
    document.documentElement.style.removeProperty('--scrollbar-width');
  });
}
