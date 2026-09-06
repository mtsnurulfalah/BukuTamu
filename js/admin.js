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

async function switchTab(tabId) {
  if (activeTab === tabId) return;

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

  // Load data sesuai tab
  if (tabId === 'ringkasan') await loadRingkasan();
  if (tabId === 'rekap')     await loadRekap();
  if (tabId === 'staf')      await loadStaf();
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

  const d = result.data;

  // ── Stat Cards ──────────────────────────────────────────────
  setStatCard('stat-hari-ini',    d.hariIni.total,
    `${d.hariIni.hadir} hadir, ${d.hariIni.pulang} pulang`);

  setStatCard('stat-aktif',       d.hariIni.hadir,    'tamu aktif saat ini');

  setStatCard('stat-bulan-ini',   d.bulanIni.total,
    `Bulan ${_formatBulan(d.bulanIni.bulan)}`);

  setStatCard('stat-terbanyak',   d.terbanyak.jenis,
    `${d.terbanyak.total} kunjungan`, true);

  // ── Bar Chart Jenis Tamu ────────────────────────────────────
  renderBarChart(d.perJenis, d.totalSemua);

  // ── Trend Chart 7 Hari ──────────────────────────────────────
  renderTrendChart(d.tren7Hari);
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

// ── Trend Chart (CSS) ─────────────────────────────────────────
function renderTrendChart(tren7Hari) {
  const chartEl  = document.getElementById('trend-chart');
  const labelsEl = document.getElementById('trend-labels');
  if (!chartEl || !labelsEl) return;

  if (!tren7Hari || tren7Hari.length === 0) {
    chartEl.innerHTML = '<p class="text-sm text-muted">Belum ada data.</p>';
    return;
  }

  const max = Math.max(...tren7Hari.map(d => d.total), 1);

  chartEl.innerHTML = tren7Hari.map(d => {
    const heightPct = Math.round((d.total / max) * 100);
    return `<div class="trend-chart__bar"
               style="height:${Math.max(heightPct, 4)}%;"
               data-count="${d.total}"
               role="img"
               aria-label="${d.label}: ${d.total} tamu">
            </div>`;
  }).join('');

  labelsEl.innerHTML = tren7Hari.map(d =>
    `<div class="trend-chart__label">${escapeHtml(d.label)}</div>`
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
  JENIS_TAMU.forEach(j => {
    const opt = document.createElement('option');
    opt.value = j; opt.textContent = j;
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
    return;
  }

  rekapData  = result.data.tamu  || [];
  rekapTotal = result.data.total || 0;
  const pages = result.data.pages || 1;

  // Update count label
  const countEl = document.getElementById('rekap-count');
  if (countEl) {
    countEl.textContent = rekapTotal > 0
      ? `${rekapTotal} data ditemukan (halaman ${rekapPage} dari ${pages})`
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

  tbody.innerHTML = data.map(t => `
    <tr>
      <td>${escapeHtml(formatTanggalDisplay(t.tanggal))}</td>
      <td>
        <div style="font-weight:600;white-space:normal;min-width:120px;">${escapeHtml(t.namaLengkap)}</div>
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
        <button class="btn btn--secondary btn--sm"
                onclick="openRekapDetail('${escapeHtml(t.id)}')"
                aria-label="Detail ${escapeHtml(t.namaLengkap)}">
          🔍 Detail
        </button>
      </td>
    </tr>`).join('');
}

function renderPagination(currentPage, totalPages) {
  const container = document.getElementById('rekap-pagination');
  if (!container) return;

  if (totalPages <= 1) { container.innerHTML = ''; return; }

  let html = '';

  // Prev
  html += `<button class="pagination__btn" ${currentPage <= 1 ? 'disabled' : ''}
             onclick="goToPage(${currentPage - 1})" aria-label="Halaman sebelumnya">‹</button>`;

  // Page numbers — tampilkan max 5 halaman di sekitar current
  const range = _pageRange(currentPage, totalPages);
  range.forEach(p => {
    if (p === '...') {
      html += `<span style="padding:0 var(--space-2);color:var(--clr-gray-400);">…</span>`;
    } else {
      html += `<button class="pagination__btn ${p === currentPage ? 'active' : ''}"
                 onclick="goToPage(${p})" aria-label="Halaman ${p}"
                 aria-current="${p === currentPage ? 'page' : 'false'}">${p}</button>`;
    }
  });

  // Next
  html += `<button class="pagination__btn" ${currentPage >= totalPages ? 'disabled' : ''}
             onclick="goToPage(${currentPage + 1})" aria-label="Halaman berikutnya">›</button>`;

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

  const result = await callGAS('getTamuById', { token: getToken(), id: tamuId });

  if (result.status !== 'ok') {
    if (content) content.innerHTML =
      `<div class="alert alert--danger">${escapeHtml(result.message)}</div>`;
    return;
  }

  const t = result.data;
  if (title) title.textContent = t.namaLengkap;

  if (badges) badges.innerHTML = `
    <span class="badge badge--${t.status === 'Hadir' ? 'success' : 'gray'}">${escapeHtml(t.status)}</span>
    <span class="badge badge--primary">${escapeHtml(t.jenisTamu)}</span>`;

  const ttdHtml = t.tandaTangan
    ? `<div class="detail-signature">
         <img src="${t.tandaTangan}" alt="Tanda tangan ${escapeHtml(t.namaLengkap)}" />
       </div>`
    : '<span class="text-muted">—</span>';

  if (content) content.innerHTML = `
    <div class="detail-row"><div class="detail-row__label">Tanggal</div><div class="detail-row__value">${displayVal(formatTanggalDisplay(t.tanggal))}</div></div>
    <div class="detail-row"><div class="detail-row__label">Jam Datang</div><div class="detail-row__value">${displayVal(t.jamDatang)}</div></div>
    <div class="detail-row"><div class="detail-row__label">Jam Pulang</div><div class="detail-row__value">${t.jamPulang || '<span class="text-muted">Belum pulang</span>'}</div></div>
    <div class="detail-row"><div class="detail-row__label">Nama</div><div class="detail-row__value">${displayVal(t.namaLengkap)}</div></div>
    <div class="detail-row"><div class="detail-row__label">Instansi</div><div class="detail-row__value">${displayVal(t.instansi)}</div></div>
    <div class="detail-row"><div class="detail-row__label">No. HP/WA</div><div class="detail-row__value">${displayVal(t.noHp)}</div></div>
    <div class="detail-row"><div class="detail-row__label">Email</div><div class="detail-row__value">${displayVal(t.email)}</div></div>
    <div class="detail-row"><div class="detail-row__label">Keperluan</div><div class="detail-row__value" style="white-space:pre-wrap;">${displayVal(t.keperluan)}</div></div>
    <div class="detail-row"><div class="detail-row__label">Bertemu</div><div class="detail-row__value">${displayVal(t.bertemuDengan)}</div></div>
    <div class="detail-row"><div class="detail-row__label">Tanda Tangan</div><div class="detail-row__value">${ttdHtml}</div></div>
    ${t.diupdateOleh ? `<div class="detail-row"><div class="detail-row__label">Dicatat oleh</div><div class="detail-row__value">${displayVal(t.diupdateOleh)}</div></div>` : ''}
  `;
}

function closeRekapDetail() {
  const modal = document.getElementById('modal-detail');
  if (modal) modal.classList.remove('active');
}

// ── Export CSV ─────────────────────────────────────────────────
async function handleExport() {
  const btn    = document.getElementById('btn-export');
  const dari   = document.getElementById('filter-dari')?.value   || '';
  const sampai = document.getElementById('filter-sampai')?.value || '';
  const jenis  = document.getElementById('filter-jenis')?.value  || '';

  setButtonLoading(btn);

  const result = await callGAS('exportData', {
    token: getToken(), dari, sampai, jenisTamu: jenis,
  });

  resetButtonLoading(btn, false);

  if (result.status !== 'ok') {
    showToast('Gagal export: ' + result.message, 'danger');
    return;
  }

  const data = result.data.tamu || [];
  if (data.length === 0) {
    showToast('Tidak ada data untuk diexport.', 'default');
    return;
  }

  // Generate CSV
  const csv = generateCSV(data);
  downloadCSV(csv, `buku-tamu-${dari || 'semua'}-${sampai || 'semua'}.csv`);
  showToast(`${data.length} data berhasil diexport ke CSV. ✅`, 'success');
}

/**
 * Generate string CSV dari array of objects.
 */
function generateCSV(data) {
  const headers = [
    'ID', 'Tanggal', 'Jenis Tamu', 'Jam Datang',
    'Nama Lengkap', 'Instansi', 'No. HP/WA', 'Email',
    'Keperluan', 'Bertemu Dengan', 'Jam Pulang', 'Status'
  ];

  const rows = data.map(t => [
    t.id, t.tanggal, t.jenisTamu, t.jamDatang,
    t.namaLengkap, t.instansi, t.noHp, t.email,
    t.keperluan, t.bertemuDengan, t.jamPulang, t.status
  ].map(v => `"${String(v || '').replace(/"/g, '""')}"`));

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
        <button class="btn btn--secondary btn--sm"
                onclick="openStafForm('${escapeHtml(s.id)}')"
                aria-label="Edit ${escapeHtml(s.nama)}">
          ✏️
        </button>
        <button class="btn btn--sm ${s.aktif ? 'btn--outline' : 'btn--success'}"
                onclick="toggleStaf('${escapeHtml(s.id)}')"
                aria-label="${s.aktif ? 'Nonaktifkan' : 'Aktifkan'} ${escapeHtml(s.nama)}">
          ${s.aktif ? '🔴' : '🟢'}
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
      banner.textContent = `🔔 ${diff} tamu baru masuk. Klik untuk melihat di tab Rekap.`;
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
