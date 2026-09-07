/**
 * form-tamu.js — Halaman Form Tamu Publik
 * ▶▶ v2: Mendukung Multi-Tamu / Rombongan
 * ─────────────────────────────────────────────────────────
 * Alur:
 *   1. Load config sekolah + staf + siswa secara paralel dari GAS
 *   2. Render pill selector jenis tamu
 *   3. Set tanggal otomatis (live) + input jam datang (editable)
 *   4. Inisialisasi signature_pad (DPR-aware)
 *   5. ▶▶ Input jumlah tamu → repeater form dinamis per anggota
 *   6. ▶▶ Review screen sebelum simpan
 *   7. Submit → callGAS('addTamu') → success screen
 */

'use strict';

// ── Module State ──────────────────────────────────────────────
let signaturePad   = null;
let selectedJenis  = '';
let clockInterval  = null;
let isSubmitting   = false;
let stafLoadFailed = false;
let siswaList      = [];

// ▶▶ MULTI-TAMU State
let jumlahTamu     = 1;      // jumlah tamu dalam sesi ini
let anggotaData    = [];     // [{namaLengkap, noHp, email, jabatan, jenisId, noId}]

// ── Konstanta ─────────────────────────────────────────────────
const EMAIL_REGEX  = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const JENIS_ORTU   = 'Orang Tua/Wali Murid';
const JENIS_ALUMNI = 'Alumni';
const MAX_TAMU     = 50;   // batas wajar di form (backend max 100)

// ═════════════════════════════════════════════════════════════
// INISIALISASI
// ═════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  showFormLoading(true);

  try {
    const [configResult, stafResult, siswaResult] = await Promise.allSettled([
      callGAS('getConfig'),
      callGAS('getStaf'),
      callGAS('getSiswa'),
    ]);

    const config = configResult.status === 'fulfilled' && configResult.value?.status === 'ok'
      ? (configResult.value.data || {}) : {};

    const stafData = stafResult.status === 'fulfilled' && stafResult.value?.status === 'ok'
      ? (stafResult.value.data || []) : [];

    stafLoadFailed = stafData.length === 0 &&
      (stafResult.status === 'rejected' || stafResult.value?.status !== 'ok');

    siswaList = siswaResult.status === 'fulfilled' && siswaResult.value?.status === 'ok'
      ? (siswaResult.value.data || []) : [];

    applySchoolConfig(config);
    populateStafDropdown(stafData);
    populateSiswaDropdown(siswaList);
    renderJenisTamuPills();
    initClock();
    initSignaturePad();
    attachFormEvents();
    initJumlahTamu();   // ▶▶

  } catch (err) {
    console.error('Form init error:', err);
    renderJenisTamuPills();
    initClock();
    initSignaturePad();
    attachFormEvents();
    initJumlahTamu();   // ▶▶
  }

  showFormLoading(false);
});

// ═════════════════════════════════════════════════════════════
// SCHOOL CONFIG
// ═════════════════════════════════════════════════════════════
function applySchoolConfig(config) {
  const namaSekolah = (config.nama_sekolah || '').trim() || CONFIG.APP_NAME;
  document.title = `Buku Tamu — ${namaSekolah}`;

  const nameEl = document.getElementById('school-name');
  if (nameEl) nameEl.textContent = namaSekolah;

  const subtitleEl = document.getElementById('school-subtitle');
  if (subtitleEl && config.alamat_sekolah) subtitleEl.textContent = config.alamat_sekolah;

  const logoWrap = document.getElementById('school-logo');
  const logoIcon = document.getElementById('school-logo-icon');
  if (logoWrap && config.logo_url && config.logo_url.trim()) {
    const existing = logoWrap.querySelector('img');
    if (existing) existing.remove();
    const img = document.createElement('img');
    img.src   = normalizeLogoUrl(config.logo_url.trim());
    img.alt   = `Logo ${namaSekolah}`;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;';
    if (logoIcon) logoIcon.style.display = 'none';
    img.onerror = () => { img.remove(); if (logoIcon) logoIcon.style.display = ''; };
    logoWrap.appendChild(img);
  }
}

// ═════════════════════════════════════════════════════════════
// STAF DROPDOWN
// ═════════════════════════════════════════════════════════════
function populateStafDropdown(stafData) {
  const select    = document.getElementById('bertemu-dengan');
  const retryWrap = document.getElementById('staf-retry-wrap');
  if (!select) return;

  while (select.options.length > 1) select.remove(1);

  if (!Array.isArray(stafData) || stafData.length === 0) {
    const opt = document.createElement('option');
    opt.value    = '';
    opt.disabled = true;
    opt.textContent = stafLoadFailed ? '— Gagal memuat daftar staf —' : '— Belum ada data staf —';
    select.appendChild(opt);
    if (retryWrap) retryWrap.style.display = stafLoadFailed ? '' : 'none';
    return;
  }

  if (retryWrap) retryWrap.style.display = 'none';
  stafData.forEach(staf => {
    const opt       = document.createElement('option');
    opt.value       = staf.nama || '';
    opt.textContent = staf.jabatan ? `${staf.nama} (${staf.jabatan})` : staf.nama || '';
    select.appendChild(opt);
  });
}

async function retryLoadStaf() {
  const btn = document.getElementById('btn-retry-staf');
  if (btn) { btn.disabled = true; btn.textContent = 'Memuat...'; }
  try {
    const result = await callGAS('getStaf');
    stafLoadFailed = false;
    const list = result?.status === 'ok' ? (result.data || []) : [];
    stafLoadFailed = list.length === 0 && result?.status !== 'ok';
    populateStafDropdown(list);
    if (list.length > 0) showToast('Daftar staf berhasil dimuat.', 'success');
    else showToast('Belum ada data staf yang tersedia.', 'default');
  } catch {
    showToast('Gagal memuat staf. Coba lagi.', 'danger');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Coba Lagi'; }
  }
}

