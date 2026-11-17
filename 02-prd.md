# PRD: Sistem Multi-Agen Produksi Konten TikTok

Versi 1.0 · 17 November 2026 · Pemilik: Project Manager (manusia)
Dokumen terkait: 00-brief, 01-target-metrik, 03-spesifikasi-teknis, 05-rencana-uji

## 1. Latar
Lihat `00-brief.md`. Ringkasnya: 7 agen (5 Muse, 2 Cue) harus menghasilkan video animasi "fakta yang jarang diketahui" untuk akun TikTok baru, tanpa PM menjadi kurir antar agen.

## 2. Tujuan
- G1. Draf video terverifikasi tersedia setiap hari kerja (target di `01-target-metrik.md`).
- G2. Semua agen terhubung lewat satu hub. Tidak ada salin-tempel manual antar agen.
- G3. Tidak ada klaim fakta tak terverifikasi yang terbit.
- G4. Waktu PM paling banyak 60 menit per hari.
- G5. Kegagalan atau limit satu akun agen tidak menghentikan produksi.

## 3. Non-tujuan (MVP)
- Tidak mengunggah otomatis ke TikTok. PM yang menerbitkan.
- Tidak membalas komentar atau DM secara otomatis.
- Tidak menangani bisnis ke-2 dan ke-3.
- Tidak memberi agen akses pembayaran, dompet, atau kredensial platform sosial.
- Tidak membuat dashboard interaktif. Dashboard hanya baca, kecuali form input metrik.
- Tidak memakai Telegram sebagai jalur agen. Telegram hanya untuk PM.
- Tidak memproduksi konten politik, saran keuangan, atau kesehatan.

## 4. Persona
| Persona | Kebutuhan |
|---|---|
| PM (pemilik) | Memilih topik, menyetujui video akhir, melihat status sekilas, tanpa belajar teknis |
| Agen (pengguna lewat MCP) | Antrean tugas yang jelas, format input-output baku, jalan keluar jujur saat terblokir |
| Developer pemelihara | Kode kecil, tes lengkap, runbook pemulihan |

## 5. Role
| Role | Akun | Tugas inti | Tidak boleh |
|---|---|---|---|
| pm | Manusia | Menyetujui topik dan video akhir, menerbitkan, mengisi metrik | |
| ceo | Cue #1 | Merencanakan, mengarahkan tugas, menegakkan QA, melapor | Menulis skrip, menilai fakta, merender |
| strategist | Muse #1 | Kandidat topik, angle, hook, skrip | Menyatakan klaim sebagai terverifikasi |
| fact_checker | Muse #2 | Memverifikasi tiap klaim inti dengan sumber | Mengubah skrip |
| animator | Cue #2 | Storyboard dan render video | Mengubah klaim |
| animator_backup | Muse #5 | Sama dengan animator, aktif saat failover | |
| analyst | Muse #3 | Laporan metrik mingguan dan saran eksperimen | Menyimpulkan sebab dari sampel kecil |
| social | Muse #4 | Caption, hashtag, teks sampul, draf jadwal | Menerbitkan |

## 6. Alur produksi per video
1. Awal minggu: strategist menyerahkan minimal 10 kandidat topik. CEO memilih dan meminta persetujuan PM (gerbang `topic`).
2. strategist menulis skrip (hook, beat, klaim inti).
3. fact_checker menilai tiap klaim. Gerbang: semua klaim inti `verified`.
4. animator membuat storyboard lalu render. Bila blocked, CEO mengalihkan ke animator_backup.
5. social menyiapkan paket caption dan draf jadwal.
6. CEO menjalankan checklist QA, lalu meminta persetujuan PM (gerbang `final`).
7. PM menerbitkan sendiri di TikTok dan menandai `published` beserta tautannya.
8. PM mengisi metrik pada 24 jam, 72 jam, dan 7 hari. analyst menulis laporan mingguan.

## 7. User story dan kriteria penerimaan
| ID | Sebagai | Saya ingin | Kriteria penerimaan |
|---|---|---|---|
| US-1 | PM | Menerima kandidat topik mingguan dan menyetujuinya lewat Telegram | Hub memuat tugas `topic_candidates` dengan minimal 10 item, tiap item punya klaim inti dan minimal 1 sumber awal. Notifikasi `topic` terkirim ke Telegram dalam 1 menit setelah CEO meminta persetujuan |
| US-2 | CEO | Mengarahkan tugas ke role yang tepat | `send_task` hanya berhasil bila `to` adalah role yang sah untuk tipe tugas itu. Selain itu ditolak dengan pesan galat yang menyebut role yang benar |
| US-3 | PM | Memastikan tidak ada video tanpa fact-check | Tugas `render` untuk video yang skripnya belum punya `gate_pass=true` ditolak hub. Ada tes otomatis untuk kasus ini |
| US-4 | CEO | Mengalihkan render saat animator terblokir | Bila animator mengirim `blocked` dengan `limit` atau `failed`, CEO menerima item `needs_reassign` dalam 1 menit. `send_task` ke animator_backup dengan `reassigned_from` berhasil dan tugas lama berstatus `superseded` |
| US-5 | PM | Menerima draf video lengkap untuk ditinjau | Saat tahap `awaiting_approval`, hub menyimpan artefak mp4, srt, sampul png, dan paket caption. Telegram mengirim ringkasan dan tombol Setuju atau Tolak |
| US-6 | PM | Menjadi satu-satunya pihak yang bisa menyetujui | Tidak ada tool MCP untuk `approve` atau `publish`. Persetujuan hanya lewat Telegram dengan allowlist `chat_id` PM atau dashboard. Tes: semua role agen mencoba, semuanya gagal |
| US-7 | PM | Menerima laporan analis mingguan | Setelah PM mengisi metrik, analyst menerima tugas `metrics_report`. Laporan memuat video terbaik dan terburuk, hipotesis, dan 3 eksperimen berikutnya. Bila video kurang dari 20, kesimpulan sebab diberi label hipotesis |
| US-8 | PM | Melihat riwayat satu video | Dashboard atau perintah Telegram `/riwayat <video_id>` menampilkan semua event berurutan waktu |
| US-9 | PM | Mencabut akses satu agen dengan cepat | `python -m hub.admin revoke-agent <nama>` membuat semua panggilan berikutnya dari agen itu ditolak dalam 1 menit, tanpa deploy ulang |
| US-10 | PM | Tahu bila tugas macet | Tugas `claimed` lebih dari 4 jam tanpa pembaruan menjadi `stale` dan memicu notifikasi |

