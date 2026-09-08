/**
 * satpam.js — Dashboard Satpam v2.1
 * ─────────────────────────────────────────────────────────
 * Fitur:
 *   - Daftar tamu aktif: rombongan tampil sebagai 1 baris
 *   - Badge rombongan & jumlah individu
 *   - Modal detail rombongan lengkap + daftar semua anggota
 *   - Catat pulang berlaku untuk seluruh sesi rombongan
 *   - Edit kunjungan: ubah data sesi + tambah/hapus/ubah anggota
 *   - Stats strip: hadir sesi + hadir individu
 *   - Pencarian cukup dengan nama salah satu anggota
 *
 * CHANGELOG v2.1:
 *   - FIX S1: try/catch di loadTamuAktif()
 *   - FIX S2: try/catch di loadSchoolConfig()
 *   - FIX S3: ganti onclick inline → event delegation di renderCards/renderTable
 *   - FIX S4/S12: isConfirmingPulang guard mencegah double-submit catat pulang
 *   - FIX S5: ganti confirm() blocking di hapus anggota → toast dua-klik
 *   - FIX S6: try/catch di _submitEditForm
 *   - FIX S7: try/catch di openDetail dan openEditModal
 *   - FIX S9: beforeunload membersihkan refreshTimer
 *   - FIX S11: ganti querySelector fragile dengan getElementById di openCatatPulang
 *   - FIX S13: null guard svgIcon di _updateNavbarLogo
 */

'use strict';

// ── State ─────────────────────────────────────────────────────
let allTamuAktif      = [];
let filteredTamu      = [];
let refreshTimer      = null;
let lastCount         = -1;
let sudahPulangCount  = 0;
let selectedTamuId    = null;
let session           = null;

// FIX S4/S12: guard double-submit catat pulang
let isConfirmingPulang = false;

// Edit state
let editTamuData = null;

// FIX S5: pending hapus anggota (ganti confirm() blocking)
const _pendingHapusAnggota = new Map(); // Map<index_string, timeoutId>

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  session = await checkAuth(ROLES.SATPAM);
  if (!session) return;

  initNavbar(session);
  loadSchoolConfig();          // fire-and-forget; tidak blocking
  await loadTamuAktif();
  startAutoRefresh();
  attachEvents();
});

// FIX S9: bersihkan timer saat halaman di-unload
window.addEventListener('beforeunload', () => {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
});

// ── Load School Config ────────────────────────────────────────
// FIX S2: try/catch agar kegagalan tidak crash halaman
async function loadSchoolConfig() {
  try {
    const result = await callGAS('getConfig');
    if (result?.status === 'ok' && result.data) {
      const nama = result.data.nama_sekolah || CONFIG.APP_NAME;
      const navName = document.getElementById('nav-school-name');
      if (navName) navName.textContent = nama;
      document.title = `Dashboard Satpam — ${nama}`;
      if (result.data.logo_app_url) _updateNavbarLogo(result.data.logo_app_url);
    }
  } catch (_) {
    // Config gagal — tampilan default tetap digunakan
  }
}

// FIX S13: null guard untuk svgIcon
function _updateNavbarLogo(url) {
  const iconEl = document.getElementById('navbar-logo-wrap');
  if (!iconEl) return;

  const oldImg = iconEl.querySelector('img');
  if (oldImg) oldImg.remove();

  // FIX S13: querySelector bisa return null setelah logo sebelumnya dihapus
  const svgIcon = iconEl.querySelector('svg, i[data-lucide]');

  if (url) {
    const img     = document.createElement('img');
    img.src       = normalizeLogoUrl(url);
    img.alt       = 'Logo sekolah';
    img.className = 'navbar__brand-logo-img';
    img.onload    = () => { if (svgIcon) svgIcon.style.display = 'none'; };
    img.onerror   = () => { img.remove(); if (svgIcon) svgIcon.style.display = ''; };
    iconEl.appendChild(img);
  } else {
    if (svgIcon) svgIcon.style.display = '';
  }
}

// ── Load Tamu Aktif ────────────────────────────────────────────
// FIX S1: try/catch agar kegagalan GAS tidak crash halaman
async function loadTamuAktif(silent = false) {
  if (!silent) showSkeleton(true);

  let result;
  try {
    result = await callGAS('getTamuAktif', { token: getToken() });
  } catch (_) {
    result = { status: 'error', message: 'Koneksi gagal.' };
  }

  if (result.status === 'ok') {
    const newData  = result.data?.tamu || [];
    const newCount = newData.length;

    if (lastCount >= 0 && newCount > lastCount) {
      const diff = newCount - lastCount;
      showNotifBanner(`Ada ${diff} tamu baru masuk. Klik untuk memperbarui.`);
    }

    lastCount    = newCount;
    allTamuAktif = newData;
    applySearch();
    updateStatsStrip(
      allTamuAktif,
      sudahPulangCount,
      result.data?.totalIndividu ?? newCount
    );

  } else {
    showToast('Gagal memuat data: ' + (result.message || 'Coba lagi'), 'danger');
  }

  if (!silent) hideSkeleton();
  updateRefreshTime();
}

