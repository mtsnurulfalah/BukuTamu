/**
 * admin.js — Dashboard Admin v2.2
 * ─────────────────────────────────────────────────────────
 * Fitur:
 *   - Cek autentikasi (admin only) — validasi token ke server (auth.js v2.1)
 *   - Tab navigasi: Ringkasan / Rekap Tamu / Manajemen Staf / Siswa / Pengaturan / Audit Log
 *   - Statistik cards: hari ini, aktif, bulan ini, terbanyak, total, rombongan
 *   - Chart.js: horizontal bar (jenis tamu) + line (tren 7 hari)
 *   - Rekap tamu: filter, pagination, modal detail
 *   - Export CSV (generate di frontend)
 *   - Manajemen staf & siswa: tambah, edit, toggle aktif
 *   - Pengaturan sekolah: identitas, logo sekolah, logo aplikasi
 *   - Polling notifikasi in-app tiap 60 detik
 *   - ▶▶ SECURITY v2.2: tab Audit Log, token format check sebelum request
 *
 * CHANGELOG v2.2 (SECURITY):
 *   - SECURITY S1: callGAS wrapper _callGASSecure() — tolak request jika token
 *                  tidak valid format (48 hex chars) sebelum dikirim ke server
 *   - SECURITY S2: Tab baru "Audit Log" — lihat aktivitas kritis
 *   - SECURITY S3: handleExport tidak menyertakan user_id dari frontend
 *   - SECURITY S4: request body tidak pernah menyertakan role/username sebagai
 *                  bukti otorisasi — server yang memutuskan dari token
 *   - SECURITY S5: token tidak pernah ada di URL/query string
 */

'use strict';

// ── SECURITY: Wrapper callGAS yang memvalidasi token sebelum request ──────────
/**
 * ▶▶ SECURITY S1: Wrapper aman untuk semua request ke GAS yang membutuhkan auth.
 * Menolak request di sisi client jika token tidak ada atau formatnya salah,
 * tanpa perlu round-trip ke server.
 *
 * Ini adalah defence-in-depth: server TETAP melakukan validasi sendiri.
 * Fungsi ini hanya mencegah request yang pasti gagal dari dikirim.
 *
 * @param {string} action
 * @param {Object} payload — JANGAN sertakan user_id/role/username sebagai
 *                           bukti otorisasi — server tentukan dari token
 * @returns {Promise<Object>}
 */
async function _callGASSecure(action, payload = {}) {
  const token = getToken();

  // ▶▶ SECURITY: Validasi format token sebelum kirim ke server
  if (!token || !/^[a-f0-9]{48}$/.test(token)) {
    // Token tidak ada atau format salah → redirect ke login
    clearSession();
    _redirectToLogin();
    return { status: 'error', message: 'Sesi tidak valid. Silakan login kembali.' };
  }

  // ▶▶ SECURITY: Pastikan payload tidak menyertakan field otorisasi dari frontend
  // Server tidak boleh mempercayai user_id/role/username dari body
  const cleanPayload = { ...payload };
  delete cleanPayload.user_id;
  delete cleanPayload.userId;
  delete cleanPayload.owner_id;
  delete cleanPayload.ownerId;
  // Catatan: token boleh ada karena itu cara GAS mengidentifikasi user

  return callGAS(action, { token, ...cleanPayload });
}

// ── State ─────────────────────────────────────────────────────
let session         = null;
let activeTab       = 'ringkasan';
let rekapData       = [];
let rekapTotal      = 0;
let rekapPage       = 1;
const REKAP_LIMIT   = 10;
let notifTimer      = null;
let lastNotifCount  = -1;
let allStaf         = [];
let editingStafId   = null;

// ── Double-submit guards per form
let _isStafSubmitting   = false;
let _isSiswaSubmitting  = false;
let _isPengaturanSubmitting = false;

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  session = await checkAuth(ROLES.ADMIN);
  if (!session) return;

  initNavbar(session);

  // FIX A10: try/catch agar config gagal tidak crash keseluruhan init
  await loadSchoolConfig();

  setDefaultFilterDates();
  populateFilterJenis();
  await loadRingkasan();

  attachTabEvents();
  attachRekapEvents();
  attachStafEvents();
  attachSiswaEvents();
  attachModalEvents();

  startNotifPolling();
});

// FIX A12: bersihkan timer polling saat halaman di-unload
window.addEventListener('beforeunload', () => {
  if (notifTimer) { clearInterval(notifTimer); notifTimer = null; }
});

// ── School Config ─────────────────────────────────────────────
// FIX A10: bungkus try/catch agar kegagalan GAS tidak crash halaman
async function loadSchoolConfig() {
  try {
    const r = await callGAS('getConfig');
    if (r?.status === 'ok' && r.data) {
      const nama = r.data.nama_sekolah || CONFIG.APP_NAME;
      const el = document.getElementById('nav-school-name');
      if (el) el.textContent = nama;
      document.title = `Dashboard Admin — ${nama}`;

      if (r.data.logo_app_url) {
        _updateNavbarLogo(r.data.logo_app_url);
      }
    }
  } catch (_) {
    // Config gagal — tampilan default tetap digunakan
  }
}

// ── Tab Navigation ────────────────────────────────────────────
function attachTabEvents() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tabId = btn.id.replace('tab-', '');
      await switchTab(tabId);
    });
  });
}

// Guard race condition — cegah concurrent tab switch
let _isTabSwitching = false;

async function switchTab(tabId) {
  if (activeTab === tabId) return;
  if (_isTabSwitching) return;

  _isTabSwitching = true;

  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.id === `tab-${tabId}`);
    b.setAttribute('aria-selected', b.id === `tab-${tabId}` ? 'true' : 'false');
  });

  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('active', p.id === `pane-${tabId}`);
  });

  activeTab = tabId;

  await new Promise(resolve => requestAnimationFrame(resolve));

  const adminNav = document.querySelector('.admin-nav');
  if (adminNav) {
    const navTop = adminNav.getBoundingClientRect().top + window.scrollY;
    if (window.scrollY > navTop) {
      window.scrollTo({ top: navTop - 8, behavior: 'instant' });
    }
  }

  try {
    if (tabId === 'ringkasan')  await loadRingkasan();
    if (tabId === 'rekap')      await loadRekap();
    if (tabId === 'staf')       await loadStaf();
    if (tabId === 'siswa')      await loadSiswa();
    if (tabId === 'pengaturan') await loadPengaturan();
    if (tabId === 'auditlog')   await loadAuditLog();   // ▶▶ SECURITY
  } finally {
    _isTabSwitching = false;
  }
}

// ══════════════════════════════════════════════════════════════
// TAB: RINGKASAN
// ══════════════════════════════════════════════════════════════

async function loadRingkasan() {
  // FIX A8: destroy chart dengan null guard yang ketat
  _destroyCharts();

  // Tampilkan skeleton
  _setChartVisibility(false);

  const today = new Date();
  const dateEl = document.getElementById('ringkasan-date');
  if (dateEl) {
    dateEl.textContent = today.toLocaleDateString('id-ID', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  }

  // FIX A1: try/catch agar kegagalan GAS tidak crash halaman
  let result;
  try {
    result = await callGAS('getStatistik', { token: getToken() });
  } catch (_) {
    showToast('Gagal memuat statistik. Periksa koneksi internet.', 'danger');
    _setChartVisibility(false);
    return;
  }

  if (result.status !== 'ok') {
    showToast('Gagal memuat statistik: ' + (result.message || 'Error tidak diketahui'), 'danger');
    return;
  }

  const d = result.data;
  if (!d) {
    showToast('Data statistik tidak valid. Coba lagi.', 'danger');
    return;
  }

  // ▶▶ MULTI-TAMU: field baru dengan fallback ke field lama
  const hariIni   = d.hariIni  || { total: 0, hadir: 0, pulang: 0 };
  const bulanIni  = d.bulanIni || { total: 0, bulan: '' };
  const terbanyak = d.terbanyak || { jenis: '—', total: 0 };
  const perJenis  = d.perJenis  || [];
  const tren7Hari = d.tren7Hari || [];
  const totalSemua = d.totalSemua || 0;

  const totalIndividuHariIni  = hariIni.totalIndividu  ?? hariIni.total;
  const hadirIndividu         = hariIni.hadir          ?? 0;
  const pulangIndividu        = hariIni.pulang         ?? 0;
  const totalIndividuBulan    = bulanIni.totalIndividu ?? bulanIni.total;
  const totalIndSemua         = d.totalIndividuSemua   ?? totalSemua;
  const totalRombSemua        = d.totalRombonganSemua  ?? 0;

  setStatCard('stat-hari-ini',
    totalIndividuHariIni,
    `${hariIni.totalSesi ?? hariIni.total} sesi · ${hadirIndividu} hadir · ${pulangIndividu} pulang`);

  setStatCard('stat-aktif',
    hadirIndividu,
    `${hariIni.hadirSesi ?? hadirIndividu} sesi aktif`);

  setStatCard('stat-bulan-ini',
    totalIndividuBulan,
    `Bulan ${_formatBulan(bulanIni.bulan)}`);

  setStatCard('stat-terbanyak',
    terbanyak.jenis,
    `${terbanyak.total} individu`, true);

  setStatCard('stat-total-semua',  totalIndSemua,  `${totalSemua} sesi total`);
  setStatCard('stat-rombongan',    totalRombSemua, 'sesi rombongan total');

  renderBarChart(perJenis);

  const jenisTotalEl = document.getElementById('chart-jenis-total');
  if (jenisTotalEl) jenisTotalEl.textContent = `${totalIndSemua} individu`;

  renderTrendChart(tren7Hari);

  const trendTotalEl = document.getElementById('chart-trend-total');
  if (trendTotalEl) {
    const sum7Ind  = tren7Hari.reduce((acc, item) => acc + (item.totalIndividu ?? item.total ?? 0), 0);
    const sum7Sesi = tren7Hari.reduce((acc, item) => acc + (item.totalSesi    ?? item.total ?? 0), 0);
    trendTotalEl.textContent = `${sum7Ind} individu · ${sum7Sesi} sesi / 7 hari`;
  }
}

function setStatCard(valueId, value, subText, isText = false) {
  const el    = document.getElementById(valueId);
  const subEl = document.getElementById(valueId + '-sub');
  if (el) {
    el.innerHTML    = '';
    el.textContent  = isText ? value : Number(value).toLocaleString('id-ID');
  }
  if (subEl && subText) subEl.textContent = subText;
}

// ── Chart instances ────────────────────────────────────────────
let _chartJenis = null;
let _chartTrend = null;

/** FIX A8: destroy dengan null guard ketat — tidak throw jika canvas sudah diganti */
function _destroyCharts() {
  if (_chartJenis) {
    try { _chartJenis.destroy(); } catch (_) {}
    _chartJenis = null;
  }
  if (_chartTrend) {
    try { _chartTrend.destroy(); } catch (_) {}
    _chartTrend = null;
  }
}

/** Tampilkan/sembunyikan skeleton vs canvas chart */
function _setChartVisibility(dataLoaded) {
  const skJenis = document.getElementById('chart-jenis-skeleton');
  const skTrend = document.getElementById('trend-chart-skeleton');
  const wJenis  = document.getElementById('chart-jenis-wrap');
  const wTrend  = document.getElementById('trend-chart-wrap');
  if (skJenis) skJenis.style.display = dataLoaded ? 'none' : '';
  if (skTrend) skTrend.style.display = dataLoaded ? 'none' : '';
  if (wJenis)  wJenis.style.display  = dataLoaded ? ''     : 'none';
  if (wTrend)  wTrend.style.display  = dataLoaded ? ''     : 'none';
}

// ── Bar Chart (Chart.js) ───────────────────────────────────────
function renderBarChart(perJenis) {
  const skJenis = document.getElementById('chart-jenis-skeleton');
  const wJenis  = document.getElementById('chart-jenis-wrap');
  const canvas  = document.getElementById('chart-jenis');

  if (!canvas) return;
  if (skJenis) skJenis.style.display = 'none';
  if (wJenis)  wJenis.style.display  = '';

  // FIX A8: tidak overwrite innerHTML — tampilkan pesan tanpa merusak canvas
  if (!perJenis || perJenis.length === 0) {
    // Sembunyikan wrap, tampilkan skeleton yg sudah ada atau fallback teks
    if (wJenis) wJenis.style.display = 'none';
    const emptyMsg = document.getElementById('chart-jenis-empty');
    if (emptyMsg) emptyMsg.style.display = '';
    return;
  }

  _destroyCharts(); // Destroy sebelum buat instance baru

  const style   = getComputedStyle(document.documentElement);
  const primary = style.getPropertyValue('--clr-primary').trim() || '#1a4480';
  const accent  = style.getPropertyValue('--clr-accent').trim()  || '#e8a020';
  const gray100 = style.getPropertyValue('--clr-gray-100').trim()|| '#f1f5f9';
  const gray600 = style.getPropertyValue('--clr-gray-600').trim()|| '#475569';
  const gray400 = style.getPropertyValue('--clr-gray-400').trim()|| '#94a3b8';

  _chartJenis = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: perJenis.map(j => j.jenis),
      datasets: [{
        data: perJenis.map(j => j.total),
        backgroundColor: primary,
        borderRadius: 5,
        borderSkipped: false,
        hoverBackgroundColor: accent,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.parsed.x} kunjungan` },
          backgroundColor: '#0f172a',
          titleColor: '#f1f5f9',
          bodyColor:  '#94a3b8',
          padding: 10,
          cornerRadius: 8,
          displayColors: false,
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { precision: 0, color: gray400, font: { size: 11 } },
          grid: { color: gray100 },
          border: { display: false },
        },
        y: {
          ticks: { color: gray600, font: { size: 11, weight: '500' } },
          grid: { display: false },
          border: { display: false },
        },
      },
      layout: { padding: { right: 8 } },
    },
  });
}

// ── Trend Chart (Chart.js) ─────────────────────────────────────
function renderTrendChart(tren7Hari) {
  const skTrend = document.getElementById('trend-chart-skeleton');
  const wTrend  = document.getElementById('trend-chart-wrap');
  const canvas  = document.getElementById('trend-chart');

  if (!canvas) return;
  if (skTrend) skTrend.style.display = 'none';
  if (wTrend)  wTrend.style.display  = '';

  if (!tren7Hari || tren7Hari.length === 0) {
    if (wTrend) wTrend.style.display = 'none';
    return;
  }

  const style   = getComputedStyle(document.documentElement);
  const primary = style.getPropertyValue('--clr-primary').trim()  || '#1a4480';
  const accent  = style.getPropertyValue('--clr-accent').trim()   || '#e8a020';
  const gray100 = style.getPropertyValue('--clr-gray-100').trim() || '#f1f5f9';
  const gray400 = style.getPropertyValue('--clr-gray-400').trim() || '#94a3b8';

  const getValue = item => item.totalIndividu ?? item.total ?? 0;

  function makeGradient(ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 120);
    gradient.addColorStop(0, primary + '40');
    gradient.addColorStop(1, primary + '00');
    return gradient;
  }

  _chartTrend = new Chart(canvas, {
    type: 'line',
    data: {
      labels: tren7Hari.map(item => escapeHtml(item.label)),
      datasets: [{
        data: tren7Hari.map(getValue),
        borderColor: primary,
        borderWidth: 2.5,
        pointBackgroundColor: primary,
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: accent,
        fill: true,
        backgroundColor: ctx => makeGradient(ctx.chart.ctx),
        tension: 0.35,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.parsed.y} individu` },
          backgroundColor: '#0f172a',
          titleColor: '#f1f5f9',
          bodyColor:  '#94a3b8',
          padding: 10,
          cornerRadius: 8,
          displayColors: false,
        },
      },
      scales: {
        x: {
          ticks: { color: gray400, font: { size: 11 } },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { precision: 0, color: gray400, font: { size: 11 } },
          grid: { color: gray100 },
          border: { display: false },
        },
      },
    },
  });
}

// ══════════════════════════════════════════════════════════════
// TAB: REKAP TAMU
// ══════════════════════════════════════════════════════════════

function setDefaultFilterDates() {
  const now  = new Date();
  const y    = now.getFullYear();
  const mo   = String(now.getMonth() + 1).padStart(2, '0');
  const d    = String(now.getDate()).padStart(2, '0');
  const dari = document.getElementById('filter-dari');
  const sampai = document.getElementById('filter-sampai');
  if (dari)   dari.value   = `${y}-${mo}-01`;
  if (sampai) sampai.value = `${y}-${mo}-${d}`;
}

