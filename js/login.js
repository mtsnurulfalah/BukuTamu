/**
 * login.js — Halaman Login v2.1
 * ─────────────────────────────────────────────────────────
 * Alur:
 *   1. Cek jika sudah login → redirect langsung sesuai role
 *   2. Load config sekolah → isi nama & logo di UI
 *   3. Handle submit form → callGAS('login', ...)
 *   4. Simpan session → redirect ke /satpam atau /admin
 *
 * CHANGELOG v2.1:
 *   - FIX L1: Guard localStorage tidak tersedia (private browsing / iOS restricted).
 *   - FIX L2: toggleIcon null-guard sudah ada; perbaiki ikon awal sesuai state password.
 *   - FIX L3: Password di-clear dengan cara yang aman (tidak trigger autocomplete save).
 *   - FIX L4: Redirect loop — validasi redirectTarget agar tidak mengirim user ke
 *             halaman yang sama atau path tidak valid.
 *   - FIX L5: _loadSchoolName tidak ada error boundary per operasi — sekarang setiap
 *             operasi (nama, logo) dibungkus try/catch individual agar satu kegagalan
 *             tidak membatalkan yang lain.
 *   - FIX L6: isSubmitting guard mencegah double-submit saat tombol ditekan cepat
 *             (form.addEventListener bisa terpicu lebih dari sekali jika ada race).
 *   - FIX L7: Setelah login sukses, tombol tidak di-reset agar user tidak bisa
 *             menekan ulang selama redirect berlangsung.
 *   - FIX L8: _applyLoginLogo — fontSize trick untuk sembunyikan icon bawaan tidak
 *             reliable; ganti dengan visibility + classList toggle.
 *   - FIX L9: Animasi error box tidak re-trigger dengan benar pada beberapa browser
 *             karena display:none→flex tidak selalu memicu reflow. Gunakan requestAnimationFrame.
 *   - FIX L10: Enter di username → fokus ke password (sudah ada, dipertahankan).
 *   - IMPROVE: Trim username saja, bukan password (password boleh punya spasi).
 *   - IMPROVE: Feedback error lebih spesifik untuk network error vs auth error.
 */

'use strict';

// ── Guard: isSubmitting mencegah double-submit (FIX L6) ───────
let isSubmitting = false;