// ═════════════════════════════════════════════════════════════
// SISWA DROPDOWN
// ═════════════════════════════════════════════════════════════
function populateSiswaDropdown(list) {
  const select = document.getElementById('instansi-siswa');
  if (!select) return;
  while (select.options.length > 1) select.remove(1);
  if (!Array.isArray(list) || list.length === 0) {
    const opt = document.createElement('option');
    opt.value    = '';
    opt.disabled = true;
    opt.textContent = '— Belum ada data siswa —';
    select.appendChild(opt);
    return;
  }
  list.forEach(siswa => {
    const opt       = document.createElement('option');
    opt.value       = siswa.namaLengkap || '';
    opt.textContent = siswa.kelas ? `${siswa.namaLengkap} (${siswa.kelas})` : siswa.namaLengkap || '';
    select.appendChild(opt);
  });
}

// ═════════════════════════════════════════════════════════════
// PILL SELECTOR JENIS TAMU
// ═════════════════════════════════════════════════════════════
function renderJenisTamuPills() {
  const container = document.getElementById('jenis-tamu-pills');
  if (!container) return;
  container.innerHTML = '';
  JENIS_TAMU.forEach(jenis => {
    const btn = document.createElement('button');
    btn.type          = 'button';
    btn.className     = 'pill-selector__item';
    btn.textContent   = jenis;
    btn.dataset.value = jenis;
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => selectJenisTamu(jenis));
    container.appendChild(btn);
  });
}

function selectJenisTamu(jenis) {
  selectedJenis = jenis;
  document.querySelectorAll('.pill-selector__item').forEach(btn => {
    const sel = btn.dataset.value === jenis;
    btn.classList.toggle('selected', sel);
    btn.setAttribute('aria-pressed', sel ? 'true' : 'false');
  });
  const hidden = document.getElementById('jenis-tamu');
  if (hidden) hidden.value = jenis;
  _toggleInstansiField(jenis);

  // Orang Tua/Wali Murid tidak boleh rombongan — 1 ortu = 1 anak
  _applyRombonganLock(jenis === JENIS_ORTU);

  hideFieldError('error-jenis-tamu');
  checkSubmitEligibility();
}

/**
 * Kunci atau buka stepper rombongan.
 * Saat locked: reset ke 1 tamu, disable tombol +, sembunyikan tombol tambah manual,
 * tampilkan pesan informatif kenapa rombongan tidak tersedia.
 * @param {boolean} locked
 */
function _applyRombonganLock(locked) {
  const plusBtn        = document.getElementById('btn-tamu-plus');
  const minusBtn       = document.getElementById('btn-tamu-minus');
  const btnTambah      = document.getElementById('btn-tambah-tamu-manual');
  const hintEl         = document.getElementById('jumlah-tamu-hint');
  const lockNoticeEl   = document.getElementById('rombongan-lock-notice');

  if (locked) {
    // Reset ke 1 tamu jika sebelumnya sudah ditambah
    if (jumlahTamu > 1) {
      jumlahTamu  = 1;
      anggotaData = anggotaData.slice(0, 1);
      renderAnggotaRepeater();
      checkSubmitEligibility();
    }

    // Disable & style tombol +
    if (plusBtn)  { plusBtn.disabled  = true;  plusBtn.setAttribute('aria-disabled', 'true'); }
    if (minusBtn) { minusBtn.disabled = true; }

    // Sembunyikan tombol tambah manual (ada di seksi anggota rombongan)
    if (btnTambah) btnTambah.style.display = 'none';

    // Sembunyikan hint default, tampilkan notice
    if (hintEl)       hintEl.style.display       = 'none';
    if (lockNoticeEl) lockNoticeEl.style.display  = '';

  } else {
    // Buka kembali
    if (plusBtn)  { plusBtn.disabled  = jumlahTamu >= MAX_TAMU; plusBtn.removeAttribute('aria-disabled'); }
    if (minusBtn) { minusBtn.disabled = jumlahTamu <= 1; }
    if (btnTambah) btnTambah.style.display = '';

    // Kembalikan hint default
    if (hintEl)       hintEl.style.display       = '';
    if (lockNoticeEl) lockNoticeEl.style.display  = 'none';
  }
}

function _toggleInstansiField(jenis) {
  const inputText   = document.getElementById('instansi');
  const selectSiswa = document.getElementById('instansi-siswa');
  const inputTahun  = document.getElementById('instansi-tahun-lulus');
  const labelEl     = document.getElementById('label-instansi');
  if (!inputText) return;

  const hide = (el) => { if (el) { el.style.display = 'none'; el.required = false; } };
  hide(inputText); hide(selectSiswa); hide(inputTahun);

  if (jenis === JENIS_ORTU) {
    if (selectSiswa) { selectSiswa.style.display = ''; selectSiswa.required = true; }
    if (labelEl) labelEl.innerHTML = 'Orang Tua/Wali dari <span class="required">*</span>';
  } else if (jenis === JENIS_ALUMNI) {
    if (inputTahun) { inputTahun.style.display = ''; inputTahun.required = true; }
    if (labelEl) labelEl.innerHTML = 'Tahun Lulus <span class="required">*</span>';
  } else {
    inputText.style.display = '';
    inputText.required = true;
    if (labelEl) labelEl.innerHTML = 'Instansi / Asal <span class="required">*</span>';
  }

  hideFieldError('error-instansi');
  [inputText, selectSiswa, inputTahun].forEach(el => {
    if (el) el.classList.remove('is-valid', 'is-invalid');
  });
}

// ═════════════════════════════════════════════════════════════
// LIVE CLOCK
// ═════════════════════════════════════════════════════════════
function initClock() {
  if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }

  function tick() {
    const now     = new Date();
    const isoDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const displayDate = now.toLocaleDateString('id-ID', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    const safe = (id, val, prop = 'textContent') => {
      const el = document.getElementById(id);
      if (el) el[prop] = val;
    };
    safe('display-tanggal', displayDate);
    safe('header-date',     displayDate);
    safe('tanggal',         isoDate, 'value');
  }

  tick();
  clockInterval = setInterval(tick, 60000);
  _setDefaultJam();
}

function _setDefaultJam() {
  const jamInput = document.getElementById('jam-datang');
  if (!jamInput) return;
  const now = new Date();
  jamInput.value = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
}