## 8. Kebutuhan fungsional
- FR-1. Hub menyediakan server MCP (streamable HTTP) pada `/mcp`, dengan autentikasi `Authorization: Bearer <kunci>` atau `X-API-Key`, satu kunci per agen.
- FR-2. Tool: `whoami`, `inbox`, `claim_task`, `submit_result`, `send_task`, `list_tasks`, `request_upload`, `post_artifact`, `get_artifact`, `request_approval` (rinci di `03`).
- FR-3. Izin per role ditegakkan di hub, bukan di prompt (matriks di `03`).
- FR-4. State machine tugas dan video. Transisi ilegal ditolak dengan galat yang bisa ditindaklanjuti.
- FR-5. Gerbang fact-check seperti US-3.
- FR-6. Failover seperti US-4.
- FR-7. Penyimpanan artefak dengan checksum SHA-256. Ukuran file maksimal 200 MB (asumsi: video 60 detik 1080x1920 jauh di bawahnya).
- FR-8. Gerbang persetujuan seperti US-6.
- FR-9. Notifikasi Telegram ke PM untuk: `awaiting_approval`, tugas `blocked` dengan `needs_human`, tugas `stale`, galat hub, dan laporan harian CEO.
- FR-10. Deteksi `stale` seperti US-10.
- FR-11. Audit log append-only untuk setiap perubahan state.
- FR-12. CLI admin: `create-agent`, `revoke-agent`, `rotate-key`, `list-agents`.
- FR-13. Input metrik oleh PM lewat Telegram (`/metrik`) atau form dashboard.
- FR-14. Cadangan DB harian ke penyimpanan terpisah. Uji pemulihan tiap bulan.
- FR-15. Endpoint `/health`.

## 9. Kebutuhan non-fungsional
- NFR-1. Keamanan: hanya hash SHA-256 kunci disimpan, HTTPS wajib, rate limit 60 permintaan per menit per agen, payload JSON maksimal 256 KB.
- NFR-2. Latensi p95 tool non-unggah di bawah 1 detik pada beban 7 agen.
- NFR-3. Ketersediaan bulanan 99% (VPS tunggal). Data tidak boleh hilang walau layanan turun.
- NFR-4. Hub tidak menyimpan kata sandi atau kredensial platform sosial apa pun.
- NFR-5. Log terstruktur JSON tanpa rahasia.
- NFR-6. Biaya infrastruktur hub sekitar USD 25 per bulan atau kurang (target, belum diverifikasi harga).
- NFR-7. Pemulihan dari nol (VPS baru, restore cadangan) dalam 2 jam mengikuti runbook.

## 10. Cakupan
| MVP (M1 sampai M6) | Fase 2 |
|---|---|
| Hub, 7 role, pipeline sampai draf, Telegram, input metrik manual, dashboard baca | Unggah otomatis, bisnis ke-2 dan ke-3, integrasi TikTok API, balasan komentar, Postgres |

## 11. Asumsi
- A1. Muse dapat membuat custom connector ke server MCP jarak jauh lewat chat. Sumber: dokumentasi pihak ketiga dan panduan Meta; diuji di M2.
- A2. Jaringan VM agen boleh mengakses domain hub dan penyimpanan artefak, mungkin lewat persetujuan Sentinel. Diuji di M2 dan M4.
- A3. Penonton berbahasa Indonesia.
- A4. Satu akun TikTok dikendalikan PM.

## 12. Pertanyaan terbuka
- O-1. Apakah agen Cue bisa menambah custom MCP connector? Per akhir September 2026 belum ada dokumentasinya. Jawaban di M2 menentukan apakah Cue #1 tetap CEO atau CEO pindah ke aplikasi Manus biasa.
- O-2. Mekanisme apa yang membangunkan tiap agen secara terjadwal (tugas terjadwal Muse, Automations Manus, atau PM mengetik "cek inbox")? Diuji di M2.
- O-3. Siapa animator terbaik, Cue #2 atau Muse #5? Dijawab bake-off di `05-rencana-uji.md`.
- O-4. Apakah ketentuan Muse dan Cue mengizinkan beberapa akun milik satu orang? PM memeriksa sebelum M2.
- O-5. Cara menerbitkan pada fase 2: API TikTok, alat penjadwal berserver MCP, atau tetap manual.
- O-6. Niche awal, pilar, bahasa, nama akun (variabel di `00-brief.md`).