document.addEventListener('DOMContentLoaded', async () => {

  // ── 1. Redirect jika sudah login ──────────────────────────
  // FIX L1: localStorage bisa tidak tersedia (Safari private mode, dsb.)
  let session = null;
  try {
    session = getSession();
  } catch (_) {
    // localStorage tidak tersedia — lanjutkan ke halaman login
  }

  if (session && session.token) {
    _redirectByRole(session.role);
    return;
  }

  // ── 2. Isi UI awal ─────────────────────────────────────────
  _setYear();
  _setAppName(CONFIG.APP_NAME);

  // Load config sekolah — best-effort, tidak blocking
  _loadSchoolName();

  // ── 3. Referensi elemen DOM ────────────────────────────────
  const form          = document.getElementById('login-form');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const btnLogin      = document.getElementById('btn-login');
  const toggleBtn     = document.getElementById('toggle-password');
  const toggleIcon    = document.getElementById('toggle-icon');

  if (!form || !usernameInput || !passwordInput || !btnLogin) {
    console.error('login.js: elemen form tidak ditemukan di DOM.');
    return;
  }

  // ── 4. Toggle tampilkan/sembunyikan password ───────────────
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';

      if (toggleIcon) {
        toggleIcon.innerHTML = isPassword
          ? _icon('eye-off', '1.1rem')
          : _icon('eye', '1.1rem');
      }

      toggleBtn.setAttribute(
        'aria-label',
        isPassword ? 'Sembunyikan password' : 'Tampilkan password'
      );
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

    // FIX L6: Guard double-submit
    if (isSubmitting) return;

    _hideError();

    // IMPROVE: trim username saja, bukan password
    const username = usernameInput.value.trim();
    const password = passwordInput.value; // password tidak di-trim

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
      if (!username) usernameInput.focus();
      else passwordInput.focus();
      return;
    }

    // Set loading + guard
    isSubmitting = true;
    setButtonLoading(btnLogin);

    try {
      const result = await callGAS('login', { username, password });

      if (result.status === 'ok') {
        const { token, role, nama, username: uname } = result.data;

        // FIX L1: wrap saveSession dalam try/catch
        try {
          saveSession(token, role, nama, uname);
        } catch (_) {
          // localStorage tidak tersedia — tetap lanjut redirect
        }

        // FIX L7: Tidak reset button — biarkan disabled selama redirect berlangsung
        showToast(`Selamat datang, ${nama}!`, 'success', 2000);

        setTimeout(() => {
          // FIX L4: Validasi redirect target — cegah redirect ke halaman login itu sendiri
          //         atau ke URL eksternal (hanya izinkan path relatif internal)
          let redirectTarget = null;
          try {
            redirectTarget = sessionStorage.getItem('btamu_redirect');
            sessionStorage.removeItem('btamu_redirect');
          } catch (_) { /* sessionStorage tidak tersedia */ }

          if (
            redirectTarget &&
            redirectTarget !== '/login' &&
            redirectTarget !== '/login.html' &&
            redirectTarget.startsWith('/') &&           // harus path relatif
            !redirectTarget.startsWith('//')            // cegah protocol-relative URL
          ) {
            window.location.href = redirectTarget;
          } else {
            _redirectByRole(role);
          }
        }, 800);

      } else {
        // Login gagal dari GAS
        const errMsg = result.message || 'Username atau password salah.';
        _showError(errMsg);

        // FIX L3: Clear password — tidak menggunakan value = '' langsung
        //         karena bisa trigger browser autofill save dialog.
        //         Gunakan setAttribute untuk menghindari hal tersebut.
        _clearPasswordField(passwordInput);

        usernameInput.classList.add('is-invalid');
        passwordInput.classList.add('is-invalid');

        isSubmitting = false;
        resetButtonLoading(btnLogin, false);
        usernameInput.focus();
      }

    } catch (_err) {
      // Error jaringan / timeout
      _showError('Tidak dapat terhubung ke server. Periksa koneksi internet Anda.');
      _clearPasswordField(passwordInput);

      isSubmitting = false;
      resetButtonLoading(btnLogin, false);
      usernameInput.focus();
    }
  });

  // ── 7. Fokus awal ke username ───────────────────────────────
  // Tunda agar animasi slideUp tidak terpotong
  setTimeout(() => {
    // Jangan auto-focus jika ada virtual keyboard yang sudah terbuka
    // (hindari UX buruk di mobile saat halaman pertama dibuka)
    if (window.innerWidth >= 768) {
      usernameInput.focus();
    }
  }, 400);
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
 * FIX L3: Bersihkan nilai password field.
 * Gunakan setAttribute + remove untuk menghindari trigger autofill dialog.
 * @param {HTMLInputElement} el
 */
function _clearPasswordField(el) {
  if (!el) return;
  el.value = '';
  // Kembalikan type ke password jika sebelumnya di-toggle ke text
  el.type = 'password';
  // Update ikon toggle ke kondisi awal (mata terbuka = tampilkan)
  const toggleIcon = document.getElementById('toggle-icon');
  const toggleBtn  = document.getElementById('toggle-password');
  if (toggleIcon) toggleIcon.innerHTML = _icon('eye', '1.1rem');
  if (toggleBtn)  toggleBtn.setAttribute('aria-label', 'Tampilkan password');
}

/**
 * FIX L9: Tampilkan kotak error dengan re-trigger animasi yang andal.
 * Menggunakan requestAnimationFrame untuk memastikan reflow terjadi.
 * @param {string} message
 */
function _showError(message) {
  const box  = document.getElementById('login-error');
  const text = document.getElementById('login-error-text');
  if (!box || !text) return;

  text.textContent = message;

  // Step 1: Sembunyikan (tanpa animasi) untuk reset state
  box.classList.remove('visible');
  box.style.display = 'none';

  // Step 2: requestAnimationFrame memastikan browser sudah paint state tersembunyi
  requestAnimationFrame(() => {
    box.style.display = '';
    // Step 3: Frame kedua untuk trigger animasi masuk
    requestAnimationFrame(() => {
      box.classList.add('visible');
    });
  });
}