function populateFilterJenis() {
  const sel = document.getElementById('filter-jenis');
  if (!sel || sel.options.length > 1) return;
  JENIS_TAMU.forEach(j => {
    const opt = document.createElement('option');
    opt.value = j;
    opt.textContent = j;
    sel.appendChild(opt);
  });
}

function attachRekapEvents() {
  document.getElementById('btn-filter')?.addEventListener('click', () => {
    rekapPage = 1;
    loadRekap();
  });

  document.getElementById('btn-reset-filter')?.addEventListener('click', () => {
    setDefaultFilterDates();
    const filterJenis  = document.getElementById('filter-jenis');
    const filterSearch = document.getElementById('filter-search');
    if (filterJenis)  filterJenis.value  = '';
    if (filterSearch) filterSearch.value = '';
    rekapPage = 1;
    loadRekap();
  });

  document.getElementById('btn-export')?.addEventListener('click', handleExport);
  document.getElementById('btn-export-pdf')?.addEventListener('click', handleExportPDF);

  document.getElementById('filter-search')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { rekapPage = 1; loadRekap(); }
  });

  // FIX A14: event delegation untuk tombol detail
  const tbody = document.getElementById('rekap-table-body');
  if (tbody) {
    tbody.addEventListener('click', e => {
      const btn = e.target.closest('.rekap-detail-btn');
      if (btn) {
        const id = btn.dataset.id;
        if (id) openRekapDetail(id);
      }
    });
  }

  // Event delegation untuk pagination
  const pagination = document.getElementById('rekap-pagination');
  if (pagination) {
    pagination.addEventListener('click', e => {
      const btn = e.target.closest('.pagination__btn');
      if (btn && !btn.disabled) {
        const page = parseInt(btn.dataset.page, 10);
        if (!isNaN(page)) goToPage(page);
      }
    });
  }
}

async function loadRekap() {
  const dari      = document.getElementById('filter-dari')?.value   || '';
  const sampai    = document.getElementById('filter-sampai')?.value || '';
  const jenisTamu = document.getElementById('filter-jenis')?.value  || '';
  const search    = document.getElementById('filter-search')?.value || '';

  showRekapSkeleton(true);

  let result;
  try {
    result = await callGAS('getTamu', {
      token: getToken(),
      dari, sampai, jenisTamu, search,
      page:  rekapPage,
      limit: REKAP_LIMIT,
    });
  } catch (_) {
    result = { status: 'error', message: 'Koneksi gagal.' };
  }

  showRekapSkeleton(false);

  if (result.status !== 'ok') {
    showToast('Gagal memuat rekap: ' + (result.message || 'Error'), 'danger');
    // FIX A5: reset data stale
    rekapData  = [];
    rekapTotal = 0;
    const tableEl = document.getElementById('rekap-table-wrapper');
    const emptyEl = document.getElementById('rekap-empty');
    const countEl = document.getElementById('rekap-count');
    if (tableEl) tableEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = '';
    if (countEl) countEl.textContent   = 'Gagal memuat data.';
    renderPagination(1, 1);
    return;
  }

  rekapData  = result.data.tamu  || [];
  rekapTotal = result.data.total || 0;
  const pages         = result.data.pages || 1;
  const totalIndividu = result.data.totalIndividu ?? rekapTotal;

  const countEl = document.getElementById('rekap-count');
  if (countEl) {
    countEl.textContent = rekapTotal > 0
      ? `${rekapTotal} sesi · ${totalIndividu} individu (hal. ${rekapPage}/${pages})`
      : 'Tidak ada data';
  }

  renderRekapTable(rekapData);
  renderPagination(rekapPage, pages);

  const emptyEl = document.getElementById('rekap-empty');
  const tableEl = document.getElementById('rekap-table-wrapper');
  if (emptyEl) emptyEl.style.display = rekapData.length === 0 ? '' : 'none';
  if (tableEl) tableEl.style.display = rekapData.length === 0 ? 'none' : '';
}

function renderRekapTable(data) {
  const tbody = document.getElementById('rekap-table-body');
  if (!tbody) return;

  tbody.innerHTML = data.map(t => {
    const anggota = Array.isArray(t.dataAnggota) ? t.dataAnggota : [];
    let namaHtml;
    if (t.isRombongan && anggota.length > 0) {
      const shown = anggota.slice(0, 2).map(a => escapeHtml(a.namaLengkap || '—')).join(', ');
      const sisa  = anggota.length - 2;
      namaHtml = `${shown}${sisa > 0 ? ` <span class="badge-sisa-rekap">+${sisa}</span>` : ''}`;
    } else {
      namaHtml = escapeHtml(t.namaLengkap);
    }

    const badgeRomb = t.isRombongan
      ? `<span class="badge-rombongan-sm">${_icon('users','0.75rem')} ${t.jumlahTamu}</span>`
      : '';

    return `
    <tr data-id="${escapeHtml(t.id)}" class="${t.isRombongan ? 'tr--rombongan' : ''}">
      <td>${escapeHtml(formatTanggalDisplay(t.tanggal))}</td>
      <td>
        <div style="font-weight:600;white-space:normal;min-width:120px;">
          ${namaHtml}${badgeRomb}
        </div>
        <div class="text-xs text-muted">${escapeHtml(t.instansi)}</div>
      </td>
      <td><span class="badge badge--primary">${escapeHtml(t.jenisTamu)}</span></td>
      <td style="white-space:normal;min-width:120px;">${escapeHtml(t.instansi)}</td>
      <td>${escapeHtml(t.jamDatang)}</td>
      <td>${t.jamPulang ? escapeHtml(t.jamPulang) : '<span class="text-muted">—</span>'}</td>
      <td>
        <span class="badge badge--${t.status === 'Hadir' ? 'success' : 'gray'}">
          ${escapeHtml(t.status)}
        </span>
      </td>
      <td>
        <button class="btn btn--secondary btn--sm rekap-detail-btn"
                data-id="${escapeHtml(t.id)}"
                aria-label="Detail ${escapeHtml(t.namaLengkap || 'tamu')}">
          ${_icon('search','0.85rem')} Detail
        </button>
      </td>
    </tr>`;
  }).join('');
}

function renderPagination(currentPage, totalPages) {
  const container = document.getElementById('rekap-pagination');
  if (!container) return;

  if (totalPages <= 1) { container.innerHTML = ''; return; }

  let html = `<button class="pagination__btn" ${currentPage <= 1 ? 'disabled' : ''}
                data-page="${currentPage - 1}" aria-label="Halaman sebelumnya">‹</button>`;

  _pageRange(currentPage, totalPages).forEach(p => {
    if (p === '...') {
      html += `<span style="padding:0 var(--space-2);color:var(--clr-gray-400);">…</span>`;
    } else {
      html += `<button class="pagination__btn ${p === currentPage ? 'active' : ''}"
                 data-page="${p}" aria-label="Halaman ${p}"
                 aria-current="${p === currentPage ? 'page' : 'false'}">${p}</button>`;
    }
  });

  html += `<button class="pagination__btn" ${currentPage >= totalPages ? 'disabled' : ''}
             data-page="${currentPage + 1}" aria-label="Halaman berikutnya">›</button>`;

  container.innerHTML = html;
}

async function goToPage(page) {
  rekapPage = page;
  await loadRekap();
  document.getElementById('pane-rekap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// FIX A2: showRekapSkeleton(false) tidak melakukan apa-pun — tbody di-clear
// pada siklus berikutnya oleh renderRekapTable() saja.
// showRekapSkeleton(true) tetap menulis skeleton agar tabel terlihat aktif.
function showRekapSkeleton(show) {
  const tbody = document.getElementById('rekap-table-body');
  if (!tbody) return;
  if (show) {
    tbody.innerHTML = Array(5).fill(`
      <tr>
        ${Array(8).fill('<td><div class="skeleton skeleton--text" style="height:0.9em;"></div></td>').join('')}
      </tr>`).join('');
  }
  // show=false: tbody akan diisi ulang oleh renderRekapTable()
}

// ── Modal Detail Rekap ─────────────────────────────────────────
async function openRekapDetail(tamuId) {
  const modal   = document.getElementById('modal-detail');
  const content = document.getElementById('modal-detail-content');
  const title   = document.getElementById('modal-detail-title');
  const badges  = document.getElementById('modal-detail-badges');

  if (!modal) return;

  // Reset scroll posisi sebelum modal aktif (konsisten dengan satpam)
  const modalBox = modal.querySelector('.modal');
  if (modalBox) modalBox.scrollTop = 0;

  if (content) content.innerHTML = `
    <div style="text-align:center;padding:var(--space-8);">
      <div class="spinner" style="margin:0 auto;"></div>
      <p class="text-sm text-muted" style="margin-top:var(--space-3);">Memuat detail...</p>
    </div>`;
  if (badges)  badges.innerHTML  = '';
  if (title)   title.textContent = 'Detail Kunjungan';
  modal.classList.add('active');
  lockScroll();

  let result;
  try {
    result = await callGAS('getTamuById', { token: getToken(), id: tamuId });
  } catch (_) {
    if (content) content.innerHTML = `<div class="alert alert--danger">Koneksi gagal. Coba lagi.</div>`;
    return;
  }

  if (result.status !== 'ok') {
    if (content) content.innerHTML =
      `<div class="alert alert--danger">${escapeHtml(result.message || 'Gagal memuat detail.')}</div>`;
    return;
  }

  const t = result.data;
  if (title) title.textContent = t.isRombongan
    ? `Rombongan — ${t.jumlahTamu} Tamu`
    : (t.namaLengkap || 'Detail Kunjungan');

  // Badges: hapus inline margin-left yang redundant karena parent sudah punya gap
  if (badges) badges.innerHTML = `
    <span class="badge badge--${t.status === 'Hadir' ? 'success' : 'gray'}">${escapeHtml(t.status)}</span>
    <span class="badge badge--primary">${escapeHtml(t.jenisTamu)}</span>
    ${t.isRombongan ? `<span class="badge-rombongan-sm">${_icon('users','0.75rem')} ${t.jumlahTamu} Tamu</span>` : ''}`;

  const ttdHtml = t.tandaTangan
    ? `<div class="detail-signature"><img src="${t.tandaTangan}" alt="Tanda tangan" /></div>`
    : '<span class="text-muted">—</span>';

  const instansiLabel = t.jenisTamu === 'Orang Tua/Wali Murid'
    ? 'Orang Tua/Wali dari'
    : t.jenisTamu === 'Alumni' ? 'Tahun Lulus' : 'Instansi / Asal';

  // Gunakan CSS classes yang sama dengan satpam — hapus semua inline style anggota
  const anggota = Array.isArray(t.dataAnggota) ? t.dataAnggota : [];
  let anggotaHtml = '';
  if (t.isRombongan && anggota.length > 0) {
    anggotaHtml = `
      <div class="detail-section-title">
        ${_icon('users','0.8rem')} Daftar Anggota (${anggota.length} orang)
      </div>
      <ol class="detail-anggota-list">
        ${anggota.map((a, i) => `
          <li class="detail-anggota-item">
            <div class="detail-anggota-item__header">
              <span class="detail-anggota-item__nomor">${i + 1}</span>
              <span class="detail-anggota-item__nama">${escapeHtml(a.namaLengkap || '—')}</span>
              ${i === 0 ? '<span class="detail-anggota-item__wakil">Wakil</span>' : ''}
              ${a.jabatan ? `<span class="detail-anggota-item__jabatan">${escapeHtml(a.jabatan)}</span>` : ''}
            </div>
            ${(a.noHp || a.email) ? `
            <div class="detail-anggota-item__contact">
              ${a.noHp  ? `<span class="detail-anggota-item__contact-item">${_icon('phone','0.75rem')} ${escapeHtml(a.noHp)}</span>` : ''}
              ${a.email ? `<span class="detail-anggota-item__contact-item">${_icon('mail','0.75rem')} ${escapeHtml(a.email)}</span>` : ''}
            </div>` : ''}
          </li>`).join('')}
      </ol>`;
  }

  if (content) content.innerHTML = `
    <div class="detail-row"><div class="detail-row__label">Tanggal</div><div class="detail-row__value">${displayVal(formatTanggalDisplay(t.tanggal))}</div></div>
    <div class="detail-row"><div class="detail-row__label">Jam Datang</div><div class="detail-row__value">${displayVal(t.jamDatang)}</div></div>
    <div class="detail-row"><div class="detail-row__label">Jam Pulang</div><div class="detail-row__value">${t.jamPulang || '<span class="text-muted">Belum pulang</span>'}</div></div>
    <div class="detail-row"><div class="detail-row__label">${escapeHtml(instansiLabel)}</div><div class="detail-row__value">${displayVal(t.instansi)}</div></div>
    <div class="detail-row"><div class="detail-row__label">Keperluan</div><div class="detail-row__value detail-row__value--pre">${displayVal(t.keperluan)}</div></div>
    <div class="detail-row"><div class="detail-row__label">Bertemu</div><div class="detail-row__value">${displayVal(t.bertemuDengan)}</div></div>
    ${!t.isRombongan ? `
    <div class="detail-row"><div class="detail-row__label">Nama</div><div class="detail-row__value">${displayVal(t.namaLengkap)}</div></div>
    <div class="detail-row"><div class="detail-row__label">No. HP/WA</div><div class="detail-row__value">${displayVal(t.noHp)}</div></div>
    <div class="detail-row"><div class="detail-row__label">Email</div><div class="detail-row__value">${displayVal(t.email)}</div></div>` : ''}
    ${anggotaHtml}
    <div class="detail-row detail-row--signature"><div class="detail-row__label">Tanda Tangan</div><div class="detail-row__value">${ttdHtml}</div></div>
    ${t.diupdateOleh ? `<div class="detail-row"><div class="detail-row__label">Dicatat oleh</div><div class="detail-row__value">${displayVal(t.diupdateOleh)}</div></div>` : ''}
  `;
}

function closeRekapDetail() {
  const modal = document.getElementById('modal-detail');
  if (modal) modal.classList.remove('active');
  unlockScroll();
}

// ── Export CSV ─────────────────────────────────────────────────
async function handleExport() {
  // FIX A11: null guard sebelum setButtonLoading
  const btn = document.getElementById('btn-export');
  if (!btn) return;

  setButtonLoading(btn);

  const dari   = document.getElementById('filter-dari')?.value   || '';
  const sampai = document.getElementById('filter-sampai')?.value || '';
  const jenis  = document.getElementById('filter-jenis')?.value  || '';

  let result;
  try {
    result = await callGAS('exportData', {
      token: getToken(), dari, sampai, jenisTamu: jenis,
    });
  } catch (_) {
    result = { status: 'error', message: 'Koneksi gagal.' };
  }

  resetButtonLoading(btn, false);

  if (result.status !== 'ok') {
    showToast('Gagal export: ' + (result.message || 'Error'), 'danger');
    return;
  }

  const data = result.data.tamu || [];
  if (data.length === 0) {
    showToast('Tidak ada data untuk diexport.', 'default');
    return;
  }

  const totalInd = result.data.totalIndividu ?? data.length;
  const csv = generateCSV(data);
  downloadCSV(csv, `buku-tamu-${dari || 'semua'}-${sampai || 'semua'}.csv`);
  showToast(`${data.length} sesi (${totalInd} individu) berhasil diexport ke CSV.`, 'success');
}

/**
 * ▶▶ MULTI-TAMU: Generate CSV — satu baris per anggota.
 */
function generateCSV(data) {
  const headers = [
    'ID Sesi','Tanggal','Jenis Tamu','Jam Datang','Jam Pulang','Status',
    'Jumlah Tamu','Instansi','Keperluan','Bertemu Dengan',
    'No. Anggota','Nama Anggota','No. HP Anggota','Email Anggota','Jabatan Anggota',
  ];

  const rows = [];
  data.forEach(t => {
    const anggota = (Array.isArray(t.dataAnggota) && t.dataAnggota.length > 0)
      ? t.dataAnggota
      : [{ namaLengkap: t.namaLengkap, noHp: t.noHp || '', email: t.email || '', jabatan: '' }];

    anggota.forEach((a, idx) => {
      rows.push([
        t.id, t.tanggal, t.jenisTamu, t.jamDatang, t.jamPulang || '', t.status,
        t.jumlahTamu || 1, t.instansi, t.keperluan, t.bertemuDengan,
        idx + 1, a.namaLengkap || '', a.noHp || '', a.email || '', a.jabatan || '',
      ].map(v => `"${String(v || '').replace(/"/g, '""')}"`));
    });
  });

  return [headers.map(h => `"${h}"`).join(','), ...rows.map(r => r.join(','))].join('\r\n');
}

function downloadCSV(csvString, filename) {
  const bom  = '\uFEFF';
  const blob = new Blob([bom + csvString], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

// ══════════════════════════════════════════════════════════════
// EKSPOR PDF — REKAP TAMU
// ══════════════════════════════════════════════════════════════

/**
 * Handler tombol "Ekspor PDF" pada tab Rekap Tamu.
 *
 * Alur:
 *  1. Baca filter aktif (dari, sampai, jenisTamu) — identik dengan handleExport CSV.
 *  2. Panggil exportData via _callGASSecure → semua data terfilter, tanpa paginasi.
 *  3. Ambil konfigurasi sekolah via getConfig (nama, alamat, kepala sekolah, logo).
 *  4. Render PDF via generateRekapPDF().
 *
 * SECURITY:
 *  - Menggunakan _callGASSecure() → token divalidasi format sebelum dikirim.
 *  - Tidak menyertakan user_id/role di payload — server menentukan dari token.
 *  - filter search tidak didukung exportData, digunakan dari/sampai/jenisTamu saja
 *    (konsisten dengan handleExport CSV yang sudah ada).
 *  - Proses ini bersifat read-only — tidak ada mutasi data.
 */
async function handleExportPDF() {
  const btn = document.getElementById('btn-export-pdf');
  if (!btn) return;

  setButtonLoading(btn);

  const dari   = document.getElementById('filter-dari')?.value   || '';
  const sampai = document.getElementById('filter-sampai')?.value || '';
  const jenis  = document.getElementById('filter-jenis')?.value  || '';

  // Ambil semua data sesuai filter (tanpa paginasi) — sama seperti CSV export
  let result;
  try {
    result = await _callGASSecure('exportData', { dari, sampai, jenisTamu: jenis });
  } catch (_) {
    result = { status: 'error', message: 'Koneksi gagal.' };
  }

  if (result.status !== 'ok') {
    resetButtonLoading(btn, false);
    showToast('Gagal membuat PDF: ' + (result.message || 'Error tidak diketahui.'), 'danger');
    return;
  }

  const exportData = result.data || {};
  const tamuList   = exportData.tamu || [];

  if (tamuList.length === 0) {
    resetButtonLoading(btn, false);
    showToast('Tidak ada data yang dapat diekspor berdasarkan filter yang dipilih.', 'default');
    return;
  }

  // Ambil konfigurasi sekolah — gunakan cache DOM jika tersedia, fallback ke API
  let schoolConfig = {};
  try {
    const cfgResult = await callGAS('getConfig');
    if (cfgResult?.status === 'ok' && cfgResult.data) {
      schoolConfig = cfgResult.data;
    }
  } catch (_) {
    // Gagal ambil config — tetap lanjut dengan fallback
  }

  try {
    await generateRekapPDF(tamuList, exportData, schoolConfig, { dari, sampai, jenis });
    showToast(
      `${tamuList.length} sesi (${exportData.totalIndividu ?? tamuList.length} individu) berhasil diekspor ke PDF.`,
      'success'
    );
  } catch (err) {
    console.error('generateRekapPDF error:', err);
    showToast('Gagal membuat PDF. Silakan coba lagi.', 'danger');
  } finally {
    resetButtonLoading(btn, false);
  }
}

// ══════════════════════════════════════════════════════════════
// PDF REKAP TAMU — Standar Surat Resmi / Dokumen Administratif
// Indonesia (Permendagri No. 80 Tahun 2015 & Pedoman Surat Dinas)
// ══════════════════════════════════════════════════════════════

// ── Konstanta Warna & Tipografi ───────────────────────────────
// Palet monokromatis + satu warna aksen biru tua.
// Dirancang agar tetap terbaca sempurna saat dicetak hitam-putih.
const _PDF = {
  // Hitam tinta untuk teks utama dokumen
  tintaHitam   : [0,   0,   0],
  // Biru tua — aksen heading & thead (gelap cukup untuk grayscale)
  biru         : [26,  68,  128],
  biruTua      : [15,  42,  85],
  // Abu-abu tipografi sekunder
  abu700       : [51,  65,  85],
  abu500       : [100, 116, 139],
  abu300       : [203, 213, 225],
  abu100       : [241, 245, 249],
  abu50        : [248, 250, 252],
  // Putih
  putih        : [255, 255, 255],
  // Warna status
  hijauTua     : [21,  128, 61],
  // Font — helvetica tersedia built-in di jsPDF (tidak perlu embed)
  font         : 'helvetica',
  // Ukuran kertas A4 Landscape (mm) — landscape dipilih karena 10 kolom tabel
  pageW        : 297,
  pageH        : 210,
  // Margin surat resmi: minimal 2.5 cm kiri-kanan, 2 cm atas-bawah
  mL           : 20,   // 20 mm (≈ 2 cm) kiri
  mR           : 15,   // 15 mm kanan
  mT           : 15,   // 15 mm atas
  mB           : 15,   // 15 mm bawah
};

// ── Nama Bulan Indonesia ──────────────────────────────────────
const _PDF_BULAN = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember'
];

// ── Helper: Format Tanggal ─────────────────────────────────────

/** ISO "YYYY-MM-DD" → "1 September 2026" */
function _pdfFormatTanggalPanjang(iso) {
  if (!iso) return '';
  const p = String(iso).split('-');
  if (p.length < 3) return iso;
  return `${parseInt(p[2], 10)} ${_PDF_BULAN[parseInt(p[1], 10) - 1] || ''} ${p[0]}`;
}

/** ISO "YYYY-MM-DD" → "01-09-2026" untuk nama file */
function _pdfFormatTanggalFile(iso) {
  if (!iso) return '';
  const p = String(iso).split('-');
  if (p.length < 3) return iso;
  return `${p[2]}-${p[1]}-${p[0]}`;
}

/** Nama file PDF yang aman untuk semua OS */
function _pdfNamaFile(namaSekolah, dari, sampai) {
  const slug = String(namaSekolah || 'Madrasah')
    .replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '-');
  const dariStr   = dari   ? _pdfFormatTanggalFile(dari)   : 'semua';
  const sampaiStr = sampai ? _pdfFormatTanggalFile(sampai) : 'semua';
  if (dari && sampai && dari !== sampai) return `Rekap-Tamu-${slug}-${dariStr}_s.d_${sampaiStr}.pdf`;
  if (dari && dari === sampai)           return `Rekap-Tamu-${slug}-${dariStr}.pdf`;
  return `Rekap-Tamu-${slug}-${dariStr}-${sampaiStr}.pdf`;
}

/**
 * Generate nomor laporan unik.
 * Format: RT-YYYY-MM-<milisecond 4 digit terakhir>
 * Contoh: RT-2026-09-4821
 * Unik dalam satu sesi ekspor; cukup untuk keperluan arsip.
 */
function _pdfNomorLaporan(wibDate) {
  const yyyy  = wibDate.getFullYear();
  const mo    = String(wibDate.getMonth() + 1).padStart(2, '0');
  const ms4   = String(Date.now()).slice(-4);
  return `RT-${yyyy}-${mo}-${ms4}`;
}

/**
 * Muat gambar dari URL dan konversi ke base64 data URL.
 * Menggunakan HTMLImageElement + OffscreenCanvas / regular Canvas.
 * Mengembalikan null jika gagal (CORS, timeout, format tidak didukung).
 *
 * @param {string} url
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<string|null>} base64 data URL atau null
 */
async function _pdfLoadImageAsBase64(url, timeoutMs = 5000) {
  if (!url) return null;
  try {
    return await Promise.race([
      new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            // Skala ke maks 200x200 untuk mengurangi ukuran PDF
            const MAX = 200;
            const scale = Math.min(1, MAX / Math.max(img.width || 1, img.height || 1));
            canvas.width  = Math.round((img.width  || 1) * scale);
            canvas.height = Math.round((img.height || 1) * scale);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/png'));
          } catch (e) {
            reject(e);
          }
        };
        img.onerror = () => reject(new Error('Gagal memuat gambar: ' + url));
        img.src = url;
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout memuat gambar')), timeoutMs)
      ),
    ]);
  } catch (_) {
    return null;   // Gagal — kop tetap tampil tanpa logo
  }
}

