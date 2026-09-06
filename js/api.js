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
