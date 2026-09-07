/**
 * login.js — Halaman Login
 * ─────────────────────────────────────────────────────────
 * Alur:
 *   1. Cek jika sudah login → redirect langsung sesuai role
 *   2. Load config sekolah → isi nama di UI
 *   3. Handle submit form → callGAS('login', ...)
 *   4. Simpan session → redirect ke /satpam atau /admin
 */

'use strict';

document.addEventListener('DOMContentLoaded', async () => {

  // ── 1. Redirect jika sudah login ──────────────────────────
  const session = getSession();
  if (session && session.token) {
    _redirectByRole(session.role);
    return; // Hentikan eksekusi — redirect sedang berlangsung
  }

  // ── 2. Isi UI awal ─────────────────────────────────────────
  _setYear();
  _setAppName(CONFIG.APP_NAME);

  // Load config sekolah untuk isi nama — best-effort (tidak blocking)
  _loadSchoolName();

  // ── 3. Referensi elemen DOM ────────────────────────────────
  const form          = document.getElementById('login-form');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const btnLogin      = document.getElementById('btn-login');
  const toggleBtn     = document.getElementById('toggle-password');
  const toggleIcon    = document.getElementById('toggle-icon');

  // Guard: pastikan semua elemen wajib ada
  if (!form || !usernameInput || !passwordInput || !btnLogin) {
    console.error('login.js: elemen form tidak ditemukan di DOM.');
    return;
  }

  // ── 4. Toggle tampilkan password ───────────────────────────
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';

      // FIX L2: null guard pada toggleIcon
      if (toggleIcon) {
        toggleIcon.textContent = isPassword ? '🙈' : '👁️';
      }
      toggleBtn.setAttribute(
        'aria-label',
        isPassword ? 'Sembunyikan password' : 'Tampilkan password'
      );
      // Kembalikan fokus ke input password setelah toggle
      passwordInput.focus();
    });
  }

  // ── 5. Sembunyikan error saat user mengetik ────────────────
  usernameInput.addEventListener('input', () => {
    _hideError();
    usernameInput.classList.remove('is-invalid');
  });

  passwordInput.addEventListener('input', () => {
    _hideError();
    passwordInput.classList.remove('is-invalid');
  });

  // FIX L10: Enter di username → pindah fokus ke password
  usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      passwordInput.focus();
    }
  });

  // ── 6. Submit form ──────────────────────────────────────────
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    _hideError();

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    // Validasi client-side
    let hasError = false;

    if (!username) {
      usernameInput.classList.add('is-invalid');
      hasError = true;
    }
    if (!password) {
      passwordInput.classList.add('is-invalid');
      hasError = true;
    }
    if (hasError) {
      _showError('Username dan password wajib diisi.');
      // Fokus ke field yang kosong pertama
      if (!username) usernameInput.focus();
      else passwordInput.focus();
      return;
    }

    // Set loading
    setButtonLoading(btnLogin);

    try {
      const result = await callGAS('login', { username, password });

      if (result.status === 'ok') {
        const { token, role, nama, username: uname } = result.data;

        // Simpan session
        saveSession(token, role, nama, uname);

        // Feedback sukses sebelum redirect
        showToast(`Selamat datang, ${nama}! 👋`, 'success', 2000);

        // Tunda agar toast terlihat, lalu redirect
        setTimeout(() => {
          const redirectTarget = sessionStorage.getItem('btamu_redirect');
          sessionStorage.removeItem('btamu_redirect');

          if (redirectTarget && redirectTarget !== '/login' && redirectTarget !== '/login.html') {
            window.location.href = redirectTarget;
          } else {
            _redirectByRole(role);
          }
        }, 800);

      } else {
        // Login gagal dari GAS
        _showError(result.message || 'Username atau password salah.');
        // FIX L3: clear password di semua kondisi gagal, termasuk saat dari catch
        passwordInput.value = '';
        usernameInput.classList.add('is-invalid');
        passwordInput.classList.add('is-invalid');
        resetButtonLoading(btnLogin, false);
        usernameInput.focus();
      }

    } catch (_err) {
      // Error jaringan / timeout
      _showError('Tidak dapat terhubung ke server. Periksa koneksi internet Anda.');
      // FIX L3: clear password di catch block juga
      passwordInput.value = '';
      resetButtonLoading(btnLogin, false);
      usernameInput.focus();
    }
  });

  // ── 7. Fokus ke username saat halaman siap ──────────────────
  // Tunda sedikit agar animasi slideUp tidak terpotong
  setTimeout(() => usernameInput.focus(), 100);
});