// ── Gambar Kop Surat Resmi Indonesia ─────────────────────────
/**
 * Gambar kop surat resmi Indonesia dengan dua logo simetris.
 *
 * Layout:
 *   [Logo App]   NAMA SEKOLAH (bold, kapital)   [Logo Sekolah]
 *                Madrasah Tsanawiyah
 *                Alamat
 *   ═══════════════════════════════ (garis tebal)
 *   ─────────────────────────────── (garis tipis)
 *
 * Logo kiri  = logo aplikasi  (logo_app_url dari config)
 * Logo kanan = logo sekolah   (logo_url dari config)
 *
 * @param {jsPDF}        doc
 * @param {Object}       school        — { nama_sekolah, alamat_sekolah }
 * @param {number}       pageW
 * @param {string|null}  logoAppB64    — base64 PNG logo aplikasi atau null
 * @param {string|null}  logoSekolahB64 — base64 PNG logo sekolah atau null
 * @returns {number} Y setelah garis kop
 */
function _pdfDrawKop(doc, school, pageW, logoAppB64, logoSekolahB64) {
  const mL = _PDF.mL;
  const mR = _PDF.mR;
  const namaSekolah = school.nama_sekolah   || CONFIG.APP_NAME || 'Buku Tamu Digital';
  const alamat      = school.alamat_sekolah || '';
  const subNama     = 'Madrasah Tsanawiyah';

  // ── Ukuran logo ───────────────────────────────────────────────
  const logoH   = 18;                        // tinggi logo mm
  const logoY   = _PDF.mT;                   // posisi Y logo

  // ── Logo kiri — logo aplikasi ─────────────────────────────────
  if (logoAppB64) {
    try {
      doc.addImage(logoAppB64, 'PNG', mL, logoY, logoH, logoH, undefined, 'FAST');
    } catch (_) { /* gagal — lanjut tanpa logo */ }
  }

  // ── Logo kanan — logo sekolah ─────────────────────────────────
  if (logoSekolahB64) {
    try {
      doc.addImage(logoSekolahB64, 'PNG', pageW - mR - logoH, logoY, logoH, logoH, undefined, 'FAST');
    } catch (_) { /* gagal — lanjut tanpa logo */ }
  }

  // ── Area teks — di antara dua logo ───────────────────────────
  const gapLogo  = 4;   // jarak teks dari tepi logo
  const textPadL = (logoAppB64    ? mL + logoH + gapLogo : mL);
  const textPadR = (logoSekolahB64 ? mR + logoH + gapLogo : mR);
  const textX    = (textPadL + (pageW - textPadR)) / 2;
  const textMaxW = (pageW - textPadR) - textPadL;

  let y = _PDF.mT;

  // ── Nama instansi ──────────────────────────────────────────────
  doc.setFont(_PDF.font, 'bold');
  doc.setFontSize(14);
  doc.setTextColor(..._PDF.tintaHitam);
  doc.text(namaSekolah.toUpperCase(), textX, y + 6, { align: 'center', maxWidth: textMaxW });

  // ── Sub-nama institusi ─────────────────────────────────────────
  doc.setFont(_PDF.font, 'normal');
  doc.setFontSize(10);
  doc.text(subNama, textX, y + 12, { align: 'center' });

  // ── Alamat ─────────────────────────────────────────────────────
  if (alamat) {
    doc.setFontSize(8);
    doc.setTextColor(..._PDF.abu700);
    const baris = doc.splitTextToSize(alamat, textMaxW);
    const alamatTeks = baris.slice(0, 2).join('\n') + (baris.length > 2 ? ' ...' : '');
    doc.text(alamatTeks, textX, y + 18, { align: 'center', lineHeightFactor: 1.4 });
  }
  doc.setTextColor(..._PDF.tintaHitam);

  // ── Garis kop: tebal + tipis sejajar ─────────────────────────
  const garisY = alamat ? y + 25 : y + 19;
  doc.setDrawColor(..._PDF.tintaHitam);
  doc.setLineWidth(1.0);
  doc.line(mL, garisY, pageW - mR, garisY);
  doc.setLineWidth(0.3);
  doc.line(mL, garisY + 1.5, pageW - mR, garisY + 1.5);

  return garisY + 4;
}

/**
 * Gambar blok identitas laporan (judul + nomor + periode + filter).
 * Mengikuti konvensi surat dinas: judul di tengah, data pendukung rata kiri.
 *
 * @param {jsPDF}  doc
 * @param {Object} filter   — { dari, sampai, jenis }
 * @param {number} pageW
 * @param {string} nomorLaporan
 * @param {string} eksporWaktu   — "dd Bulan YYYY, HH:MM WIB"
 * @returns {number} Y setelah blok judul
 */
