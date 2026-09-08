/**
 * admin.js
 * Logic dashboard admin (/admin.html).
 * ─────────────────────────────────────────────────────────
 * Fitur:
 *   - Cek autentikasi (admin only)
 *   - Tab navigasi: Ringkasan / Rekap Tamu / Manajemen Staf
 *   - Statistik cards: hari ini, aktif, bulan ini, terbanyak
 *   - CSS bar chart breakdown jenis tamu
 *   - CSS trend chart 7 hari
 *   - Rekap tamu: filter, pagination, modal detail
 *   - Export CSV (generate di frontend)
 *   - Manajemen staf: tambah, edit, toggle aktif
 *   - Polling notifikasi in-app tiap 60 detik
 */

// ── State ─────────────────────────────────────────────────────
let session         = null;
let activeTab       = 'ringkasan';
let rekapData       = [];       // data rekap setelah filter
let rekapTotal      = 0;
let rekapPage       = 1;
const REKAP_LIMIT   = 10;
let notifTimer      = null;
let lastNotifCount  = -1;
let allStaf         = [];       // semua staf (aktif + nonaktif)
let editingStafId   = null;     // null = tambah baru, string = edit existing

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  session = await checkAuth(ROLES.ADMIN);
  if (!session) return;

  initNavbar(session);
  await loadSchoolConfig();

  // Set default filter tanggal (bulan ini)
  setDefaultFilterDates();

  // Isi dropdown filter jenis tamu
  populateFilterJenis();

  // Load tab aktif pertama
  await loadRingkasan();

  // Event listeners
  attachTabEvents();
  attachRekapEvents();
  attachStafEvents();
  attachSiswaEvents();
  attachModalEvents();

  // Mulai polling notifikasi
  startNotifPolling();
});

// ── School Config ─────────────────────────────────────────────
async function loadSchoolConfig() {
  const r = await callGAS('getConfig').catch(() => null);
  if (r?.status === 'ok' && r.data) {
    const nama = r.data.nama_sekolah || CONFIG.APP_NAME;
    const el = document.getElementById('nav-school-name');
    if (el) el.textContent = nama;
    document.title = `Dashboard Admin — ${nama}`;

    // Apply logo aplikasi ke navbar jika sudah diatur
    if (r.data.logo_app_url) {
      _updateNavbarLogo(r.data.logo_app_url);
    }
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

// FIX A7: guard race condition — cegah concurrent tab switch
let _isTabSwitching = false;

async function switchTab(tabId) {
  if (activeTab === tabId) return;
  if (_isTabSwitching) return;

  _isTabSwitching = true;

  // Update button states
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.id === `tab-${tabId}`);
    b.setAttribute('aria-selected', b.id === `tab-${tabId}` ? 'true' : 'false');
  });

  // Update pane visibility
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('active', p.id === `pane-${tabId}`);
  });

  activeTab = tabId;

  // Beri satu frame kepada browser untuk menghitung layout pane baru
  // sebelum konten dimuat. Ini penting agar elemen seperti img, canvas,
  // atau elemen yang bergantung pada dimensi visible sudah ter-layout.
  await new Promise(resolve => requestAnimationFrame(resolve));

  // Scroll ke atas tab nav agar konsisten, tanpa efek jumping
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
  } finally {
    _isTabSwitching = false;
  }
}

// ══════════════════════════════════════════════════════════════
// TAB: RINGKASAN
// ══════════════════════════════════════════════════════════════

