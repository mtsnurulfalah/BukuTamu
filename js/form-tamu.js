/**
 * form-tamu.js — Halaman Form Tamu Publik
 * ─────────────────────────────────────────────────────────
 * Alur:
 *   1. Load config sekolah (nama, logo) + staf secara paralel dari GAS
 *   2. Render pill selector jenis tamu
 *   3. Set tanggal & jam otomatis (live clock setiap detik)
 *   4. Inisialisasi signature_pad (dengan DPR-aware canvas sizing)
 *   5. Pasang validasi real-time per field
 *   6. Submit → callGAS('addTamu') → success screen
 */

'use strict';

// ── Module State ──────────────────────────────────────────────
let signaturePad   = null;   // instance SignaturePad
let selectedJenis  = '';     // jenis tamu yang dipilih
let clockInterval  = null;   // interval ID untuk live clock
let isSubmitting   = false;  // guard double-submit
let stafLoadFailed = false;  // flag kegagalan load staf

// ── Konstanta ─────────────────────────────────────────────────
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ═════════════════════════════════════════════════════════════
// INISIALISASI
// ═════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  showFormLoading(true);

  try {
    // Load config & staf secara paralel
    const [configResult, stafResult] = await Promise.allSettled([
      callGAS('getConfig'),
      callGAS('getStaf'),
    ]);

    const config = configResult.status === 'fulfilled' && configResult.value?.status === 'ok'
      ? (configResult.value.data || {})
      : {};

    const stafList = stafResult.status === 'fulfilled' && stafResult.value?.status === 'ok'
      ? (stafResult.value.data || [])
      : [];

    stafLoadFailed = stafList.length === 0 &&
      (stafResult.status === 'rejected' || stafResult.value?.status !== 'ok');

    // Terapkan ke UI
    applySchoolConfig(config);
    populateStafDropdown(stafList);
    renderJenisTamuPills();
    initClock();
    initSignaturePad();
    attachFormEvents();

  } catch (err) {
    // Fallback: tetap tampilkan form meski ada error
    console.error('Form init error:', err);
    renderJenisTamuPills();
    initClock();
    initSignaturePad();
    attachFormEvents();
  }

  showFormLoading(false);
});

// ═════════════════════════════════════════════════════════════
// SCHOOL CONFIG
// ═════════════════════════════════════════════════════════════
/**
 * Terapkan data config sekolah ke header UI.
 * Guard duplikasi: hapus img lama sebelum menyisipkan yang baru.
 * @param {Object} config
 */
function applySchoolConfig(config) {
  const namaSekolah = (config.nama_sekolah || '').trim() || CONFIG.APP_NAME;

  // Judul halaman
  document.title = `Buku Tamu — ${namaSekolah}`;

  // Nama sekolah
  const nameEl = document.getElementById('school-name');
  if (nameEl) nameEl.textContent = namaSekolah;

  // Alamat / subtitle
  const subtitleEl = document.getElementById('school-subtitle');
  if (subtitleEl && config.alamat_sekolah) {
    subtitleEl.textContent = config.alamat_sekolah;
  }

  // Logo
  const logoWrap = document.getElementById('school-logo');
  const logoIcon = document.getElementById('school-logo-icon');
  if (logoWrap && config.logo_url && config.logo_url.trim()) {
    // Hapus img duplikat jika ada
    const existing = logoWrap.querySelector('img');
    if (existing) existing.remove();

    const img = document.createElement('img');
    img.src   = normalizeLogoUrl(config.logo_url.trim());
    img.alt   = `Logo ${namaSekolah}`;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;';
    // BUG #2 FIX: sembunyikan icon segera sebelum gambar mulai load,
    // restore di onerror jika gambar gagal. Ini mencegah flash emoji+gambar bersamaan.
    if (logoIcon) logoIcon.style.display = 'none';
    img.onload  = () => { /* icon sudah disembunyikan di atas */ };
    img.onerror = () => {
      img.remove();
      if (logoIcon) logoIcon.style.display = ''; // tampilkan kembali icon default
    };
    logoWrap.appendChild(img);
  }
}