// ═════════════════════════════════════════════════════════════
// SIGNATURE PAD
// ═════════════════════════════════════════════════════════════
function initSignaturePad() {
  const canvas      = document.getElementById('signature-canvas');
  const container   = document.getElementById('signature-container');
  const placeholder = document.getElementById('signature-placeholder');
  const clearBtn    = document.getElementById('btn-clear-signature');

  if (!canvas || typeof SignaturePad === 'undefined') return;

  function resizeCanvas() {
    const hadSignature = signaturePad && !signaturePad.isEmpty();
    const savedData    = hadSignature ? signaturePad.toData() : null;
    const ratio  = Math.max(window.devicePixelRatio || 1, 1);
    const width  = container ? container.clientWidth  : canvas.offsetWidth;
    const height = container ? container.clientHeight : (canvas.offsetHeight || 160);
    canvas.width  = width  * ratio;
    canvas.height = height * ratio;
    canvas.getContext('2d').scale(ratio, ratio);
    if (signaturePad) signaturePad.clear();
    if (savedData && savedData.length > 0) {
      try { signaturePad.fromData(savedData); } catch (_) {}
    }
  }

  signaturePad = new SignaturePad(canvas, {
    minWidth: 1, maxWidth: 3,
    penColor: '#1f2937',
    backgroundColor: 'rgba(255,255,255,0)',
  });

  requestAnimationFrame(() => resizeCanvas());

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCanvas, 250);
  });

  canvas.style.touchAction = 'none';

  signaturePad.addEventListener('beginStroke', () => {
    if (placeholder) placeholder.classList.add('hidden');
    if (container)   container.classList.add('active');
  });

  signaturePad.addEventListener('endStroke', () => {
    if (container) {
      container.classList.remove('active');
      container.classList.add('has-signature');
    }
    _setSignatureStatus(true);
    hideFieldError('error-ttd');
    checkSubmitEligibility();
  });

  if (clearBtn) clearBtn.addEventListener('click', clearSignature);
}

function clearSignature() {
  if (!signaturePad) return;
  signaturePad.clear();
  const placeholder = document.getElementById('signature-placeholder');
  const container   = document.getElementById('signature-container');
  if (placeholder) placeholder.classList.remove('hidden');
  if (container)   container.classList.remove('has-signature', 'active');
  _setSignatureStatus(false);
  checkSubmitEligibility();
}

function _setSignatureStatus(signed) {
  const el = document.getElementById('signature-status');
  if (!el) return;
  el.classList.toggle('signed', signed);
  const textEl = el.querySelector('span:not(.signature-status__dot)');
  if (textEl) textEl.textContent = signed ? 'Tanda tangan tersimpan' : 'Belum ditandatangani';
}

// ═════════════════════════════════════════════════════════════
// ▶▶ MULTI-TAMU: JUMLAH TAMU & REPEATER ANGGOTA
// ═════════════════════════════════════════════════════════════

/**
 * Inisialisasi kontrol jumlah tamu dan render repeater pertama kali.
 */
