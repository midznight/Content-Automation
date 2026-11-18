# Roadmap dan Breakdown Tugas

Estimasi kasar dalam hari kerja, dengan asumsi pembangunan di Antigravity dan satu developer paruh waktu untuk deploy dan tinjauan keamanan. Urutan mengikuti dependensi: tidak ada agen yang bisa diuji sebelum hub hidup, dan tidak ada pipeline sebelum jawaban soal Cue.

| Milestone | Isi | Estimasi | Bergantung pada | Selesai bila |
|---|---|---|---|---|
| M0 Fondasi | Isi variabel `00-brief`. Siapkan VPS, domain, repo, bot Telegram (lewat BotFather), akun penyimpanan S3-compatible. Baca ketentuan akun ganda Muse dan Cue (O-4) | 1 | | Semua kredensial ada di `.env` lokal, variabel terisi |
| M1 Hub inti | Prompt A: skema DB, autentikasi per agen, tool dasar, izin, state machine tugas, rate limit, `/health`, Docker Compose | 3 | M0 | `pytest -q` lulus dan klien MCP menyelesaikan `whoami`, `send_task`, `inbox`, `claim_task`, `submit_result` |
| M2 Sambung agen | Deploy hub. Sambungkan CEO dan satu Muse. Uji T1 sampai T3 di `05`. Jawab O-1 dan O-2 | 2 | M1 | Ping-pong nyata berhasil dan keputusan jalur Cue dicatat |
| M3 Pipeline | Tipe tugas dan penjaga transisi, fact-check gate, R2 artefak, approval PM, failover, stale, Telegram opsional, laporan harian | 4 | M2 | Implementasi Cloudflare tersedia pada branch `feat/m3-production-pipeline`; penerapan remote dan uji satu video menunggu PR, secret PM, dan E2E produksi |
| M4 Bake-off animator | Uji skrip sama pada Cue #2 dan Muse #5. Pilih utama dan cadangan | 2 | M3 | Rubrik terisi dan keputusan dicatat di `05` |
| M5 Paket dan dashboard | Sambungkan 7 role. Prompt C: dashboard baca dan form metrik | 3 | M4 | Semua role menjalankan tugas nyata dan PM bisa melihat riwayat satu video |
| M6 Percobaan 10 video | Produksi 10 video sampai draf, PM menerbitkan manual, mengisi metrik, lalu retrospektif | 10 sampai 14 | M5 | Checklist penerimaan MVP di `05` terpenuhi |

## Tugas PM per milestone (di luar pembangunan)
- M0: memutuskan variabel, mendaftar akun TikTok dengan nomor dan email sendiri.
- M2: memasukkan kunci agen ke penyimpanan kredensial aman tiap platform, bukan ke chat.
- M3 sampai M6: menyetujui topik mingguan dan video akhir. Sasaran waktu: 60 menit per hari.

## Fase 2 (setelah M6, bila M1 sampai M8 tercapai)
Unggah otomatis (dengan keputusan O-5), bisnis ke-2 dan ke-3 dengan antrean dan role terpisah, Postgres bila beban naik, komentar dan DM semi-otomatis.

## Keputusan yang menentukan jalur
- Bila O-1 gagal untuk Cue: CEO pindah ke aplikasi Manus biasa dan animator utama menjadi Muse (lihat `03` Lampiran A).
- Bila T3 gagal (VM tidak bisa mengunggah ke penyimpanan): artefak besar dikirim lewat tautan yang PM tempel sementara, dan jalur unggah dipikirkan ulang bersama developer.