// ── Update Stats Strip ────────────────────────────────────────
function updateStatsStrip(data, sudahPulang = 0, totalIndividuAktif) {
  const sesiAktif    = data.length;
  const individAktif = totalIndividuAktif !== undefined
    ? totalIndividuAktif
    : data.reduce((s, t) => s + (t.jumlahTamu || 1), 0);

  const elSesi    = document.getElementById('stat-sesi-aktif');
  const elInd     = document.getElementById('stat-aktif');
  const elHariIni = document.getElementById('stat-hari-ini');
  const elPulang  = document.getElementById('stat-pulang');
  const elBadge   = document.getElementById('active-count');

  if (elSesi)    elSesi.textContent   = sesiAktif;
  if (elInd)     elInd.textContent    = individAktif;
  if (elHariIni) elHariIni.textContent= individAktif + sudahPulang;
  if (elPulang)  elPulang.textContent = sudahPulang;
  if (elBadge) {
    elBadge.textContent   = individAktif;
    elBadge.style.display = individAktif > 0 ? '' : 'none';
  }
}

// ── Apply Search Filter ───────────────────────────────────────
function applySearch() {
  const searchVal = (document.getElementById('search-input')?.value || '')
    .trim().toLowerCase();

  if (!searchVal) {
    filteredTamu = [...allTamuAktif];
  } else {
    filteredTamu = allTamuAktif.filter(t => {
      if (
        (t.namaLengkap || '').toLowerCase().includes(searchVal) ||
        (t.instansi    || '').toLowerCase().includes(searchVal) ||
        (t.keperluan   || '').toLowerCase().includes(searchVal)
      ) return true;

      if (Array.isArray(t.dataAnggota)) {
        return t.dataAnggota.some(a =>
          (a.namaLengkap || '').toLowerCase().includes(searchVal) ||
          (a.jabatan     || '').toLowerCase().includes(searchVal)
        );
      }
      return false;
    });
  }

  renderTamu();
}

// ── Render Tamu ───────────────────────────────────────────────
// FIX S8: gunakan window.matchMedia yang lebih robust
function renderTamu() {
  const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
  if (isDesktop) { renderTable(); showView('table'); }
  else           { renderCards(); showView('cards'); }

  const emptyState = document.getElementById('empty-state');
  if (emptyState) emptyState.style.display = filteredTamu.length === 0 ? '' : 'none';
}

function showView(view) {
  const cardList  = document.getElementById('tamu-card-list');
  const tableWrap = document.getElementById('tamu-table-wrap');
  if (cardList)  cardList.style.display  = view === 'cards' ? '' : 'none';
  if (tableWrap) tableWrap.style.display = view === 'table' ? '' : 'none';
}

// ── Helper: Render nama rombongan ─────────────────────────────
function _namaRombongan(tamu) {
  if (!tamu.isRombongan) return escapeHtml(tamu.namaLengkap);
  const anggota = Array.isArray(tamu.dataAnggota) ? tamu.dataAnggota : [];
  const shown   = anggota.slice(0, 3).map(a => escapeHtml(a.namaLengkap || '—')).join(', ');
  const sisa    = anggota.length - 3;
  return sisa > 0
    ? `${shown} <span class="badge-sisa">+${sisa}</span>`
    : shown;
}

function _badgeTamu(tamu) {
  if (!tamu.isRombongan) return '';
  return `<span class="badge-rombongan">${_icon('users','0.75rem')} ${tamu.jumlahTamu} Tamu</span>`;
}

