/**
 * form-tamu.js
 * Logic halaman form tamu publik (index.html).
 * ─────────────────────────────────────────────────────────
 * Alur:
 *   1. Load config sekolah (nama, logo) dari GAS
 *   2. Load daftar staf aktif untuk dropdown "Bertemu Dengan"
 *   3. Set tanggal & jam otomatis (realtime clock)
 *   4. Render pill selector jenis tamu
 *   5. Inisialisasi signature_pad canvas
 *   6. Validasi semua field secara real-time
 *   7. Submit → callGAS('addTamu', ...) → halaman sukses
 */

// ── State ─────────────────────────────────────────────────────
let signaturePad   = null;   // instance signature_pad
let selectedJenis  = '';     // jenis tamu yang dipilih
let clockInterval  = null;   // interval untuk jam live
let isSubmitting   = false;  // guard double submit

// ── Regex validasi email ──────────────────────────────────────
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ── DOMContentLoaded ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  showFormLoading(true);

  // Jalankan load config & staf secara paralel
  const [configResult, stafResult] = await Promise.all([
    callGAS('getConfig').catch(() => ({ status: 'error', data: {} })),
    callGAS('getStaf').catch(() => ({ status: 'error', data: [] })),
  ]);

  // Terapkan config sekolah ke UI
  applySchoolConfig(configResult.data || {});

  // Isi dropdown Bertemu Dengan
  populateStafDropdown(stafResult.data || []);

  // Render pill selector jenis tamu
  renderJenisTamuPills();

  // Set tanggal & jam otomatis + mulai clock
  initClock();

  // Inisialisasi signature pad
  initSignaturePad();

  // Pasang event listeners form
  attachFormEvents();

  showFormLoading(false);
});

// ── Apply School Config ───────────────────────────────────────
/**
 * Terapkan data config sekolah ke elemen UI.
 * @param {Object} config
 */
function applySchoolConfig(config) {
  // Nama sekolah
  const namaSekolah = config.nama_sekolah || CONFIG.APP_NAME;

  const nameEl    = document.getElementById('school-name');
  const logoIcon  = document.getElementById('school-logo-icon');
  const logoImg   = document.getElementById('school-logo-img');

  if (nameEl) nameEl.textContent = namaSekolah;

  // Update judul halaman
  document.title = `Buku Tamu — ${namaSekolah}`;

  // Logo
  if (config.logo_url && config.logo_url.trim() !== '') {
    // Buat elemen img jika ada URL logo
    if (logoIcon) {
      const img = document.createElement('img');
      img.src   = config.logo_url;
      img.alt   = `Logo ${namaSekolah}`;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:var(--radius-lg);';
      img.onerror = () => { img.remove(); }; // fallback jika gagal load
      logoIcon.parentElement.appendChild(img);
      logoIcon.style.display = 'none';
    }
  }

  // Subtitle alamat
  const subtitleEl = document.getElementById('school-subtitle');
  if (subtitleEl && config.alamat_sekolah) {
    subtitleEl.textContent = config.alamat_sekolah;
  }
}

// ── Populate Staf Dropdown ────────────────────────────────────
/**
 * Isi dropdown "Bertemu Dengan" dengan daftar staf aktif.
 * @param {Array} stafList
 */
function populateStafDropdown(stafList) {
  const select = document.getElementById('bertemu-dengan');
  if (!select) return;

  // Hapus semua option kecuali placeholder
  while (select.options.length > 1) {
    select.remove(1);
  }

  if (!stafList || stafList.length === 0) {
    const opt = document.createElement('option');
    opt.value    = '';
    opt.disabled = true;
    opt.textContent = '— Data staf tidak tersedia —';
    select.appendChild(opt);
    return;
  }

  stafList.forEach(staf => {
    const opt = document.createElement('option');
    opt.value       = staf.nama;
    opt.textContent = staf.jabatan
      ? `${staf.nama} (${staf.jabatan})`
      : staf.nama;
    select.appendChild(opt);
  });
}

// ── Render Jenis Tamu Pills ───────────────────────────────────
/**
 * Render tombol pill untuk setiap jenis tamu.
 */
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

    btn.addEventListener('click', () => selectJenisTamu(jenis, btn));
    container.appendChild(btn);
  });
}

