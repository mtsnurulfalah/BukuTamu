/**
 * form-tamu.js — Halaman Form Tamu Publik
 * ─────────────────────────────────────────────────────────
 * Alur:
 *   1. Load config sekolah (nama, logo) + staf + siswa secara paralel dari GAS
 *   2. Render pill selector jenis tamu
 *   3. Set tanggal otomatis (live) + input jam datang (editable, default sekarang)
 *   4. Inisialisasi signature_pad (DPR-aware, pointer events untuk desktop)
 *   5. Pasang validasi real-time per field
 *   6. Submit → callGAS('addTamu') → success screen
 */

'use strict';

// ── Module State ──────────────────────────────────────────────
let signaturePad   = null;   // instance SignaturePad
let selectedJenis  = '';     // jenis tamu yang dipilih
let clockInterval  = null;   // interval ID untuk live clock (tanggal)
let isSubmitting   = false;  // guard double-submit
let stafLoadFailed = false;  // flag kegagalan load staf
let siswaList      = [];     // data siswa dari GAS

// ── Konstanta ─────────────────────────────────────────────────
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const JENIS_ORTU  = 'Orang Tua/Wali Murid';
const JENIS_ALUMNI = 'Alumni';

// ═════════════════════════════════════════════════════════════
// INISIALISASI
// ═════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  showFormLoading(true);

  try {
    // Load config, staf, dan siswa secara paralel
    const [configResult, stafResult, siswaResult] = await Promise.allSettled([
      callGAS('getConfig'),
      callGAS('getStaf'),
      callGAS('getSiswa'),
    ]);

    const config = configResult.status === 'fulfilled' && configResult.value?.status === 'ok'
      ? (configResult.value.data || {})
      : {};

    const stafData = stafResult.status === 'fulfilled' && stafResult.value?.status === 'ok'
      ? (stafResult.value.data || [])
      : [];

    stafLoadFailed = stafData.length === 0 &&
      (stafResult.status === 'rejected' || stafResult.value?.status !== 'ok');

    siswaList = siswaResult.status === 'fulfilled' && siswaResult.value?.status === 'ok'
      ? (siswaResult.value.data || [])
      : [];

    // Terapkan ke UI
    applySchoolConfig(config);
    populateStafDropdown(stafData);
    populateSiswaDropdown(siswaList);
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
function applySchoolConfig(config) {
  const namaSekolah = (config.nama_sekolah || '').trim() || CONFIG.APP_NAME;

  document.title = `Buku Tamu — ${namaSekolah}`;

  const nameEl = document.getElementById('school-name');
  if (nameEl) nameEl.textContent = namaSekolah;

  const subtitleEl = document.getElementById('school-subtitle');
  if (subtitleEl && config.alamat_sekolah) {
    subtitleEl.textContent = config.alamat_sekolah;
  }

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
    img.onerror = () => {
      img.remove();
      if (logoIcon) logoIcon.style.display = '';
    };
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
    opt.textContent = stafLoadFailed
      ? '— Gagal memuat daftar staf —'
      : '— Belum ada data staf —';
    select.appendChild(opt);
    if (retryWrap) retryWrap.style.display = stafLoadFailed ? '' : 'none';
    return;
  }

  if (retryWrap) retryWrap.style.display = 'none';

  stafData.forEach(staf => {
    const opt       = document.createElement('option');
    opt.value       = staf.nama || '';
    opt.textContent = staf.jabatan
      ? `${staf.nama} (${staf.jabatan})`
      : staf.nama || '';
    select.appendChild(opt);
  });
}

/** Retry load staf */
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
// SISWA DROPDOWN
// ═════════════════════════════════════════════════════════════
/**
 * Isi dropdown siswa untuk field "Orang Tua/Wali dari".
 * @param {Array} list - data siswa dari GAS
 */