// ═════════════════════════════════════════════════════════════
// STAF DROPDOWN
// ═════════════════════════════════════════════════════════════
/**
 * Isi dropdown "Bertemu Dengan" dengan daftar staf aktif.
 * Tampilkan tombol retry jika data kosong.
 * @param {Array} stafList
 */
function populateStafDropdown(stafList) {
  const select   = document.getElementById('bertemu-dengan');
  const retryWrap = document.getElementById('staf-retry-wrap');
  if (!select) return;

  // Hapus semua opsi kecuali placeholder pertama
  while (select.options.length > 1) select.remove(1);

  if (!Array.isArray(stafList) || stafList.length === 0) {
    const opt = document.createElement('option');
    opt.value    = '';
    opt.disabled = true;
    opt.textContent = stafLoadFailed
      ? '— Gagal memuat daftar staf —'
      : '— Belum ada data staf —';
    select.appendChild(opt);

    // Tampilkan tombol retry jika gagal
    if (retryWrap) retryWrap.style.display = stafLoadFailed ? '' : 'none';
    return;
  }

  if (retryWrap) retryWrap.style.display = 'none';

  stafList.forEach(staf => {
    const opt         = document.createElement('option');
    opt.value         = staf.nama || '';
    opt.textContent   = staf.jabatan
      ? `${staf.nama} (${staf.jabatan})`
      : staf.nama || '';
    select.appendChild(opt);
  });
}

/** Retry load staf (dipanggil dari tombol retry) */
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
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Coba Lagi'; }
  }
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
    btn.type      = 'button';
    btn.className = 'pill-selector__item';
    btn.textContent  = jenis;
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

  hideFieldError('error-jenis-tamu');
  checkSubmitEligibility();
}

