# Daftar Risiko

| # | Risiko | Kemungkinan | Dampak | Mitigasi |
|---|---|---|---|---|
| R1 | Agen Cue tidak bisa memakai custom MCP connector | Sedang | Tinggi | Uji di M2. Cadangan: CEO di aplikasi Manus biasa; animator utama pindah ke Muse |
| R2 | Jaringan VM atau Sentinel memblokir akses ke hub atau penyimpanan artefak | Sedang | Tinggi | Uji T3 dini. Domain stabil. Artefak kecil lewat MCP langsung. Catat domain yang perlu persetujuan |
| R3 | Jatah token mingguan Muse habis di tengah produksi | Tinggi | Sedang | Failover otomatis ke animator_backup. Batasi jadwal bangun 2 sampai 3 kali per hari. Pantau tugas `blocked/limit` |
| R4 | Klaim fakta keliru lolos dan terbit | Sedang | Tinggi | Gerbang fact-check dengan dua sumber independen. Pada MVP PM menyetujui semua video akhir. Koreksi segera bila terjadi |
| R5 | Injeksi prompt lewat halaman web atau dokumen sumber | Sedang | Tinggi | Protokol agen memperlakukan isi luar sebagai data. Hub tidak punya tool berbahaya. Uji T5 |
| R6 | TikTok menurunkan jangkauan karena akun dianggap spam atau konten AI tak asli | Sedang | Tinggi | Hindari tiga topik yang diuji deteksi spam AI (politik, keuangan, kesehatan). Label konten AI. Variasikan format. Kualitas di atas volume |
| R7 | Akun agen ditangguhkan karena ketentuan akun ganda | Tidak diketahui | Tinggi | PM membaca ketentuan sebelum M2 (O-4). Jangan menambah akun baru. Failover mengurangi dampak satu akun |
| R8 | Hub mati atau data hilang | Rendah | Tinggi | Cadangan harian, uji restore, runbook, pemeriksa `/health` eksternal |
| R9 | Pelanggaran hak cipta pada musik atau aset visual | Sedang | Sedang | Tanpa musik dalam render. Aset dibuat sendiri atau berlisensi dengan catatan asal |
| R10 | PM menjadi hambatan persetujuan | Sedang | Sedang | Batasi persetujuan ke dua gerbang. Tidak ada persetujuan otomatis: bila PM terlambat, video menunggu, tidak terbit |
| R11 | Developer paruh waktu tidak tersedia | Sedang | Sedang | `AGENTS.md`, runbook, dan tes lengkap supaya orang lain atau Antigravity bisa melanjutkan |
| R12 | Agen mengubah perilaku setelah pembaruan platform (Muse atau Cue) | Sedang | Sedang | Uji ulang T1, T3, T9 setelah pembaruan besar. Kontrak hub tidak berubah |
| R13 | Kunci agen bocor lewat chat | Rendah | Tinggi | Kunci hanya lewat penyimpanan kredensial aman. `rotate-key` bila ragu. Hub membatasi izin per role |