function populateSiswaDropdown(list) {
  const select = document.getElementById('instansi-siswa');
  if (!select) return;

  // Hapus opsi lama kecuali placeholder
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
    opt.textContent = siswa.kelas
      ? `${siswa.namaLengkap} (${siswa.kelas})`
      : siswa.namaLengkap || '';
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
    btn.type         = 'button';
    btn.className    = 'pill-selector__item';
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

  // Tampilkan/sembunyikan field instansi sesuai jenis tamu
  _toggleInstansiField(jenis);

  hideFieldError('error-jenis-tamu');
  checkSubmitEligibility();
}

/**
 * Toggle tampilan field instansi sesuai jenis tamu:
 * - Orang Tua/Wali Murid → dropdown siswa
 * - Alumni               → input angka tahun lulus
 * - Lainnya              → input teks instansi/asal
 * @param {string} jenis
 */
function _toggleInstansiField(jenis) {
  const inputText     = document.getElementById('instansi');
  const selectSiswa   = document.getElementById('instansi-siswa');
  const inputTahun    = document.getElementById('instansi-tahun-lulus');
  const labelEl       = document.getElementById('label-instansi');

  if (!inputText) return;

  // Sembunyikan dan non-required semua dulu
  const hide = (el) => { if (el) { el.style.display = 'none'; el.required = false; } };
  hide(inputText);
  hide(selectSiswa);
  hide(inputTahun);

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

  // Bersihkan state validasi saat jenis berganti
  hideFieldError('error-instansi');
  [inputText, selectSiswa, inputTahun].forEach(el => {
    if (el) el.classList.remove('is-valid', 'is-invalid');
  });
}

// ═════════════════════════════════════════════════════════════
// LIVE CLOCK (hanya tanggal; jam datang kini input editable)
// ═════════════════════════════════════════════════════════════
function initClock() {
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

    const safe = (id, val, prop = 'textContent') => {
      const el = document.getElementById(id);
      if (el) el[prop] = val;
    };

    safe('display-tanggal', displayDate);
    safe('header-date',     displayDate);
    safe('tanggal',         isoDate, 'value');
  }

  tick();
  clockInterval = setInterval(tick, 60000); // update per menit cukup untuk tanggal

  // Set default jam sekarang pada input jam-datang (hanya sekali, agar tidak
  // menimpa nilai yang sudah diubah user)
  _setDefaultJam();
}

/**
 * Isi input jam-datang dengan jam sekarang sebagai default.
 * Dipanggil sekali saat init/reset — tidak menimpa pilihan user.
 */