// ════════════════════════════════════════════════════════════
// PRIVATE HELPERS
// ════════════════════════════════════════════════════════════

/**
 * Redirect ke dashboard sesuai role.
 * @param {string} role
 */
function _redirectByRole(role) {
  window.location.href = role === ROLES.ADMIN ? '/admin' : '/satpam';
}

/**
 * FIX L9: Tampilkan kotak error dengan re-trigger animasi.
 * @param {string} message
 */
function _showError(message) {
  const box  = document.getElementById('login-error');
  const text = document.getElementById('login-error-text');
  if (!box || !text) return;

  text.textContent = message;

  // Re-trigger animasi: hapus class → force reflow → tambah lagi
  box.classList.remove('visible');
  void box.offsetHeight; // trigger reflow
  box.classList.add('visible');
}

/**
 * Sembunyikan kotak error login.
 */
function _hideError() {
  const box = document.getElementById('login-error');
  if (box) box.classList.remove('visible');
}

/**
 * Isi tahun di footer.
 */
function _setYear() {
  const el = document.getElementById('year');
  if (el) el.textContent = new Date().getFullYear();
}

/**
 * Isi nama aplikasi/sekolah di elemen UI.
 * @param {string} name
 */
function _setAppName(name) {
  const appNameEl  = document.getElementById('app-name');
  const brandEl    = document.getElementById('brand-school-name');
  const mobileTitle = document.getElementById('login-mobile-title');

  if (appNameEl)   appNameEl.textContent  = name;
  if (brandEl)     brandEl.textContent    = name;
  if (mobileTitle) mobileTitle.textContent = name;
}

/**
 * FIX BUG #3: Load nama sekolah DAN logo dari GAS config, update UI.
 * Best-effort — halaman tetap berfungsi jika gagal.
 */
async function _loadSchoolName() {
  try {
    const result = await callGAS('getConfig');
    if (result?.status === 'ok' && result.data) {
      const data = result.data;

      // Nama sekolah
      if (data.nama_sekolah) {
        _setAppName(data.nama_sekolah);
        document.title = `Login — ${data.nama_sekolah}`;
      }

      // Alamat (subtitle panel kiri)
      const subEl = document.getElementById('login-brand-sub');
      if (subEl && data.alamat_sekolah) {
        subEl.textContent = data.alamat_sekolah;
      }

      // Logo sekolah (tampil di panel kiri tablet+) — gunakan logo_url
      if (data.logo_url) {
        _applyLoginLogo('login-brand-logo', data.logo_url, '0');
      }

      // Logo sekolah (tampil di panel mobile) — gunakan logo_url
      if (data.logo_url) {
        _applyLoginLogo('login-mobile-logo', data.logo_url, '0');
      }
    }
  } catch (_) {
    // Gagal load config — biarkan tampilan default
  }
}

/**
 * Sisipkan gambar logo ke dalam elemen login (panel kiri / mobile).
 * Sembunyikan emoji default saat gambar berhasil dimuat.
 * @param {string} containerId - ID elemen kontainer
 * @param {string} url         - URL gambar
 * @param {string} hideFontSize - fontSize untuk menyembunyikan emoji (misal '0')
 */
function _applyLoginLogo(containerId, url, hideFontSize = '0') {
  const container = document.getElementById(containerId);
  if (!container || !url) return;

  // Hapus img lama jika ada
  const oldImg = container.querySelector('img');
  if (oldImg) oldImg.remove();

  const img = document.createElement('img');
  img.src   = normalizeLogoUrl(url);
  img.alt   = 'Logo sekolah';
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:inherit;';
  img.onload  = () => { container.style.fontSize = hideFontSize; };
  img.onerror = () => { img.remove(); container.style.fontSize = ''; };
  container.appendChild(img);
}