/**
 * Set jenis tamu yang dipilih dan update UI pill.
 * @param {string} jenis
 * @param {HTMLButtonElement} clickedBtn
 */
function selectJenisTamu(jenis, clickedBtn) {
  selectedJenis = jenis;

  // Update semua pill
  document.querySelectorAll('.pill-selector__item').forEach(btn => {
    const isSelected = btn.dataset.value === jenis;
    btn.classList.toggle('selected', isSelected);
    btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });

  // Update hidden input
  const hiddenInput = document.getElementById('jenis-tamu');
  if (hiddenInput) hiddenInput.value = jenis;

  // Hapus error
  hideFieldError('error-jenis-tamu');

  checkSubmitEligibility();
}

// ── Clock ─────────────────────────────────────────────────────
/**
 * Set tanggal & jam datang otomatis dan jalankan live clock setiap detik.
 */
function initClock() {
  function updateClock() {
    const now = new Date();

    // Format tanggal: Senin, 06 September 2026
    const opsiTanggal = {
      weekday: 'long',
      year   : 'numeric',
      month  : 'long',
      day    : 'numeric'
    };
    const tanggalDisplay = now.toLocaleDateString('id-ID', opsiTanggal);

    // Format jam: HH:MM
    const jam = now.toLocaleTimeString('id-ID', {
      hour  : '2-digit',
      minute: '2-digit',
      hour12: false
    });

    // Format tanggal ISO untuk dikirim ke GAS: YYYY-MM-DD
    const y  = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const d  = String(now.getDate()).padStart(2, '0');
    const tanggalISO = `${y}-${mo}-${d}`;

    // Update display
    const dispTanggal = document.getElementById('display-tanggal');
    const dispJam     = document.getElementById('display-jam');
    const headerDate  = document.getElementById('header-date');
    const hidTanggal  = document.getElementById('tanggal');
    const hidJam      = document.getElementById('jam-datang');

    if (dispTanggal) dispTanggal.textContent = tanggalDisplay;
    if (dispJam)     dispJam.textContent     = jam;
    if (headerDate)  headerDate.textContent  = tanggalDisplay;
    if (hidTanggal)  hidTanggal.value        = tanggalISO;
    if (hidJam)      hidJam.value            = jam;
  }

  updateClock();
  clockInterval = setInterval(updateClock, 1000);
}

// ── Signature Pad ─────────────────────────────────────────────
/**
 * Inisialisasi signature_pad pada canvas.
 * Menangani resize canvas agar tidak blur di Retina/HDPI.
 */
function initSignaturePad() {
  const canvas    = document.getElementById('signature-canvas');
  const container = document.getElementById('signature-container');
  const placeholder = document.getElementById('signature-placeholder');
  const clearBtn  = document.getElementById('btn-clear-signature');

  if (!canvas || typeof SignaturePad === 'undefined') {
    console.warn('signature_pad tidak tersedia atau canvas tidak ditemukan.');
    return;
  }

  // Resize canvas sesuai DPR untuk tampilan tajam di layar Retina
  function resizeCanvas() {
    const ratio  = Math.max(window.devicePixelRatio || 1, 1);
    const width  = canvas.offsetWidth;
    const height = canvas.offsetHeight;

    canvas.width  = width  * ratio;
    canvas.height = height * ratio;
    canvas.getContext('2d').scale(ratio, ratio);

    // Clear setelah resize agar tidak ada artefak
    if (signaturePad) signaturePad.clear();
  }

  signaturePad = new SignaturePad(canvas, {
    minWidth       : 1,
    maxWidth       : 3,
    penColor       : '#1f2937',
    backgroundColor: 'rgba(255,255,255,0)',
  });

  resizeCanvas();

  // Handle resize window
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCanvas, 200);
  });

  // Sembunyikan placeholder saat mulai tanda tangan
  signaturePad.addEventListener('beginStroke', () => {
    if (placeholder) placeholder.classList.add('hidden');
    if (container)   container.classList.add('active');
  });

  // Update state setelah tanda tangan selesai
  signaturePad.addEventListener('endStroke', () => {
    if (container) {
      container.classList.remove('active');
      container.classList.add('has-signature');
    }
    // Update status indicator
    _setSignatureStatus(true);
    hideFieldError('error-ttd');
    checkSubmitEligibility();
  });

  // Tombol clear
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      signaturePad.clear();
      if (placeholder) placeholder.classList.remove('hidden');
      if (container) {
        container.classList.remove('has-signature', 'active');
      }
      _setSignatureStatus(false);
      checkSubmitEligibility();
    });
  }
}