// ═════════════════════════════════════════════════════════════
// LIVE CLOCK
// ═════════════════════════════════════════════════════════════
function initClock() {
  // FIX B2: bersihkan interval lama sebelum membuat yang baru
  if (clockInterval) {
    clearInterval(clockInterval);
    clockInterval = null;
  }

  function tick() {
    const now = new Date();
    const y   = now.getFullYear();
    const mo  = String(now.getMonth() + 1).padStart(2, '0');
    const d   = String(now.getDate()).padStart(2, '0');
    const isoDate = `${y}-${mo}-${d}`;

    const displayDate = now.toLocaleDateString('id-ID', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    const displayTime = now.toLocaleTimeString('id-ID', {
      hour: '2-digit', minute: '2-digit', hour12: false,
    });

    const safe = (id, val, prop = 'textContent') => {
      const el = document.getElementById(id);
      if (el) el[prop] = val;
    };

    safe('display-tanggal', displayDate);
    safe('display-jam',     displayTime);
    safe('header-date',     displayDate);
    safe('tanggal',         isoDate,      'value');
    safe('jam-datang',      displayTime,  'value');
  }

  tick();
  clockInterval = setInterval(tick, 1000);
}

// ═════════════════════════════════════════════════════════════
// SIGNATURE PAD
// ═════════════════════════════════════════════════════════════
function initSignaturePad() {
  const canvas      = document.getElementById('signature-canvas');
  const container   = document.getElementById('signature-container');
  const placeholder = document.getElementById('signature-placeholder');
  const clearBtn    = document.getElementById('btn-clear-signature');

  if (!canvas || typeof SignaturePad === 'undefined') {
    console.warn('SignaturePad tidak tersedia atau canvas tidak ditemukan.');
    return;
  }

  /**
   * FIX B8: Simpan data tanda tangan sebelum resize, restore sesudahnya.
   * Ini mencegah hilangnya tanda tangan saat orientasi berubah.
   */
  function resizeCanvas() {
    // Simpan data sebelum resize
    const hadSignature = signaturePad && !signaturePad.isEmpty();
    const savedData    = hadSignature ? signaturePad.toData() : null;

    const ratio  = Math.max(window.devicePixelRatio || 1, 1);
    const width  = canvas.offsetWidth;
    const height = canvas.offsetHeight || 160;

    canvas.width  = width  * ratio;
    canvas.height = height * ratio;
    canvas.getContext('2d').scale(ratio, ratio);

    if (signaturePad) signaturePad.clear();

    // Restore tanda tangan jika ada
    if (savedData && savedData.length > 0) {
      try {
        signaturePad.fromData(savedData);
      } catch (_) {
        // Jika restore gagal, biarkan canvas kosong
      }
    }
  }

  signaturePad = new SignaturePad(canvas, {
    minWidth       : 1,
    maxWidth       : 3,
    penColor       : '#1f2937',
    backgroundColor: 'rgba(255,255,255,0)',
  });

  resizeCanvas();

  // Debounced resize
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCanvas, 250);
  });

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

  if (clearBtn) {
    clearBtn.addEventListener('click', clearSignature);
  }
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
// EVENT LISTENERS
// ═════════════════════════════════════════════════════════════
function attachFormEvents() {
  const form = document.getElementById('form-tamu');
  if (!form) return;

  // Validasi real-time tiap field text
  [
    ['nama-lengkap', 'error-nama',       'Nama lengkap wajib diisi.'],
    ['instansi',     'error-instansi',   'Instansi/asal wajib diisi.'],
    ['no-hp',        'error-no-hp',      'Nomor HP/WA wajib diisi.'],
    ['keperluan',    'error-keperluan',  'Keperluan wajib diisi.'],
  ].forEach(([id, errId, msg]) => attachRequiredValidation(id, errId, msg));

  // Validasi email
  const emailInput = document.getElementById('email');
  if (emailInput) {
    emailInput.addEventListener('input', () => {
      validateEmail(emailInput);
      checkSubmitEligibility();
    });
    emailInput.addEventListener('blur', () => validateEmail(emailInput, true));
  }

  // Dropdown bertemu
  const bertemuSelect = document.getElementById('bertemu-dengan');
  if (bertemuSelect) {
    bertemuSelect.addEventListener('change', () => {
      if (bertemuSelect.value) {
        bertemuSelect.classList.remove('is-invalid');
        bertemuSelect.classList.add('is-valid');
        hideFieldError('error-bertemu');
      } else {
        bertemuSelect.classList.remove('is-valid');
      }
      checkSubmitEligibility();
    });
  }

  // Submit form
  form.addEventListener('submit', handleSubmit);

  // Tombol "Daftarkan Tamu Lain"
  const btnNew = document.getElementById('btn-new-entry');
  if (btnNew) btnNew.addEventListener('click', resetForm);

  // Tombol retry staf
  const btnRetry = document.getElementById('btn-retry-staf');
  if (btnRetry) btnRetry.addEventListener('click', retryLoadStaf);
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

/**
 * Validasi email dengan feedback visual.
 * @param {HTMLInputElement|null} input
 * @param {boolean} strict
 * @returns {boolean}
 */
function validateEmail(input, strict = false) {
  // FIX B6: null guard
  if (!input) return false;

  const val = input.value.trim();

  if (!val) {
    input.classList.remove('is-valid', 'is-invalid');
    hideFieldError('error-email');
    if (strict) {
      input.classList.add('is-invalid');
      showFieldError('error-email', 'Email wajib diisi.');
    }
    return false;
  }

  if (!EMAIL_REGEX.test(val)) {
    input.classList.add('is-invalid');
    input.classList.remove('is-valid');
    showFieldError('error-email', 'Format email tidak valid. Contoh: nama@domain.com');
    return false;
  }

  input.classList.add('is-valid');
  input.classList.remove('is-invalid');
  hideFieldError('error-email');
  return true;
}

/**
 * FIX B5 & B9: Tampilkan pesan error — update textContent langsung pada elemen,
 * tidak bergantung pada child <span> yang mungkin tidak ada.
 */
function showFieldError(errorId, message) {
  const el = document.getElementById(errorId);
  if (!el) return;
  if (message) el.textContent = `⚠️ ${message}`;
  el.classList.add('visible');
}

function hideFieldError(errorId) {
  const el = document.getElementById(errorId);
  if (el) el.classList.remove('visible');
}

function checkSubmitEligibility() {
  const btn = document.getElementById('btn-submit');
  if (!btn) return;
  btn.disabled = !isFormValid() || isSubmitting;
}

function isFormValid() {
  if (!selectedJenis) return false;

  const requiredFields = ['nama-lengkap', 'instansi', 'no-hp', 'keperluan'];
  for (const id of requiredFields) {
    const el = document.getElementById(id);
    if (!el || !el.value.trim()) return false;
  }

  const emailEl = document.getElementById('email');
  if (!emailEl || !EMAIL_REGEX.test(emailEl.value.trim())) return false;

  const bertemuEl = document.getElementById('bertemu-dengan');
  if (!bertemuEl || !bertemuEl.value) return false;

  // FIX B10: null guard untuk signaturePad
  if (!signaturePad || signaturePad.isEmpty()) return false;

  return true;
}

// ═════════════════════════════════════════════════════════════
// SUBMIT
// ═════════════════════════════════════════════════════════════
async function handleSubmit(e) {
  e.preventDefault();
  if (isSubmitting) return;

  if (!validateAllFields()) return;

  isSubmitting = true;
  const btn = document.getElementById('btn-submit');
  if (btn) setButtonLoading(btn);

  const payload = collectFormData();
  if (!payload) {
    // collectFormData gagal — elemen tidak ditemukan
    showToast('Terjadi kesalahan internal. Refresh halaman dan coba lagi.', 'danger', 5000);
    isSubmitting = false;
    if (btn) resetButtonLoading(btn, false);
    return;
  }

  try {
    const result = await callGAS('addTamu', payload);

    if (result.status === 'ok') {
      // Hentikan clock
      if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
      showSuccessScreen(payload);
    } else {
      showToast(result.message || 'Gagal menyimpan data. Coba lagi.', 'danger', 4000);
      isSubmitting = false;
      if (btn) resetButtonLoading(btn, false);
    }

  } catch (_) {
    showToast('Terjadi kesalahan koneksi. Silakan coba lagi.', 'danger', 4000);
    isSubmitting = false;
    if (btn) resetButtonLoading(btn, false);
  }
}

function validateAllFields() {
  let firstInvalid = null;

  // Jenis tamu
  if (!selectedJenis) {
    showFieldError('error-jenis-tamu', 'Pilih jenis tamu terlebih dahulu.');
    firstInvalid = firstInvalid || document.getElementById('jenis-tamu-pills');
  }

  // Field text wajib
  const fieldMap = [
    { id: 'nama-lengkap', errId: 'error-nama',      msg: 'Nama lengkap wajib diisi.' },
    { id: 'instansi',     errId: 'error-instansi',  msg: 'Instansi/asal wajib diisi.' },
    { id: 'no-hp',        errId: 'error-no-hp',     msg: 'Nomor HP/WA wajib diisi.' },
    { id: 'keperluan',    errId: 'error-keperluan', msg: 'Keperluan wajib diisi.' },
  ];

  fieldMap.forEach(({ id, errId, msg }) => {
    const el = document.getElementById(id);
    if (!el || !el.value.trim()) {
      if (el) el.classList.add('is-invalid');
      showFieldError(errId, msg);
      if (!firstInvalid) firstInvalid = el;
    }
  });

  // Email — FIX B6: ambil element secara eksplisit dengan null check
  const emailEl = document.getElementById('email');
  if (!validateEmail(emailEl, true)) {
    if (!firstInvalid) firstInvalid = emailEl;
  }

  // Bertemu dengan
  const bertemuEl = document.getElementById('bertemu-dengan');
  if (!bertemuEl || !bertemuEl.value) {
    if (bertemuEl) bertemuEl.classList.add('is-invalid');
    showFieldError('error-bertemu', 'Pilih staf yang akan ditemui.');
    if (!firstInvalid) firstInvalid = bertemuEl;
  }

  // Tanda tangan — FIX B10: null guard
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

/**
 * FIX B7: Semua akses .value dibungkus dengan null guard.
 * @returns {Object|null} payload atau null jika ada elemen DOM yang hilang
 */
function collectFormData() {
  const tanggalEl    = document.getElementById('tanggal');
  const jamEl        = document.getElementById('jam-datang');
  const namaEl       = document.getElementById('nama-lengkap');
  const instansiEl   = document.getElementById('instansi');
  const noHpEl       = document.getElementById('no-hp');
  const emailEl      = document.getElementById('email');
  const keperluanEl  = document.getElementById('keperluan');
  const bertemuEl    = document.getElementById('bertemu-dengan');

  // Pastikan semua elemen wajib ada
  if (!tanggalEl || !jamEl || !namaEl || !instansiEl ||
      !noHpEl || !emailEl || !keperluanEl || !bertemuEl) {
    console.error('collectFormData: satu atau lebih elemen DOM tidak ditemukan.');
    return null;
  }

  const ttdBase64 = signaturePad && !signaturePad.isEmpty()
    ? signaturePad.toDataURL('image/png')
    : '';

  return {
    tanggal      : tanggalEl.value,
    jenisTamu    : selectedJenis,
    jamDatang    : jamEl.value,
    namaLengkap  : namaEl.value.trim(),
    instansi     : instansiEl.value.trim(),
    noHp         : noHpEl.value.trim(),
    email        : emailEl.value.trim().toLowerCase(),
    keperluan    : keperluanEl.value.trim(),
    bertemuDengan: bertemuEl.value,
    tandaTangan  : ttdBase64,
  };
}

// ═════════════════════════════════════════════════════════════
// SUCCESS SCREEN
// ═════════════════════════════════════════════════════════════
function showSuccessScreen(payload) {
  const formWrapper   = document.getElementById('form-wrapper');
  const successScreen = document.getElementById('success-screen');

  if (formWrapper)   formWrapper.style.display = 'none';
  if (successScreen) {
    // FIX B14: Re-trigger animasi dengan force reflow
    successScreen.classList.remove('visible');
    void successScreen.offsetHeight; // trigger reflow
    successScreen.classList.add('visible');
  }

  const timeEl = document.getElementById('success-time');
  const dateEl = document.getElementById('success-date');
  if (timeEl) timeEl.textContent = payload?.jamDatang || '';
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('id-ID', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ═════════════════════════════════════════════════════════════
// RESET FORM
// ═════════════════════════════════════════════════════════════
function resetForm() {
  // FIX B2: bersihkan clock lama, initClock akan buat yang baru
  if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }

  isSubmitting  = false;
  selectedJenis = '';

  // FIX B1: gunakan ID yang benar langsung
  const form = document.getElementById('form-tamu');
  if (form) form.reset();

  // Reset hidden input jenis tamu
  const hidJenis = document.getElementById('jenis-tamu');
  if (hidJenis) hidJenis.value = '';

  // Reset pill selector
  document.querySelectorAll('.pill-selector__item').forEach(btn => {
    btn.classList.remove('selected');
    btn.setAttribute('aria-pressed', 'false');
  });

  // Reset state validasi semua input
  document.querySelectorAll('.form-control').forEach(el => {
    el.classList.remove('is-valid', 'is-invalid');
  });

  // Sembunyikan semua pesan error
  document.querySelectorAll('.form-error').forEach(el => {
    el.classList.remove('visible');
  });

  // Reset signature pad
  clearSignature();

  // Tampilkan form, sembunyikan success screen
  const formWrapper   = document.getElementById('form-wrapper');
  const successScreen = document.getElementById('success-screen');
  if (formWrapper)   formWrapper.style.display = '';
  if (successScreen) successScreen.classList.remove('visible');

  // Nonaktifkan tombol submit
  const btn = document.getElementById('btn-submit');
  if (btn) btn.disabled = true;

  // Restart clock
  initClock();

  // Scroll ke atas
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Fokus ke field pertama setelah animasi scroll selesai
  setTimeout(() => {
    const namaInput = document.getElementById('nama-lengkap');
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
