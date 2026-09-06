/**
 * config.js
 * Konfigurasi global aplikasi Buku Tamu Sekolah.
 * Ganti GAS_URL dengan URL Web App Google Apps Script setelah deploy.
 */

const CONFIG = {
  // Ganti dengan URL GAS Web App setelah deploy
  GAS_URL: "https://script.google.com/macros/s/AKfycbz0D94vKDATrOILZX1phjvXwI8MA7pw08uQdarRS5RulxVGoCb4ciYEjl0ECSnHQtqn/exec",

  // Nama aplikasi
  APP_NAME: "Buku Tamu Digital",

  // Timeout fetch ke GAS (ms)
  FETCH_TIMEOUT: 15000,

  // Interval auto-refresh dashboard (ms)
  REFRESH_INTERVAL: 30000,

  // Interval polling notifikasi admin (ms)
  NOTIF_INTERVAL: 60000,
};

const JENIS_TAMU = [
  "Orang Tua/Wali Murid",
  "Dinas/Instansi",
  "Mitra",
  "Alumni",
  "Masyarakat",
  "Vendor/Penyedia",
  "Tamu Umum",
];

const ROLES = {
  ADMIN: "admin",
  SATPAM: "satpam",
};