function _setDefaultJam() {
  const jamInput = document.getElementById('jam-datang');
  if (!jamInput) return;
  const now = new Date();
  const hh  = String(now.getHours()).padStart(2, '0');
  const mm  = String(now.getMinutes()).padStart(2, '0');
  jamInput.value = `${hh}:${mm}`;
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
   * Resize canvas dengan memperhitungkan Device Pixel Ratio.
   * Canvas kini position:absolute mengisi container, jadi kita baca
   * dimensi dari container (offsetParent), bukan canvas itu sendiri.
   * Simpan & restore data tanda tangan agar tidak hilang saat resize.
   */
  function resizeCanvas() {
    const hadSignature = signaturePad && !signaturePad.isEmpty();
    const savedData    = hadSignature ? signaturePad.toData() : null;

    const ratio  = Math.max(window.devicePixelRatio || 1, 1);
    // Baca dimensi dari container, bukan canvas (canvas sudah 100%x100%)
    const width  = container ? container.clientWidth  : canvas.offsetWidth;
    const height = container ? container.clientHeight : (canvas.offsetHeight || 160);

    canvas.width  = width  * ratio;
    canvas.height = height * ratio;
    canvas.getContext('2d').scale(ratio, ratio);

    if (signaturePad) signaturePad.clear();

    if (savedData && savedData.length > 0) {
      try { signaturePad.fromData(savedData); } catch (_) { /* biarkan kosong */ }
    }
  }

  // ── Inisialisasi SignaturePad ───────────────────────────────
  signaturePad = new SignaturePad(canvas, {
    minWidth       : 1,
    maxWidth       : 3,
    penColor       : '#1f2937',
    backgroundColor: 'rgba(255,255,255,0)',
  });

  // Beri waktu sebentar agar browser menghitung layout (canvas sudah absolute)
  requestAnimationFrame(() => {
    resizeCanvas();
  });

  // Debounced resize
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCanvas, 250);
  });

  // touch-action: none wajib ada di canvas agar browser tidak scroll saat menggambar.
  // Ini sudah di-set via CSS, tapi set juga via JS sebagai failsafe.
  canvas.style.touchAction = 'none';
  // Jangan set position/zIndex via JS — sudah diatur di CSS dengan benar.

  // Signature events
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

  // Validasi real-time field text wajib
  [
    ['nama-lengkap', 'error-nama',       'Nama lengkap wajib diisi.'],
    ['no-hp',        'error-no-hp',      'Nomor HP/WA wajib diisi.'],
    ['keperluan',    'error-keperluan',  'Keperluan wajib diisi.'],
  ].forEach(([id, errId, msg]) => attachRequiredValidation(id, errId, msg));

  // Validasi instansi teks
  const instansiInput = document.getElementById('instansi');
  if (instansiInput) {
    instansiInput.addEventListener('input', () => {
      if (instansiInput.value.trim()) {
        instansiInput.classList.remove('is-invalid');
        instansiInput.classList.add('is-valid');
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

  // Validasi dropdown siswa
  const siswaSelect = document.getElementById('instansi-siswa');
  if (siswaSelect) {
    siswaSelect.addEventListener('change', () => {
      if (siswaSelect.value) {
        siswaSelect.classList.remove('is-invalid');
        siswaSelect.classList.add('is-valid');
        hideFieldError('error-instansi');
      } else {
        siswaSelect.classList.remove('is-valid');
      }
      checkSubmitEligibility();
    });
  }

  // Validasi input tahun lulus (Alumni)
  const tahunInput = document.getElementById('instansi-tahun-lulus');
  if (tahunInput) {
    tahunInput.addEventListener('input', () => {
      const val = tahunInput.value.trim();
      const yr  = parseInt(val, 10);
      if (val && yr >= 1900 && yr <= 2099) {
        tahunInput.classList.remove('is-invalid');
        tahunInput.classList.add('is-valid');
        hideFieldError('error-instansi');
      } else {
        tahunInput.classList.remove('is-valid');
      }
      checkSubmitEligibility();
    });
    tahunInput.addEventListener('blur', () => {
      if (selectedJenis === JENIS_ALUMNI) {
        const val = tahunInput.value.trim();
        const yr  = parseInt(val, 10);
        if (!val || yr < 1900 || yr > 2099) {
          tahunInput.classList.add('is-invalid');
          showFieldError('error-instansi', 'Masukkan tahun lulus yang valid.');
        }
      }
    });
  }

  // Validasi email
  const emailInput = document.getElementById('email');
  if (emailInput) {
    emailInput.addEventListener('input', () => {
      validateEmail(emailInput);
      checkSubmitEligibility();
    });
    emailInput.addEventListener('blur', () => validateEmail(emailInput, true));
  }

  // Dropdown bertemu dengan
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

function validateEmail(input, strict = false) {
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

  // Field teks wajib
  const textFields = ['nama-lengkap', 'no-hp', 'keperluan'];
  for (const id of textFields) {
    const el = document.getElementById(id);
    if (!el || !el.value.trim()) return false;
  }

  // Instansi: teks, dropdown siswa, atau tahun lulus tergantung jenis tamu
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

  // Email
  const emailEl = document.getElementById('email');
  if (!emailEl || !EMAIL_REGEX.test(emailEl.value.trim())) return false;

  // Bertemu dengan
  const bertemuEl = document.getElementById('bertemu-dengan');
  if (!bertemuEl || !bertemuEl.value) return false;

  // Jam datang (harus terisi)
  const jamEl = document.getElementById('jam-datang');
  if (!jamEl || !jamEl.value) return false;

  // Tanda tangan
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
    showToast('Terjadi kesalahan internal. Refresh halaman dan coba lagi.', 'danger', 5000);
    isSubmitting = false;
    if (btn) resetButtonLoading(btn, false);
    return;
  }

  try {
    const result = await callGAS('addTamu', payload);

    if (result.status === 'ok') {
      if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
      // Reset tombol loading sebelum berpindah ke success screen
      if (btn) resetButtonLoading(btn, false);
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

  // Nama
  const namaEl = document.getElementById('nama-lengkap');
  if (!namaEl || !namaEl.value.trim()) {
    if (namaEl) namaEl.classList.add('is-invalid');
    showFieldError('error-nama', 'Nama lengkap wajib diisi.');
    if (!firstInvalid) firstInvalid = namaEl;
  }

  // Instansi (teks, dropdown siswa, atau tahun lulus)
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

  // No HP
  const noHpEl = document.getElementById('no-hp');
  if (!noHpEl || !noHpEl.value.trim()) {
    if (noHpEl) noHpEl.classList.add('is-invalid');
    showFieldError('error-no-hp', 'Nomor HP/WA wajib diisi.');
    if (!firstInvalid) firstInvalid = noHpEl;
  }

  // Email
  const emailEl = document.getElementById('email');
  if (!validateEmail(emailEl, true)) {
    if (!firstInvalid) firstInvalid = emailEl;
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
  const namaEl      = document.getElementById('nama-lengkap');
  const noHpEl      = document.getElementById('no-hp');
  const emailEl     = document.getElementById('email');
  const keperluanEl = document.getElementById('keperluan');
  const bertemuEl   = document.getElementById('bertemu-dengan');

  if (!tanggalEl || !jamEl || !namaEl || !noHpEl || !emailEl || !keperluanEl || !bertemuEl) {
    console.error('collectFormData: satu atau lebih elemen DOM tidak ditemukan.');
    return null;
  }

  // Instansi: ambil dari teks, dropdown siswa, atau tahun lulus
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

  const ttdBase64 = signaturePad && !signaturePad.isEmpty()
    ? signaturePad.toDataURL('image/png')
    : '';

  // Format jam dari input[type=time] → "HH:MM"
  const jamRaw = jamEl.value || '';
  const jamDatang = jamRaw.length >= 5 ? jamRaw.substring(0, 5) : jamRaw;

  return {
    tanggal      : tanggalEl.value,
    jenisTamu    : selectedJenis,
    jamDatang    : jamDatang,
    namaLengkap  : namaEl.value.trim(),
    instansi     : instansiVal,
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
  if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }

  isSubmitting  = false;
  selectedJenis = '';

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

  // Reset field instansi ke teks (jenis belum dipilih)
  const instansiInput   = document.getElementById('instansi');
  const instansiSiswa   = document.getElementById('instansi-siswa');
  const instansiTahun   = document.getElementById('instansi-tahun-lulus');
  const labelInstansi   = document.getElementById('label-instansi');
  if (instansiInput) { instansiInput.style.display = ''; instansiInput.required = true; }
  if (instansiSiswa) { instansiSiswa.style.display = 'none'; instansiSiswa.required = false; }
  if (instansiTahun) { instansiTahun.style.display = 'none'; instansiTahun.required = false; }
  if (labelInstansi) labelInstansi.innerHTML = 'Instansi / Asal <span class="required">*</span>';

  // Reset signature pad
  clearSignature();

  // Tampilkan form, sembunyikan success screen
  const formWrapper   = document.getElementById('form-wrapper');
  const successScreen = document.getElementById('success-screen');
  if (formWrapper)   formWrapper.style.display = '';
  if (successScreen) successScreen.classList.remove('visible');

  // Fix #3: Reset tombol submit ke state default (disabled, teks normal, tanpa loading)
  const btn = document.getElementById('btn-submit');
  if (btn) {
    btn.disabled = true;
    btn.classList.remove('loading');   // class yang diset oleh setButtonLoading()
    const textEl = btn.querySelector('.btn__text');
    if (textEl) textEl.textContent = 'Daftarkan Kunjungan';
  }

  // Restart clock (tanggal) dan set default jam
  initClock();

  window.scrollTo({ top: 0, behavior: 'smooth' });

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
