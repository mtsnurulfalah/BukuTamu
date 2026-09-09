/**
 * auth.js
 * Manajemen sesi pengguna (login, logout, cek auth).
 * Disertakan di semua halaman yang butuh proteksi.
 * ─────────────────────────────────────────────────────────
 * ▶▶ SECURITY v2.1:
 *   - checkAuth() sekarang memvalidasi token ke server (bukan hanya localStorage)
 *   - Token format divalidasi sebelum dikirim ke server
 *   - Session dicache (MAX_VALIDATE_INTERVAL_MS) agar tidak terlalu sering
 *     request ke GAS setiap navigasi halaman
 *   - Jika validasi server gagal, session dihapus & redirect ke login
 *   - Semua request ke GAS selalu menggunakan token dari localStorage
 *     (bukan dari URL param atau request body lain)
 *
 * Session disimpan di localStorage dengan key:
 *   btamu_token       — token string (48 hex chars)
 *   btamu_role        — "admin" | "satpam"
 *   btamu_nama        — nama lengkap user
 *   btamu_username    — username
 *   btamu_validated   — Unix ms terakhir validasi berhasil ke server
 */

const SESSION_KEYS = {
  TOKEN    : 'btamu_token',
  ROLE     : 'btamu_role',
  NAMA     : 'btamu_nama',
  USERNAME : 'btamu_username',
  VALIDATED: 'btamu_validated',  // ▶▶ SECURITY: timestamp validasi server terakhir
};

// ▶▶ SECURITY: Interval minimum antara validasi ke server (5 menit)
// Mencegah flood request ke GAS setiap page load, tapi tetap enforce
// bahwa token dicek ulang secara berkala
const MAX_VALIDATE_INTERVAL_MS = 5 * 60 * 1000;

// ── Simpan & Ambil Session ───────────────────────────────────

/**
 * Simpan data session ke localStorage setelah login berhasil.
 * ▶▶ SECURITY: Tandai waktu validasi agar tidak perlu re-validate terlalu sering.
 * @param {string} token
 * @param {string} role
 * @param {string} nama
 * @param {string} username
 */
function saveSession(token, role, nama, username) {
  localStorage.setItem(SESSION_KEYS.TOKEN,     token);
  localStorage.setItem(SESSION_KEYS.ROLE,      role);
  localStorage.setItem(SESSION_KEYS.NAMA,      nama);
  localStorage.setItem(SESSION_KEYS.USERNAME,  username);
  localStorage.setItem(SESSION_KEYS.VALIDATED, String(Date.now())); // ▶▶ SECURITY
}

/**
 * Ambil semua data session dari localStorage.
 * @returns {{ token, role, nama, username } | null}
 */
function getSession() {
  const token = localStorage.getItem(SESSION_KEYS.TOKEN);
  if (!token) return null;
  return {
    token    : token,
    role     : localStorage.getItem(SESSION_KEYS.ROLE)     || '',
    nama     : localStorage.getItem(SESSION_KEYS.NAMA)     || '',
    username : localStorage.getItem(SESSION_KEYS.USERNAME) || '',
  };
}

/**
 * Hapus semua data session dari localStorage.
 */
function clearSession() {
  Object.values(SESSION_KEYS).forEach(key => localStorage.removeItem(key));
}

/**
 * Ambil token dari session.
 * @returns {string}
 */
function getToken() {
  return localStorage.getItem(SESSION_KEYS.TOKEN) || '';
}

/**
 * Ambil role dari session.
 * @returns {string}
 */
function getRole() {
  return localStorage.getItem(SESSION_KEYS.ROLE) || '';
}

/**
 * Ambil nama user dari session.
 * @returns {string}
 */
function getNama() {
  return localStorage.getItem(SESSION_KEYS.NAMA) || '';
}

// ── Validasi Token Format (client-side pre-check) ─────────────

/**
 * ▶▶ SECURITY: Periksa format token sebelum dikirim ke server.
 * Token valid: 48 karakter hex lowercase.
 * @param {string} token
 * @returns {boolean}
 */
function _isTokenFormatValid(token) {
  return typeof token === 'string' && /^[a-f0-9]{48}$/.test(token);
}

// ── Proteksi Halaman ──────────────────────────────────────────

