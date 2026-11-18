# ADR-001: Prioritaskan Chat Gateway dan Telegram sebelum A2A

- Status: **Accepted — keputusan arah arsitektur**
- Tanggal: 18 November 2026
- Proyek: Content-Automation
- Cakupan: akses chat lintas agen, koordinasi Telegram, aktivasi agen, dan interoperabilitas

## Konteks

Content-Automation saat ini memakai satu Cloudflare Worker sebagai MCP Streamable HTTP hub, D1 sebagai sumber data tugas dan audit, serta R2 untuk artefak. Agen Cue dan Muse memiliki identitas/role terpisah dan bekerja melalui tool Hub seperti `inbox`, `claim_task`, `send_task`, `submit_result`, dan `get_task_result`.

Telegram yang sudah ada hanya menjadi kanal notifikasi dan persetujuan PM opsional melalui webhook. Belum ada ruang chat bersama tempat PM dapat berbicara dengan semua agen atau meminta beberapa agen berdiskusi.

Penjadwalan pemeriksaan AI berkala juga tidak ideal karena sesi yang hanya memeriksa inbox kosong tetap dapat mengonsumsi kuota/token. Cron Cloudflare untuk pemeliharaan task stale dan laporan sistem adalah proses backend, bukan sesi AI, sehingga keduanya harus dibedakan.

A2A (Agent2Agent) ditujukan untuk interoperabilitas antaragen independen lintas vendor/framework. A2A tidak otomatis menyediakan antarmuka chat untuk pengguna dan tidak otomatis membangunkan aplikasi Cue/Muse.

## Keputusan

**Jangan migrasi dari MCP ke A2A sekarang. Pertahankan MCP sebagai jalur tool/data utama dan prioritaskan Chat Gateway bersama event-driven activation.** A2A ditunda sebagai adapter interoperabilitas opsional setelah kebutuhan nyata dan kompatibilitas agen terbukti.

Target arsitektur:

1. **Single source of truth:** Cloudflare Worker + D1 + R2 tetap menjadi hub, task engine, policy enforcement, approval, dan audit.
2. **Chat Gateway:** tambahkan adapter chat yang memungkinkan PM mengakses CEO maupun agen spesialis tanpa membuka aplikasi agen satu per satu. Akses web/chat dan Telegram menggunakan identitas, izin, konteks percakapan, dan task engine yang sama.
3. **Telegram shared group:** sediakan satu grup/supergroup privat khusus Content-Automation sebagai ruang koordinasi PM dan semua role agen.
4. **Satu bot gateway pada tahap pertama:** bot pusat menerima perintah yang ditujukan secara eksplisit, mengirim pekerjaan melalui Hub, lalu memublikasikan balasan dengan label identitas logis (mis. `CEO`, `Strategist (Muse)`, `Fact Checker (Muse)`, `Animator (Cue)`). Ini tidak mengklaim bahwa setiap agen merupakan akun Telegram manusia/bot tersendiri.
5. **Diskusi multi-agen dimediasi Hub:** PM dapat meminta satu agen, CEO, atau diskusi terbatas antar-role. Hub membuat task berantai/roundtable, membatasi giliran dan anggaran, menyimpan setiap hasil, lalu bot gateway menampilkan respons berlabel dalam grup. Agen tidak diberi akses bebas untuk saling mengirim instruksi di luar task yang tervalidasi.
6. **Event-driven activation:** task baru, approval, hasil task, dan failover menjadi pemicu. Gunakan webhook/automation platform yang benar-benar didukung. Jangan mengandalkan polling AI setiap 30 menit. Bila platform belum mendukung webhook inbound/trigger, gunakan fallback manual/berdasarkan kebutuhan yang transparan, bukan polling rapat yang terus berjalan.
7. **Tetap ada approval manusia:** keputusan topik dan final tetap PM. Telegram group tidak boleh membuka aksi publish otomatis atau memberikan hak PM kepada agen.

## Mengapa satu bot gateway lebih dahulu

- Lebih sedikit token bot, secret, webhook, dan konfigurasi operasional.
- Satu kontrol akses dan satu audit trail.
- Pesan agen dapat dibedakan melalui identitas logis tanpa berpura-pura sebagai akun Telegram berbeda.
- Lebih mudah mencegah loop diskusi, spam, dan ledakan biaya.

Telegram memiliki mekanisme Bot-to-Bot Communication Mode dalam kondisi tertentu. Kita tidak mengandalkan fitur itu pada tahap pertama karena menambah kompleksitas identitas, pengaturan BotFather, privacy, dan routing. Opsi multi-bot dapat dievaluasi lagi bila ada kebutuhan operasional yang jelas.

## Kontrak interaksi awal yang dituju

Perintah konseptual (detail implementasi akan ditentukan pada PR teknis):

- `/ask strategist <pertanyaan>` — meminta satu agen menjawab.
- `/ask ceo <instruksi>` — meminta CEO mengorkestrasi pekerjaan.
- `/discuss <topik>` — meminta CEO memilih role yang relevan dan memoderasi diskusi singkat.
- `/status` — ringkasan antrean, video, dan approval dari D1 tanpa membangunkan agen.
- `/approve <approval_id>` dan `/reject <approval_id>` — keputusan PM yang diverifikasi dengan Telegram user ID dan chat ID yang diizinkan.