function _pdfDrawJudul(doc, filter, pageW, nomorLaporan, eksporWaktu) {
  const mL = _PDF.mL;
  const mR = _PDF.mR;
  let   y  = _pdfCurrentY;

  // ── Judul dokumen — terpusat ─────────────────────────────────
  doc.setFont(_PDF.font, 'bold');
  doc.setFontSize(12);
  doc.setTextColor(..._PDF.tintaHitam);
  doc.text('REKAPITULASI DATA KUNJUNGAN TAMU', pageW / 2, y, { align: 'center' });
  y += 5.5;

  // ── Periode — satu baris di bawah judul, rata tengah ─────────
  // Hanya ditampilkan di sini; tidak diulang di baris metadata.
  let periodeTeks = 'Semua Periode';
  if (filter.dari && filter.sampai) {
    periodeTeks = `${_pdfFormatTanggalPanjang(filter.dari)} s.d. ${_pdfFormatTanggalPanjang(filter.sampai)}`;
  } else if (filter.dari) {
    periodeTeks = `Mulai ${_pdfFormatTanggalPanjang(filter.dari)}`;
  } else if (filter.sampai) {
    periodeTeks = `Sampai ${_pdfFormatTanggalPanjang(filter.sampai)}`;
  }

  doc.setFont(_PDF.font, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(..._PDF.abu700);
  doc.text(periodeTeks, pageW / 2, y, { align: 'center' });
  y += 4.5;

  // ── Nomor laporan ─────────────────────────────────────────────
  doc.setFontSize(8);
  doc.text(`Nomor Laporan: ${nomorLaporan}`, pageW / 2, y, { align: 'center' });
  y += 5;

  // ── Garis tipis pemisah setelah judul ─────────────────────────
  doc.setDrawColor(..._PDF.abu300);
  doc.setLineWidth(0.3);
  doc.line(mL, y, pageW - mR, y);
  y += 3;

  // ── Baris metadata filter — hanya info yang BELUM ada di atas ─
  // Periode sudah tampil di atas; waktu cetak ada di footer setiap halaman.
  // Di sini hanya tampilkan: Jenis Tamu (jika difilter).
  doc.setFont(_PDF.font, 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(..._PDF.abu500);

  const filterParts = [];
  filterParts.push(`Jenis Tamu: ${filter.jenis || 'Semua Jenis'}`);

  doc.text(filterParts.join('   \u2022   '), mL, y);
  y += 4.5;

  // ── Garis tipis setelah metadata ──────────────────────────────
  doc.setDrawColor(..._PDF.abu300);
  doc.setLineWidth(0.2);
  doc.line(mL, y, pageW - mR, y);

  doc.setTextColor(..._PDF.tintaHitam);
  return y + 2;
}

/**
 * Gambar baris ringkasan statistik — format tabel teks sederhana
 * (bukan kotak warna-warni) sesuai estetika dokumen resmi.
 *
 * Layout: 4 kolom stat dalam 1 baris tipografi.
 *
 * @returns {number} Y setelah ringkasan
 */
function _pdfDrawRingkasan(doc, tamuList, exportData, pageW) {
  const mL         = _PDF.mL;
  const mR         = _PDF.mR;
  const usableW    = pageW - mL - mR;
  const totalSesi  = exportData.total         ?? tamuList.length;
  const totalInd   = exportData.totalIndividu  ?? tamuList.length;
  const totalRomb  = tamuList.filter(t => t.isRombongan).length;
  const masihHadir = tamuList.filter(t => t.status === 'Hadir').length;

  let y = _pdfCurrentY;

  // Latar kotak ringkasan — putih dengan border tipis
  const boxH = 14;
  doc.setFillColor(..._PDF.abu50);
  doc.setDrawColor(..._PDF.abu300);
  doc.setLineWidth(0.3);
  doc.rect(mL, y, usableW, boxH, 'FD');

  // Garis kiri aksen biru
  doc.setFillColor(..._PDF.biru);
  doc.rect(mL, y, 2, boxH, 'F');

  // Label "Ringkasan" di kiri dalam kotak
  doc.setFont(_PDF.font, 'bold');
  doc.setFontSize(7);
  doc.setTextColor(..._PDF.biruTua);
  doc.text('RINGKASAN', mL + 5, y + 5);

  // 4 stat diletakkan secara merata dalam satu baris
  const stats = [
    { label: 'Total Kunjungan (Sesi)', value: String(totalSesi)  },
    { label: 'Total Individu (Orang)', value: String(totalInd)   },
    { label: 'Rombongan (>= 2 Orang)', value: String(totalRomb)  },
    { label: 'Masih Berada di Lokasi', value: String(masihHadir) },
  ];

  const statColW  = (usableW - 40) / 4;   // 40mm untuk label "RINGKASAN"
  const statBaseX = mL + 40;

  stats.forEach((s, i) => {
    const x = statBaseX + i * statColW + statColW / 2;

    // Nilai angka (bold)
    doc.setFont(_PDF.font, 'bold');
    doc.setFontSize(11);
    doc.setTextColor(..._PDF.biruTua);
    doc.text(s.value, x, y + 6.5, { align: 'center' });

    // Label kecil di bawah angka
    doc.setFont(_PDF.font, 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(..._PDF.abu700);
    doc.text(s.label, x, y + 11.5, { align: 'center' });

    // Garis pemisah antar kolom stat (kecuali setelah kolom terakhir)
    if (i < 3) {
      doc.setDrawColor(..._PDF.abu300);
      doc.setLineWidth(0.2);
      doc.line(statBaseX + (i + 1) * statColW, y + 2, statBaseX + (i + 1) * statColW, y + 12);
    }
  });

  doc.setTextColor(..._PDF.tintaHitam);
  return y + boxH + 4;
}

/**
 * Tambahkan mini-header identitas + footer halaman ke setiap halaman.
 * Dipanggil SETELAH autoTable agar nomor total halaman sudah diketahui.
 *
 * Standar surat resmi: setiap halaman lanjutan memuat identitas singkat
 * institusi agar dokumen tetap teridentifikasi jika tercecer.
 */
function _pdfAddHeaderFooterAllPages(doc, school, filter, eksporWaktu, nomorLaporan) {
  const pageW   = _PDF.pageW;
  const pageH   = _PDF.pageH;
  const totalPg = doc.internal.getNumberOfPages();
  const mL      = _PDF.mL;
  const mR      = _PDF.mR;
  const namaS   = school.nama_sekolah || CONFIG.APP_NAME || 'Buku Tamu Digital';

  for (let pg = 1; pg <= totalPg; pg++) {
    doc.setPage(pg);

    // ── Mini-header identitas (halaman 2+) ────────────────────
    if (pg > 1) {
      // Garis atas tipis + teks identitas singkat
      doc.setDrawColor(..._PDF.tintaHitam);
      doc.setLineWidth(0.6);
      doc.line(mL, _PDF.mT, pageW - mR, _PDF.mT);
      doc.setLineWidth(0.2);
      doc.line(mL, _PDF.mT + 1.5, pageW - mR, _PDF.mT + 1.5);

      doc.setFont(_PDF.font, 'bold');
      doc.setFontSize(8);
      doc.setTextColor(..._PDF.tintaHitam);
      doc.text(namaS.toUpperCase(), mL, _PDF.mT + 7);

      // Nomor laporan di kanan mini-header — tidak mengulang periode
      // (periode sudah ada di halaman 1 pada bagian judul)
      doc.setFont(_PDF.font, 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(..._PDF.abu700);
      doc.text(`No. Laporan: ${nomorLaporan}`, pageW - mR, _PDF.mT + 7, { align: 'right' });

      doc.setFontSize(7.5);
      doc.text('Rekapitulasi Data Kunjungan Tamu', mL, _PDF.mT + 12);
    }

    // ── Footer setiap halaman ─────────────────────────────────
    // Garis footer: tebal + tipis (mirroring kop)
    doc.setDrawColor(..._PDF.tintaHitam);
    doc.setLineWidth(0.6);
    doc.line(mL, pageH - _PDF.mB, pageW - mR, pageH - _PDF.mB);
    doc.setLineWidth(0.2);
    doc.line(mL, pageH - _PDF.mB + 1.5, pageW - mR, pageH - _PDF.mB + 1.5);

    // Kiri footer: nomor laporan
    doc.setFont(_PDF.font, 'normal');
    doc.setFontSize(7);
    doc.setTextColor(..._PDF.abu500);
    doc.text(`No. Laporan: ${nomorLaporan}  |  Dicetak: ${eksporWaktu}`, mL, pageH - _PDF.mB + 5);

    // Kanan footer: nomor halaman
    doc.setFont(_PDF.font, 'bold');
    doc.setFontSize(7);
    doc.setTextColor(..._PDF.abu700);
    doc.text(`Halaman ${pg} dari ${totalPg}`, pageW - mR, pageH - _PDF.mB + 5, { align: 'right' });
  }
}

/**
 * Gambar blok tanda tangan pada halaman terakhir.
 *
 * Mengikuti tata letak surat dinas Indonesia:
 *  - Kiri:  ruang kosong (pihak pertama / Kepala Madrasah)
 *  - Kanan: tempat, tanggal cetak + jabatan Petugas/Admin
 *
 * Format standar:
 *   [kota], [tanggal panjang]
 *
 *   [jabatan],
 *
 *   (tanda tangan)
 *
 *   [nama]
 *   NIP / NIP (jika ada)
 */
function _pdfDrawTandaTangan(doc, school, eksporWaktu, startY) {
  const pageW   = _PDF.pageW;
  const pageH   = _PDF.pageH;
  const mL      = _PDF.mL;
  const mR      = _PDF.mR;
  const footerH = _PDF.mB + 8;
  const ttdH    = 52;

  // Jika tidak cukup ruang di halaman ini, tambah halaman baru
  if (startY + ttdH > pageH - footerH) {
    doc.addPage();
    startY = _PDF.mT + 18;  // halaman baru — mulai setelah mini-header
  }

  let y = startY + 2;

  // ── Garis pemisah atas ────────────────────────────────────────
  doc.setDrawColor(..._PDF.abu300);
  doc.setLineWidth(0.3);
  doc.line(mL, y, pageW - mR, y);
  y += 6;

  // ── Heading "Mengetahui," — rata kiri (konvensi surat dinas) ──
  doc.setFont(_PDF.font, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(..._PDF.tintaHitam);
  doc.text('Mengetahui,', mL, y);
  y += 5;

  // ── Posisi dua kolom ─────────────────────────────────────────
  // Kiri:  Kepala Madrasah (mengetahui / menyetujui)
  // Kanan: Petugas/Admin yang mencetak (di sisi kanan, dengan tanggal)
  const colKiriX  = mL + 30;         // titik tengah kolom kiri
  const colKananX = pageW - mR - 35; // titik tengah kolom kanan

  // ── Kolom KANAN dulu: tempat + tanggal (standar surat dinas) ──
  // Ambil tanggal dari eksporWaktu (sudah format "dd Bulan YYYY, HH:MM WIB")
  // Untuk surat resmi, tampilkan hanya tanggal (bukan jam)
  const tanggalCetak = eksporWaktu.split(',')[0] || eksporWaktu;

  doc.setFont(_PDF.font, 'normal');
  doc.setFontSize(9);
  doc.text(tanggalCetak, colKananX, y, { align: 'center' });
  y += 5;

  // ── Jabatan kedua pihak ───────────────────────────────────────
  const kepalaSekolah = school.kepala_sekolah || '';
  const jabatan1 = 'Kepala Madrasah,';
  const jabatan2 = 'Petugas/Admin,';

  doc.setFont(_PDF.font, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(..._PDF.tintaHitam);
  doc.text(jabatan1, colKiriX, y, { align: 'center' });
  doc.text(jabatan2, colKananX, y, { align: 'center' });
  y += 18;   // ruang tanda tangan ≈ 1.8 cm

  // ── Nama (garis bawah jika kosong) ────────────────────────────
  if (kepalaSekolah) {
    // Nama kepala sekolah dari config (bold, tanda kurung konvensi surat)
    doc.setFont(_PDF.font, 'bold');
    doc.setFontSize(9);
    doc.text(kepalaSekolah, colKiriX, y, { align: 'center' });
  } else {
    // Garis nama kosong
    doc.setDrawColor(..._PDF.tintaHitam);
    doc.setLineWidth(0.4);
    doc.line(colKiriX - 35, y, colKiriX + 35, y);
  }

  // Kolom kanan — nama kosong untuk admin
  doc.setDrawColor(..._PDF.tintaHitam);
  doc.setLineWidth(0.4);
  doc.line(colKananX - 30, y, colKananX + 30, y);
  y += 4;

  // ── Catatan kaki dokumen ──────────────────────────────────────
  doc.setFont(_PDF.font, 'normal');
  doc.setFontSize(7);
  doc.setTextColor(..._PDF.abu500);
  const catatan = 'Dokumen ini dicetak secara otomatis oleh sistem Buku Tamu Digital dan sah sebagai arsip administratif.';
  const catatanLines = doc.splitTextToSize(catatan, pageW - mL - mR);
  doc.text(catatanLines, pageW / 2, y + 6, { align: 'center' });
}

// Variabel modul-level untuk meneruskan posisi Y antar fungsi
let _pdfCurrentY = 0;

/**
 * Fungsi utama — generate dan download PDF Rekap Tamu.
 *
 * Struktur dokumen:
 *  1. Halaman 1:
 *     a. Kop surat resmi (nama, alamat, dua garis)
 *     b. Judul + nomor laporan + periode
 *     c. Ringkasan statistik
 *     d. Tabel rekap (bisa berlanjut ke halaman berikutnya)
 *  2. Halaman lanjutan:
 *     a. Mini-header identitas (dua garis + nama institusi)
 *     b. Lanjutan tabel
 *  3. Halaman terakhir:
 *     a. Blok tanda tangan (mengetahui / petugas)
 *  4. Setiap halaman: footer (nomor laporan, waktu cetak, nomor halaman)
 *
 * @param {Array}  tamuList    — data dari exportData.tamu
 * @param {Object} exportData  — { total, totalIndividu, dari, sampai }
 * @param {Object} school      — konfigurasi sekolah dari getConfig
 * @param {Object} filter      — { dari, sampai, jenis }
 */
async function generateRekapPDF(tamuList, exportData, school, filter) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error('Library jsPDF belum dimuat. Periksa koneksi internet.');
  }

  const { jsPDF } = window.jspdf;

  // ── Init dokumen A4 Landscape ──────────────────────────────
  const doc = new jsPDF({
    orientation : 'landscape',
    unit        : 'mm',
    format      : 'a4',
    compress    : true,
  });

  const pageW = _PDF.pageW;
  const pageH = _PDF.pageH;
  const mL    = _PDF.mL;
  const mR    = _PDF.mR;
  const mB    = _PDF.mB;

  // ── Metadata PDF ──────────────────────────────────────────
  const namaSekolah = school.nama_sekolah || CONFIG.APP_NAME || 'Buku Tamu Digital';
  doc.setProperties({
    title   : `Rekapitulasi Tamu — ${namaSekolah}`,
    subject : 'Rekapitulasi Data Kunjungan Tamu',
    author  : namaSekolah,
    creator : 'Buku Tamu Digital',
  });

  // ── Waktu ekspor WIB ──────────────────────────────────────
  const now       = new Date();
  const utcMs     = now.getTime() + now.getTimezoneOffset() * 60000;
  const wibDate   = new Date(utcMs + 7 * 60 * 60000);
  const dd        = String(wibDate.getDate()).padStart(2, '0');
  const hh        = String(wibDate.getHours()).padStart(2, '0');
  const mn        = String(wibDate.getMinutes()).padStart(2, '0');
  const eksporWaktu   = `${parseInt(dd,10)} ${_PDF_BULAN[wibDate.getMonth()]} ${wibDate.getFullYear()}, ${hh}:${mn} WIB`;
  const nomorLaporan  = _pdfNomorLaporan(wibDate);

  // ── Muat logo secara paralel (timeout 5 detik masing-masing) ──
  // logo_app_url = logo aplikasi (kiri kop)
  // logo_url     = logo sekolah  (kanan kop)
  // Kedua proses dijalankan bersamaan; jika gagal nilai null = kop tanpa logo.
  const [logoAppB64, logoSekolahB64] = await Promise.all([
    _pdfLoadImageAsBase64(school.logo_app_url || ''),
    _pdfLoadImageAsBase64(school.logo_url     || ''),
  ]);

  // ── 1. Kop surat ──────────────────────────────────────────
  let y = _pdfDrawKop(doc, school, pageW, logoAppB64, logoSekolahB64);
  y += 3;

  // ── 2. Judul + ringkasan metadata ─────────────────────────
  _pdfCurrentY = y;
  y = _pdfDrawJudul(doc, filter, pageW, nomorLaporan, eksporWaktu);
  y += 2;

  // ── 3. Ringkasan statistik ────────────────────────────────
  _pdfCurrentY = y;
  y = _pdfDrawRingkasan(doc, tamuList, exportData, pageW);

  // ── 4. Persiapan body tabel ───────────────────────────────
  // 1 sesi = 1 baris. Rombongan: nama semua anggota dipisah newline
  // dalam satu sel — memastikan tidak ada inflasi jumlah baris.
  let nomor = 1;
  const tableBody = tamuList.map(t => {
    const anggota = Array.isArray(t.dataAnggota) && t.dataAnggota.length > 0
      ? t.dataAnggota
      : [{ namaLengkap: t.namaLengkap || '—', jabatan: '' }];

    let namaCell;
    if (t.isRombongan) {
      const daftar = anggota.map((a, i) => {
        const jab = a.jabatan ? ` (${a.jabatan})` : '';
        return `${i + 1}. ${a.namaLengkap || '—'}${jab}`;
      }).join('\n');
      namaCell = `[Rombongan ${t.jumlahTamu} org]\n${daftar}`;
    } else {
      namaCell = anggota[0]?.namaLengkap || t.namaLengkap || '—';
    }

    const v = val => (val && String(val).trim()) ? String(val).trim() : '—';

    return [
      nomor++,
      v(t.tanggal ? _pdfFormatTanggalPanjang(t.tanggal) : ''),
      namaCell,
      v(t.jenisTamu),
      v(t.instansi),
      v(t.keperluan),
      v(t.bertemuDengan),
      v(t.jamDatang),
      t.jamPulang ? v(t.jamPulang) : '—',
      t.status || '—',
    ];
  });

  // ── 5. Render tabel autoTable ─────────────────────────────
  // Kolom total ≈ 257 mm (pageW 297 - mL 20 - mR 15 = 262, jsPDF sedikit berbeda)
  doc.autoTable({
    startY      : y,
    margin      : { left: mL, right: mR, bottom: mB + 10 },
    showHead    : 'everyPage',
    head        : [[
      'No.', 'Tanggal', 'Nama / Tamu', 'Jenis Tamu',
      'Instansi / Asal /\nTahun Lulus', 'Keperluan', 'Bertemu Dengan',
      'Jam\nDatang', 'Jam\nPulang', 'Status',
    ]],
    body        : tableBody,
    // ── Lebar kolom — total harus ≤ usableW (pageW 297 - mL 20 - mR 15 = 262 mm)
    // Pembagian: 8+26+48+24+34+42+32+14+14+18 = 260 mm (sisa 2 mm untuk padding)
    columnStyles: {
      0 : { cellWidth: 8,  halign: 'center' },   // No.
      1 : { cellWidth: 26 },                     // Tanggal
      2 : { cellWidth: 48 },                     // Nama (multi-line rombongan)
      3 : { cellWidth: 24 },                     // Jenis Tamu
      4 : { cellWidth: 34 },                     // Instansi / Asal / Tahun Lulus
      5 : { cellWidth: 42 },                     // Keperluan
      6 : { cellWidth: 32 },                     // Bertemu Dengan
      7 : { cellWidth: 14, halign: 'center' },   // Jam Datang
      8 : { cellWidth: 14, halign: 'center' },   // Jam Pulang
      9 : { cellWidth: 18, halign: 'center' },   // Status
    },
    styles: {
      font          : _PDF.font,
      fontSize      : 8,
      cellPadding   : { top: 2.5, right: 3, bottom: 2.5, left: 3 },
      textColor     : _PDF.tintaHitam,
      overflow      : 'linebreak',
      lineColor     : _PDF.abu300,
      lineWidth     : 0.2,
      minCellHeight : 8,
    },
    headStyles: {
      fillColor   : _PDF.biruTua,
      textColor   : _PDF.putih,
      fontStyle   : 'bold',
      fontSize    : 7.5,
      cellPadding : { top: 3, right: 3, bottom: 3, left: 3 },
      halign      : 'center',
    },
    alternateRowStyles: {
      fillColor: _PDF.abu50,   // abu sangat terang — terbaca di grayscale
    },
    bodyStyles: {
      fillColor: _PDF.putih,
    },
    didParseCell(data) {
      // Kolom Status — teks berwarna sesuai nilai
      if (data.section === 'body' && data.column.index === 9) {
        const val = String(data.cell.raw || '');
        if (val === 'Hadir') {
          data.cell.styles.textColor = _PDF.hijauTua;
          data.cell.styles.fontStyle = 'bold';
        } else if (val === 'Pulang') {
          data.cell.styles.textColor = _PDF.abu500;
        }
      }
      // Kolom Nama — baris rombongan: ukuran font sedikit lebih kecil
      if (data.section === 'body' && data.column.index === 2) {
        if (String(data.cell.raw || '').startsWith('[Rombongan')) {
          data.cell.styles.fontSize = 7.5;
        }
      }
    },
    // didDrawPage kosong — header/footer ditangani oleh _pdfAddHeaderFooterAllPages
    didDrawPage() {},
  });

  // ── 6. Blok tanda tangan di halaman terakhir ──────────────
  const finalY = doc.lastAutoTable.finalY || pageH - mB - 12;
  _pdfDrawTandaTangan(doc, school, eksporWaktu, finalY + 5);

  // ── 7. Header + footer ke semua halaman ───────────────────
  _pdfAddHeaderFooterAllPages(doc, school, filter, eksporWaktu, nomorLaporan);

  // ── 8. Simpan ─────────────────────────────────────────────
  const namaFile = _pdfNamaFile(namaSekolah, filter.dari, filter.sampai);
  doc.save(namaFile);
}

// ══════════════════════════════════════════════════════════════
// TAB: MANAJEMEN STAF
// ══════════════════════════════════════════════════════════════

function attachStafEvents() {
  document.getElementById('btn-tambah-staf')?.addEventListener('click', () => openStafForm(null));
  document.getElementById('btn-cancel-staf')?.addEventListener('click', closeStafForm);
  document.getElementById('staf-form')?.addEventListener('submit', handleStafSubmit);

  const stafList = document.getElementById('staf-list');
  if (stafList) {
    stafList.addEventListener('click', e => {
      const editBtn   = e.target.closest('.staf-edit-btn');
      const toggleBtn = e.target.closest('.staf-toggle-btn');
      if (editBtn)   openStafForm(editBtn.dataset.id);
      else if (toggleBtn) toggleStaf(toggleBtn.dataset.id);
    });
  }
}

async function loadStaf() {
  // FIX A1: try/catch
  let result;
  try {
    result = await callGAS('getAllStaf', { token: getToken() });
  } catch (_) {
    showToast('Gagal memuat staf. Periksa koneksi.', 'danger');
    return;
  }

  if (result.status !== 'ok') {
    showToast('Gagal memuat staf: ' + (result.message || 'Error'), 'danger');
    return;
  }

  allStaf = result.data || [];
  renderStafList(allStaf);
}

function renderStafList(stafList) {
  const listEl  = document.getElementById('staf-list');
  const emptyEl = document.getElementById('staf-empty');
  if (!listEl) return;

  if (stafList.length === 0) {
    listEl.innerHTML  = '';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  listEl.innerHTML = stafList.map(s => `
    <div class="staf-card ${s.aktif ? '' : 'inactive'}" role="listitem" data-id="${escapeHtml(s.id)}">
      <div class="staf-card__avatar" aria-hidden="true">
        ${escapeHtml(s.nama.charAt(0).toUpperCase())}
      </div>
      <div class="staf-card__info">
        <div class="staf-card__name">${escapeHtml(s.nama)}</div>
        <div class="staf-card__jabatan">${escapeHtml(s.jabatan)}</div>
        ${!s.aktif ? '<span class="badge badge--gray" style="margin-top:4px;">Nonaktif</span>' : ''}
      </div>
      <div class="staf-card__actions">
        <button class="btn btn--secondary btn--sm staf-edit-btn"
                data-id="${escapeHtml(s.id)}"
                aria-label="Edit ${escapeHtml(s.nama)}">
          ${_icon('pencil','0.85rem')}
        </button>
        <button class="btn btn--sm staf-toggle-btn ${s.aktif ? 'btn--outline' : 'btn--success'}"
                data-id="${escapeHtml(s.id)}"
                aria-label="${s.aktif ? 'Nonaktifkan' : 'Aktifkan'} ${escapeHtml(s.nama)}">
          ${s.aktif ? _icon('toggle-right','1rem') : _icon('toggle-left','1rem')}
        </button>
      </div>
    </div>`).join('');
}

function openStafForm(stafId) {
  editingStafId = stafId;
  const formCard  = document.getElementById('staf-form-card');
  const formTitle = document.getElementById('staf-form-title');
  const idInput   = document.getElementById('staf-id');
  const namaInput = document.getElementById('staf-nama');
  const jabInput  = document.getElementById('staf-jabatan');
  const btnTambah = document.getElementById('btn-tambah-staf');

  if (stafId) {
    const staf = allStaf.find(s => s.id === stafId);
    if (!staf) return;
    if (formTitle) formTitle.textContent = `Edit Staf: ${staf.nama}`;
    if (idInput)   idInput.value   = staf.id;
    if (namaInput) namaInput.value = staf.nama;
    if (jabInput)  jabInput.value  = staf.jabatan;
  } else {
    if (formTitle) formTitle.textContent = 'Tambah Staf Baru';
    if (idInput)   idInput.value   = '';
    if (namaInput) namaInput.value = '';
    if (jabInput)  jabInput.value  = '';
  }

  if (formCard)  { formCard.classList.add('visible'); formCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  if (btnTambah) btnTambah.setAttribute('aria-expanded', 'true');
  namaInput?.focus();
}

function closeStafForm() {
  editingStafId = null;
  _isStafSubmitting = false;
  const formCard  = document.getElementById('staf-form-card');
  const btnTambah = document.getElementById('btn-tambah-staf');
  if (formCard)  formCard.classList.remove('visible');
  if (btnTambah) btnTambah.setAttribute('aria-expanded', 'false');
  document.getElementById('staf-form')?.reset();
}

async function handleStafSubmit(e) {
  e.preventDefault();
  // IMPROVE: double-submit guard
  if (_isStafSubmitting) return;

  const btn     = document.getElementById('btn-save-staf');
  const nama    = document.getElementById('staf-nama')?.value.trim()    || '';
  const jabatan = document.getElementById('staf-jabatan')?.value.trim() || '';

  if (!nama || !jabatan) {
    showToast('Nama dan jabatan wajib diisi.', 'danger');
    return;
  }

  _isStafSubmitting = true;
  if (btn) setButtonLoading(btn);

  let result;
  try {
    result = editingStafId
      ? await callGAS('updateStaf', { token: getToken(), id: editingStafId, nama, jabatan })
      : await callGAS('addStaf',    { token: getToken(), nama, jabatan });
  } catch (_) {
    result = { status: 'error', message: 'Koneksi gagal.' };
  }

  if (btn) resetButtonLoading(btn, false);
  _isStafSubmitting = false;

  if (result.status === 'ok') {
    showToast(result.message || 'Staf berhasil disimpan.', 'success');
    closeStafForm();
    await loadStaf();
  } else {
    showToast(result.message || 'Gagal menyimpan staf.', 'danger');
  }
}

/**
 * FIX A3: Ganti confirm() blocking dengan toast konfirmasi dua langkah.
 * Klik pertama → tampilkan toast konfirmasi.
 * Klik kedua (dalam 4 detik) → eksekusi.
 */
const _pendingToggle = new Map(); // Map<stafId, timeoutId>

async function toggleStaf(stafId) {
  const staf = allStaf.find(s => s.id === stafId);
  if (!staf) return;

  // Jika sudah ada pending konfirmasi, eksekusi langsung
  if (_pendingToggle.has(stafId)) {
    clearTimeout(_pendingToggle.get(stafId));
    _pendingToggle.delete(stafId);
    await _doToggleStaf(stafId, staf);
    return;
  }

  // Tunjukkan toast konfirmasi
  const label = staf.aktif ? 'Nonaktifkan' : 'Aktifkan';
  showToast(`Klik lagi untuk ${label.toLowerCase()} "${staf.nama}".`, 'default', 4000);

  const tid = setTimeout(() => _pendingToggle.delete(stafId), 4000);
  _pendingToggle.set(stafId, tid);
}

async function _doToggleStaf(stafId, staf) {
  let result;
  try {
    result = await callGAS('toggleStafAktif', { token: getToken(), id: stafId });
  } catch (_) {
    result = { status: 'error', message: 'Koneksi gagal.' };
  }

  if (result.status === 'ok') {
    showToast(result.message || 'Status staf diperbarui.', 'success');
    await loadStaf();
  } else {
    showToast(result.message || 'Gagal mengubah status staf.', 'danger');
  }
}

// ══════════════════════════════════════════════════════════════
// TAB: MANAJEMEN SISWA
// ══════════════════════════════════════════════════════════════

let allSiswa        = [];
let editingSiswaId  = null;
let _siswaSearchVal = '';

function attachSiswaEvents() {
  document.getElementById('btn-tambah-siswa')?.addEventListener('click', () => openSiswaForm(null));
  document.getElementById('btn-cancel-siswa')?.addEventListener('click', closeSiswaForm);
  document.getElementById('siswa-form')?.addEventListener('submit', handleSiswaSubmit);

  const siswaListEl = document.getElementById('siswa-list');
  if (siswaListEl) {
    siswaListEl.addEventListener('click', e => {
      const editBtn   = e.target.closest('.siswa-edit-btn');
      const toggleBtn = e.target.closest('.siswa-toggle-btn');
      if (editBtn)   openSiswaForm(editBtn.dataset.id);
      else if (toggleBtn) toggleSiswa(toggleBtn.dataset.id);
    });
  }

  const searchEl = document.getElementById('siswa-search');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      _siswaSearchVal = searchEl.value.trim().toLowerCase();
      _renderFilteredSiswa();
    });
  }
}

async function loadSiswa() {
  // FIX A1: try/catch
  let result;
  try {
    result = await callGAS('getAllSiswa', { token: getToken() });
  } catch (_) {
    showToast('Gagal memuat siswa. Periksa koneksi.', 'danger');
    return;
  }

  if (result.status !== 'ok') {
    showToast('Gagal memuat siswa: ' + (result.message || 'Error'), 'danger');
    return;
  }

  allSiswa = result.data || [];
  _renderFilteredSiswa();
}

function _renderFilteredSiswa() {
  const filtered = _siswaSearchVal
    ? allSiswa.filter(s =>
        s.namaLengkap.toLowerCase().includes(_siswaSearchVal) ||
        s.kelas.toLowerCase().includes(_siswaSearchVal))
    : allSiswa;
  renderSiswaList(filtered);
}

function renderSiswaList(list) {
  const listEl  = document.getElementById('siswa-list');
  const emptyEl = document.getElementById('siswa-empty');
  if (!listEl) return;

  if (list.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  listEl.innerHTML = list.map(s => `
    <div class="staf-card ${s.aktif ? '' : 'inactive'}" role="listitem" data-id="${escapeHtml(s.id)}">
      <div class="staf-card__avatar" aria-hidden="true">
        ${escapeHtml((s.namaLengkap || '?').charAt(0).toUpperCase())}
      </div>
      <div class="staf-card__info">
        <div class="staf-card__name">${escapeHtml(s.namaLengkap)}</div>
        <div class="staf-card__jabatan">Kelas ${escapeHtml(s.kelas)}</div>
        ${!s.aktif ? '<span class="badge badge--gray" style="margin-top:4px;">Nonaktif</span>' : ''}
      </div>
      <div class="staf-card__actions">
        <button class="btn btn--secondary btn--sm siswa-edit-btn"
                data-id="${escapeHtml(s.id)}"
                aria-label="Edit ${escapeHtml(s.namaLengkap)}">
          ${_icon('pencil','0.85rem')}
        </button>
        <button class="btn btn--sm siswa-toggle-btn ${s.aktif ? 'btn--outline' : 'btn--success'}"
                data-id="${escapeHtml(s.id)}"
                aria-label="${s.aktif ? 'Nonaktifkan' : 'Aktifkan'} ${escapeHtml(s.namaLengkap)}">
          ${s.aktif ? _icon('toggle-right','1rem') : _icon('toggle-left','1rem')}
        </button>
      </div>
    </div>`).join('');
}

function openSiswaForm(siswaId) {
  editingSiswaId = siswaId;
  const formCard   = document.getElementById('siswa-form-card');
  const formTitle  = document.getElementById('siswa-form-title');
  const idInput    = document.getElementById('siswa-id');
  const namaInput  = document.getElementById('siswa-nama');
  const kelasInput = document.getElementById('siswa-kelas');
  const btnTambah  = document.getElementById('btn-tambah-siswa');

  if (siswaId) {
    const siswa = allSiswa.find(s => s.id === siswaId);
    if (!siswa) return;
    if (formTitle)  formTitle.textContent = `Edit Siswa: ${siswa.namaLengkap}`;
    if (idInput)    idInput.value    = siswa.id;
    if (namaInput)  namaInput.value  = siswa.namaLengkap;
    if (kelasInput) kelasInput.value = siswa.kelas;
  } else {
    if (formTitle)  formTitle.textContent = 'Tambah Siswa Baru';
    if (idInput)    idInput.value    = '';
    if (namaInput)  namaInput.value  = '';
    if (kelasInput) kelasInput.value = '';
  }

  if (formCard)  { formCard.classList.add('visible'); formCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  if (btnTambah) btnTambah.setAttribute('aria-expanded', 'true');
  namaInput?.focus();
}

function closeSiswaForm() {
  editingSiswaId = null;
  _isSiswaSubmitting = false;
  const formCard  = document.getElementById('siswa-form-card');
  const btnTambah = document.getElementById('btn-tambah-siswa');
  if (formCard)  formCard.classList.remove('visible');
  if (btnTambah) btnTambah.setAttribute('aria-expanded', 'false');
  document.getElementById('siswa-form')?.reset();
}

async function handleSiswaSubmit(e) {
  e.preventDefault();
  if (_isSiswaSubmitting) return;

  const btn    = document.getElementById('btn-save-siswa');
  const nama   = document.getElementById('siswa-nama')?.value.trim()  || '';
  const kelas  = document.getElementById('siswa-kelas')?.value.trim() || '';

  if (!nama || !kelas) {
    showToast('Nama lengkap dan kelas wajib diisi.', 'danger');
    return;
  }

  _isSiswaSubmitting = true;
  if (btn) setButtonLoading(btn);

  let result;
  try {
    result = editingSiswaId
      ? await callGAS('updateSiswa', { token: getToken(), id: editingSiswaId, namaLengkap: nama, kelas })
      : await callGAS('addSiswa',    { token: getToken(), namaLengkap: nama, kelas });
  } catch (_) {
    result = { status: 'error', message: 'Koneksi gagal.' };
  }

  if (btn) resetButtonLoading(btn, false);
  _isSiswaSubmitting = false;

  if (result.status === 'ok') {
    showToast(result.message || 'Siswa berhasil disimpan.', 'success');
    closeSiswaForm();
    await loadSiswa();
  } else {
    showToast(result.message || 'Gagal menyimpan siswa.', 'danger');
  }
}

/** FIX A3: Sama dengan toggleStaf — ganti confirm() dengan toast dua langkah */
const _pendingToggleSiswa = new Map();

async function toggleSiswa(siswaId) {
  const siswa = allSiswa.find(s => s.id === siswaId);
  if (!siswa) return;

  if (_pendingToggleSiswa.has(siswaId)) {
    clearTimeout(_pendingToggleSiswa.get(siswaId));
    _pendingToggleSiswa.delete(siswaId);
    await _doToggleSiswa(siswaId, siswa);
    return;
  }

  const label = siswa.aktif ? 'Nonaktifkan' : 'Aktifkan';
  showToast(`Klik lagi untuk ${label.toLowerCase()} "${siswa.namaLengkap}".`, 'default', 4000);
  const tid = setTimeout(() => _pendingToggleSiswa.delete(siswaId), 4000);
  _pendingToggleSiswa.set(siswaId, tid);
}

async function _doToggleSiswa(siswaId) {
  let result;
  try {
    result = await callGAS('toggleSiswaAktif', { token: getToken(), id: siswaId });
  } catch (_) {
    result = { status: 'error', message: 'Koneksi gagal.' };
  }

  if (result.status === 'ok') {
    showToast(result.message || 'Status siswa diperbarui.', 'success');
    await loadSiswa();
  } else {
    showToast(result.message || 'Gagal mengubah status siswa.', 'danger');
  }
}

// ══════════════════════════════════════════════════════════════
// NOTIFIKASI IN-APP (polling)
// ══════════════════════════════════════════════════════════════

function startNotifPolling() {
  if (notifTimer) clearInterval(notifTimer);
  // FIX A12: simpan referensi interval untuk dibersihkan di beforeunload
  notifTimer = setInterval(checkNotif, CONFIG.NOTIF_INTERVAL);
}

async function checkNotif() {
  // FIX A12: guard — hentikan jika token sudah tidak ada
  if (!getToken()) {
    clearInterval(notifTimer);
    notifTimer = null;
    return;
  }

  let result;
  try {
    result = await callGAS('getTamuAktif', { token: getToken() });
  } catch (_) {
    return; // Koneksi gagal — coba lagi pada interval berikutnya
  }

  if (!result || result.status !== 'ok') return;

  const count   = (result.data.tamu || []).length;
  const countEl = document.getElementById('notif-count');

  if (lastNotifCount >= 0 && count > lastNotifCount) {
    const diff = count - lastNotifCount;
    if (countEl) { countEl.textContent = diff; countEl.style.display = ''; }

    const banner = document.getElementById('notif-banner');
    if (banner) {
      banner.textContent = `Ada ${diff} tamu baru masuk. Klik untuk melihat di tab Rekap.`;
      banner.classList.add('visible');
    }
  }

  lastNotifCount = count;
}

// ── Modal & Keyboard Events ────────────────────────────────────
function attachModalEvents() {
  document.getElementById('btn-close-detail')?.addEventListener('click', closeRekapDetail);

  // ▶▶ SECURITY: tombol refresh audit log
  document.getElementById('btn-refresh-auditlog')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh-auditlog');
    if (btn) setButtonLoading(btn);
    await loadAuditLog();
    if (btn) resetButtonLoading(btn, false);
  });

  const modalDetail = document.getElementById('modal-detail');
  if (modalDetail) {
    modalDetail.addEventListener('click', e => {
      if (e.target === modalDetail) closeRekapDetail();
    });
  }

  const notifBanner = document.getElementById('notif-banner');
  if (notifBanner) {
    const handleBannerActivate = async () => {
      notifBanner.classList.remove('visible');
      const countEl = document.getElementById('notif-count');
      if (countEl) countEl.style.display = 'none';
      await switchTab('rekap');
    };
    notifBanner.addEventListener('click', handleBannerActivate);
    notifBanner.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        await handleBannerActivate();
      }
    });
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('modal-detail');
      if (modal?.classList.contains('active')) closeRekapDetail();
    }
  });
}

