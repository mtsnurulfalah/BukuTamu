/**
 * form-tamu.js — Halaman Form Tamu Publik
 * ▶▶ v2.2: OTP Email Verifikasi Tamu
 * ─────────────────────────────────────────────────────────
 * Alur:
 *   1. Load config sekolah + staf + siswa secara paralel dari GAS
 *   2. Render pill selector jenis tamu
 *   3. Set tanggal otomatis (live) + input jam datang (editable)
 *   4. Inisialisasi signature_pad (DPR-aware)
 *   5. ▶▶ Input jumlah tamu → repeater form dinamis per anggota
 *   6. ▶▶ OTP email verifikasi untuk Alumni/Dinas/Mitra/Vendor
 *   7. ▶▶ Review screen sebelum simpan
 *   8. Submit → callGAS('addTamu') → success screen
 *
 * CHANGELOG v2.2:
 *   - ADD OTP: Verifikasi email untuk jenis tamu wajib OTP
 *              (Alumni, Dinas/Instansi, Mitra, Vendor/Penyedia).
 *   - ADD: UI dinamis email OTP di card tamu pertama.
 *   - ADD: State emailSessionId — sessionId dari server setelah OTP verified.
 *   - ADD: isFormValid() & validateAllFields() cek emailVerified untuk jenis wajib.
 *   - ADD: collectFormData() menyertakan emailSessionId untuk backend validation.
 *   - ADD: resetForm() membersihkan state OTP.
 *   - ADD: selectJenisTamu() me-reset state OTP saat ganti jenis.
 * CHANGELOG v2.1:
 *   - FIX B17: Signature canvas height.
 *   - FIX B13/B20: Validasi No HP tamu pertama.
 *   - FIX B14: Validasi format email tamu ke-2+.
 *   - FIX B24, FIX U9, FIX U10, FIX R1.
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

// ▶▶ OTP TAMU State
let emailSessionId    = '';      // sessionId dari server setelah verifyTamuOtp berhasil
let emailVerified     = false;   // true jika email tamu pertama sudah terverifikasi
let otpVerifiedEmail  = '';      // email yang sudah terverifikasi (normalisasi lowercase)
let otpResendTimer    = null;    // interval timer countdown resend
let otpExpiryTimer   = null;    // interval timer countdown expiry OTP
let isSendingOtp      = false;   // mencegah double-click kirim OTP
let isVerifyingOtp    = false;   // mencegah double-click verifikasi OTP

// ── Konstanta ─────────────────────────────────────────────────
const EMAIL_REGEX   = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_REGEX   = /^(\+62|62|0)[0-9]{8,13}$/;       // FIX B13: pola HP Indonesia
const JENIS_ORTU    = 'Orang Tua/Wali Murid';
const JENIS_ALUMNI  = 'Alumni';
const MAX_TAMU      = 50;   // batas wajar di form (backend max 100)
const MAX_KEPERLUAN = 500;  // karakter maksimum textarea keperluan (FIX U10)

// Jenis tamu yang wajib verifikasi email OTP (harus sama dengan backend JENIS_WAJIB_OTP)
const JENIS_WAJIB_OTP = ['Alumni', 'Dinas/Instansi', 'Mitra', 'Vendor/Penyedia'];

/** Apakah jenis tamu yang dipilih memerlukan verifikasi OTP? */
function jenisWajibOtp(jenis) {
  return JENIS_WAJIB_OTP.includes(jenis);
}

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
    initJumlahTamu();
    initProgressIndicator();

  } catch (err) {
    console.error('Form init error:', err);
    renderJenisTamuPills();
    initClock();
    initSignaturePad();
    attachFormEvents();
    initJumlahTamu();
    initProgressIndicator();
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
  const prevJenis = selectedJenis;
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

  // ▶▶ OTP: Reset state verifikasi jika jenis tamu berubah
  // (baik dari wajib→tidak-wajib, tidak-wajib→wajib, maupun wajib→wajib-lain)
  if (prevJenis !== jenis) {
    _resetOtpState();
    // Re-render card anggota pertama agar UI OTP muncul/hilang sesuai jenis baru
    if (anggotaData.length > 0) {
      renderAnggotaRepeater();
    }
  }

  hideFieldError('error-jenis-tamu');
  checkSubmitEligibility();
}

/**
 * Kunci atau buka stepper rombongan.
 * Saat locked: reset ke 1 tamu, disable tombol +, sembunyikan tombol tambah manual.
 * @param {boolean} locked
 */