// ── Form Event Listeners ──────────────────────────────────────
/**
 * Pasang semua event listener validasi dan submit pada form.
 */
function attachFormEvents() {
  const form = document.getElementById('form-tamu');
  if (!form) return;

  // ── Validasi real-time per field ──────────────────────────

  // Nama Lengkap
  attachRequiredValidation('nama-lengkap', 'error-nama',
    'Nama lengkap wajib diisi.');

  // Instansi
  attachRequiredValidation('instansi', 'error-instansi',
    'Instansi/asal wajib diisi.');

  // No. HP
  attachRequiredValidation('no-hp', 'error-no-hp',
    'Nomor HP/WA wajib diisi.');

  // Email — validasi format
  const emailInput = document.getElementById('email');
  if (emailInput) {
    emailInput.addEventListener('input', () => {
      validateEmail(emailInput);
      checkSubmitEligibility();
    });

    emailInput.addEventListener('blur', () => {
      validateEmail(emailInput, true); // strict mode saat blur
    });
  }

  // Keperluan
  attachRequiredValidation('keperluan', 'error-keperluan',
    'Keperluan wajib diisi.');

  // Bertemu Dengan (select)
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

  // ── Submit ─────────────────────────────────────────────────
  form.addEventListener('submit', handleSubmit);

  // Tombol "Daftarkan Tamu Lain"
  const btnNew = document.getElementById('btn-new-entry');
  if (btnNew) {
    btnNew.addEventListener('click', resetForm);
  }
}

// ── Validasi Helper ───────────────────────────────────────────
/**
 * Pasang validasi required pada input + update submit button.
 * @param {string} inputId
 * @param {string} errorId
 * @param {string} errorMsg
 */
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
 * Validasi format email dengan feedback visual.
 * @param {HTMLInputElement} input
 * @param {boolean} strict - jika true, tampilkan error meski input kosong
 */
function validateEmail(input, strict = false) {
  const val = input.value.trim();
  const errorId = 'error-email';

  if (!val) {
    input.classList.remove('is-valid', 'is-invalid');
    hideFieldError(errorId);
    if (strict) {
      input.classList.add('is-invalid');
      showFieldError(errorId, 'Email wajib diisi.');
    }
    return false;
  }

  if (!EMAIL_REGEX.test(val)) {
    input.classList.add('is-invalid');
    input.classList.remove('is-valid');
    showFieldError(errorId, 'Format email tidak valid. Contoh: nama@domain.com');
    return false;
  }

  // Valid
  input.classList.add('is-valid');
  input.classList.remove('is-invalid');
  hideFieldError(errorId);
  return true;
}

/**
 * Tampilkan pesan error pada field.
 * @param {string} errorId
 * @param {string} message
 */
function showFieldError(errorId, message) {
  const el = document.getElementById(errorId);
  if (!el) return;
  if (message) {
    // Update teks (biarkan ikon ⚠️ di HTML)
    const span = el.querySelector('span:last-child') || el;
    span.textContent = message;
  }
  el.classList.add('visible');
}

/**
 * Sembunyikan pesan error pada field.
 * @param {string} errorId
 */
function hideFieldError(errorId) {
  const el = document.getElementById(errorId);
  if (el) el.classList.remove('visible');
}

// ── Submit Eligibility Check ──────────────────────────────────
/**
 * Cek apakah semua field valid dan aktifkan/nonaktifkan tombol submit.
 */
function checkSubmitEligibility() {
  const btn = document.getElementById('btn-submit');
  if (!btn) return;

  const isValid = isFormValid();
  btn.disabled = !isValid || isSubmitting;
}

/**
 * Kembalikan true jika semua field wajib valid.
 * @returns {boolean}
 */