// ══════════════════════════════════════════════════════════════
// TAB: PENGATURAN SEKOLAH
// ══════════════════════════════════════════════════════════════

let _pengaturanInitialized = false;

async function loadPengaturan() {
  let config = {};
  try {
    const result = await callGAS('getConfig');
    if (result?.status === 'ok' && result.data) {
      config = result.data;
    } else {
      console.warn('loadPengaturan: gagal fetch config, form akan kosong.');
    }
  } catch (_) {
    console.warn('loadPengaturan: koneksi gagal, form akan kosong.');
  }

  _setVal('set-nama-sekolah',   config.nama_sekolah    || '');
  _setVal('set-kepala-sekolah', config.kepala_sekolah  || '');
  _setVal('set-alamat',         config.alamat_sekolah  || '');
  _setVal('set-tahun-ajaran',   config.tahun_ajaran    || '');
  _setVal('set-logo-url',       config.logo_url        || '');
  _setVal('set-logo-app-url',   config.logo_app_url    || '');

  _applyLogoPreview('sekolah', config.logo_url     || '');
  _applyLogoPreview('app',     config.logo_app_url || '');
  _updatePreviewHeader(config);

  if (!_pengaturanInitialized) {
    _initPengaturanEvents();
    _pengaturanInitialized = true;
  }

  // ▶▶ EMAIL NOTIF: muat status email notifikasi setiap kali tab dibuka
  await loadEmailNotif();
}

