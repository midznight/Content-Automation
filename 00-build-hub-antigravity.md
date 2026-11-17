# Prompt Eksekusi untuk Antigravity

Pakai berurutan. Prompt B hanya setelah tes Prompt A lulus dan hub sudah diuji dengan agen nyata (M2). Prompt C setelah M4.
Cara pakai: tempel satu prompt sebagai tugas. Antigravity wajib memberi rencana dulu. Baca rencananya, setujui atau koreksi, baru biarkan mengeksekusi.
Model yang cocok: model coding agentic terkuat yang tersedia di Antigravity Anda, dengan mode perencanaan bila ada.

---

## Prompt A: Hub inti (M1)

````
<peran>
Kamu insinyur backend Python senior yang membangun layanan MCP kecil, aman, dan mudah dirawat oleh orang non-teknis.
</peran>

<konteks>
Repo ini berisi /docs (sumber kebenaran) dan AGENTS.md (aturan kerja). Baca AGENTS.md, docs/02-prd.md, docs/03-spesifikasi-teknis.md, dan docs/05-rencana-uji.md bagian A sebelum merencanakan. Tujuan milestone M1: hub MCP yang bisa dipanggil agen Muse dan Cue dan lulus uji ping-pong. Pengguna hub adalah agen AI di VM terpisah, dengan Project Manager manusia yang tidak teknis.
</konteks>

<tugas>
Bangun M1 dengan butir berikut, satu commit per butir:
1. Kerangka proyek sesuai struktur folder di AGENTS.md, pyproject.toml dengan versi dependensi yang kamu verifikasi dari dokumentasi resmi, konfigurasi ruff dan pytest.
2. Model dan migrasi Alembic untuk tabel agents, videos, tasks, artifacts, approvals, events, metrics (docs/03 bagian 4).
3. Autentikasi per agen: header Authorization Bearer atau X-API-Key, hash SHA-256, CLI `python -m hub.admin` dengan create-agent (kunci ditampilkan sekali), revoke-agent, rotate-key, list-agents.
4. Server MCP streamable HTTP di /mcp dengan tool whoami, inbox, claim_task, submit_result, send_task, list_tasks.
5. Izin per role di hub/domain/permissions.py sesuai matriks docs/03 bagian 6. Tipe tugas di luar matriks ditolak.
6. State machine tugas (queued, claimed, done, blocked, failed, stale, superseded). Setiap perubahan menulis baris events dalam transaksi yang sama. submit_result membuat item inbox result_ready untuk ceo.
7. Rate limit 60 permintaan per menit per agen dan batas payload 256 KB.
8. Endpoint /health yang memeriksa DB.
9. Docker Compose (hub, caddy), .env.example, dan deploy/README.md berisi langkah deploy ke VPS yang bisa diikuti orang non-teknis, termasuk cara membuat agen pertama.
10. Tes pytest sesuai docs/05 bagian A untuk butir 1 sampai 8, ditambah satu tes ping-pong end-to-end yang memakai klien MCP dari SDK.
</tugas>

<batasan>
- Ikuti AGENTS.md. Dependensi hanya yang ada di stack. Tanpa tool publish, pembayaran, atau akses kredensial platform sosial.
- Cek dokumentasi resmi SDK MCP untuk API transport streamable HTTP yang berlaku sebelum menulis kode. Bila ragu tentang suatu fungsi, katakan ragu; jangan mengarang.
- Galat dari tool harus menyebut apa yang salah dan apa yang harus agen lakukan, karena pembacanya model AI tanpa konteks tambahan.
- Jangan menambah fitur di luar butir 1 sampai 10.
</batasan>

<proses>
Tulis rencana: daftar berkas, urutan butir, dan tes yang akan ditulis. Berhenti dan tunggu persetujuan PM. Setelah disetujui, kerjakan per butir dan jalankan `pytest -q` serta lint di tiap butir.
</proses>