async function loadRingkasan() {
  // Tanggal di header
  const today = new Date();
  const dateEl = document.getElementById('ringkasan-date');
  if (dateEl) {
    dateEl.textContent = today.toLocaleDateString('id-ID', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  const result = await callGAS('getStatistik', { token: getToken() });

  if (result.status !== 'ok') {
    showToast('Gagal memuat statistik: ' + result.message, 'danger');
    return;
  }

  // FIX A5: null/undefined guard — GAS mungkin return struktur tidak lengkap
  const d = result.data;
  if (!d) {
    showToast('Data statistik tidak valid. Coba lagi.', 'danger');
    return;
  }

  // ▶▶ MULTI-TAMU: ambil field baru dengan fallback ke field lama
  const hariIni   = d.hariIni  || { total: 0, hadir: 0, pulang: 0 };
  const bulanIni  = d.bulanIni || { total: 0, bulan: '' };
  const terbanyak = d.terbanyak || { jenis: '—', total: 0 };
  const perJenis  = d.perJenis  || [];
  const tren7Hari = d.tren7Hari || [];
  const totalSemua = d.totalSemua || 0;

  // ▶▶ Field multi-tamu (dengan fallback ke field lama agar backward-compat)
  const totalIndividuHariIni  = hariIni.totalIndividu  ?? hariIni.total;
  const totalRombonganHariIni = hariIni.totalRombongan ?? 0;
  const hadirIndividu         = hariIni.hadir          ?? 0;
  const pulangIndividu        = hariIni.pulang         ?? 0;
  const totalIndividuBulan    = bulanIni.totalIndividu ?? bulanIni.total;

  // ── Stat Cards ──────────────────────────────────────────────
  // ▶▶ Hari ini: tampilkan individu + info sesi
  setStatCard('stat-hari-ini',
    totalIndividuHariIni,
    `${hariIni.totalSesi ?? hariIni.total} sesi · ${hadirIndividu} hadir · ${pulangIndividu} pulang`);

  // ▶▶ Sedang hadir: individu
  setStatCard('stat-aktif',
    hadirIndividu,
    `${hariIni.hadirSesi ?? hadirIndividu} sesi aktif`);

  // ▶▶ Bulan ini: individu
  setStatCard('stat-bulan-ini',
    totalIndividuBulan,
    `Bulan ${_formatBulan(bulanIni.bulan)}`);

  setStatCard('stat-terbanyak',
    terbanyak.jenis,
    `${terbanyak.total} individu`, true);

  // ▶▶ Stat cards tambahan (rombongan & total semua)
  const totalIndSemua  = d.totalIndividuSemua ?? totalSemua;
  const totalRombSemua = d.totalRombonganSemua ?? 0;
  setStatCard('stat-total-semua',   totalIndSemua,  `${totalSemua} sesi total`);
  setStatCard('stat-rombongan',     totalRombSemua, 'sesi rombongan total');

  // ── Bar Chart Jenis Tamu ────────────────────────────────────
  renderBarChart(perJenis, totalIndSemua);

  const jenisTotalEl = document.getElementById('chart-jenis-total');
  if (jenisTotalEl) jenisTotalEl.textContent = `${totalIndSemua} individu`;

  // ── Trend Chart 7 Hari ──────────────────────────────────────
  renderTrendChart(tren7Hari);

  const trendTotalEl = document.getElementById('chart-trend-total');
  if (trendTotalEl) {
    // ▶▶ Tampilkan total individu 7 hari terakhir
    const sum7Ind  = tren7Hari.reduce((acc, item) => acc + (item.totalIndividu ?? item.total ?? 0), 0);
    const sum7Sesi = tren7Hari.reduce((acc, item) => acc + (item.totalSesi    ?? item.total ?? 0), 0);
    trendTotalEl.textContent = `${sum7Ind} individu · ${sum7Sesi} sesi / 7 hari`;
  }
}

/**
 * Update nilai stat card dengan animasi.
 */
function setStatCard(valueId, value, subText, isText = false) {
  const el    = document.getElementById(valueId);
  const subId = valueId + '-sub';
  const subEl = document.getElementById(subId);

  if (el) {
    // Hapus skeleton jika masih ada
    el.innerHTML = '';
    el.textContent = isText ? value : Number(value).toLocaleString('id-ID');
  }
  if (subEl && subText) subEl.textContent = subText;
}

// ── Bar Chart (CSS) ───────────────────────────────────────────
function renderBarChart(perJenis, totalSemua) {
  const container = document.getElementById('chart-jenis');
  if (!container) return;

  if (!perJenis || perJenis.length === 0) {
    container.innerHTML = '<p class="text-sm text-muted">Belum ada data.</p>';
    return;
  }

  const max = Math.max(...perJenis.map(j => j.total), 1);

  container.innerHTML = perJenis.map(item => {
    const pct = Math.round((item.total / max) * 100);
    return `
      <div class="bar-chart__item">
        <div class="bar-chart__label" title="${escapeHtml(item.jenis)}">${escapeHtml(item.jenis)}</div>
        <div class="bar-chart__bar-wrap">
          <div class="bar-chart__bar" style="width:${pct}%;" role="progressbar"
               aria-valuenow="${item.total}" aria-valuemax="${max}"
               aria-label="${escapeHtml(item.jenis)}: ${item.total} kunjungan">
          </div>
        </div>
        <div class="bar-chart__count">${item.total}</div>
      </div>`;
  }).join('');
}

// ── Trend Chart (CSS) ─────────────────────────────────────
function renderTrendChart(tren7Hari) {
  const chartEl  = document.getElementById('trend-chart');
  const labelsEl = document.getElementById('trend-labels');
  if (!chartEl || !labelsEl) return;

  if (!tren7Hari || tren7Hari.length === 0) {
    chartEl.innerHTML = '<p class="text-sm text-muted">Belum ada data.</p>';
    return;
  }

  // BUG D4 FIX: gunakan totalIndividu untuk tinggi bar (konsisten dengan label)
  // Fallback ke total (sesi) jika totalIndividu tidak tersedia (data lama)
  const getValue = item => item.totalIndividu ?? item.total ?? 0;
  const max = Math.max(...tren7Hari.map(getValue), 1);

  chartEl.innerHTML = tren7Hari.map(item => {
    const val        = getValue(item);
    const heightPct  = Math.round((val / max) * 100);
    return `<div class="trend-chart__bar"
               style="height:${Math.max(heightPct, 4)}%;"
               data-count="${val}"
               role="img"
               aria-label="${escapeHtml(item.label)}: ${val} individu">
            </div>`;
  }).join('');

  labelsEl.innerHTML = tren7Hari.map(item =>
    `<div class="trend-chart__label">${escapeHtml(item.label)}</div>`
  ).join('');
}

// ══════════════════════════════════════════════════════════════
// TAB: REKAP TAMU
// ══════════════════════════════════════════════════════════════

function setDefaultFilterDates() {
  const now    = new Date();
  const y      = now.getFullYear();
  const mo     = String(now.getMonth() + 1).padStart(2, '0');
  const d      = String(now.getDate()).padStart(2, '0');
  const today  = `${y}-${mo}-${d}`;
  const firstOfMonth = `${y}-${mo}-01`;

  const dariEl   = document.getElementById('filter-dari');
  const sampaiEl = document.getElementById('filter-sampai');
  if (dariEl)   dariEl.value   = firstOfMonth;
  if (sampaiEl) sampaiEl.value = today;
}

function populateFilterJenis() {
  const sel = document.getElementById('filter-jenis');
  if (!sel) return;
  // FIX A11: cek duplikasi — hanya tambahkan jika belum ada opsinya
  if (sel.options.length > 1) return; // sudah pernah diisi
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

  // Enter key pada search
  document.getElementById('filter-search')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { rekapPage = 1; loadRekap(); }
  });

  // FIX A14: event delegation untuk tombol detail di tabel rekap
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

  // FIX A14: event delegation untuk pagination
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

  // Skeleton
  showRekapSkeleton(true);

  const result = await callGAS('getTamu', {
    token    : getToken(),
    dari, sampai, jenisTamu, search,
    page : rekapPage,
    limit: REKAP_LIMIT,
  });

  showRekapSkeleton(false);

  if (result.status !== 'ok') {
    showToast('Gagal memuat rekap: ' + result.message, 'danger');
    // FIX A6: pastikan tabel kembali terlihat (tidak stuck di skeleton)
    const tableEl = document.getElementById('rekap-table-wrapper');
    const emptyEl = document.getElementById('rekap-empty');
    if (tableEl) tableEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = '';
    const countEl = document.getElementById('rekap-count');
    if (countEl) countEl.textContent = 'Gagal memuat data.';
    return;
  }

  rekapData  = result.data.tamu  || [];
  rekapTotal = result.data.total || 0;
  const pages = result.data.pages || 1;
  // ▶▶ MULTI-TAMU: total individu
  const totalIndividu = result.data.totalIndividu ?? rekapTotal;

  // Update count label
  const countEl = document.getElementById('rekap-count');
  if (countEl) {
    countEl.textContent = rekapTotal > 0
      ? `${rekapTotal} sesi · ${totalIndividu} individu (hal. ${rekapPage}/${pages})`
      : 'Tidak ada data';
  }

  renderRekapTable(rekapData);
  renderPagination(rekapPage, pages);

  // Empty state
  const emptyEl = document.getElementById('rekap-empty');
  const tableEl = document.getElementById('rekap-table-wrapper');
  if (emptyEl) emptyEl.style.display   = rekapData.length === 0 ? '' : 'none';
  if (tableEl) tableEl.style.display   = rekapData.length === 0 ? 'none' : '';
}