function _initPengaturanEvents() {

  // ── Identitas ────────────────────────────────────────────────
  document.getElementById('form-identitas')
    ?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (_isPengaturanSubmitting) return;
      const btn = document.getElementById('btn-save-identitas');
      const namaSekolah = _getVal('set-nama-sekolah').trim();
      if (!namaSekolah) {
        showToast('Nama sekolah tidak boleh kosong.', 'danger');
        document.getElementById('set-nama-sekolah')?.focus();
        return;
      }
      _isPengaturanSubmitting = true;
      if (btn) setButtonLoading(btn);
      let result;
      try {
        result = await callGAS('updateConfigBatch', {
          token  : getToken(),
          updates: {
            nama_sekolah   : namaSekolah,
            kepala_sekolah : _getVal('set-kepala-sekolah'),
            alamat_sekolah : _getVal('set-alamat'),
            tahun_ajaran   : _getVal('set-tahun-ajaran'),
          },
        });
      } catch (_) { result = { status: 'error', message: 'Koneksi gagal.' }; }
      if (btn) resetButtonLoading(btn, false);
      _isPengaturanSubmitting = false;
      if (result.status === 'ok') {
        showToast('Identitas sekolah berhasil disimpan.', 'success');
        _showSavedIndicator('form-identitas');
        _updatePreviewHeader({ nama_sekolah: namaSekolah, alamat_sekolah: _getVal('set-alamat'), logo_url: _getVal('set-logo-url') });
        _updateNavbarName(namaSekolah);
      } else {
        showToast(result.message || 'Gagal menyimpan identitas.', 'danger');
      }
    });

  ['set-nama-sekolah', 'set-alamat'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      _updatePreviewHeader({
        nama_sekolah  : _getVal('set-nama-sekolah'),
        alamat_sekolah: _getVal('set-alamat'),
        logo_url      : _getVal('set-logo-url'),
      });
    });
  });

  // ── Logo Sekolah ─────────────────────────────────────────────
  document.getElementById('btn-preview-logo-sekolah')
    ?.addEventListener('click', () => _applyLogoPreview('sekolah', _getVal('set-logo-url')));

  document.getElementById('set-logo-url')
    ?.addEventListener('input', () => _resetLogoPreview('sekolah'));

  document.getElementById('form-logo-sekolah')
    ?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btn-save-logo-sekolah');
      const url = _getVal('set-logo-url').trim();
      if (url && !_isValidUrl(url)) {
        showToast('URL logo tidak valid. Pastikan dimulai dengan https://', 'danger');
        return;
      }
      if (btn) setButtonLoading(btn);
      let result;
      try {
        result = await callGAS('updateConfig', { token: getToken(), key: 'logo_url', value: url });
      } catch (_) { result = { status: 'error', message: 'Koneksi gagal.' }; }
      if (btn) resetButtonLoading(btn, false);
      if (result.status === 'ok') {
        showToast(url ? 'Logo sekolah berhasil disimpan.' : 'Logo sekolah berhasil dihapus.', 'success');
        _applyLogoPreview('sekolah', url);
        _updatePreviewHeader({ nama_sekolah: _getVal('set-nama-sekolah'), alamat_sekolah: _getVal('set-alamat'), logo_url: url });
      } else {
        showToast(result.message || 'Gagal menyimpan logo.', 'danger');
      }
    });

  document.getElementById('btn-hapus-logo-sekolah')
    ?.addEventListener('click', async () => {
      // FIX A3: ganti confirm() dengan toast dua langkah
      if (!_confirmHapusLogo('sekolah')) return;
      _setVal('set-logo-url', '');
      const btn = document.getElementById('btn-save-logo-sekolah');
      if (btn) setButtonLoading(btn);
      let result;
      try {
        result = await callGAS('updateConfig', { token: getToken(), key: 'logo_url', value: '' });
      } catch (_) { result = { status: 'error', message: 'Koneksi gagal.' }; }
      if (btn) resetButtonLoading(btn, false);
      if (result.status === 'ok') {
        showToast('Logo sekolah berhasil dihapus.', 'success');
        _applyLogoPreview('sekolah', '');
        _updatePreviewHeader({ nama_sekolah: _getVal('set-nama-sekolah'), alamat_sekolah: _getVal('set-alamat'), logo_url: '' });
      } else {
        showToast(result.message || 'Gagal menghapus logo.', 'danger');
      }
    });

  // ── Logo Aplikasi ────────────────────────────────────────────
  document.getElementById('btn-preview-logo-app')
    ?.addEventListener('click', () => _applyLogoPreview('app', _getVal('set-logo-app-url')));

  document.getElementById('set-logo-app-url')
    ?.addEventListener('input', () => _resetLogoPreview('app'));

  document.getElementById('form-logo-app')
    ?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btn-save-logo-app');
      const url = _getVal('set-logo-app-url').trim();
      if (url && !_isValidUrl(url)) {
        showToast('URL logo aplikasi tidak valid.', 'danger');
        return;
      }
      if (btn) setButtonLoading(btn);
      let result;
      try {
        result = await callGAS('updateConfig', { token: getToken(), key: 'logo_app_url', value: url });
      } catch (_) { result = { status: 'error', message: 'Koneksi gagal.' }; }
      if (btn) resetButtonLoading(btn, false);
      if (result.status === 'ok') {
        showToast(url ? 'Logo aplikasi berhasil disimpan.' : 'Logo aplikasi berhasil dihapus.', 'success');
        _applyLogoPreview('app', url);
        _updateNavbarLogo(url);
      } else {
        showToast(result.message || 'Gagal menyimpan logo aplikasi.', 'danger');
      }
    });

  document.getElementById('btn-hapus-logo-app')
    ?.addEventListener('click', async () => {
      if (!_confirmHapusLogo('app')) return;
      _setVal('set-logo-app-url', '');
      const btn = document.getElementById('btn-save-logo-app');
      if (btn) setButtonLoading(btn);
      let result;
      try {
        result = await callGAS('updateConfig', { token: getToken(), key: 'logo_app_url', value: '' });
      } catch (_) { result = { status: 'error', message: 'Koneksi gagal.' }; }
      if (btn) resetButtonLoading(btn, false);
      if (result.status === 'ok') {
        showToast('Logo aplikasi berhasil dihapus.', 'success');
        _applyLogoPreview('app', '');
        _updateNavbarLogo('');
      } else {
        showToast(result.message || 'Gagal menghapus logo.', 'danger');
      }
    });
}

/**
 * FIX A3: Pengganti confirm() untuk hapus logo — toast dua langkah.
 * Return true hanya jika ada pending konfirmasi yang sudah ditampilkan.
 */
const _pendingHapusLogo = new Map();
function _confirmHapusLogo(type) {
  if (_pendingHapusLogo.has(type)) {
    clearTimeout(_pendingHapusLogo.get(type));
    _pendingHapusLogo.delete(type);
    return true; // Eksekusi hapus
  }
  showToast(`Klik lagi untuk menghapus logo ${type === 'sekolah' ? 'sekolah' : 'aplikasi'}.`, 'default', 4000);
  const tid = setTimeout(() => _pendingHapusLogo.delete(type), 4000);
  _pendingHapusLogo.set(type, tid);
  return false; // Tunda — tunggu konfirmasi
}

// ── Live Preview Helpers ───────────────────────────────────────

/**
 * FIX A4: Apply logo ke preview box.
 * Cek img.complete SEBELUM appendChild agar onload tidak terlewat di browser
 * yang sudah cache gambar (terutama Safari ≤14).
 */
function _applyLogoPreview(type, url) {
  const box      = document.getElementById(`preview-logo-${type}`);
  const fallback = document.getElementById(`preview-logo-${type}-fallback`);
  const status   = document.getElementById(`preview-logo-${type}-status`);
  if (!box) return;

  const oldImg = box.querySelector('img');
  if (oldImg) oldImg.remove();

  if (!url) {
    box.classList.remove('has-image', 'error');
    if (fallback) fallback.style.display = '';
    if (status) {
      status.textContent = type === 'sekolah' ? 'Belum ada logo' : 'Menggunakan ikon default';
      status.className   = 'logo-preview-box__desc';
    }
    return;
  }

  const img = document.createElement('img');
  img.alt = `Logo ${type}`;
  img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;';

  const onSuccess = () => {
    box.classList.add('has-image');
    box.classList.remove('error');
    if (fallback) fallback.style.display = 'none';
    if (status) {
      status.textContent = 'Gambar berhasil dimuat';
      status.className   = 'logo-preview-box__desc success';
    }
  };

  const onError = () => {
    img.remove();
    box.classList.add('error');
    box.classList.remove('has-image');
    if (fallback) fallback.style.display = '';
    if (status) {
      status.textContent = 'Gagal memuat gambar';
      status.className   = 'logo-preview-box__desc error';
    }
  };

  img.onload  = onSuccess;
  img.onerror = onError;

  // FIX A4: Set src SEBELUM menentukan apakah sudah complete
  img.src = normalizeLogoUrl(url);

  // Append ke DOM SETELAH src di-set dan handler di-pasang
  box.appendChild(img);

  // FIX A4: Cek cache — jika sudah complete saat src di-set, onload tidak fired
  if (img.complete) {
    if (img.naturalWidth > 0) onSuccess();
    else onError();
  }
}

function _resetLogoPreview(type) {
  const box = document.getElementById(`preview-logo-${type}`);
  if (!box) return;
  const oldImg = box.querySelector('img');
  if (oldImg) oldImg.remove();
  box.classList.remove('has-image', 'error');
  const fallback = document.getElementById(`preview-logo-${type}-fallback`);
  if (fallback) fallback.style.display = '';
  const status = document.getElementById(`preview-logo-${type}-status`);
  if (status) {
    status.textContent = type === 'sekolah' ? 'Belum ada logo' : 'Menggunakan ikon default';
    status.className   = 'logo-preview-box__desc';
  }
}

function _updatePreviewHeader(config) {
  const nameEl   = document.getElementById('settings-preview-name');
  const addrEl   = document.getElementById('settings-preview-addr');
  const logoBox  = document.getElementById('settings-preview-logo');
  const logoIcon = document.getElementById('settings-preview-logo-icon');

  if (nameEl) nameEl.textContent = config.nama_sekolah   || 'Nama Sekolah';
  if (addrEl) addrEl.textContent = config.alamat_sekolah || 'Alamat Sekolah';

  if (logoBox && logoIcon) {
    const oldImg = logoBox.querySelector('img');
    if (oldImg) oldImg.remove();

    if (config.logo_url) {
      const img = document.createElement('img');
      img.src   = normalizeLogoUrl(config.logo_url);
      img.alt   = config.nama_sekolah || 'Logo sekolah';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      img.onload  = () => { logoIcon.style.display = 'none'; };
      img.onerror = () => { img.remove(); logoIcon.style.display = ''; };
      logoBox.appendChild(img);
    } else {
      logoIcon.style.display = '';
    }
  }
}

function _updateNavbarName(nama) {
  const el = document.getElementById('nav-school-name');
  if (el && nama) el.textContent = nama;
}

/**
 * FIX A9: null guard untuk svgIcon — mungkin sudah dihapus oleh pemanggilan sebelumnya.
 */