function initJumlahTamu() {
  jumlahTamu  = 1;
  anggotaData = [_emptyAnggota()];
  renderAnggotaRepeater();

  const minusBtn = document.getElementById('btn-tamu-minus');
  const plusBtn  = document.getElementById('btn-tamu-plus');
  const display  = document.getElementById('jumlah-tamu-display');

  if (minusBtn) {
    minusBtn.addEventListener('click', () => {
      if (jumlahTamu <= 1) return;
      jumlahTamu--;
      anggotaData.pop();
      updateJumlahTamuDisplay();
      renderAnggotaRepeater();
      checkSubmitEligibility();
    });
  }

  if (plusBtn) {
    plusBtn.addEventListener('click', () => {
      if (jumlahTamu >= MAX_TAMU) {
        showToast(`Maksimal ${MAX_TAMU} tamu per kunjungan.`, 'danger');
        return;
      }
      jumlahTamu++;
      anggotaData.push(_emptyAnggota());
      updateJumlahTamuDisplay();
      renderAnggotaRepeater();
      checkSubmitEligibility();
      // Scroll ke card tamu baru
      setTimeout(() => {
        const cards = document.querySelectorAll('.anggota-card');
        if (cards.length > 0) {
          cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    });
  }
}

function _emptyAnggota() {
  return { namaLengkap: '', noHp: '', email: '', jabatan: '', jenisId: '', noId: '' };
}

function updateJumlahTamuDisplay() {
  const display  = document.getElementById('jumlah-tamu-display');
  const minusBtn = document.getElementById('btn-tamu-minus');
  const plusBtn  = document.getElementById('btn-tamu-plus');
  const label    = document.getElementById('jumlah-tamu-label');

  if (display)  display.textContent = jumlahTamu;
  if (minusBtn) minusBtn.disabled   = jumlahTamu <= 1;
  // Tombol + juga dikunci jika jenis tamu adalah Orang Tua/Wali Murid
  const isLocked = selectedJenis === JENIS_ORTU;
  if (plusBtn)  plusBtn.disabled    = isLocked || jumlahTamu >= MAX_TAMU;
  if (label)    label.textContent   = jumlahTamu === 1 ? 'orang (kunjungan tunggal)' : `orang (rombongan)`;
}

/**
 * Render semua card anggota ke container yang tepat:
 * - jumlahTamu = 1 → #anggota-repeater-tunggal (di seksi "Data Diri Tamu")
 * - jumlahTamu > 1 → #anggota-repeater (di seksi "Data Setiap Anggota")
 */
function renderAnggotaRepeater() {
  updateJumlahTamuDisplay();

  const isRombongan     = jumlahTamu > 1;
  const sectionAnggota  = document.getElementById('section-anggota');
  const sectionTunggal  = document.getElementById('section-tamu-tunggal');
  const containerRomb   = document.getElementById('anggota-repeater');
  const containerTunggal= document.getElementById('anggota-repeater-tunggal');

  // Tunjukkan/sembunyikan seksi
  // BUG FIX: set 'block' bukan '' karena CSS #section-anggota { display:none }
  // menggunakan ID selector (specificity tinggi) yang mengalahkan inline style kosong.
  if (sectionAnggota) sectionAnggota.style.display  = isRombongan ? 'block' : 'none';
  if (sectionTunggal) sectionTunggal.style.display  = isRombongan ? 'none'  : 'block';

  // Update counter di badge seksi rombongan
  const badge2 = document.getElementById('jumlah-tamu-display-2');
  if (badge2) badge2.textContent = jumlahTamu;

  // Render ke container aktif
  const targetContainer = isRombongan ? containerRomb : containerTunggal;
  if (!targetContainer) return;

  // Kosongkan container yang tidak aktif juga agar tidak ada sisa DOM
  if (containerRomb && !isRombongan)    containerRomb.innerHTML    = '';
  if (containerTunggal && isRombongan)  containerTunggal.innerHTML = '';

  targetContainer.innerHTML = '';
  anggotaData.forEach((a, i) => {
    const card = _buildAnggotaCard(i, a);
    targetContainer.appendChild(card);
  });
}

/**
 * Bangun elemen DOM satu card anggota.
 * @param {number}  index - 0-based
 * @param {Object}  data  - data anggota saat ini
 */
function _buildAnggotaCard(index, data) {
  const isFirst  = index === 0;
  const nomor    = index + 1;
  const cardId   = `anggota-card-${index}`;

  const card = document.createElement('div');
  card.className  = 'anggota-card';
  card.id         = cardId;
  card.setAttribute('data-index', index);

  // Label kartu dengan nomor
  const header = document.createElement('div');
  header.className = 'anggota-card__header';
  header.innerHTML = `
    <div class="anggota-card__badge">${nomor}</div>
    <div class="anggota-card__title">
      Tamu ${nomor}${isFirst ? ' <span class="anggota-card__badge--wakil">(Wakil/Utama)</span>' : ''}
    </div>
    ${!isFirst ? `
    <button type="button" class="anggota-card__remove" data-index="${index}"
      aria-label="Hapus Tamu ${nomor}" title="Hapus tamu ini">
      ${_icon('x','0.85rem')}
    </button>` : ''}
  `;
  card.appendChild(header);

  // Body form
  const body = document.createElement('div');
  body.className = 'anggota-card__body';

  // Nama (wajib)
  body.innerHTML += `
    <div class="form-group">
      <label class="form-label" for="anggota-nama-${index}">
        Nama Lengkap <span class="required">*</span>
      </label>
      <input type="text" id="anggota-nama-${index}" class="form-control anggota-nama"
        placeholder="Nama lengkap tamu ${nomor}"
        value="${escapeAttr(data.namaLengkap)}"
        data-index="${index}" autocomplete="name" required />
      <span class="form-error" id="error-anggota-nama-${index}" role="alert"></span>
    </div>
  `;

  // No HP
  body.innerHTML += `
    <div class="form-group">
      <label class="form-label" for="anggota-nohp-${index}">
        No. HP / WA ${isFirst ? '<span class="required">*</span>' : '<span class="form-optional">(opsional)</span>'}
      </label>
      <input type="tel" id="anggota-nohp-${index}" class="form-control anggota-nohp"
        placeholder="08xx-xxxx-xxxx"
        value="${escapeAttr(data.noHp)}"
        data-index="${index}" inputmode="numeric" ${isFirst ? 'required' : ''} />
      <span class="form-error" id="error-anggota-nohp-${index}" role="alert"></span>
    </div>
  `;

  // Email (wajib hanya tamu pertama)
  body.innerHTML += `
    <div class="form-group">
      <label class="form-label" for="anggota-email-${index}">
        Email ${isFirst ? '<span class="required">*</span>' : '<span class="form-optional">(opsional)</span>'}
      </label>
      <input type="email" id="anggota-email-${index}" class="form-control anggota-email"
        placeholder="${isFirst ? 'nama@email.com' : 'Opsional'}"
        value="${escapeAttr(data.email)}"
        data-index="${index}" inputmode="email" ${isFirst ? 'required' : ''} />
      <span class="form-error" id="error-anggota-email-${index}" role="alert"></span>
    </div>
  `;

  // Jabatan/Status (opsional)
  body.innerHTML += `
    <div class="form-group">
      <label class="form-label" for="anggota-jabatan-${index}">
        Jabatan / Status <span class="form-optional">(opsional)</span>
      </label>
      <input type="text" id="anggota-jabatan-${index}" class="form-control anggota-jabatan"
        placeholder="Misal: Ketua, Anggota, Guru"
        value="${escapeAttr(data.jabatan)}"
        data-index="${index}" />
    </div>
  `;

  card.appendChild(body);

  // Pasang event listener setelah card masuk ke DOM (via delegation di container)
  return card;
}

/**
 * Escape nilai untuk atribut HTML (mencegah XSS di value="").
 */
function escapeAttr(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Sinkronisasi data dari input card anggota ke array anggotaData.
 * Dipanggil sebelum validasi dan submit.
 */
function syncAnggotaFromDOM() {
  anggotaData.forEach((_, i) => {
    const nama    = document.getElementById(`anggota-nama-${i}`);
    const noHp    = document.getElementById(`anggota-nohp-${i}`);
    const email   = document.getElementById(`anggota-email-${i}`);
    const jabatan = document.getElementById(`anggota-jabatan-${i}`);
    if (nama)    anggotaData[i].namaLengkap = nama.value.trim();
    if (noHp)    anggotaData[i].noHp        = noHp.value.trim();
    if (email)   anggotaData[i].email       = email.value.trim().toLowerCase();
    if (jabatan) anggotaData[i].jabatan     = jabatan.value.trim();
  });
}

/**
 * Event delegation untuk input di dalam anggota-repeater (rombongan & tunggal).
 * Dipanggil sekali saat init; karena delegation tidak perlu ulang saat re-render.
 */
function attachAnggotaRepeaterEvents() {
  // Delegasikan ke parent statis yang selalu ada di DOM
  const container = document.getElementById('main-content');
  if (!container) return;

  // Input changes — update anggotaData realtime
  container.addEventListener('input', (e) => {
    const el    = e.target;
    const idx   = parseInt(el.getAttribute('data-index') ?? '-1', 10);
    if (idx < 0 || idx >= anggotaData.length) return;

    if (el.classList.contains('anggota-nama')) {
      anggotaData[idx].namaLengkap = el.value.trim();
      // Validasi nama
      if (el.value.trim()) {
        el.classList.remove('is-invalid');
        el.classList.add('is-valid');
        hideFieldError(`error-anggota-nama-${idx}`);
      } else {
        el.classList.remove('is-valid');
      }
    } else if (el.classList.contains('anggota-nohp')) {
      anggotaData[idx].noHp = el.value.trim();
    } else if (el.classList.contains('anggota-email')) {
      anggotaData[idx].email = el.value.trim().toLowerCase();
      if (idx === 0 && el.value.trim()) {
        const ok = EMAIL_REGEX.test(el.value.trim());
        el.classList.toggle('is-valid',   ok);
        el.classList.toggle('is-invalid', !ok);
        if (!ok) showFieldError(`error-anggota-email-${idx}`, 'Format email tidak valid.');
        else     hideFieldError(`error-anggota-email-${idx}`);
      } else {
        el.classList.remove('is-valid', 'is-invalid');
        hideFieldError(`error-anggota-email-${idx}`);
      }
    } else if (el.classList.contains('anggota-jabatan')) {
      anggotaData[idx].jabatan = el.value.trim();
    }

    checkSubmitEligibility();
  });

  // Blur validasi nama
  container.addEventListener('blur', (e) => {
    const el  = e.target;
    const idx = parseInt(el.getAttribute('data-index') ?? '-1', 10);
    if (idx < 0) return;
    if (el.classList.contains('anggota-nama') && !el.value.trim()) {
      el.classList.add('is-invalid');
      showFieldError(`error-anggota-nama-${idx}`, `Nama tamu ${idx + 1} wajib diisi.`);
    }
  }, true); // useCapture agar blur bubbles

  // Hapus tamu (tombol remove)
  container.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.anggota-card__remove');
    if (!removeBtn) return;

    const idx = parseInt(removeBtn.getAttribute('data-index'), 10);
    if (isNaN(idx) || idx === 0) return; // tidak bisa hapus tamu pertama

    if (jumlahTamu <= 1) return;

    jumlahTamu--;
    anggotaData.splice(idx, 1);
    updateJumlahTamuDisplay();
    renderAnggotaRepeater();
    // Re-attach karena innerHTML baru
    checkSubmitEligibility();
  });
}

// ═════════════════════════════════════════════════════════════
// EVENT LISTENERS FORM UTAMA
// ═════════════════════════════════════════════════════════════
function attachFormEvents() {
  const form = document.getElementById('form-tamu');
  if (!form) return;

  // Validasi real-time field kunjungan
  [
    ['keperluan', 'error-keperluan', 'Keperluan wajib diisi.'],
  ].forEach(([id, errId, msg]) => attachRequiredValidation(id, errId, msg));

  // Instansi teks
  const instansiInput = document.getElementById('instansi');
  if (instansiInput) {
    instansiInput.addEventListener('input', () => {
      if (instansiInput.value.trim()) {
        instansiInput.classList.replace('is-invalid', 'is-valid') || instansiInput.classList.add('is-valid');
        hideFieldError('error-instansi');
      } else {
        instansiInput.classList.remove('is-valid');
      }
      checkSubmitEligibility();
    });
    instansiInput.addEventListener('blur', () => {
      if (selectedJenis !== JENIS_ORTU && selectedJenis !== JENIS_ALUMNI && !instansiInput.value.trim()) {
        instansiInput.classList.add('is-invalid');
        showFieldError('error-instansi', 'Instansi/asal wajib diisi.');
      }
    });
  }

  // Dropdown siswa
  const siswaSelect = document.getElementById('instansi-siswa');
  if (siswaSelect) {
    siswaSelect.addEventListener('change', () => {
      if (siswaSelect.value) {
        siswaSelect.classList.replace('is-invalid', 'is-valid') || siswaSelect.classList.add('is-valid');
        hideFieldError('error-instansi');
      } else {
        siswaSelect.classList.remove('is-valid');
      }
      checkSubmitEligibility();
    });
  }

  // Tahun lulus Alumni
  const tahunInput = document.getElementById('instansi-tahun-lulus');
  if (tahunInput) {
    tahunInput.addEventListener('input', () => {
      const yr = parseInt(tahunInput.value.trim(), 10);
      const ok = tahunInput.value.trim() && yr >= 1900 && yr <= 2099;
      tahunInput.classList.toggle('is-valid', !!ok);
      tahunInput.classList.toggle('is-invalid', !ok && !!tahunInput.value.trim());
      if (ok) hideFieldError('error-instansi');
      checkSubmitEligibility();
    });
    tahunInput.addEventListener('blur', () => {
      if (selectedJenis === JENIS_ALUMNI) {
        const yr = parseInt(tahunInput.value.trim(), 10);
        if (!tahunInput.value.trim() || yr < 1900 || yr > 2099) {
          tahunInput.classList.add('is-invalid');
          showFieldError('error-instansi', 'Masukkan tahun lulus yang valid.');
        }
      }
    });
  }

  // Dropdown bertemu dengan
  const bertemuSelect = document.getElementById('bertemu-dengan');
  if (bertemuSelect) {
    bertemuSelect.addEventListener('change', () => {
      if (bertemuSelect.value) {
        bertemuSelect.classList.replace('is-invalid', 'is-valid') || bertemuSelect.classList.add('is-valid');
        hideFieldError('error-bertemu');
      } else {
        bertemuSelect.classList.remove('is-valid');
      }
      checkSubmitEligibility();
    });
  }

  // ▶▶ Pasang event delegation repeater anggota
  attachAnggotaRepeaterEvents();

  // Submit form
  form.addEventListener('submit', handleSubmit);

  // Tombol "Daftarkan Tamu Lain"
  const btnNew = document.getElementById('btn-new-entry');
  if (btnNew) btnNew.addEventListener('click', resetForm);

  // Retry staf
  const btnRetry = document.getElementById('btn-retry-staf');
  if (btnRetry) btnRetry.addEventListener('click', retryLoadStaf);

  // ▶▶ Tombol navigasi review
  const btnEdit = document.getElementById('btn-review-edit');
  if (btnEdit) btnEdit.addEventListener('click', closeReviewScreen);

  const btnConfirm = document.getElementById('btn-review-confirm');
  if (btnConfirm) btnConfirm.addEventListener('click', submitFromReview);

  // ▶▶ Tombol Tambah Tamu Manual (di seksi anggota)
  const btnTambahManual = document.getElementById('btn-tambah-tamu-manual');
  if (btnTambahManual) {
    btnTambahManual.addEventListener('click', () => {
      // Guard: Orang Tua/Wali Murid tidak boleh rombongan
      if (selectedJenis === JENIS_ORTU) return;
      if (jumlahTamu >= MAX_TAMU) {
        showToast(`Maksimal ${MAX_TAMU} tamu per kunjungan.`, 'danger');
        return;
      }
      jumlahTamu++;
      anggotaData.push(_emptyAnggota());
      updateJumlahTamuDisplay();
      renderAnggotaRepeater();
      checkSubmitEligibility();
      setTimeout(() => {
        const cards = document.querySelectorAll('.anggota-card');
        if (cards.length > 0) cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    });
  }
}

// ═════════════════════════════════════════════════════════════
// VALIDASI
// ═════════════════════════════════════════════════════════════
function attachRequiredValidation(inputId, errorId, errorMsg) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('input', () => {
    if (input.value.trim()) {
      input.classList.remove('is-invalid');
      input.classList.add('is-valid');
      hideFieldError(errorId);
    } else {
      input.classList.remove('is-valid');
    }
    checkSubmitEligibility();
  });
  input.addEventListener('blur', () => {
    if (!input.value.trim()) {
      input.classList.add('is-invalid');
      input.classList.remove('is-valid');
      showFieldError(errorId, errorMsg);
    }
  });
}

function showFieldError(errorId, message) {
  const el = document.getElementById(errorId);
  if (!el) return;
  if (message) el.textContent = message;
  el.classList.add('visible');
}

function hideFieldError(errorId) {
  const el = document.getElementById(errorId);
  if (el) el.classList.remove('visible');
}

function checkSubmitEligibility() {
  const btn = document.getElementById('btn-submit');
  if (!btn) return;
  // BUG A2 FIX: update teks tombol sesuai jumlah tamu
  const textEl = btn.querySelector('.btn__text');
  if (textEl) {
    textEl.textContent = jumlahTamu > 1 ? 'Tinjau & Simpan' : 'Daftarkan Kunjungan';
  }
  btn.disabled = !isFormValid() || isSubmitting;
}

function isFormValid() {
  if (!selectedJenis) return false;

  // Instansi
  if (selectedJenis === JENIS_ORTU) {
    const siswaEl = document.getElementById('instansi-siswa');
    if (!siswaEl || !siswaEl.value) return false;
  } else if (selectedJenis === JENIS_ALUMNI) {
    const tahunEl = document.getElementById('instansi-tahun-lulus');
    const yr = parseInt(tahunEl?.value || '', 10);
    if (!tahunEl || isNaN(yr) || yr < 1900 || yr > 2099) return false;
  } else {
    const instansiEl = document.getElementById('instansi');
    if (!instansiEl || !instansiEl.value.trim()) return false;
  }

  // Keperluan
  const keperluanEl = document.getElementById('keperluan');
  if (!keperluanEl || !keperluanEl.value.trim()) return false;

  // Bertemu dengan
  const bertemuEl = document.getElementById('bertemu-dengan');
  if (!bertemuEl || !bertemuEl.value) return false;

  // Jam datang
  const jamEl = document.getElementById('jam-datang');
  if (!jamEl || !jamEl.value) return false;

  // Tanda tangan
  if (!signaturePad || signaturePad.isEmpty()) return false;

  // ▶▶ Validasi anggota pertama: selalu baca dari DOM sebagai source of truth
  const namaEl0  = document.getElementById('anggota-nama-0');
  const email0El = document.getElementById('anggota-email-0');
  if (!namaEl0 || !namaEl0.value.trim()) return false;
  const email0 = email0El ? email0El.value.trim() : '';
  if (!EMAIL_REGEX.test(email0)) return false;

  return true;
}

// ═════════════════════════════════════════════════════════════
// SUBMIT & REVIEW
// ═════════════════════════════════════════════════════════════
async function handleSubmit(e) {
  e.preventDefault();
  if (isSubmitting) return;

  // Sync final dari DOM sebelum validasi
  syncAnggotaFromDOM();

  if (!validateAllFields()) return;

  // ▶▶ Jika rombongan (>1 tamu), tampilkan review screen sebelum simpan
  if (jumlahTamu > 1) {
    showReviewScreen();
    return;
  }

  // Satu tamu — langsung simpan
  await _doSubmit();
}

/**
 * Dipanggil dari tombol "Simpan Kunjungan" di review screen.
 */
async function submitFromReview() {
  // Pastikan data anggota tersync (form tersembunyi, tapi data tidak berubah)
  syncAnggotaFromDOM();
  await _doSubmit();
}

async function _doSubmit() {
  if (isSubmitting) return;
  isSubmitting = true;

  const btnSubmit  = document.getElementById('btn-submit');
  const btnConfirm = document.getElementById('btn-review-confirm');
  if (btnSubmit)  setButtonLoading(btnSubmit);
  if (btnConfirm) setButtonLoading(btnConfirm);

  const payload = collectFormData();
  if (!payload) {
    showToast('Terjadi kesalahan internal. Refresh dan coba lagi.', 'danger', 5000);
    isSubmitting = false;
    if (btnSubmit)  resetButtonLoading(btnSubmit, false);
    if (btnConfirm) resetButtonLoading(btnConfirm, false);
    return;
  }

  try {
    const result = await callGAS('addTamu', payload);

    if (result.status === 'ok') {
      if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
      if (btnSubmit)  resetButtonLoading(btnSubmit, false);
      if (btnConfirm) resetButtonLoading(btnConfirm, false);
      closeReviewScreen();
      showSuccessScreen(payload);
    } else {
      showToast(result.message || 'Gagal menyimpan data. Coba lagi.', 'danger', 4000);
      isSubmitting = false;
      if (btnSubmit)  resetButtonLoading(btnSubmit, false);
      if (btnConfirm) resetButtonLoading(btnConfirm, false);
    }

  } catch (_) {
    showToast('Terjadi kesalahan koneksi. Silakan coba lagi.', 'danger', 4000);
    isSubmitting = false;
    if (btnSubmit)  resetButtonLoading(btnSubmit, false);
    if (btnConfirm) resetButtonLoading(btnConfirm, false);
  }
}

function validateAllFields() {
  let firstInvalid = null;

  // Jenis tamu
  if (!selectedJenis) {
    showFieldError('error-jenis-tamu', 'Pilih jenis tamu terlebih dahulu.');
    firstInvalid = firstInvalid || document.getElementById('jenis-tamu-pills');
  }

  // Instansi
  if (selectedJenis === JENIS_ORTU) {
    const siswaEl = document.getElementById('instansi-siswa');
    if (!siswaEl || !siswaEl.value) {
      if (siswaEl) siswaEl.classList.add('is-invalid');
      showFieldError('error-instansi', 'Pilih nama siswa terlebih dahulu.');
      if (!firstInvalid) firstInvalid = siswaEl;
    }
  } else if (selectedJenis === JENIS_ALUMNI) {
    const tahunEl = document.getElementById('instansi-tahun-lulus');
    const yr = parseInt(tahunEl?.value || '', 10);
    if (!tahunEl || isNaN(yr) || yr < 1900 || yr > 2099) {
      if (tahunEl) tahunEl.classList.add('is-invalid');
      showFieldError('error-instansi', 'Masukkan tahun lulus yang valid.');
      if (!firstInvalid) firstInvalid = tahunEl;
    }
  } else {
    const instansiEl = document.getElementById('instansi');
    if (!instansiEl || !instansiEl.value.trim()) {
      if (instansiEl) instansiEl.classList.add('is-invalid');
      showFieldError('error-instansi', 'Instansi/asal wajib diisi.');
      if (!firstInvalid) firstInvalid = instansiEl;
    }
  }

  // Keperluan
  const keperluanEl = document.getElementById('keperluan');
  if (!keperluanEl || !keperluanEl.value.trim()) {
    if (keperluanEl) keperluanEl.classList.add('is-invalid');
    showFieldError('error-keperluan', 'Keperluan wajib diisi.');
    if (!firstInvalid) firstInvalid = keperluanEl;
  }

  // Bertemu dengan
  const bertemuEl = document.getElementById('bertemu-dengan');
  if (!bertemuEl || !bertemuEl.value) {
    if (bertemuEl) bertemuEl.classList.add('is-invalid');
    showFieldError('error-bertemu', 'Pilih staf yang akan ditemui.');
    if (!firstInvalid) firstInvalid = bertemuEl;
  }

  // ▶▶ Validasi setiap anggota
  for (let i = 0; i < anggotaData.length; i++) {
    const namaEl  = document.getElementById(`anggota-nama-${i}`);
    const emailEl = document.getElementById(`anggota-email-${i}`);

    // Nama wajib semua tamu
    if (!namaEl || !namaEl.value.trim()) {
      if (namaEl) namaEl.classList.add('is-invalid');
      showFieldError(`error-anggota-nama-${i}`, `Nama tamu ${i + 1} wajib diisi.`);
      if (!firstInvalid) firstInvalid = namaEl;
    }

    // Email wajib tamu pertama
    if (i === 0) {
      const emailVal = emailEl ? emailEl.value.trim() : '';
      if (!emailVal || !EMAIL_REGEX.test(emailVal)) {
        if (emailEl) emailEl.classList.add('is-invalid');
        showFieldError('error-anggota-email-0', 'Email tamu pertama wajib diisi dengan format yang valid.');
        if (!firstInvalid) firstInvalid = emailEl;
      }
    }
  }

  // Tanda tangan
  if (!signaturePad || signaturePad.isEmpty()) {
    showFieldError('error-ttd', 'Tanda tangan wajib diisi.');
    if (!firstInvalid) firstInvalid = document.getElementById('signature-container');
  }

  if (firstInvalid) {
    firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }
  return true;
}

function collectFormData() {
  const tanggalEl   = document.getElementById('tanggal');
  const jamEl       = document.getElementById('jam-datang');
  const keperluanEl = document.getElementById('keperluan');
  const bertemuEl   = document.getElementById('bertemu-dengan');

  if (!tanggalEl || !jamEl || !keperluanEl || !bertemuEl) {
    console.error('collectFormData: elemen DOM tidak ditemukan.');
    return null;
  }

  // Instansi
  let instansiVal = '';
  if (selectedJenis === JENIS_ORTU) {
    const siswaEl = document.getElementById('instansi-siswa');
    instansiVal   = siswaEl ? siswaEl.value.trim() : '';
  } else if (selectedJenis === JENIS_ALUMNI) {
    const tahunEl = document.getElementById('instansi-tahun-lulus');
    instansiVal   = tahunEl ? tahunEl.value.trim() : '';
  } else {
    const instansiEl = document.getElementById('instansi');
    instansiVal      = instansiEl ? instansiEl.value.trim() : '';
  }

  const ttdBase64  = signaturePad && !signaturePad.isEmpty() ? signaturePad.toDataURL('image/png') : '';
  const jamRaw     = jamEl.value || '';
  const jamDatang  = jamRaw.length >= 5 ? jamRaw.substring(0, 5) : jamRaw;

  // ▶▶ collectFormData hanya membaca dari anggotaData (sudah disync di handleSubmit/submitFromReview)
  return {
    tanggal      : tanggalEl.value,
    jenisTamu    : selectedJenis,
    jamDatang    : jamDatang,
    instansi     : instansiVal,
    keperluan    : keperluanEl.value.trim(),
    bertemuDengan: bertemuEl.value,
    tandaTangan  : ttdBase64,
    anggota      : anggotaData,  // ▶▶ array anggota
  };
}

// ═════════════════════════════════════════════════════════════
// ▶▶ REVIEW SCREEN (Ringkasan Sebelum Simpan)
// ═════════════════════════════════════════════════════════════

function showReviewScreen() {
  const wrapper = document.getElementById('form-wrapper');
  const review  = document.getElementById('review-screen');
  if (!review) return;

  const bertemuEl   = document.getElementById('bertemu-dengan');
  const keperluanEl = document.getElementById('keperluan');
  const tanggalEl   = document.getElementById('tanggal');
  const jamEl       = document.getElementById('jam-datang');

  // Isi ringkasan kunjungan
  const elJumlah   = document.getElementById('review-jumlah');
  const elBertemu  = document.getElementById('review-bertemu');
  const elKep      = document.getElementById('review-keperluan');
  const elJenis    = document.getElementById('review-jenis');
  const elWaktu    = document.getElementById('review-waktu');
  const elDaftar   = document.getElementById('review-daftar-anggota');

  if (elJumlah)  elJumlah.textContent  = `${jumlahTamu} orang`;
  if (elBertemu) elBertemu.textContent = bertemuEl?.value || '—';
  if (elKep)     elKep.textContent     = keperluanEl?.value.trim() || '—';
  if (elJenis)   elJenis.textContent   = selectedJenis || '—';

  // Format waktu
  const tanggalDisplay = tanggalEl?.value
    ? new Date(tanggalEl.value + 'T00:00:00').toLocaleDateString('id-ID', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      })
    : '—';
  if (elWaktu) elWaktu.textContent = `${tanggalDisplay} · ${jamEl?.value || '—'}`;

  // Daftar anggota
  if (elDaftar) {
    elDaftar.innerHTML = anggotaData.map((a, i) => `
      <li class="review-anggota-item">
        <span class="review-anggota-item__nomor">${i + 1}</span>
        <span class="review-anggota-item__nama">${escapeHtml(a.namaLengkap || '—')}</span>
        ${a.jabatan ? `<span class="review-anggota-item__jabatan">${escapeHtml(a.jabatan)}</span>` : ''}
      </li>
    `).join('');
  }

  // Reset tombol konfirmasi
  const btnConfirm = document.getElementById('btn-review-confirm');
  if (btnConfirm) {
    btnConfirm.disabled = false;
    btnConfirm.classList.remove('loading');
  }

  if (wrapper) wrapper.style.display = 'none';
  review.style.display = '';
  void review.offsetHeight;
  review.classList.add('visible');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeReviewScreen() {
  const wrapper = document.getElementById('form-wrapper');
  const review  = document.getElementById('review-screen');
  if (review)  { review.classList.remove('visible'); review.style.display = 'none'; }
  if (wrapper) wrapper.style.display = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ═════════════════════════════════════════════════════════════
// SUCCESS SCREEN
// ═════════════════════════════════════════════════════════════
function showSuccessScreen(payload) {
  const formWrapper   = document.getElementById('form-wrapper');
  const successScreen = document.getElementById('success-screen');

  if (formWrapper)   formWrapper.style.display = 'none';
  if (successScreen) {
    successScreen.classList.remove('visible');
    void successScreen.offsetHeight;
    successScreen.classList.add('visible');
  }

  const timeEl   = document.getElementById('success-time');
  const dateEl   = document.getElementById('success-date');
  const countEl  = document.getElementById('success-count');

  if (timeEl) timeEl.textContent = payload?.jamDatang || '';
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('id-ID', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  }
  // ▶▶ Tampilkan jumlah tamu
  if (countEl) {
    const jml = payload?.anggota?.length || 1;
    countEl.textContent = jml > 1 ? `${jml} tamu terdaftar` : '1 tamu terdaftar';
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ═════════════════════════════════════════════════════════════
// RESET FORM
// ═════════════════════════════════════════════════════════════
function resetForm() {
  if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }

  isSubmitting  = false;
  selectedJenis = '';
  jumlahTamu    = 1;
  anggotaData   = [_emptyAnggota()];

  // Pastikan lock rombongan dilepas saat form direset
  _applyRombonganLock(false);

  const form = document.getElementById('form-tamu');
  if (form) form.reset();

  const hidJenis = document.getElementById('jenis-tamu');
  if (hidJenis) hidJenis.value = '';

  document.querySelectorAll('.pill-selector__item').forEach(btn => {
    btn.classList.remove('selected');
    btn.setAttribute('aria-pressed', 'false');
  });

  document.querySelectorAll('.form-control').forEach(el => {
    el.classList.remove('is-valid', 'is-invalid');
  });

  document.querySelectorAll('.form-error').forEach(el => {
    el.classList.remove('visible');
  });

  // Reset instansi field
  const instansiInput = document.getElementById('instansi');
  const instansiSiswa = document.getElementById('instansi-siswa');
  const instansiTahun = document.getElementById('instansi-tahun-lulus');
  const labelInstansi = document.getElementById('label-instansi');
  if (instansiInput) { instansiInput.style.display = ''; instansiInput.required = true; }
  if (instansiSiswa) { instansiSiswa.style.display = 'none'; instansiSiswa.required = false; }
  if (instansiTahun) { instansiTahun.style.display = 'none'; instansiTahun.required = false; }
  if (labelInstansi) labelInstansi.innerHTML = 'Instansi / Asal <span class="required">*</span>';

  clearSignature();

  // Tampilkan form, sembunyikan layar lain
  const formWrapper   = document.getElementById('form-wrapper');
  const successScreen = document.getElementById('success-screen');
  const reviewScreen  = document.getElementById('review-screen');
  if (formWrapper)   formWrapper.style.display = '';
  if (successScreen) successScreen.classList.remove('visible');
  if (reviewScreen)  { reviewScreen.classList.remove('visible'); reviewScreen.style.display = 'none'; }

  // Reset tombol submit
  const btn = document.getElementById('btn-submit');
  if (btn) {
    btn.disabled = true;
    btn.classList.remove('loading');
    const textEl = btn.querySelector('.btn__text');
    if (textEl) textEl.textContent = jumlahTamu > 1 ? 'Tinjau & Simpan' : 'Daftarkan Kunjungan';
  }

  // ▶▶ Reset repeater anggota
  renderAnggotaRepeater();

  initClock();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  setTimeout(() => {
    const namaInput = document.getElementById('anggota-nama-0');
    if (namaInput) namaInput.focus();
  }, 500);
}

// ═════════════════════════════════════════════════════════════
// LOADING STATE
// ═════════════════════════════════════════════════════════════
function showFormLoading(show) {
  const loader  = document.getElementById('form-loading');
  const wrapper = document.getElementById('form-wrapper');
  if (show) {
    if (loader)  loader.classList.add('visible');
    if (wrapper) wrapper.style.display = 'none';
  } else {
    if (loader)  loader.classList.remove('visible');
    if (wrapper) wrapper.style.display = '';
  }
}