function renderRekapTable(data) {
  const tbody = document.getElementById('rekap-table-body');
  if (!tbody) return;

  tbody.innerHTML = data.map(t => {
    // ▶▶ MULTI-TAMU: nama ringkasan rombongan
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
          ${namaHtml}
          ${badgeRomb}
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
                aria-label="Detail ${escapeHtml(t.namaLengkap)}">
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

  let html = '';

  // Prev
  html += `<button class="pagination__btn" ${currentPage <= 1 ? 'disabled' : ''}
             data-page="${currentPage - 1}" aria-label="Halaman sebelumnya">‹</button>`;

  // Page numbers — tampilkan max 5 halaman di sekitar current
  const range = _pageRange(currentPage, totalPages);
  range.forEach(p => {
    if (p === '...') {
      html += `<span style="padding:0 var(--space-2);color:var(--clr-gray-400);">…</span>`;
    } else {
      html += `<button class="pagination__btn ${p === currentPage ? 'active' : ''}"
                 data-page="${p}" aria-label="Halaman ${p}"
                 aria-current="${p === currentPage ? 'page' : 'false'}">${p}</button>`;
    }
  });

  // Next
  html += `<button class="pagination__btn" ${currentPage >= totalPages ? 'disabled' : ''}
             data-page="${currentPage + 1}" aria-label="Halaman berikutnya">›</button>`;

  container.innerHTML = html;
}

async function goToPage(page) {
  rekapPage = page;
  await loadRekap();
  // Scroll ke atas tabel
  document.getElementById('pane-rekap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showRekapSkeleton(show) {
  const wrapper = document.getElementById('rekap-table-wrapper');
  const tbody   = document.getElementById('rekap-table-body');
  if (!show || !tbody) return;
  tbody.innerHTML = Array(5).fill(`
    <tr>
      ${Array(8).fill('<td><div class="skeleton skeleton--text" style="height:0.9em;"></div></td>').join('')}
    </tr>`).join('');
}

// ── Modal Detail Rekap ─────────────────────────────────────────
async function openRekapDetail(tamuId) {
  const modal   = document.getElementById('modal-detail');
  const content = document.getElementById('modal-detail-content');
  const title   = document.getElementById('modal-detail-title');
  const badges  = document.getElementById('modal-detail-badges');

  if (!modal) return;

  if (content) content.innerHTML = `
    <div style="text-align:center;padding:var(--space-8);">
      <div class="spinner" style="margin:0 auto;"></div>
    </div>`;
  if (badges)  badges.innerHTML  = '';
  if (title)   title.textContent = 'Detail Kunjungan';
  modal.classList.add('active');
  lockScroll();

  const result = await callGAS('getTamuById', { token: getToken(), id: tamuId });

  if (result.status !== 'ok') {
    if (content) content.innerHTML =
      `<div class="alert alert--danger">${escapeHtml(result.message)}</div>`;
    return;
  }

  const t = result.data;
  if (title) title.textContent = t.isRombongan
    ? `Rombongan — ${t.jumlahTamu} Tamu`
    : (t.namaLengkap || 'Detail Kunjungan');

  if (badges) badges.innerHTML = `
    <span class="badge badge--${t.status === 'Hadir' ? 'success' : 'gray'}">${escapeHtml(t.status)}</span>
    <span class="badge badge--primary">${escapeHtml(t.jenisTamu)}</span>
    ${t.isRombongan ? `<span class="badge-rombongan-sm" style="margin-left:4px;">${_icon('users','0.75rem')} ${t.jumlahTamu} Tamu</span>` : ''}`;

  const ttdHtml = t.tandaTangan
    ? `<div class="detail-signature"><img src="${t.tandaTangan}" alt="Tanda tangan" /></div>`
    : '<span class="text-muted">—</span>';

  const instansiLabel = t.jenisTamu === 'Orang Tua/Wali Murid'
    ? 'Orang Tua/Wali dari'
    : t.jenisTamu === 'Alumni' ? 'Tahun Lulus' : 'Instansi / Asal';

  // ▶▶ Daftar anggota rombongan
  const anggota = Array.isArray(t.dataAnggota) ? t.dataAnggota : [];
  let anggotaHtml = '';
  if (t.isRombongan && anggota.length > 0) {
    anggotaHtml = `
      <div class="detail-section-title" style="margin-top:var(--space-4);padding-top:var(--space-4);border-top:1px solid var(--clr-gray-100);">
        ${_icon('users','0.8rem')} Daftar Anggota (${anggota.length} orang)
      </div>
      <ol style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:var(--space-2);">
        ${anggota.map((a, i) => `
          <li style="background:var(--clr-gray-50);border:1px solid var(--clr-gray-200);border-radius:var(--radius-lg);padding:var(--space-3) var(--space-4);">
            <div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap;">
              <span style="width:22px;height:22px;border-radius:50%;background:${i===0?'var(--clr-primary)':'var(--clr-gray-300)'};color:${i===0?'white':'var(--clr-gray-700)'};font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">${i+1}</span>
              <strong style="font-size:var(--font-size-sm);">${escapeHtml(a.namaLengkap||'—')}</strong>
              ${i===0?'<span style="font-size:10px;background:var(--clr-primary);color:white;padding:1px 7px;border-radius:999px;font-weight:700;">Wakil</span>':''}
              ${a.jabatan?`<span style="font-size:11px;color:var(--clr-gray-500);background:var(--clr-gray-200);padding:1px 7px;border-radius:999px;">${escapeHtml(a.jabatan)}</span>`:''}
            </div>
            ${(a.noHp||a.email)?`<div style="font-size:var(--font-size-xs);color:var(--clr-gray-500);margin-top:4px;display:flex;gap:var(--space-3);flex-wrap:wrap;">
              ${a.noHp?`<span style="display:flex;align-items:center;gap:3px;">${_icon('phone','0.75rem')} ${escapeHtml(a.noHp)}</span>`:''}
              ${a.email?`<span style="display:flex;align-items:center;gap:3px;">${_icon('mail','0.75rem')} ${escapeHtml(a.email)}</span>`:''}
            </div>`:''}
          </li>`).join('')}
      </ol>`;
  }

  if (content) content.innerHTML = `
    <div class="detail-row"><div class="detail-row__label">Tanggal</div><div class="detail-row__value">${displayVal(formatTanggalDisplay(t.tanggal))}</div></div>
    <div class="detail-row"><div class="detail-row__label">Jam Datang</div><div class="detail-row__value">${displayVal(t.jamDatang)}</div></div>
    <div class="detail-row"><div class="detail-row__label">Jam Pulang</div><div class="detail-row__value">${t.jamPulang || '<span class="text-muted">Belum pulang</span>'}</div></div>
    <div class="detail-row"><div class="detail-row__label">${escapeHtml(instansiLabel)}</div><div class="detail-row__value">${displayVal(t.instansi)}</div></div>
    <div class="detail-row"><div class="detail-row__label">Keperluan</div><div class="detail-row__value" style="white-space:pre-wrap;">${displayVal(t.keperluan)}</div></div>
    <div class="detail-row"><div class="detail-row__label">Bertemu</div><div class="detail-row__value">${displayVal(t.bertemuDengan)}</div></div>
    ${!t.isRombongan ? `
    <div class="detail-row"><div class="detail-row__label">Nama</div><div class="detail-row__value">${displayVal(t.namaLengkap)}</div></div>
    <div class="detail-row"><div class="detail-row__label">No. HP/WA</div><div class="detail-row__value">${displayVal(t.noHp)}</div></div>
    <div class="detail-row"><div class="detail-row__label">Email</div><div class="detail-row__value">${displayVal(t.email)}</div></div>` : ''}
    ${anggotaHtml}
    <div class="detail-row" style="margin-top:var(--space-4);"><div class="detail-row__label">Tanda Tangan</div><div class="detail-row__value">${ttdHtml}</div></div>
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
  // FIX A13: null guard — btn bisa null jika elemen tidak ditemukan
  const btn    = document.getElementById('btn-export');
  if (btn) setButtonLoading(btn);

  const dari   = document.getElementById('filter-dari')?.value   || '';
  const sampai = document.getElementById('filter-sampai')?.value || '';
  const jenis  = document.getElementById('filter-jenis')?.value  || '';

  const result = await callGAS('exportData', {
    token: getToken(), dari, sampai, jenisTamu: jenis,
  });

  if (btn) resetButtonLoading(btn, false);

  if (result.status !== 'ok') {
    showToast('Gagal export: ' + result.message, 'danger');
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
 * ▶▶ MULTI-TAMU: Generate CSV dari array sesi kunjungan.
 * Satu rombongan = satu baris per anggota (dengan info sesi diulang).
 */
function generateCSV(data) {
  const headers = [
    'ID Sesi', 'Tanggal', 'Jenis Tamu', 'Jam Datang', 'Jam Pulang', 'Status',
    'Jumlah Tamu', 'Instansi', 'Keperluan', 'Bertemu Dengan',
    'No. Anggota', 'Nama Anggota', 'No. HP Anggota', 'Email Anggota', 'Jabatan Anggota'
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
        idx + 1, a.namaLengkap || '', a.noHp || '', a.email || '', a.jabatan || ''
      ].map(v => `"${String(v || '').replace(/"/g, '""')}"`));
    });
  });

  return [headers.map(h => `"${h}"`).join(','), ...rows.map(r => r.join(','))].join('\r\n');
}