/**
 * Periksa apakah pengguna sudah login dan memiliki role yang tepat.
 * ▶▶ SECURITY: Validasi token ke SERVER setiap MAX_VALIDATE_INTERVAL_MS.
 *
 * Jika token tidak valid di server → hapus session + redirect ke login.
 * Frontend tidak boleh dipercaya sebagai satu-satunya penjaga akses.
 *
 * @param {'admin'|'satpam'} requiredRole - Role minimum yang dibutuhkan
 * @returns {Promise<{token, role, nama, username} | null>}
 */
async function checkAuth(requiredRole) {
  const session = getSession();

  // Tidak ada session lokal → langsung redirect
  if (!session || !session.token) {
    _redirectToLogin();
    return null;
  }

  // ▶▶ SECURITY: Validasi format token sebelum apapun
  if (!_isTokenFormatValid(session.token)) {
    clearSession();
    _redirectToLogin();
    return null;
  }

  // ▶▶ SECURITY: Cek role dari localStorage sebagai pre-filter UX
  // Role harus TEPAT SAMA dengan requiredRole — tidak ada "admin bypass semua halaman"
  // Setiap halaman hanya untuk role yang spesifik:
  //   - /satpam  → hanya role 'satpam'
  //   - /admin   → hanya role 'admin'
  // Admin yang mencoba buka /satpam akan ditolak dan sebaliknya.
  const hasAccess = session.role === requiredRole;

  if (!hasAccess) {
    // Jangan hapus session — user masih login, hanya salah halaman
    // Redirect ke halaman yang sesuai dengan role mereka
    _redirectToRolePage(session.role);
    return null;
  }

  // ▶▶ SECURITY: Validasi token ke SERVER
  // Cek apakah perlu re-validate (setiap MAX_VALIDATE_INTERVAL_MS)
  const lastValidated = parseInt(localStorage.getItem(SESSION_KEYS.VALIDATED) || '0', 10);
  const needsRevalidate = (Date.now() - lastValidated) > MAX_VALIDATE_INTERVAL_MS;

  if (needsRevalidate) {
    try {
      const result = await callGAS('validateToken', { token: session.token });

      if (result.status !== 'ok') {
        // Token tidak valid di server — hapus session & redirect
        clearSession();
        _redirectToLogin();
        return null;
      }

      // ▶▶ SECURITY: Pastikan role yang dikembalikan server sesuai dengan halaman ini
      // Server adalah sumber kebenaran — localStorage role tidak bisa dipercaya penuh
      const serverRole = result.data?.role || '';
      if (serverRole && serverRole !== session.role) {
        // Role di localStorage berbeda dari server — perbarui dari server
        localStorage.setItem(SESSION_KEYS.ROLE,     serverRole);
        localStorage.setItem(SESSION_KEYS.NAMA,     result.data?.nama     || session.nama);
        localStorage.setItem(SESSION_KEYS.USERNAME, result.data?.username || session.username);

        // Re-cek akses dengan role yang benar dari server
        // Role harus TEPAT SAMA — tidak ada bypass
        const serverHasAccess = serverRole === requiredRole;

        if (!serverHasAccess) {
          // Jangan hapus session — redirect ke halaman yang sesuai role mereka
          _redirectToRolePage(serverRole);
          return null;
        }
      } else if (serverRole && serverRole !== requiredRole) {
        // Role dari server valid tapi salah halaman — redirect
        _redirectToRolePage(serverRole);
        return null;
      }

      // Perbarui timestamp validasi
      localStorage.setItem(SESSION_KEYS.VALIDATED, String(Date.now()));

    } catch (networkErr) {
      // Jika jaringan gagal → jangan blokir user (fail open untuk UX)
      // tapi catat di console dan tetap gunakan session lokal
      console.warn('[auth] Validasi token ke server gagal (network error):', networkErr);
      // Jangan clearSession() — user mungkin offline sementara
    }
  }

  // Kembalikan session (diperbarui dari server jika diperlukan)
  return {
    token    : localStorage.getItem(SESSION_KEYS.TOKEN)    || '',
    role     : localStorage.getItem(SESSION_KEYS.ROLE)     || '',
    nama     : localStorage.getItem(SESSION_KEYS.NAMA)     || '',
    username : localStorage.getItem(SESSION_KEYS.USERNAME) || '',
  };
}