function isFormValid() {
  // Jenis tamu
  if (!selectedJenis) return false;

  // Field text wajib
  const fields = ['nama-lengkap', 'instansi', 'no-hp', 'keperluan'];
  for (const id of fields) {
    const el = document.getElementById(id);
    if (!el || !el.value.trim()) return false;
  }

  // Email
  const emailInput = document.getElementById('email');
  if (!emailInput || !EMAIL_REGEX.test(emailInput.value.trim())) return false;

  // Bertemu Dengan
  const bertemuSelect = document.getElementById('bertemu-dengan');
  if (!bertemuSelect || !bertemuSelect.value) return false;

  // Tanda tangan
  if (!signaturePad || signaturePad.isEmpty()) return false;

  return true;
}

// ── Handle Submit ─────────────────────────────────────────────
/**
 * Handle submit form tamu.
 * Validasi final → kumpulkan data → kirim ke GAS → tampilkan sukses.
 * @param {Event} e
 */
async function handleSubmit(e) {
  e.preventDefault();

  if (isSubmitting) return;

  // Validasi final semua field
  if (!validateAllFields()) return;

  isSubmitting = true;
  const btn = document.getElementById('btn-submit');
  setButtonLoading(btn);

  // Kumpulkan data form
  const payload = collectFormData();

  try {
    const result = await callGAS('addTamu', payload);

    if (result.status === 'ok') {
      // Stop clock setelah submit
      if (clockInterval) clearInterval(clockInterval);

      // Tampilkan halaman sukses
      showSuccessScreen(payload);

    } else {
      showToast(result.message || 'Gagal menyimpan data. Coba lagi.', 'danger', 4000);
      resetButtonLoading(btn, false);
      isSubmitting = false;
    }

  } catch (err) {
    showToast('Terjadi kesalahan koneksi. Silakan coba lagi.', 'danger', 4000);
    resetButtonLoading(btn, false);
    isSubmitting = false;
  }
}

/**
 * Jalankan validasi final semua field dan tampilkan error jika ada.
 * @returns {boolean} true jika semua valid
 */
function validateAllFields() {
  let firstInvalid = null;

  // Jenis tamu
  if (!selectedJenis) {
    showFieldError('error-jenis-tamu', 'Pilih jenis tamu terlebih dahulu.');
    firstInvalid = firstInvalid || document.getElementById('jenis-tamu-pills');
  }

  // Field text wajib
  const fieldMap = [
    { id: 'nama-lengkap', errorId: 'error-nama',      msg: 'Nama lengkap wajib diisi.' },
    { id: 'instansi',     errorId: 'error-instansi',  msg: 'Instansi/asal wajib diisi.' },
    { id: 'no-hp',        errorId: 'error-no-hp',     msg: 'Nomor HP/WA wajib diisi.' },
    { id: 'keperluan',    errorId: 'error-keperluan', msg: 'Keperluan wajib diisi.' },
  ];

  fieldMap.forEach(({ id, errorId, msg }) => {
    const el = document.getElementById(id);
    if (!el || !el.value.trim()) {
      el && el.classList.add('is-invalid');
      showFieldError(errorId, msg);
      firstInvalid = firstInvalid || el;
    }
  });

  // Email
  const emailInput = document.getElementById('email');
  if (!validateEmail(emailInput, true)) {
    firstInvalid = firstInvalid || emailInput;
  }

  // Bertemu Dengan
  const bertemuSelect = document.getElementById('bertemu-dengan');
  if (!bertemuSelect || !bertemuSelect.value) {
    bertemuSelect && bertemuSelect.classList.add('is-invalid');
    showFieldError('error-bertemu', 'Pilih staf yang akan ditemui.');
    firstInvalid = firstInvalid || bertemuSelect;
  }

  // Tanda tangan
  if (!signaturePad || signaturePad.isEmpty()) {
    showFieldError('error-ttd', 'Tanda tangan wajib diisi.');
    firstInvalid = firstInvalid || document.getElementById('signature-container');
  }

  // Scroll ke error pertama
  if (firstInvalid) {
    firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }

  return true;
}

/**
 * Kumpulkan semua data form ke dalam payload object untuk GAS.
 * @returns {Object}
 */