<format_output>
Ringkasan akhir dengan bagian: butir selesai, hasil pytest, cara menjalankan lokal, cara deploy, keputusan yang kamu ambil, hal yang belum selesai atau tidak yakin.
</format_output>

<kriteria_sukses>
- `pytest -q` dan lint lulus.
- `docker compose up` menjalankan hub dan /health mengembalikan sukses.
- Klien MCP menyelesaikan whoami, send_task, inbox, claim_task, submit_result dengan dua role berbeda.
- Setiap pasangan tool dan role pada matriks izin punya tes.
- String kunci uji tidak muncul di log maupun repo.
</kriteria_sukses>

<verifikasi>
Sebelum ringkasan: jalankan semua perintah di AGENTS.md, telusuri log dan repo untuk string kunci uji, dan cocokkan tiap butir dengan kriteria penerimaan di docs/02-prd.md (US-2, US-9, US-10 bagian yang relevan).
</verifikasi>
````

---

## Prompt B: Pipeline, gerbang, dan notifikasi (M3)

````
<peran>
Kamu insinyur backend Python senior yang memahami alur kerja berbasis state machine dan keamanan layanan yang melayani agen AI.
</peran>

<konteks>
Hub inti (M1) sudah berjalan dan sudah diuji dengan agen nyata (M2). Baca AGENTS.md, docs/02-prd.md, docs/03-spesifikasi-teknis.md bagian 3 sampai 9, dan docs/05-rencana-uji.md. Catatan hasil M2 (jalur Cue, mekanisme penjadwalan, apakah VM bisa mengunggah): [TEMPEL RINGKASAN HASIL M2 DI SINI].
</konteks>

<tugas>
Bangun M3, satu commit per butir:
1. State machine video (topic, scripted, fact_checked, animated, packaged, awaiting_approval, approved, published, analyzed) dengan penjaga transisi di docs/03 bagian 7.
2. Validasi skema result per tipe tugas (script, fact_check, render, package, topic_candidates, metrics_report) dengan Pydantic. Hitung ulang gate_pass dari verdicts dan tolak hasil yang tidak konsisten.
3. Gerbang fact-check: send_task render ditolak untuk video yang belum fact_checked.
4. Tool request_upload (URL PUT bertanda tangan 15 menit untuk penyimpanan S3-compatible), post_artifact (teks atau upload_id dengan verifikasi SHA-256), get_artifact (hanya untuk role penerima berikutnya pada video itu).
5. Failover: blocked dengan limit atau failed pada render membuat item needs_reassign untuk ceo. send_task dengan reassigned_from menandai tugas lama superseded.
6. request_approval (tool, ceo saja) dan persetujuan oleh PM lewat bot Telegram: tombol Setuju dan Tolak dengan catatan, allowlist chat_id PM dari .env. Tidak ada tool MCP untuk approve atau publish.
7. Perintah Telegram: /riwayat <video_id>, /metrik <video_id> <window> <views> <avg_watch_pct> <likes> <comments> <shares> <saves> <follows>, /terbit <video_id> <url>.
8. Deteksi stale: pekerjaan latar yang menandai tugas claimed lebih dari 4 jam tanpa pembaruan dan mengirim notifikasi.
9. Notifikasi Telegram untuk: awaiting_approval, needs_human, stale, galat hub, laporan harian dari ceo.
10. Tes untuk US-3, US-4, US-5, US-6, US-10 dan uji T4 serta T6 di docs/05, otomatis bila bisa.
</tugas>

<batasan>
- Ikuti AGENTS.md dan jangan mengubah matriks izin, amplop tugas, atau state machine di luar yang tertulis di docs. Bila menurutmu ada yang perlu diubah, ajukan perubahannya di dokumen dan tunggu persetujuan PM.
- Token bot Telegram dan kredensial penyimpanan hanya dari .env.
- Tanpa dashboard di milestone ini.
</batasan>