/**
 * Trigger download file CSV di browser.
 */
function downloadCSV(csvString, filename) {
  const bom  = '\uFEFF'; // BOM untuk Excel agar baca UTF-8 dengan benar
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
// TAB: MANAJEMEN STAF
// ══════════════════════════════════════════════════════════════

function attachStafEvents() {
  // Tombol Tambah Staf
  document.getElementById('btn-tambah-staf')?.addEventListener('click', () => {
    openStafForm(null);
  });

  // Batal form staf
  document.getElementById('btn-cancel-staf')?.addEventListener('click', closeStafForm);

  // Submit form staf
  document.getElementById('staf-form')?.addEventListener('submit', handleStafSubmit);

  // FIX A14: event delegation untuk tombol edit & toggle staf
  // Dipasang sekali di container, bukan per-card (aman meski list di-render ulang)
  const stafList = document.getElementById('staf-list');
  if (stafList) {
    stafList.addEventListener('click', e => {
      const editBtn   = e.target.closest('.staf-edit-btn');
      const toggleBtn = e.target.closest('.staf-toggle-btn');

      if (editBtn) {
        const id = editBtn.dataset.id;
        if (id) openStafForm(id);
      } else if (toggleBtn) {
        const id = toggleBtn.dataset.id;
        if (id) toggleStaf(id);
      }
    });
  }
}

async function loadStaf() {
  const listEl   = document.getElementById('staf-list');
  const emptyEl  = document.getElementById('staf-empty');

  // Skeleton sudah ada di HTML, hapus jika sudah pernah load
  if (allStaf.length === 0) {
    // Tampilkan skeleton (sudah ada di HTML)
  }

  const result = await callGAS('getAllStaf', { token: getToken() });

  if (result.status !== 'ok') {
    showToast('Gagal memuat staf: ' + result.message, 'danger');
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
    // Mode edit — isi form dengan data existing
    const staf = allStaf.find(s => s.id === stafId);
    if (!staf) return;

    if (formTitle) formTitle.textContent = `Edit Staf: ${staf.nama}`;
    if (idInput)   idInput.value   = staf.id;
    if (namaInput) namaInput.value = staf.nama;
    if (jabInput)  jabInput.value  = staf.jabatan;
  } else {
    // Mode tambah
    if (formTitle) formTitle.textContent = 'Tambah Staf Baru';
    if (idInput)   idInput.value   = '';
    if (namaInput) namaInput.value = '';
    if (jabInput)  jabInput.value  = '';
  }

  if (formCard) {
    formCard.classList.add('visible');
    formCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  if (btnTambah) btnTambah.setAttribute('aria-expanded', 'true');
  namaInput?.focus();
}

function closeStafForm() {
  editingStafId = null;
  const formCard  = document.getElementById('staf-form-card');
  const btnTambah = document.getElementById('btn-tambah-staf');
  if (formCard)  formCard.classList.remove('visible');
  if (btnTambah) btnTambah.setAttribute('aria-expanded', 'false');
  document.getElementById('staf-form')?.reset();
}

async function handleStafSubmit(e) {
  e.preventDefault();

  const btn     = document.getElementById('btn-save-staf');
  const nama    = document.getElementById('staf-nama')?.value.trim()    || '';
  const jabatan = document.getElementById('staf-jabatan')?.value.trim() || '';

  if (!nama || !jabatan) {
    showToast('Nama dan jabatan wajib diisi.', 'danger');
    return;
  }

  setButtonLoading(btn);

  let result;
  if (editingStafId) {
    result = await callGAS('updateStaf', {
      token: getToken(), id: editingStafId, nama, jabatan,
    });
  } else {
    result = await callGAS('addStaf', {
      token: getToken(), nama, jabatan,
    });
  }

  resetButtonLoading(btn, false);

  if (result.status === 'ok') {
    showToast(result.message, 'success');
    closeStafForm();
    await loadStaf(); // reload list
  } else {
    showToast(result.message || 'Gagal menyimpan staf.', 'danger');
  }
}

async function toggleStaf(stafId) {
  const staf = allStaf.find(s => s.id === stafId);
  if (!staf) return;

  const action = staf.aktif ? 'nonaktifkan' : 'aktifkan';
  const konfirmasi = confirm(`${staf.aktif ? 'Nonaktifkan' : 'Aktifkan'} staf "${staf.nama}"?`);
  if (!konfirmasi) return;

  const result = await callGAS('toggleStafAktif', {
    token: getToken(), id: stafId,
  });

  if (result.status === 'ok') {
    showToast(result.message, 'success');
    await loadStaf();
  } else {
    showToast(result.message || `Gagal ${action} staf.`, 'danger');
  }
}

// ══════════════════════════════════════════════════════════════
// NOTIFIKASI IN-APP (polling)
// ══════════════════════════════════════════════════════════════

function startNotifPolling() {
  if (notifTimer) clearInterval(notifTimer);
  notifTimer = setInterval(checkNotif, CONFIG.NOTIF_INTERVAL);
}

async function checkNotif() {
  const result = await callGAS('getTamuAktif', { token: getToken() }).catch(() => null);
  if (!result || result.status !== 'ok') return;

  const count = (result.data.tamu || []).length;
  const countEl = document.getElementById('notif-count');

  if (lastNotifCount >= 0 && count > lastNotifCount) {
    const diff = count - lastNotifCount;

    // Badge di navbar
    if (countEl) {
      countEl.textContent = diff;
      countEl.style.display = '';
    }

    // Banner
    const banner = document.getElementById('notif-banner');
    if (banner) {
      banner.textContent = `Ada tamu baru masuk. Klik untuk melihat di tab Rekap.`;
      banner.classList.add('visible');
    }
  }

  lastNotifCount = count;
}

// ── Modal & Keyboard Events ────────────────────────────────────
function attachModalEvents() {
  // Close button modal detail
  document.getElementById('btn-close-detail')?.addEventListener('click', closeRekapDetail);

  // Klik backdrop modal detail
  const modalDetail = document.getElementById('modal-detail');
  if (modalDetail) {
    modalDetail.addEventListener('click', e => {
      if (e.target === modalDetail) closeRekapDetail();
    });
  }

  // Notif banner: klik → tutup + switch ke tab rekap
  const notifBanner = document.getElementById('notif-banner');
  if (notifBanner) {
    notifBanner.addEventListener('click', async () => {
      notifBanner.classList.remove('visible');
      const countEl = document.getElementById('notif-count');
      if (countEl) countEl.style.display = 'none';
      await switchTab('rekap');
    });
    // FIX A12: keyboard handler agar bisa diaktifkan via Enter/Space
    notifBanner.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        notifBanner.classList.remove('visible');
        const countEl = document.getElementById('notif-count');
        if (countEl) countEl.style.display = 'none';
        await switchTab('rekap');
      }
    });
  }

  // Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeRekapDetail();
  });
}