/**
 * Logout: hapus session + redirect ke login.
 * Dipanggil dari tombol logout di setiap halaman protected.
 */
async function logout() {
  const token = getToken();
  if (token) {
    // Best-effort: kirim logout ke GAS (tidak menunggu response)
    callGAS('logout', { token }).catch(() => {});
  }
  clearSession();
  window.location.href = '/login';
}

// ── Isi Navbar User Info ──────────────────────────────────────

/**
 * Isi nama user di navbar dan pasang event logout.
 * Dipanggil setelah checkAuth() di setiap halaman protected.
 * @param {Object} session - Hasil dari checkAuth()
 */
function initNavbar(session) {
  if (!session) return;

  // Nama user di navbar
  const navUser = document.getElementById('nav-user-name');
  if (navUser) navUser.textContent = session.nama;

  // Badge role
  const navRole = document.getElementById('nav-role-badge');
  if (navRole) {
    navRole.textContent = session.role === ROLES.ADMIN ? 'Admin' : 'Satpam';
  }

  // Tombol logout — buka modal konfirmasi, bukan langsung logout
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      openLogoutModal();
    });
  }
}

// ── Modal Konfirmasi Logout ───────────────────────────────────

/**
 * Buka modal konfirmasi sebelum logout.
 */
function openLogoutModal() {
  const modal = document.getElementById('modal-logout');
  if (!modal) {
    _doLogout('/login');
    return;
  }
  modal.classList.add('active');
  lockScroll();
}

function closeLogoutModal() {
  const modal = document.getElementById('modal-logout');
  if (modal) modal.classList.remove('active');
  unlockScroll();
}

/**
 * Proses logout lalu redirect ke tujuan yang dipilih user.
 * ▶▶ SECURITY: Hapus seluruh session termasuk validated timestamp.
 * @param {string} destination - URL tujuan setelah logout
 */
async function _doLogout(destination) {
  const btnFormTamu = document.getElementById('btn-logout-to-form');
  const btnLogin    = document.getElementById('btn-logout-to-login');
  if (btnFormTamu) { btnFormTamu.disabled = true; btnFormTamu.classList.add('loading'); }
  if (btnLogin)    { btnLogin.disabled    = true; btnLogin.classList.add('loading'); }

  const token = getToken();
  if (token) {
    // Best-effort: kirim logout ke GAS — server akan hapus token dari PropertiesService
    callGAS('logout', { token }).catch(() => {});
  }
  clearSession(); // ▶▶ SECURITY: hapus semua key termasuk btamu_validated
  window.location.href = destination;
}

// ── Private Helpers ───────────────────────────────────────────

/**
 * Redirect ke halaman login sambil menyimpan URL tujuan.
 */
function _redirectToLogin() {
  const current = window.location.pathname;
  if (current !== '/login' && current !== '/login.html') {
    sessionStorage.setItem('btamu_redirect', current);
  }
  window.location.href = '/login';
}

/**
 * ▶▶ SECURITY: Redirect user ke halaman yang sesuai dengan role mereka.
 * Dipanggil ketika user mencoba buka halaman yang bukan miliknya.
 * Contoh: admin buka /satpam → diarahkan ke /admin
 *         satpam buka /admin → diarahkan ke /satpam
 *
 * @param {string} role - Role user yang sedang login
 */
function _redirectToRolePage(role) {
  if (role === ROLES.ADMIN) {
    window.location.href = '/admin';
  } else if (role === ROLES.SATPAM) {
    window.location.href = '/satpam';
  } else {
    // Role tidak dikenal — logout
    clearSession();
    window.location.href = '/login';
  }
}

// ── Event Listeners Modal Logout ─────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-logout-batal')
    ?.addEventListener('click', closeLogoutModal);

  document.getElementById('btn-logout-to-form')
    ?.addEventListener('click', () => _doLogout('/'));

  document.getElementById('btn-logout-to-login')
    ?.addEventListener('click', () => _doLogout('/login'));

  document.getElementById('modal-logout')
    ?.addEventListener('click', e => {
      if (e.target === document.getElementById('modal-logout')) closeLogoutModal();
    });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('modal-logout');
      if (modal?.classList.contains('active')) closeLogoutModal();
    }
  });
});