// ── Render Cards (Mobile) ─────────────────────────────────────
// FIX S3: tidak lagi pakai onclick inline — gunakan data-action + event delegation
function renderCards() {
  const container = document.getElementById('tamu-card-list');
  if (!container) return;
  if (filteredTamu.length === 0) { container.innerHTML = ''; return; }

  container.innerHTML = filteredTamu.map(tamu => `
    <article class="tamu-card${tamu.isRombongan ? ' tamu-card--rombongan' : ''}"
      role="listitem" data-id="${escapeHtml(tamu.id)}">
      <div class="tamu-card__header">
        <div class="tamu-card__header-left">
          <div class="tamu-card__name">${_namaRombongan(tamu)}</div>
          <div class="tamu-card__meta">${escapeHtml(tamu.instansi)}</div>
          ${_badgeTamu(tamu)}
        </div>
        <span class="badge badge--success">Hadir</span>
      </div>
      <div class="tamu-card__body">
        <div class="tamu-card__field">
          <label>Jenis</label>
          <span>${escapeHtml(tamu.jenisTamu)}</span>
        </div>
        <div class="tamu-card__field">
          <label>Jam Datang</label>
          <span>${escapeHtml(tamu.jamDatang)}</span>
        </div>
        <div class="tamu-card__field">
          <label>Keperluan</label>
          <span>${escapeHtml(tamu.keperluan)}</span>
        </div>
        <div class="tamu-card__field">
          <label>Bertemu</label>
          <span>${escapeHtml(tamu.bertemuDengan)}</span>
        </div>
      </div>
      <div class="tamu-card__actions">
        <button class="btn btn-pulang btn--sm"
          data-action="pulang" data-id="${escapeHtml(tamu.id)}"
          aria-label="Catat pulang ${escapeHtml(tamu.namaLengkap || 'tamu')}">
          ${_icon('check','0.85rem')} Catat Pulang
        </button>
        <button class="btn btn-detail btn--sm"
          data-action="detail" data-id="${escapeHtml(tamu.id)}"
          aria-label="Lihat detail ${escapeHtml(tamu.namaLengkap || 'tamu')}">
          ${_icon('search','0.85rem')} Detail
        </button>
      </div>
    </article>
  `).join('');
}