// ── Private Helpers ───────────────────────────────────────────

/**
 * Format "YYYY-MM" → "Januari 2026"
 */
function _formatBulan(yyyyMM) {
  if (!yyyyMM) return '';
  const [y, m] = yyyyMM.split('-');
  const bulanNames = [
    '', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  return `${bulanNames[parseInt(m, 10)] || m} ${y}`;
}

/**
 * Buat range nomor halaman untuk pagination (dengan elipsis).
 * @param {number} current
 * @param {number} total
 * @returns {Array<number|string>}
 */
function _pageRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = [];
  pages.push(1);
  if (current > 3)           pages.push('...');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    pages.push(i);
  }
  if (current < total - 2)   pages.push('...');
  pages.push(total);
  return pages;
}


// ══════════════════════════════════════════════════════════════
// TAB: MANAJEMEN SISWA
// ══════════════════════════════════════════════════════════════

let allSiswa        = [];
let editingSiswaId  = null;
let _siswaSearchVal = '';

function attachSiswaEvents() {
  document.getElementById('btn-tambah-siswa')?.addEventListener('click', () => {
    openSiswaForm(null);
  });

  document.getElementById('btn-cancel-siswa')?.addEventListener('click', closeSiswaForm);

  document.getElementById('siswa-form')?.addEventListener('submit', handleSiswaSubmit);

  // Event delegation untuk list siswa
  const siswaListEl = document.getElementById('siswa-list');
  if (siswaListEl) {
    siswaListEl.addEventListener('click', e => {
      const editBtn   = e.target.closest('.siswa-edit-btn');
      const toggleBtn = e.target.closest('.siswa-toggle-btn');
      if (editBtn)   openSiswaForm(editBtn.dataset.id);
      else if (toggleBtn) toggleSiswa(toggleBtn.dataset.id);
    });
  }

  // Pencarian live
  const searchEl = document.getElementById('siswa-search');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      _siswaSearchVal = searchEl.value.trim().toLowerCase();
      _renderFilteredSiswa();
    });
  }
}

