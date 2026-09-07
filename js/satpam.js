/**
 * satpam.js
 * Logic dashboard satpam (/satpam.html).
 * ─────────────────────────────────────────────────────────
 * Fitur:
 *   - Cek autentikasi (satpam/admin)
 *   - Load & render daftar tamu aktif
 *   - Auto-refresh tiap 30 detik
 *   - Card layout (mobile) / tabel layout (desktop)
 *   - Pencarian real-time berdasarkan nama
 *   - Bottom sheet / modal "Catat Pulang"
 *   - Modal detail tamu lengkap + tanda tangan
 *   - Notifikasi in-app saat ada tamu baru
 *   - Badge jumlah tamu aktif di navbar
 */

// ── State ─────────────────────────────────────────────────────
let allTamuAktif    = [];    // semua data tamu aktif dari GAS
let filteredTamu    = [];    // setelah filter search
let refreshTimer    = null;  // interval auto-refresh
let lastCount       = -1;    // jumlah tamu saat terakhir fetch (untuk notif)
let sudahPulangCount = 0;    // Bug #2 fix: counter lokal tamu yang sudah pulang hari ini
let selectedTamuId  = null;  // ID tamu yang dipilih untuk catat pulang
let session         = null;  // session user

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Cek auth — satpam dan admin boleh akses
  session = await checkAuth(ROLES.SATPAM);
  if (!session) return;

  // Inisialisasi navbar
  initNavbar(session);

  // Load config sekolah
  loadSchoolConfig();

  // Load data pertama kali
  await loadTamuAktif();

  // Mulai auto-refresh
  startAutoRefresh();

  // Pasang event listeners
  attachEvents();
});

// ── Load School Config ────────────────────────────────────────
async function loadSchoolConfig() {
  const result = await callGAS('getConfig').catch(() => null);
  if (result && result.status === 'ok' && result.data) {
    const nama = result.data.nama_sekolah || CONFIG.APP_NAME;
    const navName = document.getElementById('nav-school-name');
    if (navName) navName.textContent = nama;
    document.title = `Dashboard Satpam — ${nama}`;

    // BUG #4 FIX: muat logo_app_url ke navbar, sama seperti admin.js
    if (result.data.logo_app_url) {
      _updateNavbarLogo(result.data.logo_app_url);
    }
  }
}

// ── Helper: update logo navbar (identik dengan admin.js) ──────
function _updateNavbarLogo(url) {
  const iconEl = document.querySelector('.navbar__brand-icon');
  if (!iconEl) return;

  const oldImg = iconEl.querySelector('img');
  if (oldImg) oldImg.remove();

  if (url) {
    const img     = document.createElement('img');
    img.src       = normalizeLogoUrl(url);
    img.alt       = 'Logo';
    img.className = 'navbar__brand-logo-img';
    img.onload    = () => { iconEl.style.fontSize = '0'; };
    img.onerror   = () => { img.remove(); iconEl.style.fontSize = ''; };
    iconEl.appendChild(img);
  } else {
    iconEl.style.fontSize = '';
  }
}

// ── Load Tamu Aktif ────────────────────────────────────────────
/**
 * Fetch data tamu aktif dari GAS dan render ke UI.
 * @param {boolean} silent - jika true, tidak tampilkan skeleton
 */
async function loadTamuAktif(silent = false) {
  if (!silent) showSkeleton(true);

  const result = await callGAS('getTamuAktif', { token: getToken() });

  if (result.status === 'ok') {
    const newData  = result.data?.tamu || [];
    const newCount = newData.length;

    // Deteksi tamu baru untuk notifikasi
    if (lastCount >= 0 && newCount > lastCount) {
      const diff = newCount - lastCount;
      showNotifBanner(`🔔 ${diff} tamu baru masuk. Klik untuk memperbarui.`);
    }

    lastCount    = newCount;
    allTamuAktif = newData;

    // Bug #7 fix: terapkan filter & render DI SINI saja.
    // showSkeleton(false) di bawah tidak boleh memanggil renderTamu() lagi.
    applySearch();

    // Bug #2 fix: teruskan counter pulang ke stats strip
    updateStatsStrip(allTamuAktif, sudahPulangCount);

  } else if (result.status === 'error') {
    showToast('Gagal memuat data: ' + (result.message || 'Coba lagi'), 'danger');
  }

  // Bug #7 fix: hanya sembunyikan skeleton, jangan render ulang
  if (!silent) hideSkeleton();
  updateRefreshTime();
}

