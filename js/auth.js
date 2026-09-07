/**
 * auth.js
 * Manajemen sesi pengguna (login, logout, cek auth).
 * Disertakan di semua halaman yang butuh proteksi.
 * ─────────────────────────────────────────────────────────
 * Session disimpan di localStorage dengan key:
 *   btamu_token    — token string
 *   btamu_role     — "admin" | "satpam"
 *   btamu_nama     — nama lengkap user
 *   btamu_username — username
 */

const SESSION_KEYS = {
  TOKEN   : 'btamu_token',
  ROLE    : 'btamu_role',
  NAMA    : 'btamu_nama',
  USERNAME: 'btamu_username',
};

// ── Simpan & Ambil Session ───────────────────────────────────

/**
 * Simpan data session ke localStorage setelah login berhasil.
 * @param {string} token
 * @param {string} role
 * @param {string} nama
 * @param {string} username
 */
function saveSession(token, role, nama, username) {
  localStorage.setItem(SESSION_KEYS.TOKEN,    token);
  localStorage.setItem(SESSION_KEYS.ROLE,     role);
  localStorage.setItem(SESSION_KEYS.NAMA,     nama);
  localStorage.setItem(SESSION_KEYS.USERNAME, username);
}

/**
 * Ambil semua data session dari localStorage.
 * @returns {{ token: string, role: string, nama: string, username: string } | null}
 */
function getSession() {
  const token = localStorage.getItem(SESSION_KEYS.TOKEN);
  if (!token) return null;
  return {
    token   : token,
    role    : localStorage.getItem(SESSION_KEYS.ROLE)     || '',
    nama    : localStorage.getItem(SESSION_KEYS.NAMA)     || '',
    username: localStorage.getItem(SESSION_KEYS.USERNAME) || '',
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

// ── Proteksi Halaman ──────────────────────────────────────────

/**
 * Periksa apakah pengguna sudah login dan memiliki role yang tepat.
 * Jika tidak, redirect ke halaman login.
 *
 * Cara pakai di awal setiap halaman protected:
 *   checkAuth('admin');    // hanya admin
 *   checkAuth('satpam');   // satpam ATAU admin
 *
 * @param {'admin'|'satpam'} requiredRole - Role minimum yang dibutuhkan
 * @returns {Promise<{token, role, nama, username}>}
 */
async function checkAuth(requiredRole) {
  const session = getSession();

  // Tidak ada session lokal → langsung redirect
  if (!session || !session.token) {
    _redirectToLogin();
    return null;
  }

  // Admin selalu punya akses ke semua halaman
  const hasAccess =
    session.role === ROLES.ADMIN ||
    session.role === requiredRole;

  if (!hasAccess) {
    _redirectToLogin();
    return null;
  }

  // Opsional: validasi token ke GAS (skip jika ingin lebih cepat load)
  // Di sini kita percaya localStorage karena token sudah divalidasi saat login.
  // Jika butuh strict validation, uncomment blok di bawah:
  /*
  const result = await callGAS('validateToken', { token: session.token });
  if (result.status !== 'ok') {
    clearSession();
    _redirectToLogin();
    return null;
  }
  */

  return session;
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
    navRole.textContent = session.role === ROLES.ADMIN ? '👑 Admin' : '🛡️ Satpam';
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
 * Modal ini tersedia di satpam.html dan admin.html via id="modal-logout".
 */
function openLogoutModal() {
  const modal = document.getElementById('modal-logout');
  if (!modal) {
    // Fallback jika modal tidak ada di halaman (seharusnya tidak terjadi)
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
 * @param {string} destination - URL tujuan setelah logout
 */
async function _doLogout(destination) {
  // Tampilkan state loading di semua tombol aksi logout
  const btnFormTamu = document.getElementById('btn-logout-to-form');
  const btnLogin    = document.getElementById('btn-logout-to-login');
  if (btnFormTamu) { btnFormTamu.disabled = true; btnFormTamu.classList.add('loading'); }
  if (btnLogin)    { btnLogin.disabled    = true; btnLogin.classList.add('loading'); }

  const token = getToken();
  if (token) {
    // Best-effort: kirim logout ke GAS (tidak menunggu response)
    callGAS('logout', { token }).catch(() => {});
  }
  clearSession();
  window.location.href = destination;
}

// ── Private Helpers ───────────────────────────────────────────

/**
 * Redirect ke halaman login sambil menyimpan URL tujuan
 * agar bisa kembali setelah login.
 */
function _redirectToLogin() {
  const current = window.location.pathname;
  // Jangan simpan halaman login itu sendiri sebagai redirect target
  if (current !== '/login' && current !== '/login.html') {
    sessionStorage.setItem('btamu_redirect', current);
  }
  window.location.href = '/login';
}

// ── Event Listeners Modal Logout ─────────────────────────────
// Dipasang via delegation setelah DOM siap, agar bekerja
// di semua halaman yang memuat auth.js (satpam & admin).
document.addEventListener('DOMContentLoaded', () => {
  // Tombol Batal
  document.getElementById('btn-logout-batal')
    ?.addEventListener('click', closeLogoutModal);

  // Tombol Keluar & Buka Form Tamu
  document.getElementById('btn-logout-to-form')
    ?.addEventListener('click', () => _doLogout('/'));

  // Tombol Keluar & Buka Hal. Login
  document.getElementById('btn-logout-to-login')
    ?.addEventListener('click', () => _doLogout('/login'));

  // Klik backdrop modal logout
  document.getElementById('modal-logout')
    ?.addEventListener('click', e => {
      if (e.target === document.getElementById('modal-logout')) closeLogoutModal();
    });

  // Escape untuk tutup modal logout
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('modal-logout');
      if (modal?.classList.contains('active')) closeLogoutModal();
    }
  });
});