async function loadSiswa() {
  const result = await callGAS('getAllSiswa', { token: getToken() });

  if (result.status !== 'ok') {
    showToast('Gagal memuat siswa: ' + result.message, 'danger');
    return;
  }

  allSiswa = result.data || [];
  _renderFilteredSiswa();
}

function _renderFilteredSiswa() {
  const filtered = _siswaSearchVal
    ? allSiswa.filter(s =>
        s.namaLengkap.toLowerCase().includes(_siswaSearchVal) ||
        s.kelas.toLowerCase().includes(_siswaSearchVal)
      )
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

  const formCard  = document.getElementById('siswa-form-card');
  const formTitle = document.getElementById('siswa-form-title');
  const idInput   = document.getElementById('siswa-id');
  const namaInput = document.getElementById('siswa-nama');
  const kelasInput = document.getElementById('siswa-kelas');
  const btnTambah = document.getElementById('btn-tambah-siswa');

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

  if (formCard) {
    formCard.classList.add('visible');
    formCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  if (btnTambah) btnTambah.setAttribute('aria-expanded', 'true');
  namaInput?.focus();
}

function closeSiswaForm() {
  editingSiswaId = null;
  const formCard  = document.getElementById('siswa-form-card');
  const btnTambah = document.getElementById('btn-tambah-siswa');
  if (formCard)  formCard.classList.remove('visible');
  if (btnTambah) btnTambah.setAttribute('aria-expanded', 'false');
  document.getElementById('siswa-form')?.reset();
}

async function handleSiswaSubmit(e) {
  e.preventDefault();

  const btn        = document.getElementById('btn-save-siswa');
  const nama       = document.getElementById('siswa-nama')?.value.trim()  || '';
  const kelas      = document.getElementById('siswa-kelas')?.value.trim() || '';

  if (!nama || !kelas) {
    showToast('Nama lengkap dan kelas wajib diisi.', 'danger');
    return;
  }

  setButtonLoading(btn);

  let result;
  if (editingSiswaId) {
    result = await callGAS('updateSiswa', {
      token: getToken(), id: editingSiswaId, namaLengkap: nama, kelas,
    });
  } else {
    result = await callGAS('addSiswa', {
      token: getToken(), namaLengkap: nama, kelas,
    });
  }

  resetButtonLoading(btn, false);

  if (result.status === 'ok') {
    showToast(result.message, 'success');
    closeSiswaForm();
    await loadSiswa();
  } else {
    showToast(result.message || 'Gagal menyimpan siswa.', 'danger');
  }
}

async function toggleSiswa(siswaId) {
  const siswa = allSiswa.find(s => s.id === siswaId);
  if (!siswa) return;

  const konfirmasi = confirm(
    `${siswa.aktif ? 'Nonaktifkan' : 'Aktifkan'} siswa "${siswa.namaLengkap}" (${siswa.kelas})?`
  );
  if (!konfirmasi) return;

  const result = await callGAS('toggleSiswaAktif', {
    token: getToken(), id: siswaId,
  });

  if (result.status === 'ok') {
    showToast(result.message, 'success');
    await loadSiswa();
  } else {
    showToast(result.message || 'Gagal mengubah status siswa.', 'danger');
  }
}

// ══════════════════════════════════════════════════════════════
// TAB: PENGATURAN SEKOLAH
// ══════════════════════════════════════════════════════════════

/**
 * Inisialisasi tab pengaturan — register semua event listeners.
 * Dipanggil sekali saat switchTab('pengaturan').
 */
let _pengaturanInitialized = false;

async function loadPengaturan() {
  // Fetch config dari GAS
  const result = await callGAS('getConfig').catch(() => null);
  const config = (result?.status === 'ok' && result.data) ? result.data : {};

  // Jika fetch gagal total, tampilkan pesan tapi tetap lanjutkan isi form
  // (nilai akan kosong, form tetap bisa digunakan)
  if (!result || result.status !== 'ok') {
    console.warn('loadPengaturan: gagal fetch config, form akan kosong.');
  }

  // ── Isi form identitas ──────────────────────────────────────
  _setVal('set-nama-sekolah',   config.nama_sekolah    || '');
  _setVal('set-kepala-sekolah', config.kepala_sekolah  || '');
  _setVal('set-alamat',         config.alamat_sekolah  || '');
  _setVal('set-tahun-ajaran',   config.tahun_ajaran    || '');

  // ── Isi form logo sekolah ───────────────────────────────────
  _setVal('set-logo-url', config.logo_url || '');
  _applyLogoPreview('sekolah', config.logo_url || '');

  // ── Isi form logo aplikasi ──────────────────────────────────
  _setVal('set-logo-app-url', config.logo_app_url || '');
  _applyLogoPreview('app', config.logo_app_url || '');

  // ── Update live preview header ──────────────────────────────
  _updatePreviewHeader(config);

  // ── Register events (sekali saja) ──────────────────────────
  if (!_pengaturanInitialized) {
    _initPengaturanEvents();
    _pengaturanInitialized = true;
  }
}

// ── Register semua event listener pengaturan ──────────────────
function _initPengaturanEvents() {

  // ── Form Identitas Submit ───────────────────────────────────
  document.getElementById('form-identitas')
    ?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btn-save-identitas');

      const namaSekolah = _getVal('set-nama-sekolah').trim();
      if (!namaSekolah) {
        showToast('Nama sekolah tidak boleh kosong.', 'danger');
        document.getElementById('set-nama-sekolah')?.focus();
        return;
      }

      setButtonLoading(btn);

      const result = await callGAS('updateConfigBatch', {
        token  : getToken(),
        updates: {
          nama_sekolah   : namaSekolah,
          kepala_sekolah : _getVal('set-kepala-sekolah'),
          alamat_sekolah : _getVal('set-alamat'),
          tahun_ajaran   : _getVal('set-tahun-ajaran'),
        },
      });

      resetButtonLoading(btn, false);

      if (result.status === 'ok') {
        showToast('Identitas sekolah berhasil disimpan.', 'success');
        _showSavedIndicator('form-identitas');

        // Update live preview header & navbar
        _updatePreviewHeader({
          nama_sekolah  : _getVal('set-nama-sekolah'),
          alamat_sekolah: _getVal('set-alamat'),
          logo_url      : _getVal('set-logo-url'),
        });
        _updateNavbarName(_getVal('set-nama-sekolah'));

      } else {
        showToast(result.message || 'Gagal menyimpan identitas.', 'danger');
      }
    });

  // ── Input identitas → live update preview ───────────────────
  ['set-nama-sekolah', 'set-alamat'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      _updatePreviewHeader({
        nama_sekolah  : _getVal('set-nama-sekolah'),
        alamat_sekolah: _getVal('set-alamat'),
        logo_url      : _getVal('set-logo-url'),
      });
    });
  });

  // ── Form Logo Sekolah ───────────────────────────────────────
  document.getElementById('btn-preview-logo-sekolah')
    ?.addEventListener('click', () => {
      _applyLogoPreview('sekolah', _getVal('set-logo-url'));
    });

  document.getElementById('set-logo-url')
    ?.addEventListener('input', () => {
      // Reset preview ke placeholder saat URL diubah
      _resetLogoPreview('sekolah');
    });

  document.getElementById('form-logo-sekolah')
    ?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btn-save-logo-sekolah');
      const url = _getVal('set-logo-url').trim();

      // Validasi: jika ada URL, cek bisa diload
      if (url && !_isValidUrl(url)) {
        showToast('URL logo tidak valid. Pastikan dimulai dengan https://', 'danger');
        return;
      }

      setButtonLoading(btn);

      const result = await callGAS('updateConfig', {
        token: getToken(),
        key  : 'logo_url',
        value: url,
      });

      resetButtonLoading(btn, false);

      if (result.status === 'ok') {
        showToast(url ? 'Logo sekolah berhasil disimpan.' : 'Logo sekolah berhasil dihapus.', 'success');
        _applyLogoPreview('sekolah', url);
        _updatePreviewHeader({
          nama_sekolah  : _getVal('set-nama-sekolah'),
          alamat_sekolah: _getVal('set-alamat'),
          logo_url      : url,
        });
      } else {
        showToast(result.message || 'Gagal menyimpan logo.', 'danger');
      }
    });

  document.getElementById('btn-hapus-logo-sekolah')
    ?.addEventListener('click', async () => {
      if (!confirm('Hapus logo sekolah? Header form tamu akan kembali menampilkan ikon default.')) return;

      _setVal('set-logo-url', '');
      const btn = document.getElementById('btn-save-logo-sekolah');
      setButtonLoading(btn);

      const result = await callGAS('updateConfig', {
        token: getToken(),
        key  : 'logo_url',
        value: '',
      });

      resetButtonLoading(btn, false);

      if (result.status === 'ok') {
        showToast('Logo sekolah berhasil dihapus.', 'success');
        _applyLogoPreview('sekolah', '');
        _updatePreviewHeader({
          nama_sekolah  : _getVal('set-nama-sekolah'),
          alamat_sekolah: _getVal('set-alamat'),
          logo_url      : '',
        });
      } else {
        showToast(result.message || 'Gagal menghapus logo.', 'danger');
      }
    });

  // ── Form Logo Aplikasi ──────────────────────────────────────
  document.getElementById('btn-preview-logo-app')
    ?.addEventListener('click', () => {
      _applyLogoPreview('app', _getVal('set-logo-app-url'));
    });

  document.getElementById('set-logo-app-url')
    ?.addEventListener('input', () => {
      _resetLogoPreview('app');
    });

  document.getElementById('form-logo-app')
    ?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btn-save-logo-app');
      const url = _getVal('set-logo-app-url').trim();

      if (url && !_isValidUrl(url)) {
        showToast('URL logo aplikasi tidak valid.', 'danger');
        return;
      }

      setButtonLoading(btn);

      const result = await callGAS('updateConfig', {
        token: getToken(),
        key  : 'logo_app_url',
        value: url,
      });

      resetButtonLoading(btn, false);

      if (result.status === 'ok') {
        showToast(url ? 'Logo aplikasi berhasil disimpan.' : 'Logo aplikasi berhasil dihapus.', 'success');
        _applyLogoPreview('app', url);
        // Update navbar logo live
        _updateNavbarLogo(url);
      } else {
        showToast(result.message || 'Gagal menyimpan logo aplikasi.', 'danger');
      }
    });

  document.getElementById('btn-hapus-logo-app')
    ?.addEventListener('click', async () => {
      if (!confirm('Hapus logo aplikasi? Navbar akan kembali ke ikon default.')) return;

      _setVal('set-logo-app-url', '');
      const btn = document.getElementById('btn-save-logo-app');
      setButtonLoading(btn);

      const result = await callGAS('updateConfig', {
        token: getToken(),
        key  : 'logo_app_url',
        value: '',
      });

      resetButtonLoading(btn, false);

      if (result.status === 'ok') {
        showToast('Logo aplikasi berhasil dihapus.', 'success');
        _applyLogoPreview('app', '');
        _updateNavbarLogo('');
      } else {
        showToast(result.message || 'Gagal menghapus logo.', 'danger');
      }
    });
}

