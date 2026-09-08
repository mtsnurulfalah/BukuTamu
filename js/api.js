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
 * Tampilkan toast notification.
 *
 * CHANGELOG:
 *   - FIX T1: hapus animasi toastOut dari CSS; kelola remove via JS setelah
 *             transisi selesai untuk menghilangkan race condition timing.
 *   - FIX T2: duration kustom kini benar-benar menentukan kapan toast hilang.
 *   - FIX T3: role="alert" untuk toast danger, role="status" untuk lainnya.
 *   - FIX T5: batasi maksimal 3 toast sekaligus; buang yang paling lama jika lebih.
 *   - FIX T7: klik pada toast untuk dismiss manual.
 *   - FIX T9: toast terbaru muncul di atas (prepend), bukan di bawah.
 *   - IMPROVE: tambah ikon sesuai tipe (✓ success, ✕ danger, ℹ default/info).
 *   - IMPROVE: toast--warning sebagai tipe baru.
 *
 * @param {string} message   - Pesan yang ditampilkan
 * @param {'default'|'success'|'danger'|'warning'} type
 * @param {number} duration  - ms sebelum toast hilang (default 3500)
 */
function showToast(message, type = 'default', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  // FIX T5: Batasi maks 3 toast; buang yang terlama jika melebihi
  const MAX_TOASTS = 3;
  const existing = container.querySelectorAll('.toast');
  if (existing.length >= MAX_TOASTS) {
    // Buang toast pertama (paling lama) segera
    _dismissToast(existing[0]);
  }

  // FIX T3: role sesuai urgensi
  const role = (type === 'danger') ? 'alert' : 'status';

  // Ikon sesuai tipe
  const icons = {
    success : '✓',
    danger  : '✕',
    warning : '⚠',
    default : 'ℹ',
  };
  const iconChar = icons[type] ?? icons.default;

  const toast = document.createElement('div');
  // FIX T4: 'default' mendapat class 'toast--info' agar punya styling berbeda
  const typeClass = type === 'default' ? 'toast--info' : `toast--${type}`;
  toast.className = `toast ${typeClass}`;
  toast.setAttribute('role', role);
  toast.setAttribute('aria-live', role === 'alert' ? 'assertive' : 'polite');
  toast.setAttribute('aria-atomic', 'true');

  // Struktur: ikon + teks
  toast.innerHTML = `
    <span class="toast__icon" aria-hidden="true">${iconChar}</span>
    <span class="toast__message">${_escapeToastMessage(message)}</span>
    <button class="toast__dismiss" aria-label="Tutup notifikasi" type="button">✕</button>
  `;

  // FIX T7: dismiss manual saat klik tombol ✕
  toast.querySelector('.toast__dismiss')?.addEventListener('click', () => {
    _dismissToast(toast);
  });

  // FIX T9: prepend agar toast terbaru di atas
  container.prepend(toast);

  // FIX T1 & T2: kelola seluruh lifecycle via JS — tidak bergantung pada timing CSS
  // Mulai animasi masuk setelah elemen ada di DOM
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.add('toast--visible');
    });
  });

  // Jadwalkan dismiss setelah duration
  const timer = setTimeout(() => _dismissToast(toast), duration);

  // Simpan timer di elemen agar bisa dibatalkan saat dismiss manual
  toast._dismissTimer = timer;
}

/**
 * Animasikan toast keluar, lalu hapus dari DOM.
 * FIX T1: satu fungsi dismiss yang andal — tidak ada race condition.
 * @param {HTMLElement} toast
 */
function _dismissToast(toast) {
  if (!toast || !toast.parentNode) return;
  if (toast._dismissTimer) {
    clearTimeout(toast._dismissTimer);
    toast._dismissTimer = null;
  }
  // Kelas out memicu animasi CSS keluar
  toast.classList.remove('toast--visible');
  toast.classList.add('toast--out');
  // Hapus dari DOM setelah animasi selesai (sinkron dengan durasi CSS transition)
  toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  // Fallback: hapus paksa setelah 500ms jika transisi tidak fired (browser lama)
  setTimeout(() => toast.remove(), 500);
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
 * Escape pesan untuk dimasukkan ke innerHTML toast.
 * Lebih ringan dari escapeHtml karena hanya perlu escape < dan >.
 * @param {string} msg
 * @returns {string}
 */
function _escapeToastMessage(msg) {
  if (!msg) return '';
  return String(msg).replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

// ── Inline SVG Icon Helper ────────────────────────────────────
/**
 * Hasilkan string SVG Lucide icon untuk dipakai di innerHTML.
 * Karena lucide.createIcons() hanya bekerja pada DOM statis,
 * untuk elemen yang di-render via innerHTML kita pakai SVG inline langsung.
 *
 * @param {string} name  - Nama ikon Lucide (kebab-case, misal 'user', 'trash-2')
 * @param {string} size  - Ukuran (default '1rem')
 * @param {string} extra - Atribut/style tambahan (opsional)
 * @returns {string} String SVG inline
 */
function _icon(name, size = '1rem', extra = '') {
  // Path data untuk ikon yang dipakai secara dinamis di JS
  const icons = {
    'pencil':        '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    'toggle-left':   '<rect x="1" y="5" width="22" height="14" rx="7" ry="7"/><circle cx="8" cy="12" r="3"/>',
    'toggle-right':  '<rect x="1" y="5" width="22" height="14" rx="7" ry="7"/><circle cx="16" cy="12" r="3"/>',
    'user':          '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    'users':         '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    'check':         '<polyline points="20 6 9 17 4 12"/>',
    'x':             '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    'trash-2':       '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>',
    'search':        '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    'plus':          '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    'log-out':       '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    'refresh-cw':    '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    'eye':           '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off':       '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
    'phone':         '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.35 2 2 0 0 1 3.59 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.66a16 16 0 0 0 6.43 6.43l.63-.64a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>',
    'mail':          '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
    'building-2':    '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
    'clipboard-list':'<rect x="9" y="2" width="6" height="4" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><line x1="12" y1="11" x2="16" y2="11"/><line x1="12" y1="16" x2="16" y2="16"/><line x1="8" y1="11" x2="8.01" y2="11"/><line x1="8" y1="16" x2="8.01" y2="16"/>',
  };

  const pathData = icons[name] || icons['x'];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:middle;flex-shrink:0;" ${extra}>${pathData}</svg>`;
}