// ── Render Table (Desktop) ────────────────────────────────────
// FIX S3: tidak lagi pakai onclick inline
function renderTable() {
  const tbody = document.getElementById('tamu-table-body');
  if (!tbody) return;

  if (filteredTamu.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted"
      style="padding:var(--space-8);">Tidak ada tamu aktif</td></tr>`;
    return;
  }

  tbody.innerHTML = filteredTamu.map(tamu => `
    <tr data-id="${escapeHtml(tamu.id)}"
      class="${tamu.isRombongan ? 'tr--rombongan' : ''}">
      <td>
        <div style="font-weight:600;">${_namaRombongan(tamu)}</div>
        <div class="text-xs text-muted">${escapeHtml(tamu.instansi)}</div>
        ${_badgeTamu(tamu)}
      </td>
      <td><span class="badge badge--primary">${escapeHtml(tamu.jenisTamu)}</span></td>
      <td>${escapeHtml(tamu.jamDatang)}</td>
      <td style="max-width:180px;white-space:normal;">${escapeHtml(tamu.keperluan)}</td>
      <td>${escapeHtml(tamu.bertemuDengan)}</td>
      <td style="text-align:center;font-weight:700;color:var(--clr-primary);">
        ${tamu.jumlahTamu || 1}
      </td>
      <td>
        <div class="tabel-actions">
          <button class="btn btn--success btn--sm"
            data-action="pulang" data-id="${escapeHtml(tamu.id)}"
            aria-label="Catat pulang">
            ${_icon('check','0.85rem')} Pulang
          </button>
          <button class="btn btn--secondary btn--sm"
            data-action="detail" data-id="${escapeHtml(tamu.id)}"
            aria-label="Lihat detail">
            ${_icon('search','0.85rem')}
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

// ── Catat Pulang ──────────────────────────────────────────────
function openCatatPulang(tamuId) {
  const tamu = allTamuAktif.find(t => t.id === tamuId);
  if (!tamu) return;

  selectedTamuId = tamuId;

  // FIX S11: ganti querySelector fragile dengan getElementById
  const namEl  = document.getElementById('pulang-nama');
  const metaEl = document.getElementById('pulang-meta');
  // Avatar masih pakai querySelector tapi lebih spesifik ke ID container
  const avatarEl = document.getElementById('pulang-avatar-icon');

  if (avatarEl) {
    avatarEl.innerHTML = _icon(tamu.isRombongan ? 'users' : 'user', '1.4rem');
  }

  if (namEl) {
    namEl.textContent = tamu.isRombongan
      ? `Rombongan ${tamu.jumlahTamu} orang`
      : tamu.namaLengkap;
  }
  if (metaEl) {
    metaEl.textContent = tamu.isRombongan
      ? `Wakil: ${tamu.namaLengkap} · Datang: ${tamu.jamDatang} · ${tamu.bertemuDengan}`
      : `${tamu.jenisTamu} · Datang: ${tamu.jamDatang} · ${tamu.bertemuDengan}`;
  }

  const jamInput = document.getElementById('input-jam-pulang');
  if (jamInput) {
    const now = new Date();
    jamInput.value = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  }

  // Reset state tombol confirm
  const btnConfirm = document.getElementById('btn-confirm-pulang');
  if (btnConfirm) {
    btnConfirm.classList.remove('loading');
    btnConfirm.disabled = false;
  }
  isConfirmingPulang = false;

  const sheet = document.getElementById('sheet-pulang');
  if (sheet) sheet.classList.add('active');
  lockScroll();
  setTimeout(() => document.getElementById('input-jam-pulang')?.focus(), 100);
}

function closeCatatPulang() {
  const sheet = document.getElementById('sheet-pulang');
  if (sheet) sheet.classList.remove('active');
  unlockScroll();
  selectedTamuId     = null;
  isConfirmingPulang = false;
}

// FIX S4/S12: guard double-submit
async function confirmCatatPulang() {
  if (!selectedTamuId || isConfirmingPulang) return;

  const jamInput   = document.getElementById('input-jam-pulang');
  const btnConfirm = document.getElementById('btn-confirm-pulang');
  const jamPulang  = jamInput?.value || '';

  if (!jamPulang) {
    showToast('Jam pulang wajib diisi.', 'danger');
    jamInput?.focus();
    return;
  }
  if (!/^\d{2}:\d{2}$/.test(jamPulang)) {
    showToast('Format jam tidak valid.', 'danger');
    return;
  }

  const tamuIdToUpdate = selectedTamuId;
  isConfirmingPulang   = true;
  if (btnConfirm) setButtonLoading(btnConfirm);

  let result;
  try {
    result = await callGAS('updateJamPulang', {
      token    : getToken(),
      id       : tamuIdToUpdate,
      jamPulang: jamPulang,
    });
  } catch (_) {
    result = { status: 'error', message: 'Koneksi gagal.' };
  }

  isConfirmingPulang = false;

  if (result.status === 'ok') {
    closeCatatPulang();
    const d           = result.data;
    const namaDisplay = (d?.jumlahTamu || 1) > 1
      ? `Rombongan ${d.jumlahTamu} orang`
      : (d?.nama || 'Tamu');
    const individu    = d?.jumlahTamu || 1;

    showToast(`${namaDisplay} berhasil dicatat pulang jam ${jamPulang}.`, 'success');

    allTamuAktif     = allTamuAktif.filter(t => t.id !== tamuIdToUpdate);
    sudahPulangCount += individu;
    lastCount        = allTamuAktif.length;
    applySearch();

    const individAktifSisa = allTamuAktif.reduce((s, t) => s + (t.jumlahTamu || 1), 0);
    updateStatsStrip(allTamuAktif, sudahPulangCount, individAktifSisa);
  } else {
    showToast(result.message || 'Gagal mencatat jam pulang.', 'danger');
    if (btnConfirm) resetButtonLoading(btnConfirm, false);
  }
}

// ── Modal Detail ──────────────────────────────────────────────
// FIX S7: try/catch per callGAS
async function openDetail(tamuId) {
  const modal   = document.getElementById('modal-detail');
  const content = document.getElementById('modal-detail-content');
  const title   = document.getElementById('modal-detail-title');
  if (!modal) return;

  if (content) content.innerHTML = `
    <div style="text-align:center;padding:var(--space-8);">
      <div class="spinner" style="margin:0 auto;"></div>
      <p class="text-sm text-muted" style="margin-top:var(--space-3);">Memuat detail...</p>
    </div>`;

  const modalBox = modal.querySelector('.modal');
  if (modalBox) modalBox.scrollTop = 0;
  modal.classList.add('active');
  lockScroll();

  let result;
  try {
    result = await callGAS('getTamuById', { token: getToken(), id: tamuId });
  } catch (_) {
    if (content) content.innerHTML =
      `<div class="alert alert--danger">Koneksi gagal. Coba lagi.</div>`;
    return;
  }

  if (result.status !== 'ok') {
    if (content) content.innerHTML =
      `<div class="alert alert--danger">${escapeHtml(result.message || 'Gagal memuat detail.')}</div>`;
    return;
  }

  const t = result.data;
  if (title) {
    title.textContent = t.isRombongan
      ? `Rombongan — ${t.jumlahTamu} Tamu`
      : (t.namaLengkap || 'Detail Tamu');
  }

  const tanggalDisplay = formatTanggalDisplay(t.tanggal);
  const instansiLabel  = t.jenisTamu === 'Orang Tua/Wali Murid' ? 'Orang Tua/Wali dari'
    : t.jenisTamu === 'Alumni' ? 'Tahun Lulus' : 'Instansi / Asal';

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
              ${a.noHp  ? `<span style="display:flex;align-items:center;gap:3px;">${_icon('phone','0.75rem')} ${escapeHtml(a.noHp)}</span>` : ''}
              ${a.email ? `<span style="display:flex;align-items:center;gap:3px;">${_icon('mail','0.75rem')} ${escapeHtml(a.email)}</span>` : ''}
            </div>` : ''}
          </li>
        `).join('')}
      </ol>`;
  }

  const ttdHtml = t.tandaTangan
    ? `<div class="detail-signature"><img src="${t.tandaTangan}" alt="Tanda tangan" /></div>`
    : '<span class="text-muted">—</span>';

  const canEdit = typeof getRole === 'function'
    ? (getRole() === 'admin' || getRole() === ROLES.SATPAM)
    : true;

  // FIX S3: ganti onclick inline dengan data-action
  const editBtn = canEdit ? `
    <div style="display:flex;gap:var(--space-3);margin-top:var(--space-5);">
      <button class="btn btn--secondary btn--sm"
        data-action="edit" data-id="${escapeHtml(t.id)}">
        ${_icon('pencil','0.85rem')} Edit Kunjungan
      </button>
    </div>` : '';

  if (content) content.innerHTML = `
    <div class="detail-badges" style="display:flex;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-3);">
      <span class="badge badge--${t.status === 'Hadir' ? 'success' : 'gray'}">${escapeHtml(t.status)}</span>
      <span class="badge badge--primary">${escapeHtml(t.jenisTamu)}</span>
      ${t.isRombongan ? `<span class="badge-rombongan">${_icon('users','0.75rem')} ${t.jumlahTamu} Tamu</span>` : ''}
    </div>
    <div class="detail-row"><div class="detail-row__label">Tanggal</div><div class="detail-row__value">${displayVal(tanggalDisplay)}</div></div>
    <div class="detail-row"><div class="detail-row__label">Jam Datang</div><div class="detail-row__value">${displayVal(t.jamDatang)}</div></div>
    <div class="detail-row"><div class="detail-row__label">Jam Pulang</div><div class="detail-row__value">${t.jamPulang || '<span class="text-muted">Belum pulang</span>'}</div></div>
    <div class="detail-row"><div class="detail-row__label">${escapeHtml(instansiLabel)}</div><div class="detail-row__value">${displayVal(t.instansi)}</div></div>
    <div class="detail-row"><div class="detail-row__label">Keperluan</div><div class="detail-row__value" style="white-space:pre-wrap;">${displayVal(t.keperluan)}</div></div>
    <div class="detail-row"><div class="detail-row__label">Bertemu</div><div class="detail-row__value">${displayVal(t.bertemuDengan)}</div></div>
    ${!t.isRombongan ? `
    <div class="detail-row"><div class="detail-row__label">No. HP/WA</div><div class="detail-row__value">${displayVal(t.noHp)}</div></div>
    <div class="detail-row"><div class="detail-row__label">Email</div><div class="detail-row__value">${displayVal(t.email)}</div></div>` : ''}
    ${anggotaHtml}
    <div class="detail-row" style="margin-top:var(--space-4);">
      <div class="detail-row__label">Tanda Tangan</div>
      <div class="detail-row__value">${ttdHtml}</div>
    </div>
    ${t.diupdateOleh ? `<div class="detail-row"><div class="detail-row__label">Dicatat oleh</div><div class="detail-row__value">${displayVal(t.diupdateOleh)}</div></div>` : ''}
    ${editBtn}
  `;
}

function closeDetail() {
  const modal = document.getElementById('modal-detail');
  if (modal) modal.classList.remove('active');
  unlockScroll();
}

// ── Edit Kunjungan ────────────────────────────────────────────
// FIX S7: try/catch per callGAS
async function openEditModal(tamuId) {
  closeDetail();

  const modal   = document.getElementById('modal-edit');
  const content = document.getElementById('modal-edit-content');
  if (!modal) return;

  if (content) content.innerHTML = `
    <div style="text-align:center;padding:var(--space-8);">
      <div class="spinner" style="margin:0 auto;"></div>
      <p class="text-sm text-muted" style="margin-top:var(--space-3);">Memuat data...</p>
    </div>`;
  modal.classList.add('active');
  lockScroll();

  let result;
  try {
    result = await callGAS('getTamuById', { token: getToken(), id: tamuId });
  } catch (_) {
    if (content) content.innerHTML =
      `<div class="alert alert--danger">Koneksi gagal. Coba lagi.</div>`;
    return;
  }

  if (result.status !== 'ok') {
    if (content) content.innerHTML =
      `<div class="alert alert--danger">${escapeHtml(result.message || 'Gagal memuat data.')}</div>`;
    return;
  }

  editTamuData = result.data;
  _renderEditForm(editTamuData);
}

function _renderEditForm(t) {
  const content = document.getElementById('modal-edit-content');
  if (!content) return;

  const anggota = Array.isArray(t.dataAnggota) && t.dataAnggota.length > 0
    ? t.dataAnggota
    : [{ namaLengkap: t.namaLengkap, noHp: t.noHp, email: t.email, jabatan: '', jenisId: '', noId: '' }];

  const anggotaRowsHtml = anggota.map((a, i) => _buildEditAnggotaRow(i, a)).join('');

  content.innerHTML = `
    <div class="edit-section-title">${_icon('clipboard-list','0.85rem')} Info Kunjungan</div>

    <div class="form-grid-2" style="margin-bottom:var(--space-4);">
      <div class="form-group">
        <label class="form-label" for="edit-jam-datang">Jam Datang</label>
        <input type="time" id="edit-jam-datang" class="form-control"
          value="${escapeAttrVal(t.jamDatang)}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="edit-jam-pulang">Jam Pulang</label>
        <input type="time" id="edit-jam-pulang" class="form-control"
          value="${escapeAttrVal(t.jamPulang)}" />
      </div>
    </div>

    <div class="form-group">
      <label class="form-label" for="edit-instansi">Instansi / Asal</label>
      <input type="text" id="edit-instansi" class="form-control"
        value="${escapeAttrVal(t.instansi)}" />
    </div>
    <div class="form-group">
      <label class="form-label" for="edit-keperluan">Keperluan</label>
      <textarea id="edit-keperluan" class="form-control" rows="2">${escapeHtml(t.keperluan)}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label" for="edit-bertemu">Bertemu Dengan</label>
      <input type="text" id="edit-bertemu" class="form-control"
        value="${escapeAttrVal(t.bertemuDengan)}" />
    </div>

    <div class="edit-section-title" style="margin-top:var(--space-2);">
      ${_icon('users','0.85rem')} Anggota Rombongan
      <span class="edit-anggota-count" id="edit-anggota-count">(${anggota.length} orang)</span>
    </div>

    <div id="edit-anggota-list">
      ${anggotaRowsHtml}
    </div>

    <button type="button" class="btn-tambah-tamu" id="btn-edit-tambah-anggota"
      style="margin-bottom:var(--space-4);">
      ${_icon('plus','0.85rem')} Tambah Anggota
    </button>

    <div class="edit-actions">
      <button type="button" class="btn btn--secondary" id="btn-edit-batal">Batal</button>
      <button type="button" class="btn btn--primary" id="btn-edit-simpan">
        <span class="btn__spinner"></span>
        <span class="btn__text">Simpan Perubahan</span>
      </button>
    </div>
  `;

  _attachEditFormEvents(t.id);
}

function _buildEditAnggotaRow(index, data) {
  const isFirst = index === 0;
  return `
    <div class="edit-anggota-row" data-index="${index}" id="edit-row-${index}">
      <div class="edit-anggota-row__header">
        <span class="edit-anggota-row__nomor">${index + 1}</span>
        <span class="edit-anggota-row__label">
          Tamu ${index + 1}${isFirst ? ' (Wakil)' : ''}
        </span>
        ${!isFirst ? `<button type="button" class="btn-hapus-anggota"
          data-index="${index}" aria-label="Hapus tamu ${index + 1}"
          title="Hapus tamu ini">${_icon('trash-2','0.85rem')}</button>` : ''}
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">Nama <span class="required">*</span></label>
          <input type="text" class="form-control edit-anggota-nama"
            data-index="${index}" value="${escapeAttrVal(data.namaLengkap)}"
            placeholder="Nama lengkap" />
        </div>
        <div class="form-group">
          <label class="form-label">No. HP</label>
          <input type="tel" class="form-control edit-anggota-nohp"
            data-index="${index}" value="${escapeAttrVal(data.noHp)}"
            placeholder="08xx-xxxx" />
        </div>
        <div class="form-group">
          <label class="form-label">
            Email ${isFirst ? '<span class="required">*</span>' : ''}
          </label>
          <input type="email" class="form-control edit-anggota-email"
            data-index="${index}" value="${escapeAttrVal(data.email)}"
            placeholder="${isFirst ? 'nama@email.com' : 'Opsional'}" />
        </div>
        <div class="form-group">
          <label class="form-label">Jabatan</label>
          <input type="text" class="form-control edit-anggota-jabatan"
            data-index="${index}" value="${escapeAttrVal(data.jabatan)}"
            placeholder="Opsional" />
        </div>
      </div>
    </div>
  `;
}

function escapeAttrVal(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _attachEditFormEvents(tamuId) {
  const modal = document.getElementById('modal-edit');
  if (!modal) return;

  // Tambah anggota
  modal.querySelector('#btn-edit-tambah-anggota')?.addEventListener('click', () => {
    const list  = modal.querySelector('#edit-anggota-list');
    const count = list ? list.querySelectorAll('.edit-anggota-row').length : 0;
    if (list) {
      list.insertAdjacentHTML('beforeend',
        _buildEditAnggotaRow(count, { namaLengkap: '', noHp: '', email: '', jabatan: '' })
      );
      _updateEditAnggotaCount();
      // FIX UX: fokus ke input nama anggota baru
      const newRow = list.lastElementChild;
      newRow?.querySelector('.edit-anggota-nama')?.focus();
    }
  });

  // FIX S5: ganti confirm() blocking → toast dua-klik dengan Map
  modal.querySelector('#edit-anggota-list')?.addEventListener('click', e => {
    const btn = e.target.closest('.btn-hapus-anggota');
    if (!btn) return;

    const idx     = parseInt(btn.getAttribute('data-index'), 10);
    const rows    = modal.querySelectorAll('.edit-anggota-row');
    const key     = String(idx);

    if (rows.length <= 1) {
      showToast('Minimal harus ada 1 anggota.', 'danger');
      return;
    }

    // FIX S5: konfirmasi dua-klik
    if (_pendingHapusAnggota.has(key)) {
      clearTimeout(_pendingHapusAnggota.get(key));
      _pendingHapusAnggota.delete(key);
      // Eksekusi hapus
      rows[idx]?.remove();
      // Re-index semua baris yang tersisa
      modal.querySelectorAll('.edit-anggota-row').forEach((row, i) => {
        row.setAttribute('data-index', i);
        row.id = `edit-row-${i}`;
        const nomor = row.querySelector('.edit-anggota-row__nomor');
        const label = row.querySelector('.edit-anggota-row__label');
        if (nomor) nomor.textContent = i + 1;
        if (label) label.textContent = `Tamu ${i + 1}${i === 0 ? ' (Wakil)' : ''}`;
        row.querySelectorAll('[data-index]').forEach(el => el.setAttribute('data-index', i));
        const hapusBtn = row.querySelector('.btn-hapus-anggota');
        if (i === 0 && hapusBtn) hapusBtn.remove();
        else if (i > 0 && !hapusBtn) {
          const hdr = row.querySelector('.edit-anggota-row__header');
          if (hdr) hdr.insertAdjacentHTML('beforeend',
            `<button type="button" class="btn-hapus-anggota" data-index="${i}"
              aria-label="Hapus tamu ${i + 1}">${_icon('trash-2','0.85rem')}</button>`);
        }
      });
      _updateEditAnggotaCount();
    } else {
      showToast(`Klik lagi untuk menghapus Tamu ${idx + 1}.`, 'default', 3000);
      const tid = setTimeout(() => _pendingHapusAnggota.delete(key), 3000);
      _pendingHapusAnggota.set(key, tid);
    }
  });

  modal.querySelector('#btn-edit-simpan')?.addEventListener('click', () => _submitEditForm(tamuId));
  modal.querySelector('#btn-edit-batal')?.addEventListener('click', closeEditModal);
}

function _updateEditAnggotaCount() {
  const modal = document.getElementById('modal-edit');
  if (!modal) return;
  const count = modal.querySelectorAll('.edit-anggota-row').length;
  const el    = modal.querySelector('#edit-anggota-count');
  if (el) el.textContent = `(${count} orang)`;
}

// FIX S6: try/catch di _submitEditForm
async function _submitEditForm(tamuId) {
  const modal   = document.getElementById('modal-edit');
  const btnSave = modal?.querySelector('#btn-edit-simpan');
  if (!modal) return;

  const anggota = [];
  const rows    = modal.querySelectorAll('.edit-anggota-row');
  let valid     = true;

  rows.forEach((row, i) => {
    const nama    = row.querySelector('.edit-anggota-nama')?.value.trim()    || '';
    const noHp    = row.querySelector('.edit-anggota-nohp')?.value.trim()    || '';
    const email   = row.querySelector('.edit-anggota-email')?.value.trim().toLowerCase() || '';
    const jabatan = row.querySelector('.edit-anggota-jabatan')?.value.trim() || '';

    if (!nama) { showToast(`Nama tamu ${i + 1} wajib diisi.`, 'danger'); valid = false; }
    if (i === 0 && !email) { showToast('Email tamu pertama wajib diisi.', 'danger'); valid = false; }
    anggota.push({ namaLengkap: nama, noHp, email, jabatan, jenisId: '', noId: '' });
  });

  if (!valid) return;

  const payload = {
    token        : getToken(),
    id           : tamuId,
    instansi     : modal.querySelector('#edit-instansi')?.value.trim()    || '',
    keperluan    : modal.querySelector('#edit-keperluan')?.value.trim()    || '',
    bertemuDengan: modal.querySelector('#edit-bertemu')?.value.trim()     || '',
    jamDatang    : modal.querySelector('#edit-jam-datang')?.value         || '',
    jamPulang    : modal.querySelector('#edit-jam-pulang')?.value         || '',
    anggota,
  };

  if (btnSave) setButtonLoading(btnSave);

  let result;
  try {
    result = await callGAS('updateTamu', payload);
  } catch (_) {
    result = { status: 'error', message: 'Koneksi gagal.' };
  }

  if (result.status === 'ok') {
    closeEditModal();
    showToast('Data kunjungan berhasil diperbarui.', 'success');
    await loadTamuAktif(true);
  } else {
    showToast(result.message || 'Gagal menyimpan perubahan.', 'danger');
    if (btnSave) resetButtonLoading(btnSave, false);
  }
}

function closeEditModal() {
  const modal = document.getElementById('modal-edit');
  if (modal) modal.classList.remove('active');
  unlockScroll();
  editTamuData = null;
  _pendingHapusAnggota.clear();
}

// ── Notifikasi ────────────────────────────────────────────────
function showNotifBanner(message) {
  const banner = document.getElementById('notif-banner');
  if (!banner) return;
  banner.textContent = message;
  banner.classList.add('visible');
}

function hideNotifBanner() {
  const banner = document.getElementById('notif-banner');
  if (banner) banner.classList.remove('visible');
}

// ── Auto Refresh ──────────────────────────────────────────────
function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(async () => { await loadTamuAktif(true); }, CONFIG.REFRESH_INTERVAL);
}

function stopAutoRefresh() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

function updateRefreshTime() {
  const el = document.getElementById('last-refresh');
  if (!el) return;
  const now = new Date();
  el.textContent = `Terakhir diperbarui: ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
}