// ── Live Preview Helpers ───────────────────────────────────────

/**
 * Apply logo ke preview box.
 * @param {'sekolah'|'app'} type
 * @param {string} url
 */
function _applyLogoPreview(type, url) {
  const previewId  = `preview-logo-${type}`;
  const fallbackId = `preview-logo-${type}-fallback`;
  const statusId   = `preview-logo-${type}-status`;

  const box      = document.getElementById(previewId);
  const fallback = document.getElementById(fallbackId);
  const status   = document.getElementById(statusId);

  if (!box) return;

  // Hapus img lama jika ada
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

  // Buat img baru dan test load
  const img = document.createElement('img');
  img.alt = `Logo ${type}`;
  img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;';

  img.onload = () => {
    box.classList.add('has-image');
    box.classList.remove('error');
    if (fallback) fallback.style.display = 'none';
    if (status) {
      status.textContent = 'Gambar berhasil dimuat';
      status.className   = 'logo-preview-box__desc success';
    }
  };

  img.onerror = () => {
    img.remove();
    box.classList.add('error');
    box.classList.remove('has-image');
    if (fallback) fallback.style.display = '';
    if (status) {
      status.textContent = 'Gagal memuat gambar';
      status.className   = 'logo-preview-box__desc error';
    }
  };

  // Set src SETELAH handler di-assign agar onload tidak terlewat
  // pada gambar yang sudah di-cache browser.
  img.src = normalizeLogoUrl(url);

  // Jika gambar sudah di-cache, onload mungkin tidak fired di beberapa browser.
  // Cek langsung via .complete dan .naturalWidth sebagai fallback.
  if (img.complete && img.naturalWidth > 0) {
    img.onload();
  }

  box.appendChild(img);
}