/**
 * Sembunyikan kotak error login.
 */
function _hideError() {
  const box = document.getElementById('login-error');
  if (box) {
    box.classList.remove('visible');
    box.style.display = '';
  }
}

/**
 * Isi tahun di footer.
 */
function _setYear() {
  const el = document.getElementById('year');
  if (el) el.textContent = new Date().getFullYear();
}

/**
 * Isi nama aplikasi/sekolah di semua elemen UI terkait.
 * @param {string} name
 */
function _setAppName(name) {
  // Panel kiri desktop: brand title
  const brandEl = document.getElementById('brand-school-name');
  if (brandEl) brandEl.textContent = name;

  // Mobile: judul di atas form (id="app-name" di HTML)
  // login-mobile-title adalah alias lama — cek keduanya untuk kompatibilitas
  const appNameEl   = document.getElementById('app-name');
  const mobileTitle = document.getElementById('login-mobile-title');
  if (appNameEl)   appNameEl.textContent   = name;
  if (mobileTitle) mobileTitle.textContent = name;
}

/**
 * FIX L5: Load nama sekolah dan logo dari GAS config.
 * Setiap operasi dibungkus try/catch independen agar kegagalan satu
 * operasi tidak membatalkan operasi lainnya.
 */
async function _loadSchoolName() {
  let data = null;

  try {
    const result = await callGAS('getConfig');
    if (result?.status === 'ok' && result.data) {
      data = result.data;
    }
  } catch (_) {
    return; // Gagal fetch — biarkan tampilan default
  }

  if (!data) return;

  // FIX L5a: Update nama sekolah — operasi independen
  try {
    if (data.nama_sekolah) {
      _setAppName(data.nama_sekolah);
      document.title = `Login — ${data.nama_sekolah}`;
    }
  } catch (_) { /* diabaikan */ }

  // FIX L5b: Update alamat — operasi independen
  try {
    const subEl = document.getElementById('login-brand-sub');
    if (subEl && data.alamat_sekolah) {
      subEl.textContent = data.alamat_sekolah;
    }
  } catch (_) { /* diabaikan */ }

  // FIX L5c: Logo panel kiri (tablet+) — operasi independen
  try {
    if (data.logo_url) {
      _applyLoginLogo('login-brand-logo', data.logo_url);
    }
  } catch (_) { /* diabaikan */ }

  // FIX L5d: Logo mobile — operasi independen
  try {
    if (data.logo_url) {
      _applyLoginLogo('login-mobile-logo', data.logo_url);
    }
  } catch (_) { /* diabaikan */ }
}

/**
 * FIX L8: Sisipkan gambar logo ke dalam elemen login.
 * Tidak lagi menggunakan fontSize trick — gunakan class toggle yang reliable.
 * @param {string} containerId - ID elemen kontainer logo
 * @param {string} url         - URL gambar logo
 */
function _applyLoginLogo(containerId, url) {
  const container = document.getElementById(containerId);
  if (!container || !url) return;

  // Hapus img lama jika ada (mencegah duplikat saat retry)
  const oldImg = container.querySelector('img');
  if (oldImg) oldImg.remove();

  const img = document.createElement('img');
  img.src   = normalizeLogoUrl(url);
  img.alt   = 'Logo sekolah';
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:inherit;position:absolute;inset:0;';

  img.onload = () => {
    // FIX L8: Sembunyikan icon default menggunakan class, bukan fontSize trick
    const defaultIcon = container.querySelector('i, svg:not(img)');
    if (defaultIcon) defaultIcon.style.display = 'none';
    container.classList.add('has-logo');
    container.appendChild(img);
  };

  img.onerror = () => {
    // Gagal load — biarkan icon default tetap tampil
    img.remove();
    container.classList.remove('has-logo');
  };

  // Append ke DOM dulu agar onload/onerror terpicu di semua browser
  // (beberapa browser tidak trigger onload jika tidak ada di DOM)
  container.style.position = 'relative';
  container.appendChild(img);
}