function collectFormData() {
  const tanggal   = document.getElementById('tanggal').value;
  const jamDatang = document.getElementById('jam-datang').value;

  // Export tanda tangan sebagai base64 PNG
  const ttdBase64 = signaturePad && !signaturePad.isEmpty()
    ? signaturePad.toDataURL('image/png')
    : '';

  return {
    tanggal       : tanggal,
    jenisTamu     : selectedJenis,
    jamDatang     : jamDatang,
    namaLengkap   : document.getElementById('nama-lengkap').value.trim(),
    instansi      : document.getElementById('instansi').value.trim(),
    noHp          : document.getElementById('no-hp').value.trim(),
    email         : document.getElementById('email').value.trim().toLowerCase(),
    keperluan     : document.getElementById('keperluan').value.trim(),
    bertemuDengan : document.getElementById('bertemu-dengan').value,
    tandaTangan   : ttdBase64,
  };
}

// ── Success Screen ────────────────────────────────────────────
/**
 * Sembunyikan form dan tampilkan halaman sukses.
 * @param {Object} payload - Data yang sudah disubmit
 */
function showSuccessScreen(payload) {
  const formWrapper   = document.getElementById('form-wrapper');
  const successScreen = document.getElementById('success-screen');
  const successTime   = document.getElementById('success-time');
  const successDate   = document.getElementById('success-date');

  if (formWrapper)   formWrapper.style.display = 'none';
  if (successScreen) successScreen.classList.add('visible');

  // Tampilkan jam & tanggal kunjungan
  if (successTime) successTime.textContent = payload.jamDatang || '';
  if (successDate) {
    const d = new Date();
    successDate.textContent = d.toLocaleDateString('id-ID', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  // Scroll ke atas
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Reset Form ────────────────────────────────────────────────
/**
 * Reset semua field form ke kondisi awal untuk tamu berikutnya.
 */
function resetForm() {
  isSubmitting   = false;
  selectedJenis  = '';

  // Reset form HTML
  const form = document.getElementById('form-form-tamu') ||
               document.getElementById('form-tamu');
  if (form) form.reset();

  // Reset hidden inputs
  const hidJenis = document.getElementById('jenis-tamu');
  if (hidJenis) hidJenis.value = '';

  // Reset pill selector
  document.querySelectorAll('.pill-selector__item').forEach(btn => {
    btn.classList.remove('selected');
    btn.setAttribute('aria-pressed', 'false');
  });

  // Reset validasi class semua input
  document.querySelectorAll('.form-control').forEach(el => {
    el.classList.remove('is-valid', 'is-invalid');
  });

  // Sembunyikan semua error
  document.querySelectorAll('.form-error').forEach(el => {
    el.classList.remove('visible');
  });

  // Reset signature pad
  if (signaturePad) {
    signaturePad.clear();
    const placeholder = document.getElementById('signature-placeholder');
    const container   = document.getElementById('signature-container');
    if (placeholder) placeholder.classList.remove('hidden');
    if (container)   container.classList.remove('has-signature', 'active');
  }

  // Sembunyikan success screen, tampilkan form
  const formWrapper   = document.getElementById('form-wrapper');
  const successScreen = document.getElementById('success-screen');
  if (formWrapper)   formWrapper.style.display = '';
  if (successScreen) successScreen.classList.remove('visible');

  // Disable submit button
  const btn = document.getElementById('btn-submit');
  if (btn) btn.disabled = true;

  // Restart clock
  initClock();

  // Scroll ke atas & fokus ke field pertama
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Fokus ke field nama setelah animasi scroll
  setTimeout(() => {
    const namaInput = document.getElementById('nama-lengkap');
    if (namaInput) namaInput.focus();
  }, 500);
}

// ── Utility: Show/Hide Form Loading ──────────────────────────
/**
 * Tampilkan atau sembunyikan skeleton loading form.
 * @param {boolean} show
 */
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

/**
 * Update tampilan status tanda tangan.
 * @param {boolean} signed
 */
function _setSignatureStatus(signed) {
  const el = document.getElementById('signature-status');
  if (!el) return;
  el.classList.toggle('signed', signed);
  const textEl = el.querySelector('span:last-child');
  if (textEl) textEl.textContent = signed ? 'Tanda tangan tersimpan' : 'Belum ditandatangani';
}