/**
 * Reset logo preview ke state kosong/default.
 * @param {'sekolah'|'app'} type
 */
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

/**
 * Update pratinjau header di tab pengaturan.
 * @param {{ nama_sekolah, alamat_sekolah, logo_url }} config
 */
function _updatePreviewHeader(config) {
  const nameEl  = document.getElementById('settings-preview-name');
  const addrEl  = document.getElementById('settings-preview-addr');
  const logoBox = document.getElementById('settings-preview-logo');
  const logoIcon = document.getElementById('settings-preview-logo-icon');

  if (nameEl) nameEl.textContent = config.nama_sekolah  || 'Nama Sekolah';
  if (addrEl) addrEl.textContent = config.alamat_sekolah || 'Alamat Sekolah';

  if (logoBox && logoIcon) {
    // Hapus img lama
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

/**
 * Update nama sekolah di navbar live.
 * @param {string} nama
 */
function _updateNavbarName(nama) {
  const el = document.getElementById('nav-school-name');
  if (el && nama) el.textContent = nama;
}

/**
 * Update logo di navbar live (brand icon).
 * Menargetkan #navbar-logo-wrap — menggantikan SVG default dengan <img> saat logo tersedia.
 * @param {string} url
 */
function _updateNavbarLogo(url) {
  const iconEl = document.getElementById('navbar-logo-wrap');
  if (!iconEl) return;

  // Hapus img lama jika ada
  const oldImg = iconEl.querySelector('img');
  if (oldImg) oldImg.remove();

  // SVG default (icon book-open) — sembunyikan/tampilkan sesuai keadaan
  const svgIcon = iconEl.querySelector('svg, i');

  if (url) {
    const img     = document.createElement('img');
    img.src       = normalizeLogoUrl(url);
    img.alt       = 'Logo sekolah';
    img.className = 'navbar__brand-logo-img';

    img.onload  = () => {
      if (svgIcon) svgIcon.style.display = 'none';
    };
    img.onerror = () => {
      img.remove();
      if (svgIcon) svgIcon.style.display = '';
    };

    iconEl.appendChild(img);
  } else {
    if (svgIcon) svgIcon.style.display = '';
  }
}

/**
 * Tampilkan indikator "Tersimpan ✓" di samping tombol simpan.
 * @param {string} formId
 */
function _showSavedIndicator(formId) {
  const form = document.getElementById(formId);
  if (!form) return;

  // Cari atau buat indikator
  let indicator = form.querySelector('.settings-saved-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = 'settings-saved-indicator';
    indicator.innerHTML = `${_icon('check','0.85rem')}<span>Tersimpan</span>`;
    const actionsEl = form.querySelector('.settings-actions');
    if (actionsEl) actionsEl.appendChild(indicator);
  }

  indicator.classList.add('visible');
  setTimeout(() => indicator.classList.remove('visible'), 3000);
}

// ── Utility Helpers ───────────────────────────────────────────

/** Ambil value dari input/textarea/select by ID */
function _getVal(id) {
  return document.getElementById(id)?.value || '';
}

/** Set value input/textarea by ID */
function _setVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value || '';
}

/** Validasi URL dasar (https:// atau http://) */
function _isValidUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Normalisasi URL Google Drive — lihat normalizeLogoUrl() di api.js.
 * Alias lokal untuk kemudahan akses di admin.js.
 */