function _updateNavbarLogo(url) {
  const iconEl = document.getElementById('navbar-logo-wrap');
  if (!iconEl) return;

  const oldImg = iconEl.querySelector('img');
  if (oldImg) oldImg.remove();

  // FIX A9: querySelector bisa return null
  const svgIcon = iconEl.querySelector('svg, i[data-lucide]');

  if (url) {
    const img = document.createElement('img');
    img.src       = normalizeLogoUrl(url);
    img.alt       = 'Logo sekolah';
    img.className = 'navbar__brand-logo-img';
    img.onload  = () => { if (svgIcon) svgIcon.style.display = 'none'; };
    img.onerror = () => { img.remove(); if (svgIcon) svgIcon.style.display = ''; };
    iconEl.appendChild(img);
  } else {
    // FIX A9: guard sebelum akses .style
    if (svgIcon) svgIcon.style.display = '';
  }
}

/**
 * FIX A13: _showSavedIndicator — tidak membuat duplikat elemen.
 * Gunakan data-indicator="true" sebagai marker agar querySelector andal.
 */
function _showSavedIndicator(formId) {
  const form = document.getElementById(formId);
  if (!form) return;

  // FIX A13: cari dengan selector yang unik
  let indicator = form.querySelector('[data-saved-indicator]');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = 'settings-saved-indicator';
    indicator.setAttribute('data-saved-indicator', 'true');
    indicator.innerHTML = `${_icon('check','0.85rem')}<span>Tersimpan</span>`;
    const actionsEl = form.querySelector('.settings-actions');
    if (actionsEl) actionsEl.appendChild(indicator);
  }

  indicator.classList.add('visible');
  // Reset sebelum set ulang agar clearTimeout tidak diperlukan
  clearTimeout(indicator._hideTimer);
  indicator._hideTimer = setTimeout(() => indicator.classList.remove('visible'), 3000);
}

// ── Utility Helpers ───────────────────────────────────────────

function _getVal(id) {
  return document.getElementById(id)?.value || '';
}

function _setVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value || '';
}

function _isValidUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function _formatBulan(yyyyMM) {
  if (!yyyyMM) return '';
  const [y, m] = yyyyMM.split('-');
  const bulanNames = [
    '', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ];
  return `${bulanNames[parseInt(m, 10)] || m} ${y}`;
}

function _pageRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1];
  if (current > 3) pages.push('...');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    pages.push(i);
  }
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}

// ══════════════════════════════════════════════════════════════
// TAB: PENGATURAN — EMAIL NOTIFIKASI ADMIN
// ══════════════════════════════════════════════════════════════
//
// State machine:
//   'unverified'          → panel-input
//   'pending_verification'→ panel-otp (dengan countdown & cooldown)
//   'verified'            → panel-verified (+ panel-pending-change jika ada email baru)
//
// PERUBAHAN v2 (audit):
//   - FIX B3: btn-ubah-email menyembunyikan semua panel sebelum buka panel-input
//   - FIX B4: btn-cancel-otp eksplisit sembunyikan panel-otp sebelum tampilkan panel lain
//   - FIX B5: _emailNotifInitialized di-set di AWAL fungsi (tidak di akhir) agar tidak
//             terdaftarkan ganda saat koneksi gagal berulang
//   - FIX B6: loadEmailNotif() skip update UI jika ada operasi in-flight
//   - FIX B9: otpAttemptsLeft default 5 ditampilkan sebagai hint dari awal
// ──────────────────────────────────────────────────────────────

// ── Email Notifikasi Admin — State & Konstanta ────────────────
// FIX #3 : pendingEmail kini ditampilkan di panel-pending-change
//          pada status pending_verification, bukan hanya verified.
// FIX #1/#10 : tombol ghost di panel light bg tidak invisible lagi
//              (diselesaikan di CSS — lihat admin.css).
// FIX #11: label cooldown memakai "dtk" bukan "d".
// FIX #13: aria-live="polite" ditambahkan ke status-bar di HTML.
// FIX #15: konfirmasi sebelum kirim email uji.

let _emailNotifState = {
  status          : 'unverified',
  email           : '',
  pendingEmail    : '',
  verifiedAt      : 0,
  otpExpiresAt    : 0,
  otpCooldownMs   : 0,
  otpAttemptsLeft : 5,
  notifStats      : { sent: 0, failed: 0, pending: 0 },
};

let _emailNotifInitialized = false;
let _otpCountdownTimer     = null;
let _resendCooldownTimer   = null;
let _isEmailNotifLoading   = false;

// ── Titik masuk: dipanggil dari loadPengaturan() ──────────────

async function loadEmailNotif() {
  // FIX B5: pasang event listener SEBELUM fetch, bukan setelah
  // Ini mencegah duplikasi jika koneksi gagal lalu berhasil di kunjungan tab berikutnya.
  if (!_emailNotifInitialized) {
    _initEmailNotifEvents();
    _emailNotifInitialized = true;
  }

  // FIX B6: jangan perbarui UI jika ada operasi yang sedang in-flight
  if (_isEmailNotifLoading) return;

  _showEmailNotifLoading(true);

  let result;
  try {
    result = await callGAS('getEmailNotifStatus', { token: getToken() });
  } catch (_) {
    result = { status: 'error', message: 'Koneksi gagal.' };
  }

  _showEmailNotifLoading(false);

  if (!result || result.status !== 'ok') {
    _applyEmailNotifState({
      status: 'unverified', email: '', pendingEmail: '',
      verifiedAt: 0, otpExpiresAt: 0, otpCooldownMs: 0,
      otpAttemptsLeft: 5, notifStats: { sent: 0, failed: 0, pending: 0 }
    });
    showToast('Gagal memuat status email notifikasi. Periksa koneksi.', 'danger');
    return;
  }

  _applyEmailNotifState(result.data);
}

// ── Terapkan state dari server ke UI ─────────────────────────

function _applyEmailNotifState(data) {
  Object.assign(_emailNotifState, data);

  const { status, email, pendingEmail, otpExpiresAt, otpCooldownMs,
          otpAttemptsLeft, notifStats } = _emailNotifState;

  // ── Status bar ────────────────────────────────────────────
  const statusBar = document.getElementById('email-notif-status-bar');
  const dotEl     = document.getElementById('email-notif-status-icon');
  const addrEl    = document.getElementById('email-notif-address');
  const labelEl   = document.getElementById('email-notif-status-label');
  const statsEl   = document.getElementById('email-notif-stats');
  const sentEl    = document.getElementById('stat-notif-sent');
  const failedEl  = document.getElementById('stat-notif-failed');

  if (statusBar) statusBar.style.display = '';

  const dotClass = {
    verified             : 'email-notif-dot--green',
    pending_verification : 'email-notif-dot--yellow',
    unverified           : 'email-notif-dot--gray',
  }[status] || 'email-notif-dot--gray';

  const statusText = {
    verified             : 'Email Terverifikasi — Notifikasi Aktif',
    pending_verification : 'Menunggu Verifikasi OTP',
    unverified           : 'Belum Terverifikasi',
  }[status] || 'Belum Terverifikasi';

  if (dotEl)   dotEl.className = 'email-notif-dot ' + dotClass;
  if (addrEl)  addrEl.textContent = email || '(belum ada email)';
  if (labelEl) labelEl.textContent = statusText;

  if (statsEl) {
    if (status === 'verified' && notifStats) {
      if (sentEl)   sentEl.textContent   = (notifStats.sent   || 0) + ' terkirim';
      if (failedEl) failedEl.textContent = (notifStats.failed || 0) + ' gagal';
      statsEl.style.display = '';
    } else {
      statsEl.style.display = 'none';
    }
  }

  // ── Reset semua panel sebelum tampilkan yang aktif ────────
  _hideAllEmailPanels();
  _clearCountdown();
  _clearResendCooldown();

  // ── Tampilkan panel sesuai status ─────────────────────────
  if (status === 'verified') {
    _showPanel('email-notif-panel-verified');
    // Tampilkan panel pending jika ada email yang sedang menunggu verifikasi
    if (pendingEmail) {
      _showPendingEmailAlert(pendingEmail);
    }

  } else if (status === 'pending_verification') {
    _showPanel('email-notif-panel-otp');
    _updateOtpAttemptsHint(typeof otpAttemptsLeft === 'number' ? otpAttemptsLeft : 5);

    // FIX #3: tampilkan alert pending juga saat pending_verification
    // (terjadi ketika email lama sudah verified, lalu ganti email baru)
    if (pendingEmail) {
      _showPendingEmailAlert(pendingEmail);
    }

    const otpInfo = document.getElementById('email-notif-otp-info');
    if (otpInfo) {
      // Tampilkan email yang relevan: pendingEmail (ganti email) atau email biasa
      const emailDisplay = pendingEmail || email || 'email Anda';
      otpInfo.textContent = 'Kode OTP telah dikirim ke ' + emailDisplay +
        '. Masukkan kode 6 digit di bawah.';
    }

    if (otpExpiresAt > Date.now()) {
      _startCountdown(otpExpiresAt);
    } else {
      // OTP sudah expired saat halaman dibuka kembali
      const hint = document.getElementById('otp-attempts-hint');
      if (hint) {
        hint.textContent = 'Kode OTP telah kedaluwarsa. Silakan kirim kode baru.';
        hint.style.color = 'var(--clr-danger,#dc2626)';
      }
      const verifyBtn = document.getElementById('btn-verify-otp');
      if (verifyBtn) verifyBtn.disabled = true;
    }
    if (otpCooldownMs > 0) _startResendCooldown(otpCooldownMs);

  } else {
    // unverified
    _showPanel('email-notif-panel-input');
    _prefillEmailInput(email);
    const hint = document.getElementById('hint-email-notif');
    if (hint) hint.textContent = 'OTP akan dikirim ke alamat email ini untuk verifikasi.';
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── Helper: tampilkan alert panel-pending-change ──────────────
// Dipakai oleh _applyEmailNotifState untuk status 'verified' DAN
// 'pending_verification' (FIX #3).

function _showPendingEmailAlert(pendingEmail) {
  const pendingPanel = document.getElementById('email-notif-panel-pending-change');
  const pendingMsg   = document.getElementById('email-notif-pending-msg');
  if (pendingPanel) pendingPanel.style.display = '';
  if (pendingMsg) {
    pendingMsg.innerHTML =
      '<i data-lucide="alert-triangle" style="width:0.85rem;height:0.85rem;flex-shrink:0;margin-top:1px;"></i>' +
      '<span>Verifikasi email baru (<strong>' + escapeHtml(pendingEmail) + '</strong>) ' +
      'sedang berlangsung. Email lama tetap aktif sampai verifikasi selesai.</span>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}

// ── Sembunyikan semua panel sekaligus ─────────────────────────

function _hideAllEmailPanels() {
  [
    'email-notif-panel-input',
    'email-notif-panel-otp',
    'email-notif-panel-verified',
    'email-notif-panel-pending-change',
    'email-notif-log-wrap',
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

// ── Event listeners ───────────────────────────────────────────

function _initEmailNotifEvents() {

  // Form kirim OTP
  document.getElementById('form-email-notif')
    ?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await _handleKirimOtp();
    });

  // Form verifikasi OTP
  document.getElementById('form-verify-otp')
    ?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await _handleVerifyOtp();
    });

  // Filter angka saja di input OTP
  document.getElementById('input-otp-code')
    ?.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
    });

  // Kirim Ulang OTP
  document.getElementById('btn-resend-otp')
    ?.addEventListener('click', async () => {
      await _handleResendOtp();
    });

  // FIX B4: Batalkan — sembunyikan panel-otp secara eksplisit sebelum tampilkan panel lain
  document.getElementById('btn-cancel-otp')
    ?.addEventListener('click', () => {
      _clearCountdown();
      _clearResendCooldown();

      // Bersihkan input OTP dan hint
      const otpInput = document.getElementById('input-otp-code');
      if (otpInput) otpInput.value = '';
      const hint = document.getElementById('otp-attempts-hint');
      if (hint) { hint.textContent = ''; hint.style.color = ''; }

      // Kembali ke panel yang sesuai dengan status sebelum OTP
      _hideAllEmailPanels();
      if (_emailNotifState.status === 'verified') {
        _showPanel('email-notif-panel-verified');
        // FIX #3: tampilkan kembali alert pending jika masih ada
        if (_emailNotifState.pendingEmail) {
          _showPendingEmailAlert(_emailNotifState.pendingEmail);
        }
      } else {
        _showPanel('email-notif-panel-input');
        _prefillEmailInput(_emailNotifState.email || '');
        const inputHint = document.getElementById('hint-email-notif');
        if (inputHint) inputHint.textContent = 'OTP akan dikirim ke alamat email ini untuk verifikasi.';
      }
    });

  // FIX B3: Ubah Email — sembunyikan SEMUA panel dulu, termasuk pending-change
  document.getElementById('btn-ubah-email')
    ?.addEventListener('click', () => {
      _hideAllEmailPanels();
      _showPanel('email-notif-panel-input');
      _prefillEmailInput(_emailNotifState.email || '');
      const hint = document.getElementById('hint-email-notif');
      if (hint) {
        hint.textContent = _emailNotifState.email
          ? 'Email lama (' + _emailNotifState.email + ') tetap aktif sampai email baru berhasil diverifikasi.'
          : 'OTP akan dikirim ke alamat email ini untuk verifikasi.';
      }
      document.getElementById('input-notif-email')?.focus();
    });

  // FIX #15: Kirim Email Uji — konfirmasi sebelum mengirim agar tidak terjadi
  // pengiriman berulang yang tidak disengaja.
  document.getElementById('btn-test-notif')
    ?.addEventListener('click', async () => {
      const email = _emailNotifState.email || '';
      // Konfirmasi singkat — menggunakan confirm() native agar tidak perlu modal baru.
      // Kompatibel dengan semua browser tanpa dependensi tambahan.
      if (!confirm('Kirim email uji coba ke ' + email + '?')) return;
      await _handleTestNotif();
    });

  // Riwayat Notifikasi (toggle)
  document.getElementById('btn-lihat-log')
    ?.addEventListener('click', async () => {
      await _handleShowLog();
    });

  // Tutup Log
  document.getElementById('btn-tutup-log')
    ?.addEventListener('click', () => {
      const logWrap = document.getElementById('email-notif-log-wrap');
      if (logWrap) logWrap.style.display = 'none';
    });
}

// ── Handler: Kirim OTP ────────────────────────────────────────

async function _handleKirimOtp() {
  if (_isEmailNotifLoading) return;

  const emailInput = document.getElementById('input-notif-email');
  const btn        = document.getElementById('btn-kirim-otp');
  const email      = (emailInput?.value || '').trim().toLowerCase();

  if (!email) {
    showToast('Alamat email tidak boleh kosong.', 'danger');
    emailInput?.focus();
    return;
  }
  if (!_isValidEmailFrontend(email)) {
    showToast('Format email tidak valid.', 'danger');
    emailInput?.focus();
    return;
  }

  _isEmailNotifLoading = true;
  if (btn) setButtonLoading(btn);

  let result;
  try {
    result = await callGAS('requestOtp', { token: getToken(), email });
  } catch (_) {
    result = { status: 'error', message: 'Koneksi gagal.' };
  }

  if (btn) resetButtonLoading(btn, false);
  _isEmailNotifLoading = false;

  if (result.status !== 'ok') {
    showToast(result.message || 'Gagal mengirim OTP.', 'danger');
    return;
  }

  const d = result.data || {};
  showToast('Kode OTP dikirim ke ' + email + '. Berlaku 5 menit.', 'success');

  // Perbarui state lokal
  _emailNotifState.otpExpiresAt    = d.otpExpiresAt  || (Date.now() + 5 * 60 * 1000);
  _emailNotifState.otpCooldownMs   = d.cooldownMs    || 60000;
  _emailNotifState.otpAttemptsLeft = 5;

  if (!d.isChangingEmail) {
    _emailNotifState.email = email;
    _emailNotifState.status = 'pending_verification';
  } else {
    _emailNotifState.pendingEmail = email;
    // status tetap 'verified' — email lama masih aktif
  }

  // Pindah ke panel OTP — sembunyikan semua panel lain dulu
  _hideAllEmailPanels();
  _showPanel('email-notif-panel-otp');

  // FIX #3: jika ganti email (isChangingEmail), tampilkan alert pending
  if (d.isChangingEmail && email) {
    _showPendingEmailAlert(email);
  }

  const otpInfo = document.getElementById('email-notif-otp-info');
  if (otpInfo) otpInfo.textContent =
    'Kode OTP telah dikirim ke ' + email + '. Masukkan kode 6 digit di bawah.';

  _clearCountdown();
  _clearResendCooldown();
  _startCountdown(_emailNotifState.otpExpiresAt);
  _startResendCooldown(_emailNotifState.otpCooldownMs);
  _updateOtpAttemptsHint(5);

  const verifyBtn = document.getElementById('btn-verify-otp');
  if (verifyBtn) verifyBtn.disabled = false;

  const otpInput = document.getElementById('input-otp-code');
  if (otpInput) { otpInput.value = ''; otpInput.focus(); }
}