// ── Update Stats Strip ────────────────────────────────────────
/**
 * @param {Array}  data       - daftar tamu yang sedang hadir
 * @param {number} [sudahPulang=0] - jumlah tamu yang sudah pulang hari ini
 *   (opsional; GAS endpoint getTamuAktif tidak mengembalikan nilai ini,
 *    sehingga kita pertahankan counter lokal dari sesi sebelumnya)
 */
function updateStatsStrip(data, sudahPulang = 0) {
  const aktif = data.length;

  const elAktif   = document.getElementById('stat-aktif');
  const elHariIni = document.getElementById('stat-hari-ini');
  const elPulang  = document.getElementById('stat-pulang');   // Bug #2 fix: sekarang diisi
  const elBadge   = document.getElementById('active-count');

  if (elAktif)   elAktif.textContent   = aktif;
  // Total hari ini = hadir sekarang + yang sudah pulang
  if (elHariIni) elHariIni.textContent = aktif + sudahPulang;
  if (elPulang)  elPulang.textContent  = sudahPulang;         // Bug #2 fix
  if (elBadge)   elBadge.textContent   = aktif;

  // Sembunyikan badge jika tidak ada tamu aktif
  if (elBadge) elBadge.style.display = aktif > 0 ? '' : 'none';
}

// ── Apply Search Filter ───────────────────────────────────────
function applySearch() {
  const searchVal = (document.getElementById('search-input')?.value || '').trim().toLowerCase();

  if (!searchVal) {
    filteredTamu = [...allTamuAktif];
  } else {
    // Bug #4 fix: null-safe toLowerCase untuk instansi
    filteredTamu = allTamuAktif.filter(t => {
      const nama     = (t.namaLengkap || '').toLowerCase();
      const instansi = (t.instansi || '').toLowerCase();
      return nama.includes(searchVal) || instansi.includes(searchVal);
    });
  }

  renderTamu();
}

// ── Render Tamu ───────────────────────────────────────────────
/**
 * Render data tamu ke card list (mobile) atau tabel (desktop).
 */
function renderTamu() {
  const isDesktop = window.innerWidth >= 1024;

  if (isDesktop) {
    renderTable();
    showView('table');
  } else {
    renderCards();
    showView('cards');
  }

  // Empty state
  const emptyState = document.getElementById('empty-state');
  if (emptyState) {
    emptyState.style.display = filteredTamu.length === 0 ? '' : 'none';
  }
}

/**
 * Tampilkan view yang benar dan sembunyikan yang lain.
 * @param {'cards'|'table'} view
 */
function showView(view) {
  const cardList  = document.getElementById('tamu-card-list');
  const tableWrap = document.getElementById('tamu-table-wrap');

  if (cardList)  cardList.style.display  = view === 'cards' ? '' : 'none';
  if (tableWrap) tableWrap.style.display = view === 'table' ? '' : 'none';
}