// ── Skeleton ──────────────────────────────────────────────────
function showSkeleton(show) {
  const skeleton  = document.getElementById('skeleton-loader');
  const cardList  = document.getElementById('tamu-card-list');
  const tableWrap = document.getElementById('tamu-table-wrap');
  if (show) {
    if (skeleton)  skeleton.style.display  = '';
    if (cardList)  cardList.style.display  = 'none';
    if (tableWrap) tableWrap.style.display = 'none';
  } else {
    hideSkeleton();
  }
}

function hideSkeleton() {
  const skeleton = document.getElementById('skeleton-loader');
  if (skeleton) skeleton.style.display = 'none';
}

// ── Attach Events ──────────────────────────────────────────────
function attachEvents() {
  // Search
  document.getElementById('search-input')
    ?.addEventListener('input', applySearch);

  // Refresh
  const btnRefresh = document.getElementById('btn-refresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      hideNotifBanner();
      setButtonLoading(btnRefresh);
      await loadTamuAktif();
      resetButtonLoading(btnRefresh, false);
      startAutoRefresh();
    });
  }

  // FIX S3: event delegation untuk card list dan tabel
  // Card list
  document.getElementById('tamu-card-list')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id     = btn.dataset.id;
    if (!id) return;
    if (action === 'pulang') openCatatPulang(id);
    if (action === 'detail') openDetail(id);
  });

  // Table body
  document.getElementById('tamu-table-body')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id     = btn.dataset.id;
    if (!id) return;
    if (action === 'pulang') openCatatPulang(id);
    if (action === 'detail') openDetail(id);
  });

  // FIX S3: event delegation untuk tombol edit di modal-detail
  document.getElementById('modal-detail')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-action="edit"]');
    if (btn) {
      const id = btn.dataset.id;
      if (id) openEditModal(id);
    }
  });

  // Bottom sheet pulang
  document.getElementById('btn-confirm-pulang')?.addEventListener('click', confirmCatatPulang);
  document.getElementById('btn-batal-pulang')?.addEventListener('click', closeCatatPulang);
  document.getElementById('sheet-pulang-backdrop')?.addEventListener('click', closeCatatPulang);

  // Modal detail
  document.getElementById('btn-close-detail')?.addEventListener('click', closeDetail);
  const modalDetail = document.getElementById('modal-detail');
  if (modalDetail) {
    modalDetail.addEventListener('click', e => {
      if (e.target === modalDetail) closeDetail();
    });
  }

  // Modal edit
  document.getElementById('btn-close-edit')?.addEventListener('click', closeEditModal);
  const modalEdit = document.getElementById('modal-edit');
  if (modalEdit) {
    modalEdit.addEventListener('click', e => {
      if (e.target === modalEdit) closeEditModal();
    });
  }

  // Notif banner
  document.getElementById('notif-banner')?.addEventListener('click', async () => {
    hideNotifBanner();
    await loadTamuAktif();
    startAutoRefresh();
  });

  // Resize — gunakan matchMedia untuk konsistensi dengan renderTamu()
  const mql = window.matchMedia('(min-width: 1024px)');
  const onBreakpointChange = () => renderTamu();
  // addEventListener untuk matchMedia (modern API)
  if (mql.addEventListener) {
    mql.addEventListener('change', onBreakpointChange);
  } else {
    // Fallback untuk browser lama
    mql.addListener(onBreakpointChange);
  }

  // Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeCatatPulang();
      closeDetail();
      closeEditModal();
    }
  });
}