// ── Handler: Verifikasi OTP ───────────────────────────────────

async function _handleVerifyOtp() {
  if (_isEmailNotifLoading) return;

  const otpInput = document.getElementById('input-otp-code');
  const btn      = document.getElementById('btn-verify-otp');
  const otp      = (otpInput?.value || '').trim();

  if (!otp || !/^\d{6}$/.test(otp)) {
    showToast('Kode OTP harus 6 digit angka.', 'danger');
    otpInput?.focus();
    return;
  }

  _isEmailNotifLoading = true;
  if (btn) setButtonLoading(btn);

  let result;
  try {
    result = await callGAS('verifyOtp', { token: getToken(), otp });
  } catch (_) {
    result = { status: 'error', message: 'Koneksi gagal.' };
  }

  if (btn) resetButtonLoading(btn, false);
  _isEmailNotifLoading = false;

  if (result.status !== 'ok') {
    showToast(result.message || 'Verifikasi gagal.', 'danger');

    // FIX #2: parse sisa percobaan — pola regex diperkuat agar cocok dengan
    // berbagai variasi format pesan backend (titik di akhir, dsb.)
    const msg        = result.message || '';
    // Cocokkan "Sisa percobaan: 3." atau "sisa percobaan: 3"
    const matchSisa  = msg.match(/sisa percobaan[:\s]+(\d+)/i);
    // Deteksi batas habis: pesan "batas percobaan" ATAU "habis"
    // Pastikan TIDAK double-match dengan matchSisa
    const isBatas    = !matchSisa && (/batas percobaan/i.test(msg) || /percobaan habis/i.test(msg));
    const isExpired  = /kedaluwarsa/i.test(msg);

    if (matchSisa) {
      _updateOtpAttemptsHint(parseInt(matchSisa[1], 10));
    } else if (isBatas) {
      _updateOtpAttemptsHint(0);
      _clearCountdown();
      // Kembalikan ke panel input setelah 1,5 detik
      setTimeout(() => {
        _hideAllEmailPanels();
        _showPanel('email-notif-panel-input');
        _prefillEmailInput(_emailNotifState.email || '');
      }, 1500);
    } else if (isExpired) {
      _clearCountdown();
      const hint = document.getElementById('otp-attempts-hint');
      if (hint) hint.textContent = 'Kode OTP telah kedaluwarsa. Silakan kirim kode baru.';
      if (btn) btn.disabled = true;
    }

    if (otpInput) { otpInput.value = ''; otpInput.focus(); }
    return;
  }

  // Sukses
  _clearCountdown();
  _clearResendCooldown();
  if (otpInput) otpInput.value = '';
  showToast(result.message || 'Email berhasil diverifikasi!', 'success');

  // Refresh penuh dari server
  await loadEmailNotif();
}

// ── Handler: Kirim Ulang OTP ──────────────────────────────────

async function _handleResendOtp() {
  if (_isEmailNotifLoading) return;

  // Gunakan pendingEmail (ganti email) atau email aktif
  const emailToUse = _emailNotifState.pendingEmail || _emailNotifState.email;
  if (!emailToUse) {
    showToast('Tidak ada email yang sedang diverifikasi.', 'danger');
    return;
  }

  const btn = document.getElementById('btn-resend-otp');
  // Nonaktifkan tombol segera untuk mencegah double-click
  if (btn) btn.disabled = true;
  _isEmailNotifLoading = true;

  let result;
  try {
    result = await callGAS('requestOtp', { token: getToken(), email: emailToUse });
  } catch (_) {
    result = { status: 'error', message: 'Koneksi gagal.' };
  }

  _isEmailNotifLoading = false;

  if (result.status !== 'ok') {
    showToast(result.message || 'Gagal mengirim ulang OTP.', 'danger');
    // Re-aktifkan tombol hanya jika belum ada cooldown aktif dari server
    if (btn) btn.disabled = false;
    return;
  }

  const d = result.data || {};
  showToast('Kode OTP baru dikirim ke ' + emailToUse + '.', 'success');

  _emailNotifState.otpExpiresAt    = d.otpExpiresAt || (Date.now() + 5 * 60 * 1000);
  _emailNotifState.otpCooldownMs   = d.cooldownMs   || 60000;
  _emailNotifState.otpAttemptsLeft = 5;

  _clearCountdown();
  _clearResendCooldown();
  _startCountdown(_emailNotifState.otpExpiresAt);
  _startResendCooldown(_emailNotifState.otpCooldownMs);
  _updateOtpAttemptsHint(5);

  const verifyBtn = document.getElementById('btn-verify-otp');
  if (verifyBtn) verifyBtn.disabled = false;

  const otpInput = document.getElementById('input-otp-code');
  if (otpInput) { otpInput.value = ''; otpInput.focus(); }
}

// ── Handler: Kirim Email Uji ──────────────────────────────────

async function _handleTestNotif() {
  if (_isEmailNotifLoading) return;

  const btn = document.getElementById('btn-test-notif');
  if (btn) setButtonLoading(btn);
  _isEmailNotifLoading = true;

  let result;
  try {
    result = await callGAS('sendTestNotif', { token: getToken() });
  } catch (_) {
    result = { status: 'error', message: 'Koneksi gagal.' };
  }

  if (btn) resetButtonLoading(btn, false);
  _isEmailNotifLoading = false;

  if (result.status === 'ok') {
    showToast(result.message || 'Email uji coba berhasil dikirim.', 'success');
  } else {
    showToast(result.message || 'Gagal mengirim email uji.', 'danger');
  }
}

// ── Handler: Riwayat Notifikasi ───────────────────────────────

async function _handleShowLog() {
  const logWrap  = document.getElementById('email-notif-log-wrap');
  const logList  = document.getElementById('email-notif-log-list');
  const logEmpty = document.getElementById('email-notif-log-empty');
  if (!logWrap) return;

  // Toggle: tutup jika sudah tampil
  if (logWrap.style.display !== 'none' && logWrap.style.display !== '') {
    logWrap.style.display = 'none';
    return;
  }

  logWrap.style.display = '';
  if (logList) {
    // Skeleton 3 baris untuk UX yang lebih representatif
    logList.innerHTML = Array(3).fill(
      '<div class="email-notif-log-skeleton-row">' +
      '<div class="skeleton skeleton--text" style="height:0.8em;width:60px;border-radius:10px;"></div>' +
      '<div class="skeleton skeleton--text" style="height:0.8em;flex:1;"></div>' +
      '<div class="skeleton skeleton--text" style="height:0.8em;width:80px;"></div>' +
      '</div>'
    ).join('');
  }
  if (logEmpty) logEmpty.style.display = 'none';

  let result;
  try {
    result = await callGAS('getNotifLog', { token: getToken(), limit: 20 });
  } catch (_) {
    result = { status: 'error', message: 'Koneksi gagal.' };
  }

  if (result.status !== 'ok') {
    if (logList) logList.innerHTML =
      '<div class="alert alert--danger" style="margin:var(--space-3) var(--space-4);">' +
      'Gagal memuat log: ' + escapeHtml(result.message || 'Error') + '</div>';
    return;
  }

  const logs = result.data?.logs || [];

  if (logs.length === 0) {
    if (logList)  logList.innerHTML = '';
    if (logEmpty) logEmpty.style.display = '';
    return;
  }

  if (logEmpty) logEmpty.style.display = 'none';
  if (logList) {
    logList.innerHTML = logs.map(log => {
      const statusClass = {
        sent    : 'log-status--sent',
        failed  : 'log-status--failed',
        pending : 'log-status--pending',
      }[log.status] || '';
      const statusLabel = {
        sent    : 'Terkirim',
        failed  : 'Gagal',
        pending : 'Menunggu',
      }[log.status] || escapeHtml(log.status || '—');

      // Gunakan sentAt jika tersedia, fallback ke createdAt
      const ts = log.sentAt || log.createdAt || 0;
      const waktu = ts
        ? new Date(ts).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
        : '—';

      // FIX #4: log-error memakai class yang sudah ada di CSS (grid-column: 1/-1)
      const errorHtml = log.errorMsg
        ? `<span class="log-error" title="${escapeHtml(log.errorMsg)}">${escapeHtml(log.errorMsg)}</span>`
        : '';

      return `<div class="email-notif-log-item">` +
        `<span class="log-status ${statusClass}">${statusLabel}</span>` +
        `<span class="log-email-to">${escapeHtml(log.emailTo || '—')}</span>` +
        `<span class="log-time">${waktu}</span>` +
        `<span class="log-visit-id" title="${escapeHtml(log.visitId || '')}">` +
          escapeHtml(log.visitId || '—') +
        `</span>` +
        errorHtml +
        `</div>`;
    }).join('');
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── Countdown OTP ─────────────────────────────────────────────

function _startCountdown(expiresAt) {
  _clearCountdown();
  const el = document.getElementById('email-notif-countdown');
  if (!el) return;

  function tick() {
    const remaining = Math.max(0, expiresAt - Date.now());
    const minutes   = Math.floor(remaining / 60000);
    const seconds   = Math.floor((remaining % 60000) / 1000);
    el.textContent  = String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');

    if (remaining <= 0) {
      _clearCountdown();
      el.textContent = '00:00';
      el.classList.add('email-notif-countdown--expired');
      const hint = document.getElementById('otp-attempts-hint');
      if (hint) { hint.textContent = 'Kode OTP telah kedaluwarsa. Silakan kirim kode baru.'; hint.style.color = 'var(--clr-danger,#dc2626)'; }
      const verifyBtn = document.getElementById('btn-verify-otp');
      if (verifyBtn) verifyBtn.disabled = true;
    }
  }

  tick();
  _otpCountdownTimer = setInterval(tick, 1000);
}

function _clearCountdown() {
  if (_otpCountdownTimer) { clearInterval(_otpCountdownTimer); _otpCountdownTimer = null; }
  const el = document.getElementById('email-notif-countdown');
  if (el) el.classList.remove('email-notif-countdown--expired');
  const verifyBtn = document.getElementById('btn-verify-otp');
  if (verifyBtn) verifyBtn.disabled = false;
}

// ── Cooldown kirim ulang ──────────────────────────────────────

function _startResendCooldown(cooldownMs) {
  _clearResendCooldown();
  const btn   = document.getElementById('btn-resend-otp');
  const label = document.getElementById('btn-resend-otp-label');
  if (!btn || cooldownMs <= 0) return;

  btn.disabled  = true;
  const endAt   = Date.now() + cooldownMs;

  function tick() {
    const remaining = Math.max(0, endAt - Date.now());
    const secs      = Math.ceil(remaining / 1000);
    // FIX #11: gunakan "dtk" sebagai singkatan detik yang lebih jelas daripada "d"
    if (label) label.textContent = secs > 0 ? `Kirim Ulang (${secs} dtk)` : 'Kirim Ulang OTP';
    if (remaining <= 0) {
      _clearResendCooldown();
      btn.disabled = false;
      if (label) label.textContent = 'Kirim Ulang OTP';
    }
  }

  tick();
  _resendCooldownTimer = setInterval(tick, 1000);
}

function _clearResendCooldown() {
  if (_resendCooldownTimer) { clearInterval(_resendCooldownTimer); _resendCooldownTimer = null; }
}

// ── UI Helpers ────────────────────────────────────────────────

function _showPanel(panelId, show = true) {
  const el = document.getElementById(panelId);
  if (el) el.style.display = show ? '' : 'none';
}

function _showEmailNotifLoading(loading) {
  const skEl  = document.getElementById('email-notif-loading');
  const barEl = document.getElementById('email-notif-status-bar');
  if (skEl)  skEl.style.display  = loading ? '' : 'none';
  if (barEl) barEl.style.display = loading ? 'none' : '';
}

function _updateOtpAttemptsHint(attemptsLeft) {
  const hint = document.getElementById('otp-attempts-hint');
  if (!hint) return;
  if (attemptsLeft <= 0) {
    hint.textContent = 'Batas percobaan habis. Silakan minta kode OTP baru.';
    hint.style.color = 'var(--clr-danger,#dc2626)';
  } else if (attemptsLeft <= 2) {
    hint.textContent = 'Perhatian: hanya tersisa ' + attemptsLeft + ' percobaan.';
    hint.style.color = 'var(--clr-warning,#d97706)';
  } else {
    // Tampilkan info sisa percobaan secara netral — tidak perlu warna mencolok
    // saat masih banyak sisa percobaan
    hint.textContent = '';
    hint.style.color = '';
  }
}

function _prefillEmailInput(email) {
  const el = document.getElementById('input-notif-email');
  if (el) el.value = email || '';
}

function _isValidEmailFrontend(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((email || '').trim());
}

// ══════════════════════════════════════════════════════════════
// ▶▶ SECURITY: TAB AUDIT LOG
// ══════════════════════════════════════════════════════════════

/**
 * Muat dan tampilkan audit log aktivitas kritis.
 * Hanya bisa diakses admin — server memverifikasi token.
 * ▶▶ SECURITY: Token dikirim dari server session, bukan dari URL/body manual.
 */
async function loadAuditLog() {
  const container = document.getElementById('auditlog-table-body');
  const countEl   = document.getElementById('auditlog-count');
  const emptyEl   = document.getElementById('auditlog-empty');
  const tableEl   = document.getElementById('auditlog-table-wrapper');

  if (!container) return;

  // Tampilkan skeleton
  container.innerHTML = Array(5).fill(`
    <tr>${Array(6).fill('<td><div class="skeleton skeleton--text" style="height:0.85em;"></div></td>').join('')}</tr>
  `).join('');
  if (tableEl) tableEl.style.display = '';
  if (emptyEl) emptyEl.style.display = 'none';
  if (countEl) countEl.textContent   = 'Memuat...';

  let result;
  try {
    // ▶▶ SECURITY: Gunakan _callGASSecure — token diambil dari localStorage
    // Server memverifikasi token dan memastikan hanya admin yang bisa akses
    result = await _callGASSecure('getAuditLog', { limit: 100 });
  } catch (_) {
    result = { status: 'error', message: 'Koneksi gagal.' };
  }

  if (result.status !== 'ok') {
    container.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding:var(--space-8);">
      ${escapeHtml(result.message || 'Gagal memuat audit log.')}
    </td></tr>`;
    if (countEl) countEl.textContent = 'Gagal memuat.';
    return;
  }

  const logs  = result.data?.logs || [];
  const total = result.data?.total || 0;

  if (countEl) countEl.textContent = `${total} entri audit log`;

  if (logs.length === 0) {
    container.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    if (tableEl) tableEl.style.display = 'none';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  const statusClass = { ok: 'badge--success', denied: 'badge--danger', error: 'badge--warning' };
  const statusLabel = { ok: 'OK', denied: 'DITOLAK', error: 'ERROR' };

  container.innerHTML = logs.map(log => {
    const ts   = log.timestamp
      ? new Date(log.timestamp).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
      : '—';
    const sCls = statusClass[log.status] || 'badge--gray';
    const sLbl = statusLabel[log.status] || escapeHtml(log.status);

    return `<tr>
      <td style="white-space:nowrap;font-size:0.78rem;color:var(--clr-gray-500);">${escapeHtml(ts)}</td>
      <td style="font-weight:600;">${escapeHtml(log.username || 'public')}</td>
      <td><span class="badge badge--primary" style="font-size:0.7rem;">${escapeHtml(log.role || '—')}</span></td>
      <td><code style="font-size:0.78rem;">${escapeHtml(log.action || '—')}</code></td>
      <td><span class="badge ${sCls}" style="font-size:0.7rem;">${sLbl}</span></td>
      <td style="font-size:0.78rem;max-width:200px;white-space:normal;">${escapeHtml(log.detail || '—')}</td>
    </tr>`;
  }).join('');
}
