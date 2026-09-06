/**
 * login.js
 * Logic halaman login (/login.html).
 * ─────────────────────────────────────────────────────────
 * Alur:
 *   1. Cek jika sudah login → redirect sesuai role
 *   2. Handle submit form → callGAS('login', ...)
 *   3. Simpan session → redirect ke /satpam atau /admin
 */

document.addEventListener('DOMContentLoaded', () => {
  // ── Cek jika sudah login ─────────────────────────────────
  const session = getSession();
  if (session && session.token) {
    _redirectByRole(session.role);
    return;
  }

  // ── Isi tahun di footer ──────────────────────────────────
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // ── Isi nama aplikasi dari CONFIG ────────────────────────
  const appNameEl = document.getElementById('app-name');
  if (appNameEl) appNameEl.textContent = CONFIG.APP_NAME;

  // ── Referensi elemen ─────────────────────────────────────
  const form         = document.getElementById('login-form');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const btnLogin     = document.getElementById('btn-login');
  const errorBox     = document.getElementById('login-error');
  const errorText    = document.getElementById('login-error-text');
  const toggleBtn    = document.getElementById('toggle-password');
  const toggleIcon   = document.getElementById('toggle-icon');

  // ── Toggle Tampilkan Password ────────────────────────────
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      toggleIcon.textContent = isPassword ? '🙈' : '👁️';
      toggleBtn.setAttribute('aria-label',
        isPassword ? 'Sembunyikan password' : 'Tampilkan password'
      );
    });
  }

  // ── Hide error saat user mulai mengetik ──────────────────
  [usernameInput, passwordInput].forEach(input => {
    input.addEventListener('input', () => {
      _hideError();
      input.classList.remove('is-invalid');
    });
  });

  // ── Submit Form ──────────────────────────────────────────
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
      usernameInput.focus();
      return;
    }

    // Set loading state
    setButtonLoading(btnLogin);

    try {
      const result = await callGAS('login', { username, password });

      if (result.status === 'ok') {
        const { token, role, nama, username: uname } = result.data;

        // Simpan session
        saveSession(token, role, nama, uname);

        // Feedback sukses
        showToast(`Selamat datang, ${nama}! 👋`, 'success', 2000);

        // Tunda sedikit agar toast terlihat, lalu redirect
        setTimeout(() => {
          // Cek apakah ada halaman tujuan yang disimpan sebelumnya
          const redirectTarget = sessionStorage.getItem('btamu_redirect');
          sessionStorage.removeItem('btamu_redirect');

          if (redirectTarget && redirectTarget !== '/login') {
            window.location.href = redirectTarget;
          } else {
            _redirectByRole(role);
          }
        }, 800);

      } else {
        _showError(result.message || 'Username atau password salah.');
        passwordInput.value = '';
        passwordInput.classList.add('is-invalid');
        usernameInput.classList.add('is-invalid');
        resetButtonLoading(btnLogin, false);
        usernameInput.focus();
      }

    } catch (err) {
      _showError('Terjadi kesalahan. Periksa koneksi internet Anda.');
      resetButtonLoading(btnLogin, false);
    }
  });

  // Fokus ke username saat halaman dibuka
  usernameInput.focus();
});

// ── Private Helpers ───────────────────────────────────────────

/**
 * Redirect ke dashboard sesuai role.
 * @param {string} role
 */
function _redirectByRole(role) {
  if (role === ROLES.ADMIN) {
    window.location.href = '/admin';
  } else {
    window.location.href = '/satpam';
  }
}

/**
 * Tampilkan kotak error login.
 * @param {string} message
 */
function _showError(message) {
  const errorBox  = document.getElementById('login-error');
  const errorText = document.getElementById('login-error-text');
  if (errorBox && errorText) {
    errorText.textContent = message;
    errorBox.classList.add('visible');
  }
}

/**
 * Sembunyikan kotak error login.
 */
function _hideError() {
  const errorBox = document.getElementById('login-error');
  if (errorBox) errorBox.classList.remove('visible');
}