function _applyRombonganLock(locked) {
  const plusBtn      = document.getElementById('btn-tamu-plus');
  const minusBtn     = document.getElementById('btn-tamu-minus');
  const btnTambah    = document.getElementById('btn-tambah-tamu-manual');
  const hintEl       = document.getElementById('jumlah-tamu-hint');
  const lockNoticeEl = document.getElementById('rombongan-lock-notice');

  if (locked) {
    if (jumlahTamu > 1) {
      jumlahTamu  = 1;
      anggotaData = anggotaData.slice(0, 1);
      renderAnggotaRepeater();
      checkSubmitEligibility();
    }
    if (plusBtn)  { plusBtn.disabled  = true;  plusBtn.setAttribute('aria-disabled', 'true'); }
    if (minusBtn) { minusBtn.disabled = true; }
    if (btnTambah) btnTambah.style.display = 'none';
    if (hintEl)       hintEl.style.display       = 'none';
    if (lockNoticeEl) lockNoticeEl.style.display  = '';
  } else {
    if (plusBtn)  { plusBtn.disabled  = jumlahTamu >= MAX_TAMU; plusBtn.removeAttribute('aria-disabled'); }
    if (minusBtn) { minusBtn.disabled = jumlahTamu <= 1; }
    if (btnTambah) btnTambah.style.display = '';
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

  // FIX B17: Gunakan explicit height (bukan hanya min-height) agar canvas
  // dengan position:absolute bisa resolve height dari parent dengan benar
  // di semua browser. Kita set height via style, bukan hanya CSS min-height.
  function ensureContainerHeight() {
    if (!container) return;
    // Jika container belum punya explicit height (hanya min-height dari CSS),
    // set height eksplisit agar canvas absolute bisa mengisi penuh.
    if (!container.style.height || container.style.height === 'auto') {
      const currentH = container.getBoundingClientRect().height;
      if (currentH > 0) {
        container.style.height = currentH + 'px';
      } else {
        // Fallback: set ke nilai minimum yang ada di CSS
        container.style.height = '160px';
      }
    }
  }

  function resizeCanvas() {
    const hadSignature = signaturePad && !signaturePad.isEmpty();
    const savedData    = hadSignature ? signaturePad.toData() : null;

    // Pastikan container memiliki tinggi yang resolve dengan benar
    ensureContainerHeight();

    const ratio  = Math.max(window.devicePixelRatio || 1, 1);
    const width  = container ? container.clientWidth  : canvas.offsetWidth;
    const height = container ? container.clientHeight : (canvas.offsetHeight || 160);

    // Guard: jangan resize ke 0 — ini menyebabkan canvas blank permanen
    if (width <= 0 || height <= 0) return;

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

  // Tunda inisialisasi sampai layout selesai
  requestAnimationFrame(() => {
    ensureContainerHeight();
    resizeCanvas();
  });

  // Gunakan ResizeObserver untuk resize yang lebih akurat (FIX B17 tambahan)
  if (typeof ResizeObserver !== 'undefined' && container) {
    let roTimer;
    const ro = new ResizeObserver(() => {
      // Reset height agar bisa di-recalculate dari ukuran baru
      container.style.height = '';
      clearTimeout(roTimer);
      roTimer = setTimeout(() => resizeCanvas(), 150);
    });
    ro.observe(container);
  } else {
    // Fallback: window resize
    let resizeTimer;
    window.addEventListener('resize', () => {
      container.style.height = '';
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resizeCanvas, 250);
    });
  }

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
 * Dipanggil SATU KALI saat DOMContentLoaded — event listener +/- hanya ditempel sekali.
 */
function initJumlahTamu() {
  jumlahTamu  = 1;
  anggotaData = [_emptyAnggota()];
  renderAnggotaRepeater();

  const minusBtn = document.getElementById('btn-tamu-minus');
  const plusBtn  = document.getElementById('btn-tamu-plus');

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
      // FIX U9: Auto-focus ke field nama pada card baru yang ditambah
      setTimeout(() => {
        const cards = document.querySelectorAll('.anggota-card');
        if (cards.length > 0) {
          const newCard = cards[cards.length - 1];
          newCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Focus ke input nama di card baru
          const namaInput = newCard.querySelector('.anggota-nama');
          if (namaInput) {
            setTimeout(() => namaInput.focus(), 300);
          }
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

  const isRombongan      = jumlahTamu > 1;
  const sectionAnggota   = document.getElementById('section-anggota');
  const sectionTunggal   = document.getElementById('section-tamu-tunggal');
  const containerRomb    = document.getElementById('anggota-repeater');
  const containerTunggal = document.getElementById('anggota-repeater-tunggal');

  if (sectionAnggota) sectionAnggota.style.display  = isRombongan ? 'block' : 'none';
  if (sectionTunggal) sectionTunggal.style.display  = isRombongan ? 'none'  : 'block';

  const badge2 = document.getElementById('jumlah-tamu-display-2');
  if (badge2) badge2.textContent = jumlahTamu;

  const targetContainer = isRombongan ? containerRomb : containerTunggal;
  if (!targetContainer) return;

  // Kosongkan container yang tidak aktif
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
 * @param {number} index - 0-based
 * @param {Object} data  - data anggota saat ini
 */
function _buildAnggotaCard(index, data) {
  const isFirst = index === 0;
  const nomor   = index + 1;
  const cardId  = `anggota-card-${index}`;

  const card = document.createElement('div');
  card.className  = 'anggota-card';
  card.id         = cardId;
  card.setAttribute('data-index', index);
  card.setAttribute('role', 'listitem');

  // Header
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
      ${_icon('x', '0.85rem')}
    </button>` : ''}
  `;
  card.appendChild(header);

  // Body form
  const body = document.createElement('div');
  body.className = 'anggota-card__body';

  // Nama (wajib semua tamu)
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

  // No HP (wajib tamu pertama, opsional lainnya) — FIX B13/B20
  body.innerHTML += `
    <div class="form-group">
      <label class="form-label" for="anggota-nohp-${index}">
        No. HP / WA ${isFirst ? '<span class="required">*</span>' : '<span class="form-optional">(opsional)</span>'}
      </label>
      <input type="tel" id="anggota-nohp-${index}" class="form-control anggota-nohp"
        placeholder="${isFirst ? '08xx-xxxx-xxxx' : 'Opsional'}"
        value="${escapeAttr(data.noHp)}"
        data-index="${index}" inputmode="tel" autocomplete="tel" ${isFirst ? 'required' : ''} />
      <span class="form-error" id="error-anggota-nohp-${index}" role="alert"></span>
    </div>
  `;

  // Email (wajib tamu pertama, opsional lainnya)
  body.innerHTML += `
    <div class="form-group">
      <label class="form-label" for="anggota-email-${index}">
        Email ${isFirst ? '<span class="required">*</span>' : '<span class="form-optional">(opsional)</span>'}
      </label>
      <input type="email" id="anggota-email-${index}" class="form-control anggota-email"
        placeholder="${isFirst ? 'nama@email.com' : 'Opsional'}"
        value="${escapeAttr(data.email)}"
        data-index="${index}" inputmode="email" autocomplete="email" ${isFirst ? 'required' : ''} />
      <span class="form-error" id="error-anggota-email-${index}" role="alert"></span>
    </div>
  `;

  // ▶▶ OTP: Sisipkan blok verifikasi email tepat setelah field email, hanya untuk tamu pertama
  if (isFirst) {
    body.innerHTML += _buildOtpVerificationBlock();
  }

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
 * Event delegation untuk input di dalam anggota-repeater.
 * Dipanggil sekali saat init; delegation tidak perlu ulang saat re-render.
 */
function attachAnggotaRepeaterEvents() {
  const container = document.getElementById('main-content');
  if (!container) return;

  // Input changes — update anggotaData realtime + validasi inline
  container.addEventListener('input', (e) => {
    const el  = e.target;
    const idx = parseInt(el.getAttribute('data-index') ?? '-1', 10);
    if (idx < 0 || idx >= anggotaData.length) return;

    if (el.classList.contains('anggota-nama')) {
      anggotaData[idx].namaLengkap = el.value.trim();
      if (el.value.trim()) {
        el.classList.remove('is-invalid');
        el.classList.add('is-valid');
        hideFieldError(`error-anggota-nama-${idx}`);
      } else {
        el.classList.remove('is-valid');
      }

    } else if (el.classList.contains('anggota-nohp')) {
      // FIX B13/B20: Validasi inline No HP
      anggotaData[idx].noHp = el.value.trim();
      const val = el.value.trim();
      if (val) {
        // Hapus semua non-digit kecuali +
        const cleaned = val.replace(/[\s\-().]/g, '');
        const ok = PHONE_REGEX.test(cleaned);
        el.classList.toggle('is-valid',   ok);
        el.classList.toggle('is-invalid', !ok);
        if (!ok) {
          showFieldError(`error-anggota-nohp-${idx}`, 'Format nomor HP tidak valid. Contoh: 0812-3456-7890');
        } else {
          hideFieldError(`error-anggota-nohp-${idx}`);
        }
      } else {
        el.classList.remove('is-valid', 'is-invalid');
        hideFieldError(`error-anggota-nohp-${idx}`);
      }

    } else if (el.classList.contains('anggota-email')) {
      anggotaData[idx].email = el.value.trim().toLowerCase();
      const val = el.value.trim();
      if (val) {
        // FIX B14: Validasi email untuk SEMUA tamu, bukan hanya idx===0
        const ok = EMAIL_REGEX.test(val);
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

  // Blur validasi — cek field required yang kosong
  container.addEventListener('blur', (e) => {
    const el  = e.target;
    const idx = parseInt(el.getAttribute('data-index') ?? '-1', 10);
    if (idx < 0) return;

    if (el.classList.contains('anggota-nama') && !el.value.trim()) {
      el.classList.add('is-invalid');
      showFieldError(`error-anggota-nama-${idx}`, `Nama tamu ${idx + 1} wajib diisi.`);
    }

    // FIX B20: Blur validasi No HP tamu pertama (required)
    if (el.classList.contains('anggota-nohp') && idx === 0 && !el.value.trim()) {
      el.classList.add('is-invalid');
      showFieldError(`error-anggota-nohp-${idx}`, 'No. HP wajib diisi untuk tamu pertama.');
    }

    // Blur validasi email tamu pertama (required)
    if (el.classList.contains('anggota-email') && idx === 0 && !el.value.trim()) {
      el.classList.add('is-invalid');
      showFieldError(`error-anggota-email-${idx}`, 'Email tamu pertama wajib diisi.');
    }
  }, true); // useCapture agar blur bubbles

  // Hapus tamu (tombol remove)
  container.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.anggota-card__remove');
    if (!removeBtn) return;

    const idx = parseInt(removeBtn.getAttribute('data-index'), 10);
    if (isNaN(idx) || idx === 0) return;
    if (jumlahTamu <= 1) return;

    jumlahTamu--;
    anggotaData.splice(idx, 1);
    updateJumlahTamuDisplay();
    renderAnggotaRepeater();
    checkSubmitEligibility();
  });
}

// ═════════════════════════════════════════════════════════════
// EVENT LISTENERS FORM UTAMA
// ═════════════════════════════════════════════════════════════
function attachFormEvents() {
  const form = document.getElementById('form-tamu');
  if (!form) return;

  // Validasi real-time keperluan + counter karakter (FIX U10)
  attachRequiredValidation('keperluan', 'error-keperluan', 'Keperluan wajib diisi.');
  _initKeperluanCounter();

  // Instansi teks
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

  // Dropdown siswa
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
        bertemuSelect.classList.remove('is-invalid');
        bertemuSelect.classList.add('is-valid');
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
      // FIX U9: Auto-focus ke field nama pada card baru
      setTimeout(() => {
        const cards = document.querySelectorAll('.anggota-card');
        if (cards.length > 0) {
          const newCard = cards[cards.length - 1];
          newCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const namaInput = newCard.querySelector('.anggota-nama');
          if (namaInput) setTimeout(() => namaInput.focus(), 300);
        }
      }, 100);
    });
  }
}

/**
 * FIX U10: Inisialisasi karakter counter di textarea keperluan.
 */
function _initKeperluanCounter() {
  const textarea  = document.getElementById('keperluan');
  const counterEl = document.getElementById('keperluan-counter');
  if (!textarea || !counterEl) return;

  function updateCounter() {
    const len  = textarea.value.length;
    const sisa = MAX_KEPERLUAN - len;
    counterEl.textContent = `${len}/${MAX_KEPERLUAN}`;
    counterEl.classList.toggle('counter--warn',  sisa <= 50 && sisa > 0);
    counterEl.classList.toggle('counter--danger', sisa <= 0);
    if (len > MAX_KEPERLUAN) {
      textarea.value = textarea.value.substring(0, MAX_KEPERLUAN);
      counterEl.textContent = `${MAX_KEPERLUAN}/${MAX_KEPERLUAN}`;
    }
  }

  textarea.addEventListener('input', updateCounter);
  textarea.setAttribute('maxlength', String(MAX_KEPERLUAN));
  updateCounter();
}

// ═════════════════════════════════════════════════════════════
// PROGRESS INDICATOR (scroll-aware via IntersectionObserver)
// ═════════════════════════════════════════════════════════════
function initProgressIndicator() {
  const progressEl = document.getElementById('form-progress');
  if (!progressEl || typeof IntersectionObserver === 'undefined') return;

  const steps = progressEl.querySelectorAll('.form-progress__step');
  if (!steps.length) return;

  let activeStep = 1;

  function updateProgress(newStep) {
    if (newStep === activeStep) return;
    activeStep = newStep;
    steps.forEach(s => {
      const n = parseInt(s.dataset.step, 10);
      s.classList.remove('active', 'completed');
      if (n === activeStep)     s.classList.add('active');
      else if (n < activeStep)  s.classList.add('completed');
    });
  }

  const visibleSections = new Map();

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const step = parseInt(entry.target.dataset.progressStep, 10);
      if (!step) return;
      if (entry.isIntersecting) {
        visibleSections.set(step, entry.boundingClientRect.top);
      } else {
        visibleSections.delete(step);
      }
    });

    if (visibleSections.size === 0) return;

    let topStep = activeStep;
    let topY    = Infinity;
    visibleSections.forEach((y, step) => {
      if (y < topY) { topY = y; topStep = step; }
    });

    updateProgress(topStep);
  }, {
    threshold: 0.15,
    rootMargin: '0px 0px -30% 0px',
  });

  document.querySelectorAll('.form-section[data-progress-step]').forEach(el => {
    observer.observe(el);
  });

  // Sembunyikan progress saat review/success
  const formWrapper   = document.getElementById('form-wrapper');
  const reviewScreen  = document.getElementById('review-screen');
  const successScreen = document.getElementById('success-screen');

  const progressObserver = new MutationObserver(() => {
    const formVisible    = formWrapper    && formWrapper.style.display    !== 'none';
    const reviewVisible  = reviewScreen   && reviewScreen.style.display   !== 'none'
                        && reviewScreen.classList.contains('visible');
    const successVisible = successScreen  && successScreen.classList.contains('visible');
    progressEl.style.display = (formVisible && !reviewVisible && !successVisible) ? '' : 'none';
  });

  if (formWrapper)   progressObserver.observe(formWrapper,   { attributes: true, attributeFilter: ['style'] });
  if (reviewScreen)  progressObserver.observe(reviewScreen,  { attributes: true, attributeFilter: ['class', 'style'] });
  if (successScreen) progressObserver.observe(successScreen, { attributes: true, attributeFilter: ['class'] });
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

  // ▶▶ Validasi anggota pertama
  const namaEl0  = document.getElementById('anggota-nama-0');
  const noHpEl0  = document.getElementById('anggota-nohp-0');
  const email0El = document.getElementById('anggota-email-0');

  if (!namaEl0 || !namaEl0.value.trim()) return false;

  // FIX B20: No HP wajib untuk tamu pertama
  const hp0 = noHpEl0 ? noHpEl0.value.trim().replace(/[\s\-().]/g, '') : '';
  if (!hp0 || !PHONE_REGEX.test(hp0)) return false;

  const email0 = email0El ? email0El.value.trim() : '';
  if (!EMAIL_REGEX.test(email0)) return false;

  // ▶▶ OTP: Jenis wajib OTP harus sudah terverifikasi
  if (jenisWajibOtp(selectedJenis)) {
    if (!emailVerified || !emailSessionId) return false;
    // Email di field harus sama dengan email yang sudah terverifikasi
    if (email0.toLowerCase() !== otpVerifiedEmail) return false;
  }

  // FIX B14: Validasi email format untuk tamu ke-2+ jika diisi
  for (let i = 1; i < anggotaData.length; i++) {
    const emailElI = document.getElementById(`anggota-email-${i}`);
    if (emailElI && emailElI.value.trim() && !EMAIL_REGEX.test(emailElI.value.trim())) {
      return false;
    }
    // Validasi No HP format jika diisi (opsional tapi harus valid jika ada)
    const noHpElI = document.getElementById(`anggota-nohp-${i}`);
    if (noHpElI && noHpElI.value.trim()) {
      const cleaned = noHpElI.value.trim().replace(/[\s\-().]/g, '');
      if (!PHONE_REGEX.test(cleaned)) return false;
    }
  }

  return true;
}

// ═════════════════════════════════════════════════════════════
// SUBMIT & REVIEW
// ═════════════════════════════════════════════════════════════
async function handleSubmit(e) {
  e.preventDefault();
  if (isSubmitting) return;

  syncAnggotaFromDOM();
  if (!validateAllFields()) return;

  // ▶▶ Jika rombongan (>1 tamu), tampilkan review screen sebelum simpan
  if (jumlahTamu > 1) {
    showReviewScreen();
    return;
  }

  await _doSubmit();
}

async function submitFromReview() {
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

  const markInvalid = (el, errId, msg) => {
    if (el) el.classList.add('is-invalid');
    showFieldError(errId, msg);
    if (!firstInvalid) firstInvalid = el;
  };

  // Jenis tamu
  if (!selectedJenis) {
    showFieldError('error-jenis-tamu', 'Pilih jenis tamu terlebih dahulu.');
    if (!firstInvalid) firstInvalid = document.getElementById('jenis-tamu-pills');
  }

  // Instansi
  if (selectedJenis === JENIS_ORTU) {
    const siswaEl = document.getElementById('instansi-siswa');
    if (!siswaEl || !siswaEl.value) markInvalid(siswaEl, 'error-instansi', 'Pilih nama siswa terlebih dahulu.');
  } else if (selectedJenis === JENIS_ALUMNI) {
    const tahunEl = document.getElementById('instansi-tahun-lulus');
    const yr = parseInt(tahunEl?.value || '', 10);
    if (!tahunEl || isNaN(yr) || yr < 1900 || yr > 2099) markInvalid(tahunEl, 'error-instansi', 'Masukkan tahun lulus yang valid.');
  } else {
    const instansiEl = document.getElementById('instansi');
    if (!instansiEl || !instansiEl.value.trim()) markInvalid(instansiEl, 'error-instansi', 'Instansi/asal wajib diisi.');
  }

  // Keperluan
  const keperluanEl = document.getElementById('keperluan');
  if (!keperluanEl || !keperluanEl.value.trim()) markInvalid(keperluanEl, 'error-keperluan', 'Keperluan wajib diisi.');

  // Bertemu dengan
  const bertemuEl = document.getElementById('bertemu-dengan');
  if (!bertemuEl || !bertemuEl.value) markInvalid(bertemuEl, 'error-bertemu', 'Pilih staf yang akan ditemui.');

  // ▶▶ Validasi setiap anggota
  for (let i = 0; i < anggotaData.length; i++) {
    const namaEl  = document.getElementById(`anggota-nama-${i}`);
    const noHpEl  = document.getElementById(`anggota-nohp-${i}`);
    const emailEl = document.getElementById(`anggota-email-${i}`);

    // Nama wajib semua tamu
    if (!namaEl || !namaEl.value.trim()) {
      markInvalid(namaEl, `error-anggota-nama-${i}`, `Nama tamu ${i + 1} wajib diisi.`);
    }

    // FIX B20: No HP wajib tamu pertama
    if (i === 0) {
      const hp = noHpEl ? noHpEl.value.trim().replace(/[\s\-().]/g, '') : '';
      if (!hp) {
        markInvalid(noHpEl, `error-anggota-nohp-${i}`, 'No. HP wajib diisi untuk tamu pertama.');
      } else if (!PHONE_REGEX.test(hp)) {
        markInvalid(noHpEl, `error-anggota-nohp-${i}`, 'Format nomor HP tidak valid. Contoh: 0812-3456-7890');
      }
    } else if (noHpEl && noHpEl.value.trim()) {
      // Opsional tapi jika diisi harus valid
      const hp = noHpEl.value.trim().replace(/[\s\-().]/g, '');
      if (!PHONE_REGEX.test(hp)) {
        markInvalid(noHpEl, `error-anggota-nohp-${i}`, 'Format nomor HP tidak valid. Contoh: 0812-3456-7890');
      }
    }

    // Email wajib tamu pertama, opsional lainnya tapi harus valid jika diisi (FIX B14)
    if (i === 0) {
      const emailVal = emailEl ? emailEl.value.trim() : '';
      if (!emailVal) {
        markInvalid(emailEl, `error-anggota-email-${i}`, 'Email tamu pertama wajib diisi.');
      } else if (!EMAIL_REGEX.test(emailVal)) {
        markInvalid(emailEl, `error-anggota-email-${i}`, 'Format email tidak valid.');
      }
    } else if (emailEl && emailEl.value.trim() && !EMAIL_REGEX.test(emailEl.value.trim())) {
      markInvalid(emailEl, `error-anggota-email-${i}`, 'Format email tidak valid.');
    }
  }

  // ▶▶ OTP: Jenis wajib OTP harus sudah terverifikasi sebelum submit
  if (jenisWajibOtp(selectedJenis)) {
    const email0Val = (document.getElementById('anggota-email-0')?.value || '').trim().toLowerCase();
    if (!emailVerified || !emailSessionId) {
      showFieldError('error-otp-submit', 'Email belum diverifikasi. Silakan verifikasi email menggunakan kode OTP terlebih dahulu.');
      const otpSection = document.getElementById('otp-verification-section');
      if (!firstInvalid) firstInvalid = otpSection;
    } else if (email0Val && email0Val !== otpVerifiedEmail) {
      // Email di field diubah setelah OTP berhasil — perlu verifikasi ulang
      showFieldError('error-otp-submit', 'Email telah diubah. Silakan verifikasi ulang email Anda.');
      _resetOtpState();
      renderAnggotaRepeater();
      if (!firstInvalid) firstInvalid = document.getElementById('otp-verification-section');
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

  const ttdBase64 = signaturePad && !signaturePad.isEmpty() ? signaturePad.toDataURL('image/png') : '';
  const jamRaw    = jamEl.value || '';
  const jamDatang = jamRaw.length >= 5 ? jamRaw.substring(0, 5) : jamRaw;

  // FIX: Deep-copy anggotaData agar payload tidak terpengaruh mutasi state setelah reset
  return {
    tanggal       : tanggalEl.value,
    jenisTamu     : selectedJenis,
    jamDatang     : jamDatang,
    instansi      : instansiVal,
    keperluan     : keperluanEl.value.trim(),
    bertemuDengan : bertemuEl.value,
    tandaTangan   : ttdBase64,
    anggota       : anggotaData.map(a => ({ ...a })),
    // ▶▶ OTP: Sertakan sessionId untuk validasi server-side
    // Backend akan menolak jika jenisTamu wajib OTP tapi sessionId kosong/tidak valid
    emailSessionId: emailSessionId || '',
  };
}

// ═════════════════════════════════════════════════════════════
// ▶▶ REVIEW SCREEN
// ═════════════════════════════════════════════════════════════
function showReviewScreen() {
  const wrapper = document.getElementById('form-wrapper');
  const review  = document.getElementById('review-screen');
  if (!review) return;

  const bertemuEl   = document.getElementById('bertemu-dengan');
  const keperluanEl = document.getElementById('keperluan');
  const tanggalEl   = document.getElementById('tanggal');
  const jamEl       = document.getElementById('jam-datang');

  const elJumlah  = document.getElementById('review-jumlah');
  const elBertemu = document.getElementById('review-bertemu');
  const elKep     = document.getElementById('review-keperluan');
  const elJenis   = document.getElementById('review-jenis');
  const elWaktu   = document.getElementById('review-waktu');
  const elDaftar  = document.getElementById('review-daftar-anggota');

  if (elJumlah)  elJumlah.textContent  = `${jumlahTamu} orang`;
  if (elBertemu) elBertemu.textContent = bertemuEl?.value || '—';
  if (elKep)     elKep.textContent     = keperluanEl?.value.trim() || '—';
  if (elJenis)   elJenis.textContent   = selectedJenis || '—';

  const tanggalDisplay = tanggalEl?.value
    ? new Date(tanggalEl.value + 'T00:00:00').toLocaleDateString('id-ID', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      })
    : '—';
  if (elWaktu) elWaktu.textContent = `${tanggalDisplay} · ${jamEl?.value || '—'}`;

  if (elDaftar) {
    elDaftar.innerHTML = anggotaData.map((a, i) => `
      <li class="review-anggota-item">
        <span class="review-anggota-item__nomor">${i + 1}</span>
        <span class="review-anggota-item__nama">${escapeHtml(a.namaLengkap || '—')}</span>
        ${a.jabatan ? `<span class="review-anggota-item__jabatan">${escapeHtml(a.jabatan)}</span>` : ''}
      </li>
    `).join('');
  }

  const btnConfirm = document.getElementById('btn-review-confirm');
  if (btnConfirm) {
    btnConfirm.disabled = false;
    btnConfirm.classList.remove('loading');
  }

  if (wrapper) wrapper.style.display = 'none';
  review.style.display = '';
  void review.offsetHeight; // force reflow untuk animasi
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

  const timeEl  = document.getElementById('success-time');
  const dateEl  = document.getElementById('success-date');
  const countEl = document.getElementById('success-count');

  if (timeEl) timeEl.textContent = payload?.jamDatang || '';
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('id-ID', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  }
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

  // ▶▶ OTP: Reset state verifikasi
  _resetOtpState();

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

  // Reset instansi field ke default
  const instansiInput = document.getElementById('instansi');
  const instansiSiswa = document.getElementById('instansi-siswa');
  const instansiTahun = document.getElementById('instansi-tahun-lulus');
  const labelInstansi = document.getElementById('label-instansi');
  if (instansiInput) { instansiInput.style.display = ''; instansiInput.required = true; }
  if (instansiSiswa) { instansiSiswa.style.display = 'none'; instansiSiswa.required = false; }
  if (instansiTahun) { instansiTahun.style.display = 'none'; instansiTahun.required = false; }
  if (labelInstansi) labelInstansi.innerHTML = 'Instansi / Asal <span class="required">*</span>';

  // Reset karakter counter keperluan (FIX U10)
  const counterEl = document.getElementById('keperluan-counter');
  if (counterEl) counterEl.textContent = `0/${MAX_KEPERLUAN}`;

  clearSignature();

  const formWrapper   = document.getElementById('form-wrapper');
  const successScreen = document.getElementById('success-screen');
  const reviewScreen  = document.getElementById('review-screen');
  if (formWrapper)   formWrapper.style.display = '';
  if (successScreen) successScreen.classList.remove('visible');
  if (reviewScreen)  { reviewScreen.classList.remove('visible'); reviewScreen.style.display = 'none'; }

  const btn = document.getElementById('btn-submit');
  if (btn) {
    btn.disabled = true;
    btn.classList.remove('loading');
    const textEl = btn.querySelector('.btn__text');
    if (textEl) textEl.textContent = 'Daftarkan Kunjungan';
  }

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

// ═════════════════════════════════════════════════════════════
// ▶▶ OTP TAMU: VERIFIKASI EMAIL
// ═════════════════════════════════════════════════════════════

/**
 * Bangun HTML blok verifikasi OTP untuk card tamu pertama.
 * Blok ini bersifat dinamis — ditampilkan/disembunyikan sesuai jenis tamu.
 * Hanya di-inject untuk index === 0.
 */
function _buildOtpVerificationBlock() {
  return `
    <div id="otp-verification-section" class="otp-section" style="display:none;"
         role="group" aria-labelledby="otp-section-label">

      <!-- State 1: Sebelum kirim OTP — tombol Kirim OTP -->
      <div id="otp-state-send" class="otp-state">
        <div class="otp-hint">
          <span class="otp-hint__icon" aria-hidden="true">📧</span>
          <span>Verifikasi email diperlukan untuk jenis tamu ini.
            Klik tombol di bawah untuk mengirim kode OTP ke email Anda.</span>
        </div>
        <button type="button" id="btn-send-otp" class="btn btn--otp-send"
          aria-label="Kirim kode OTP ke email">
          <span class="btn__icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </span>
          <span class="btn__text">Kirim Kode OTP</span>
        </button>
        <span class="form-error" id="error-otp-send" role="alert"></span>
      </div>

      <!-- State 2: Setelah kirim OTP — form verifikasi -->
      <div id="otp-state-verify" class="otp-state" style="display:none;">
        <div class="otp-sent-info" id="otp-sent-info" aria-live="polite">
          <span class="otp-sent-info__icon" aria-hidden="true">✉️</span>
          <span>Kode OTP telah dikirim ke:
            <strong id="otp-masked-email" class="otp-masked-email">—</strong>
          </span>
        </div>

        <div class="form-group" style="margin-bottom:var(--space-3);">
          <label class="form-label" for="otp-input" id="otp-input-label">
            Kode OTP <span class="required">*</span>
          </label>
          <div class="otp-input-wrap">
            <input type="text" id="otp-input" class="form-control otp-input"
              placeholder="_ _ _ _ _ _"
              inputmode="numeric" pattern="[0-9]{6}"
              maxlength="6" autocomplete="one-time-code"
              aria-labelledby="otp-input-label"
              aria-describedby="otp-expiry-info" />
          </div>
          <div class="otp-expiry-row" id="otp-expiry-row">
            <span class="otp-expiry-text" id="otp-expiry-info" aria-live="polite">
              Kode berlaku <strong id="otp-countdown">5:00</strong>
            </span>
            <span class="otp-resend-wrap">
              <button type="button" id="btn-resend-otp" class="btn-otp-resend" disabled
                aria-label="Kirim ulang kode OTP">
                Kirim ulang
              </button>
              <span id="otp-resend-countdown" class="otp-resend-countdown" aria-live="polite"></span>
            </span>
          </div>
          <span class="form-error" id="error-otp-verify" role="alert"></span>
        </div>

        <button type="button" id="btn-verify-otp" class="btn btn--otp-verify"
          aria-label="Verifikasi kode OTP">
          <span class="btn__icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </span>
          <span class="btn__text">Verifikasi Email</span>
        </button>
      </div>

      <!-- State 3: Email terverifikasi -->
      <div id="otp-state-verified" class="otp-state otp-state--verified" style="display:none;"
           role="status" aria-live="polite">
        <div class="otp-verified-badge">
          <span class="otp-verified-badge__icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
          </span>
          <div class="otp-verified-badge__text">
            <span class="otp-verified-badge__label">Email Terverifikasi</span>
            <span class="otp-verified-badge__email" id="otp-verified-email-display">—</span>
          </div>
          <button type="button" id="btn-change-email-otp" class="btn-otp-change"
            aria-label="Ganti email dan verifikasi ulang" title="Ganti email">
            Ganti
          </button>
        </div>
      </div>

      <!-- Error submit saat belum terverifikasi -->
      <span class="form-error" id="error-otp-submit" role="alert"></span>
    </div>
  `;
}

/**
 * Tampilkan/sembunyikan blok OTP berdasarkan jenis tamu yang dipilih.
 * Dipanggil setelah renderAnggotaRepeater().
 */
function _updateOtpSectionVisibility() {
  const section = document.getElementById('otp-verification-section');
  if (!section) return;

  const wajib = jenisWajibOtp(selectedJenis);
  section.style.display = wajib ? '' : 'none';

  if (!wajib) {
    // Bersihkan error OTP jika jenis tidak wajib
    hideFieldError('error-otp-submit');
    return;
  }

  // Tampilkan state yang sesuai dengan emailVerified
  _syncOtpStateUI();
  // Pasang event listener OTP (idempoten — cek apakah sudah dipasang)
  _attachOtpEvents();
}

/**
 * Sinkronkan tampilan UI OTP dengan state saat ini.
 */
function _syncOtpStateUI() {
  const stateSend     = document.getElementById('otp-state-send');
  const stateVerify   = document.getElementById('otp-state-verify');
  const stateVerified = document.getElementById('otp-state-verified');
  if (!stateSend || !stateVerify || !stateVerified) return;

  if (emailVerified && otpVerifiedEmail) {
    stateSend.style.display     = 'none';
    stateVerify.style.display   = 'none';
    stateVerified.style.display = '';
    const emailDisplay = document.getElementById('otp-verified-email-display');
    if (emailDisplay) emailDisplay.textContent = otpVerifiedEmail;
  } else {
    stateSend.style.display     = '';
    stateVerify.style.display   = 'none';
    stateVerified.style.display = 'none';
  }
}

/**
 * Reset seluruh state OTP ke kondisi awal.
 * Dipanggil saat: ganti jenis tamu, ganti email, resetForm.
 */
function _resetOtpState() {
  emailSessionId   = '';
  emailVerified    = false;
  otpVerifiedEmail = '';

  if (otpResendTimer)  { clearInterval(otpResendTimer);  otpResendTimer  = null; }
  if (otpExpiryTimer) { clearInterval(otpExpiryTimer); otpExpiryTimer = null; }

  isSendingOtp   = false;
  isVerifyingOtp = false;

  // Bersihkan error OTP
  ['error-otp-send', 'error-otp-verify', 'error-otp-submit'].forEach(id => hideFieldError(id));

  // Kembalikan state UI ke "send"
  _syncOtpStateUI();
}

/** Flag agar _attachOtpEvents tidak duplikat */
let _otpEventsAttached = false;

/**
 * Pasang event listener untuk tombol-tombol OTP.
 * Idempoten — hanya dieksekusi sekali meskipun dipanggil berkali-kali.
 */
function _attachOtpEvents() {
  // Gunakan event delegation dari main-content agar tidak perlu re-attach setelah re-render
  const container = document.getElementById('main-content');
  if (!container || _otpEventsAttached) return;
  _otpEventsAttached = true;

  container.addEventListener('click', async (e) => {
    const target = e.target.closest('button');
    if (!target) return;

    switch (target.id) {
      case 'btn-send-otp':
        await _handleSendOtp();
        break;
      case 'btn-resend-otp':
        await _handleSendOtp(true);
        break;
      case 'btn-verify-otp':
        await _handleVerifyOtp();
        break;
      case 'btn-change-email-otp':
        _handleChangeEmail();
        break;
    }
  });

  // Input OTP: hanya izinkan angka, auto-submit setelah 6 digit
  container.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id !== 'otp-input') return;
    // Hapus non-digit
    el.value = el.value.replace(/\D/g, '').substring(0, 6);
    hideFieldError('error-otp-verify');
    // Auto-submit jika sudah 6 digit
    if (el.value.length === 6) {
      const verifyBtn = document.getElementById('btn-verify-otp');
      if (verifyBtn && !verifyBtn.disabled) {
        _handleVerifyOtp();
      }
    }
  });

  // Prevent paste non-digit di input OTP
  container.addEventListener('paste', (e) => {
    const el = e.target;
    if (el.id !== 'otp-input') return;
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    const digits = pasted.replace(/\D/g, '').substring(0, 6);
    el.value = digits;
    el.dispatchEvent(new Event('input'));
  });
}

/**
 * Handler tombol "Kirim Kode OTP" / "Kirim ulang".
 */
async function _handleSendOtp(isResend = false) {
  if (isSendingOtp) return;

  const emailEl = document.getElementById('anggota-email-0');
  const email   = emailEl ? emailEl.value.trim().toLowerCase() : '';

  // Validasi email
  if (!email) {
    showFieldError('error-otp-send', 'Masukkan alamat email terlebih dahulu.');
    emailEl && emailEl.focus();
    return;
  }
  if (!EMAIL_REGEX.test(email)) {
    showFieldError('error-otp-send', 'Format email tidak valid.');
    emailEl && emailEl.focus();
    return;
  }

  hideFieldError('error-otp-send');
  hideFieldError('error-otp-verify');

  const btnSend   = document.getElementById('btn-send-otp');
  const btnResend = document.getElementById('btn-resend-otp');

  isSendingOtp = true;
  if (btnSend)   setButtonLoading(btnSend);
  if (btnResend) { btnResend.disabled = true; btnResend.textContent = 'Mengirim...'; }

  try {
    const result = await callGAS('requestTamuOtp', {
      email     : email,
      jenisTamu : selectedJenis,
      sessionId : emailSessionId || undefined,  // reuse jika ada
    });

    if (result.status === 'ok') {
      // Simpan sessionId dari server
      emailSessionId = result.data?.sessionId || emailSessionId;

      const maskedEmail    = result.data?.maskedEmail || _maskEmailLocal(email);
      const otpExpiresAt   = result.data?.otpExpiresAt  || 0;
      const cooldownMs     = result.data?.cooldownMs    || 60000;

      // Tampilkan state verifikasi
      const stateSend   = document.getElementById('otp-state-send');
      const stateVerify = document.getElementById('otp-state-verify');
      if (stateSend)   stateSend.style.display   = 'none';
      if (stateVerify) stateVerify.style.display = '';

      const maskedEl = document.getElementById('otp-masked-email');
      if (maskedEl) maskedEl.textContent = maskedEmail;

      // Bersihkan input OTP
      const otpInput = document.getElementById('otp-input');
      if (otpInput) { otpInput.value = ''; otpInput.focus(); }

      // Mulai countdown expiry
      if (otpExpiresAt > 0) _startOtpExpiryCountdown(otpExpiresAt);

      // Mulai cooldown resend
      _startResendCooldown(cooldownMs);

      if (!isResend) showToast('Kode OTP telah dikirim ke ' + maskedEmail, 'success', 4000);
      else           showToast('Kode OTP baru telah dikirim.', 'success', 3500);

    } else {
      showFieldError(isResend ? 'error-otp-verify' : 'error-otp-send',
        result.message || 'Gagal mengirim OTP. Silakan coba lagi.');
    }

  } catch (_err) {
    showFieldError(isResend ? 'error-otp-verify' : 'error-otp-send',
      'Koneksi gagal. Periksa internet dan coba lagi.');
  } finally {
    isSendingOtp = false;
    if (btnSend)   resetButtonLoading(btnSend, false);
    // Resend button akan di-enable oleh countdown selesai
  }
}

/**
 * Handler tombol "Verifikasi Email".
 */
async function _handleVerifyOtp() {
  if (isVerifyingOtp) return;

  const otpInput = document.getElementById('otp-input');
  const otp      = otpInput ? otpInput.value.trim() : '';

  if (!otp) {
    showFieldError('error-otp-verify', 'Masukkan kode OTP terlebih dahulu.');
    otpInput && otpInput.focus();
    return;
  }
  if (!/^\d{6}$/.test(otp)) {
    showFieldError('error-otp-verify', 'Kode OTP harus 6 digit angka.');
    otpInput && otpInput.focus();
    return;
  }
  if (!emailSessionId) {
    showFieldError('error-otp-verify', 'Sesi verifikasi tidak ditemukan. Silakan kirim ulang OTP.');
    return;
  }

  hideFieldError('error-otp-verify');

  const email  = (document.getElementById('anggota-email-0')?.value || '').trim().toLowerCase();
  const btnVerify = document.getElementById('btn-verify-otp');

  isVerifyingOtp = true;
  if (btnVerify) setButtonLoading(btnVerify);

  try {
    const result = await callGAS('verifyTamuOtp', {
      sessionId: emailSessionId,
      email    : email,
      otp      : otp,
    });

    if (result.status === 'ok') {
      // Berhasil terverifikasi
      emailVerified    = true;
      otpVerifiedEmail = email;
      emailSessionId   = result.data?.sessionId || emailSessionId;

      // Hentikan countdown
      if (otpExpiryTimer) { clearInterval(otpExpiryTimer); otpExpiryTimer = null; }
      if (otpResendTimer) { clearInterval(otpResendTimer); otpResendTimer = null; }

      // Tampilkan state verified
      const stateVerify   = document.getElementById('otp-state-verify');
      const stateVerified = document.getElementById('otp-state-verified');
      if (stateVerify)   stateVerify.style.display   = 'none';
      if (stateVerified) stateVerified.style.display = '';

      const emailDisplay = document.getElementById('otp-verified-email-display');
      if (emailDisplay) emailDisplay.textContent = email;

      hideFieldError('error-otp-submit');
      showToast('✓ Email berhasil diverifikasi!', 'success', 4000);
      checkSubmitEligibility();

    } else {
      showFieldError('error-otp-verify', result.message || 'Kode OTP tidak valid. Coba lagi.');
      if (otpInput) { otpInput.value = ''; otpInput.focus(); }
    }

  } catch (_err) {
    showFieldError('error-otp-verify', 'Koneksi gagal. Periksa internet dan coba lagi.');
  } finally {
    isVerifyingOtp = false;
    if (btnVerify) resetButtonLoading(btnVerify, false);
  }
}

/**
 * Handler tombol "Ganti email" — reset OTP dan kembali ke state awal.
 */
function _handleChangeEmail() {
  _resetOtpState();

  // Kembali ke state send
  const stateSend     = document.getElementById('otp-state-send');
  const stateVerify   = document.getElementById('otp-state-verify');
  const stateVerified = document.getElementById('otp-state-verified');
  if (stateSend)     stateSend.style.display     = '';
  if (stateVerify)   stateVerify.style.display   = 'none';
  if (stateVerified) stateVerified.style.display = 'none';

  // Focus ke field email
  const emailEl = document.getElementById('anggota-email-0');
  if (emailEl) {
    emailEl.classList.remove('is-valid', 'is-invalid');
    setTimeout(() => emailEl.focus(), 100);
  }

  checkSubmitEligibility();
}

/**
 * Mulai countdown expiry OTP.
 * @param {number} expiresAt - Unix ms
 */
function _startOtpExpiryCountdown(expiresAt) {
  if (otpExpiryTimer) clearInterval(otpExpiryTimer);

  const countdownEl = document.getElementById('otp-countdown');
  const expiryRow   = document.getElementById('otp-expiry-row');

  function tick() {
    const remaining = expiresAt - Date.now();
    if (!countdownEl) return;

    if (remaining <= 0) {
      clearInterval(otpExpiryTimer);
      otpExpiryTimer = null;
      countdownEl.textContent = '0:00';
      countdownEl.style.color = 'var(--clr-danger, #dc2626)';
      if (expiryRow) expiryRow.classList.add('otp-expiry--expired');
      showFieldError('error-otp-verify', 'Kode OTP telah kedaluwarsa. Silakan kirim ulang kode.');
      // Disable tombol verify
      const verifyBtn = document.getElementById('btn-verify-otp');
      if (verifyBtn) verifyBtn.disabled = true;
      return;
    }

    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    countdownEl.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;

    // Warnai merah di 60 detik terakhir
    if (remaining <= 60000) {
      countdownEl.style.color = 'var(--clr-danger, #dc2626)';
    }
  }

  tick();
  otpExpiryTimer = setInterval(tick, 1000);
}

/**
 * Mulai countdown cooldown resend.
 * @param {number} cooldownMs - ms cooldown
 */
function _startResendCooldown(cooldownMs) {
  if (otpResendTimer) clearInterval(otpResendTimer);

  const btnResend     = document.getElementById('btn-resend-otp');
  const countdownEl   = document.getElementById('otp-resend-countdown');

  if (btnResend) btnResend.disabled = true;

  const endsAt = Date.now() + cooldownMs;

  function tick() {
    const remaining = endsAt - Date.now();
    if (remaining <= 0) {
      clearInterval(otpResendTimer);
      otpResendTimer = null;
      if (btnResend)   { btnResend.disabled = false; btnResend.textContent = 'Kirim ulang'; }
      if (countdownEl) countdownEl.textContent = '';
      return;
    }
    const secs = Math.ceil(remaining / 1000);
    if (btnResend)   btnResend.textContent = `Kirim ulang`;
    if (countdownEl) countdownEl.textContent = `(${secs}d)`;
  }

  tick();
  otpResendTimer = setInterval(tick, 1000);
}

/**
 * Mask email di sisi frontend (fallback jika server tidak kembalikan maskedEmail).
 * @param {string} email
 * @returns {string}
 */
function _maskEmailLocal(email) {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  if (local.length <= 2) return local + '@' + domain;
  return local[0] + '***' + local[local.length - 1] + '@' + domain;
}

// ── Override renderAnggotaRepeater untuk update OTP section ──

const _origRenderAnggotaRepeater = renderAnggotaRepeater;

// Monkey-patch renderAnggotaRepeater agar setiap re-render
// juga mengupdate visibilitas blok OTP
// (Pendekatan ini non-invasif — tidak mengubah logika render asli)
const _renderAnggotaRepeaterBase = renderAnggotaRepeater;
// (Re-assign tidak perlu karena kita panggil _updateOtpSectionVisibility
//  langsung setelah render selesai di fungsi yang memanggil renderAnggotaRepeater)

// Wrap renderAnggotaRepeater agar selalu sinkronkan OTP visibility
{
  const _orig = renderAnggotaRepeater;
  renderAnggotaRepeater = function() {
    _orig();
    // Setelah DOM terender, update OTP section visibility
    _updateOtpSectionVisibility();
  };
}