<proses>
Rencana dulu (berkas, skema yang berubah, migrasi, tes), berhenti untuk persetujuan PM, lalu kerjakan per butir dengan tes hijau di tiap butir.
</proses>

<format_output>
Ringkasan akhir: butir selesai, hasil pytest, perubahan skema dan cara migrasi di server, keputusan yang diambil, hal yang belum selesai, dan langkah uji T4 serta T6 untuk PM.
</format_output>

<kriteria_sukses>
- Semua kriteria penerimaan US-3, US-4, US-5, US-6, US-10 lulus dalam tes.
- Satu video percobaan dengan data buatan melewati seluruh tahap sampai awaiting_approval, dan PM menyetujuinya dari Telegram.
- Semua role agen yang mencoba menyetujui atau menerbitkan ditolak.
</kriteria_sukses>

<verifikasi>
Telusuri log dan repo untuk kunci uji dan token. Pastikan migrasi bisa dijalankan pada salinan DB M1 tanpa kehilangan data.
</verifikasi>
````

---

## Prompt C: Dashboard baca dan form metrik (M5)

````
<peran>
Kamu insinyur full-stack yang membuat antarmuka internal sederhana, cepat, dan aman untuk satu pengguna non-teknis.
</peran>

<konteks>
Hub dengan pipeline lengkap sudah berjalan (M3) dan 7 role sudah tersambung. Baca AGENTS.md, docs/02-prd.md (US-8, FR-13), docs/03-spesifikasi-teknis.md. Pengguna satu-satunya adalah PM, sering membuka dari ponsel.
</konteks>

<tugas>
Bangun dashboard di dalam aplikasi FastAPI yang sama dengan halaman HTML dari server (Jinja2), tanpa kerangka JavaScript berat:
1. Halaman Ringkasan: jumlah video per tahap, tugas macet (blocked, stale), status tiap agen (terakhir aktif dari last_seen_at), persetujuan yang menunggu.
2. Halaman Video: daftar video dan detail satu video dengan riwayat events berurutan waktu, artefak (tautan unduh bertanda tangan), dan hasil fact-check beserta sumbernya.
3. Halaman Tugas: filter berdasarkan status, role, dan tipe.
4. Form input metrik per video dan window (24h, 72h, 7d), dan tombol Setuju atau Tolak untuk persetujuan yang menunggu.
5. Login satu pengguna: kata sandi dari .env disimpan sebagai hash, sesi cookie HttpOnly dan Secure, batas percobaan gagal 5 kali per 15 menit.
6. Tampilan: terbaca di layar 375 piksel, kontras teks minimal 4,5 banding 1, target sentuh minimal 44 piksel, kondisi kosong dan galat tertangani. Tipografi sistem, satu warna aksen, tanpa dekorasi yang tidak punya fungsi.
7. Tes untuk autentikasi, batas percobaan, dan bahwa halaman hanya membaca kecuali dua form di butir 4.
</tugas>

<batasan>
Ikuti AGENTS.md. Dashboard tidak boleh menambah jalur penulisan lain, tidak boleh menampilkan kunci atau hash kunci, dan tidak memuat skrip dari domain luar.
</batasan>

<proses>
Rencana dulu dan berhenti untuk persetujuan PM. Lalu kerjakan per butir.
</proses>

<format_output>
Ringkasan akhir: butir selesai, hasil tes, cara membuka dari ponsel, keputusan yang diambil.
</format_output>

<kriteria_sukses>
PM bisa menjawab dalam di bawah 30 detik: video mana yang menunggu saya, tugas apa yang macet, agen mana yang diam. Semua tes lulus dan tidak ada permintaan jaringan ke domain luar pada halaman.
</kriteria_sukses>

<verifikasi>
Buka tiap halaman pada lebar 375 piksel, cek kontras dan target sentuh, dan jalankan tes. Telusuri keluaran HTML untuk string kunci.
</verifikasi>
````