Semua perintah harus dibatasi ke grup/chat ID dan user ID PM yang dikonfigurasi. Bot sebaiknya tetap dalam privacy mode dan hanya memproses command/mention/reply yang ditujukan kepadanya; tidak perlu membaca seluruh percakapan umum. Jangan pernah meminta atau menampilkan API key, token, atau kredensial di grup.

## Batasan dan risiko yang harus diuji

- Tidak semua aplikasi Cue/Muse pasti mendukung webhook inbound untuk memulai sesi. Ini harus dibuktikan per platform sebelum jadwal polling dimatikan.
- Manus memiliki dokumentasi webhook untuk task lifecycle API dan Automation trigger, tetapi event webhook dan pemicu AI agent harus dibedakan; dukungan webhook bukan bukti otomatis bahwa setiap akun Muse/Cue dapat dibangunkan.
- Telegram bot API memiliki aturan privacy dan komunikasi antarbot. Tahap pertama menggunakan satu bot gateway agar routing dan kontrol tetap sederhana.
- Group chat berisiko prompt injection dari anggota/pesan/berkas. Semua isi grup dianggap data tidak tepercaya; perintah hanya diproses dari pengirim yang diizinkan dan melalui parser command terstruktur.
- Diskusi multi-agen perlu batas jumlah giliran, timeout, deduplikasi event, idempotency key, rate limit, dan batas biaya/token.
- Jangan mengirim semua pesan grup ke semua agen. Hanya pesan yang secara eksplisit diarahkan memicu AI.

## Tahapan implementasi

### P0 — Dokumentasi keputusan
Catat ADR ini. Tidak mengubah sistem produksi.

### P1 — Chat Gateway inti
- Buat skema percakapan, peserta/role, message routing, dan audit.
- Buat API yang mengakses Hub dengan permission per role; jangan meneruskan kredensial agen ke browser/Telegram.
- Dukung direct ask, status non-AI, dan diskusi termoderasi.
- Tambahkan idempotency, rate limit, batas giliran, dan cost budget.

### P2 — Telegram shared group
- Satu bot gateway dan satu grup privat khusus.
- Allowlist chat ID dan Telegram user ID PM.
- Command/mention/reply eksplisit; privacy mode tidak perlu dimatikan.
- Tampilkan setiap respons dengan label agen, task ID, dan status.
- Approval tetap memvalidasi identitas PM dan tahap video.

### P3 — Event-driven wake-up
- Tambahkan transactional outbox/dispatch record di D1 agar task dan event tidak hilang jika webhook gagal.
- Dispatcher mengirim webhook hanya saat ada pekerjaan untuk role terkait.
- Retry dengan backoff, deduplikasi, dead-letter state, dan notifikasi kegagalan.
- Buktikan trigger/wake-up untuk Manus/Cue dan Muse secara terpisah.
- Jika platform tidak mendukung wake-up otomatis, sediakan fallback manual atau pemicu saat pengguna memulai chat; jangan mengganti polling 30-menit dengan polling lain yang lebih sering.

### P4 — Web chat untuk semua agen
- Antarmuka chat menggunakan Chat Gateway dan session routing yang sama dengan Telegram.
- PM dapat memilih satu agen atau mode diskusi.
- Identitas dan izin agen tetap ditegakkan di backend.

### P5 — Evaluasi A2A (ditunda)
A2A baru ditambahkan sebagai adapter ketika:
- ada agen eksternal yang perlu ditemukan/dipanggil melalui Agent Card;
- platform target secara nyata mendukung A2A versi yang disepakati;
- ada kebutuhan interoperabilitas yang tidak cukup dipenuhi MCP/Chat Gateway;
- uji keamanan, otorisasi, task mapping, dan biaya lolos.

Jika kelak ditambahkan, MCP tetap tersedia untuk tool access. A2A bukan pengganti task engine D1, izin, audit, atau approval PM.

## Kriteria penerimaan

- PM dapat menghubungi CEO dan masing-masing role dari satu antarmuka chat.
- PM dapat memulai diskusi terbatas antar-role dan membaca respons dengan identitas logis yang jelas.
- Telegram grup hanya menerima instruksi dari PM yang diizinkan.
- Pesan biasa yang tidak diarahkan tidak membangunkan agen.
- Task dan seluruh pesan/ringkasan penting tercatat di D1.
- Duplicate webhook tidak menghasilkan task/sesi ganda.
- Agen tidak dapat menyetujui atau memublikasikan konten atas nama PM.
- Sistem tetap berjalan bila satu platform agen tidak mendukung webhook.
- Tidak ada polling AI berulang hanya untuk memeriksa inbox kosong.

## Referensi

- A2A Protocol: https://a2a-protocol.org/latest/specification/
- Telegram Bot Features: https://core.telegram.org/bots/features
- Telegram Bot FAQ: https://core.telegram.org/bots/faq
- Manus Automations: https://www.manus.im/id/features/automations
- Manus Webhooks: https://open.manus.ai/docs/v2/webhooks-overview