// ── Render Cards (Mobile) ─────────────────────────────────────
function renderCards() {
  const container = document.getElementById('tamu-card-list');
  if (!container) return;

  if (filteredTamu.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = filteredTamu.map(tamu => `
    <article class="tamu-card" role="listitem" data-id="${escapeHtml(tamu.id)}">
      <div class="tamu-card__header">
        <div>
          <div class="tamu-card__name">${escapeHtml(tamu.namaLengkap)}</div>
          <div class="tamu-card__meta">${escapeHtml(tamu.instansi)}</div>
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
        <button
          class="btn btn-pulang btn--sm"
          onclick="openCatatPulang('${escapeHtml(tamu.id)}')"
          aria-label="Catat pulang ${escapeHtml(tamu.namaLengkap)}"
        >
          ✅ Catat Pulang
        </button>
        <button
          class="btn btn-detail btn--sm"
          onclick="openDetail('${escapeHtml(tamu.id)}')"
          aria-label="Lihat detail ${escapeHtml(tamu.namaLengkap)}"
        >
          🔍 Detail
        </button>
      </div>
    </article>
  `).join('');
}

// ── Render Table (Desktop) ────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById('tamu-table-body');
  if (!tbody) return;

  if (filteredTamu.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center text-muted" style="padding:var(--space-8);">
          Tidak ada tamu aktif
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = filteredTamu.map(tamu => `
    <tr data-id="${escapeHtml(tamu.id)}">
      <td>
        <div style="font-weight:600;">${escapeHtml(tamu.namaLengkap)}</div>
        <div class="text-xs text-muted">${escapeHtml(tamu.instansi)}</div>
      </td>
      <td><span class="badge badge--primary">${escapeHtml(tamu.jenisTamu)}</span></td>
      <td>${escapeHtml(tamu.jamDatang)}</td>
      <td style="max-width:180px;white-space:normal;">${escapeHtml(tamu.keperluan)}</td>
      <td>${escapeHtml(tamu.bertemuDengan)}</td>
      <td>
        <div style="display:flex;gap:var(--space-2);">
          <button
            class="btn btn--success btn--sm"
            onclick="openCatatPulang('${escapeHtml(tamu.id)}')"
            aria-label="Catat pulang ${escapeHtml(tamu.namaLengkap)}"
          >
            ✅ Pulang
          </button>
          <button
            class="btn btn--secondary btn--sm"
            onclick="openDetail('${escapeHtml(tamu.id)}')"
            aria-label="Detail ${escapeHtml(tamu.namaLengkap)}"
          >
            🔍
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

// ── Catat Pulang ──────────────────────────────────────────────
/**
 * Buka bottom sheet / modal catat pulang untuk tamu tertentu.
 * @param {string} tamuId
 */
function openCatatPulang(tamuId) {
  const tamu = allTamuAktif.find(t => t.id === tamuId);
  if (!tamu) return;

  selectedTamuId = tamuId;

  // Isi info tamu di bottom sheet
  const namEl  = document.getElementById('pulang-nama');
  const metaEl = document.getElementById('pulang-meta');
  // Update avatar emoji berdasarkan jenis tamu (opsional, fallback ke 👤)
  const avatarEl = document.querySelector('#sheet-pulang .catat-pulang-info__avatar');
  const avatarMap = {
    'Orang Tua/Wali Murid': '👨‍👩‍👧',
    'Dinas/Instansi'      : '🏛️',
    'Mitra'               : '🤝',
    'Alumni'              : '🎓',
    'Vendor/Penyedia'     : '📦',
  };
  if (avatarEl) avatarEl.textContent = avatarMap[tamu.jenisTamu] || '👤';

  if (namEl)  namEl.textContent  = tamu.namaLengkap;
  if (metaEl) metaEl.textContent = `${tamu.jenisTamu} • Datang: ${tamu.jamDatang} • ${tamu.bertemuDengan}`;

  // Set jam default = sekarang
  const jamInput = document.getElementById('input-jam-pulang');
  if (jamInput) {
    const now = new Date();
    jamInput.value = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  }

  // Bug #5 fix: pastikan tombol dalam keadaan normal (enabled, tidak loading)
  const btnConfirm = document.getElementById('btn-confirm-pulang');
  if (btnConfirm) {
    btnConfirm.classList.remove('loading');
    btnConfirm.disabled = false;
  }

  // Buka bottom sheet
  const sheet = document.getElementById('sheet-pulang');
  if (sheet) sheet.classList.add('active');
  lockScroll();

  // Fokus ke input jam
  setTimeout(() => jamInput?.focus(), 100);
}

/**
 * Tutup bottom sheet catat pulang.
 */
function closeCatatPulang() {
  const sheet = document.getElementById('sheet-pulang');
  if (sheet) sheet.classList.remove('active');
  unlockScroll();
  selectedTamuId = null;
}

/**
 * Konfirmasi dan kirim update jam pulang ke GAS.
 */
async function confirmCatatPulang() {
  if (!selectedTamuId) return;

  const jamInput   = document.getElementById('input-jam-pulang');
  const btnConfirm = document.getElementById('btn-confirm-pulang');
  const jamPulang  = jamInput?.value || '';

  if (!jamPulang) {
    showToast('Jam pulang wajib diisi.', 'danger');
    jamInput?.focus();
    return;
  }

  // Validasi format HH:MM
  if (!/^\d{2}:\d{2}$/.test(jamPulang)) {
    showToast('Format jam tidak valid. Gunakan HH:MM.', 'danger');
    return;
  }

  // Bug #3 fix: simpan ID ke variabel lokal SEBELUM memanggil closeCatatPulang()
  // agar filter di bawah masih bisa menggunakannya setelah selectedTamuId di-null-kan.
  const tamuIdToUpdate = selectedTamuId;

  setButtonLoading(btnConfirm);

  const result = await callGAS('updateJamPulang', {
    token    : getToken(),
    id       : tamuIdToUpdate,
    jamPulang: jamPulang,
  });

  if (result.status === 'ok') {
    closeCatatPulang(); // selectedTamuId menjadi null di sini — sudah aman karena pakai tamuIdToUpdate

    showToast(`${result.data?.nama || 'Tamu'} berhasil dicatat pulang jam ${jamPulang}. ✅`, 'success');

    // Hapus dari list lokal tanpa menunggu refresh — gunakan tamuIdToUpdate (Bug #3 fix)
    allTamuAktif  = allTamuAktif.filter(t => t.id !== tamuIdToUpdate);
    sudahPulangCount++;               // naikkan counter lokal untuk stat strip
    lastCount     = allTamuAktif.length;
    applySearch();
    updateStatsStrip(allTamuAktif, sudahPulangCount);

  } else {
    showToast(result.message || 'Gagal mencatat jam pulang.', 'danger');
    resetButtonLoading(btnConfirm, false);
  }
}

// ── Modal Detail ──────────────────────────────────────────────
/**
 * Buka modal detail tamu dan fetch data lengkap (termasuk TTD).
 * @param {string} tamuId
 */
async function openDetail(tamuId) {
  const modal   = document.getElementById('modal-detail');
  const content = document.getElementById('modal-detail-content');
  const title   = document.getElementById('modal-detail-title');

  if (!modal) return;

  // Reset & buka modal
  if (content) content.innerHTML = `
    <div style="text-align:center;padding:var(--space-8);">
      <div class="spinner" style="margin:0 auto;"></div>
      <p class="text-sm text-muted" style="margin-top:var(--space-3);">Memuat detail...</p>
    </div>`;

  // Bug #6 fix: reset scroll ke atas sebelum membuka modal
  const modalBox = modal.querySelector('.modal');
  if (modalBox) modalBox.scrollTop = 0;

  modal.classList.add('active');
  lockScroll();

  // Fetch detail lengkap dari GAS
  const result = await callGAS('getTamuById', {
    token: getToken(),
    id   : tamuId,
  });

  if (result.status !== 'ok') {
    if (content) content.innerHTML = `
      <div class="alert alert--danger">${escapeHtml(result.message || 'Gagal memuat detail.')}</div>`;
    return;
  }

  const t = result.data;
  if (title) title.textContent = t.namaLengkap || 'Detail Tamu';

  // Render tanda tangan
  const ttdHtml = t.tandaTangan
    ? `<div class="detail-signature">
         <img src="${t.tandaTangan}" alt="Tanda tangan ${escapeHtml(t.namaLengkap)}" />
       </div>`
    : '<span class="text-muted">—</span>';

  // Format tanggal display
  const tanggalDisplay = formatTanggalDisplay(t.tanggal);

  // Label field instansi disesuaikan dengan jenis tamu
  const instansiLabel = t.jenisTamu === 'Orang Tua/Wali Murid'
    ? 'Orang Tua/Wali dari'
    : t.jenisTamu === 'Alumni'
      ? 'Tahun Lulus'
      : 'Instansi / Asal';

  if (content) content.innerHTML = `
    <div style="margin-bottom:var(--space-3);">
      <span class="badge badge--${t.status === 'Hadir' ? 'success' : 'gray'}">${escapeHtml(t.status)}</span>
      <span class="badge badge--primary" style="margin-left:var(--space-2);">${escapeHtml(t.jenisTamu)}</span>
    </div>
    <div class="detail-row"><div class="detail-row__label">Tanggal</div><div class="detail-row__value">${tanggalDisplay}</div></div>
    <div class="detail-row"><div class="detail-row__label">Jam Datang</div><div class="detail-row__value">${displayVal(t.jamDatang)}</div></div>
    <div class="detail-row"><div class="detail-row__label">Jam Pulang</div><div class="detail-row__value">${displayVal(t.jamPulang) || '<span class="text-muted">Belum pulang</span>'}</div></div>
    <div class="detail-row"><div class="detail-row__label">Nama</div><div class="detail-row__value">${displayVal(t.namaLengkap)}</div></div>
    <div class="detail-row"><div class="detail-row__label">${escapeHtml(instansiLabel)}</div><div class="detail-row__value">${displayVal(t.instansi)}</div></div>
    <div class="detail-row"><div class="detail-row__label">No. HP/WA</div><div class="detail-row__value">${displayVal(t.noHp)}</div></div>
    <div class="detail-row"><div class="detail-row__label">Email</div><div class="detail-row__value">${displayVal(t.email)}</div></div>
    <div class="detail-row"><div class="detail-row__label">Keperluan</div><div class="detail-row__value" style="white-space:pre-wrap;">${displayVal(t.keperluan)}</div></div>
    <div class="detail-row"><div class="detail-row__label">Bertemu</div><div class="detail-row__value">${displayVal(t.bertemuDengan)}</div></div>
    <div class="detail-row">
      <div class="detail-row__label">Tanda Tangan</div>
      <div class="detail-row__value">${ttdHtml}</div>
    </div>
    ${t.diupdateOleh ? `<div class="detail-row"><div class="detail-row__label">Dicatat oleh</div><div class="detail-row__value">${displayVal(t.diupdateOleh)}</div></div>` : ''}
  `;
}

/**
 * Tutup modal detail.
 */
function closeDetail() {
  const modal = document.getElementById('modal-detail');
  if (modal) modal.classList.remove('active');
  unlockScroll();
}

// ── Notifikasi In-App ─────────────────────────────────────────
/**
 * Tampilkan banner notifikasi tamu baru.
 * @param {string} message
 */
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
  refreshTimer = setInterval(async () => {
    await loadTamuAktif(true); // silent refresh
  }, CONFIG.REFRESH_INTERVAL);
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function updateRefreshTime() {
  const el = document.getElementById('last-refresh');
  if (!el) return;
  const now = new Date();
  const jam = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  el.textContent = `Terakhir diperbarui: ${jam}`;
}

// ── Skeleton Loader ───────────────────────────────────────────
function showSkeleton(show) {
  if (show) {
    const skeleton  = document.getElementById('skeleton-loader');
    const cardList  = document.getElementById('tamu-card-list');
    const tableWrap = document.getElementById('tamu-table-wrap');
    if (skeleton)  skeleton.style.display  = '';
    if (cardList)  cardList.style.display  = 'none';
    if (tableWrap) tableWrap.style.display = 'none';
  } else {
    hideSkeleton();
  }
}

/**
 * Bug #7 fix: sembunyikan skeleton TANPA memanggil renderTamu().
 * renderTamu() sudah dipanggil oleh applySearch() di loadTamuAktif().
 */
function hideSkeleton() {
  const skeleton = document.getElementById('skeleton-loader');
  if (skeleton) skeleton.style.display = 'none';
}

// ── Attach Events ──────────────────────────────────────────────
function attachEvents() {
  // Search input — real-time filter
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', applySearch);
  }

  // Refresh button
  const btnRefresh = document.getElementById('btn-refresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      hideNotifBanner();
      setButtonLoading(btnRefresh);
      await loadTamuAktif();
      resetButtonLoading(btnRefresh, false);
      startAutoRefresh(); // reset timer
    });
  }

  // Bottom sheet: konfirmasi pulang
  const btnConfirm = document.getElementById('btn-confirm-pulang');
  if (btnConfirm) btnConfirm.addEventListener('click', confirmCatatPulang);

  // Bottom sheet: batal
  const btnBatal = document.getElementById('btn-batal-pulang');
  if (btnBatal) btnBatal.addEventListener('click', closeCatatPulang);

  // Bottom sheet: klik backdrop
  const backdrop = document.getElementById('sheet-pulang-backdrop');
  if (backdrop) backdrop.addEventListener('click', closeCatatPulang);

  // Modal detail: close button
  const btnCloseDetail = document.getElementById('btn-close-detail');
  if (btnCloseDetail) btnCloseDetail.addEventListener('click', closeDetail);

  // Modal detail: klik backdrop
  const modalDetail = document.getElementById('modal-detail');
  if (modalDetail) {
    modalDetail.addEventListener('click', (e) => {
      if (e.target === modalDetail) closeDetail();
    });
  }

  // Notifikasi banner: klik untuk refresh
  const notifBanner = document.getElementById('notif-banner');
  if (notifBanner) {
    notifBanner.addEventListener('click', async () => {
      hideNotifBanner();
      await loadTamuAktif();
      startAutoRefresh();
    });
  }

  // Resize: re-render layout saat ukuran window berubah
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderTamu, 200);
  });

  // Keyboard: Escape untuk tutup modal/sheet
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeCatatPulang();
      closeDetail();
    }
  });
}
