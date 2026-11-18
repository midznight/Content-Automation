# Content-Automation — Cloudflare Worker + D1 + R2

Backend cloud untuk proyek **Content-Automation**. Repositori, Worker, D1, R2, kredensial, dan alur deploy proyek ini terpisah dari Automation-Business dan Seiton.

## Infrastruktur

- Worker: `content-automation-hub`
- URL: `https://content-automation-hub.midzpribadi.workers.dev`
- MCP Streamable HTTP: `/mcp`
- Health: `/health`
- D1: `content-automation-hub-prod` (database khusus Content-Automation, APAC)
- R2: `content-automation-artifacts-prod` (bucket khusus Content-Automation, APAC)
- Autentikasi agen: satu API key per agen; hanya hash SHA-256 disimpan di D1
- Admin provisioning: secret `ADMIN_TOKEN`
- Persetujuan PM: secret terpisah `PM_TOKEN`
- Audit: tabel `events` append-only

Bucket R2 telah dibuat. Binding, migration M3, dan tool M3 berada pada branch `feat/m3-production-pipeline` sampai PR ditinjau dan digabung.

## Tool MCP

Tool baseline dan M3:

| Tool | Fungsi |
|---|---|
| `whoami` | Identitas dan role agen |
| `inbox` | Tugas dan notifikasi role |
| `claim_task` | Mengklaim tugas yang ditujukan ke role |
| `submit_result` | Mengirim hasil `done`, `blocked`, atau `failed` |
| `send_task` | Membuat tugas; hanya CEO |
| `list_tasks` | Melihat antrean sesuai role |
| `create_video` | Membuat record produksi; hanya CEO |
| `request_upload` | Membuat sesi upload R2 15 menit |
| `post_artifact` | Mendaftarkan artefak yang sudah diunggah |
| `get_artifact` | Membuat token unduh sekali pakai |
| `request_approval` | Mengajukan persetujuan topik atau hasil akhir; hanya CEO |

MCP tidak menyediakan tool `approve` atau `publish`. Keputusan persetujuan dan pencatatan publikasi hanya melalui endpoint PM yang dilindungi `PM_TOKEN`.

## State machine produksi

Alur video yang ditegakkan oleh Worker:

`topic → awaiting_topic_approval → topic_approved → scripted → fact_checked → animated → packaged → awaiting_approval → approved → published`

- CEO membuat record video dan meminta persetujuan topik PM.
- Setelah topik disetujui, CEO dapat mengirim tugas script.
- Hasil script harus memiliki hook, beats, klaim, dan durasi 10–90 detik.
- Fact-check gate dihitung ulang oleh Hub. `gate_pass` yang dikirim agen diabaikan.
- Render hanya dapat dibuat setelah video `fact_checked`.
- Tugas render hanya dapat selesai jika MP4, SRT, dan cover terdaftar sebagai artefak.
- Paket social harus memiliki caption, 1–8 hashtag, dan teks cover.
- Video final menunggu persetujuan PM. Tidak ada publikasi otomatis.

### Fact-check gate

Untuk setiap klaim inti di script, Fact Checker mengirim verdict `verified` dan minimal dua URL HTTPS dengan hostname berbeda yang ditandai sebagai sumber independen. Worker menghitung ulang jumlah klaim inti yang lolos. Ini merupakan validasi struktur/evidence metadata, **bukan verifikasi kebenaran sumber oleh mesin**; PM tetap meninjau hasil akhir.

## Artefak R2

1. Agen yang sedang memegang tugas memanggil `request_upload` dengan `task_id`, `kind`, `file_name`, `content_type`, `size_bytes`, dan SHA-256 hex.
2. Hub mengembalikan URL PUT, token upload sekali pakai, dan masa berlaku 15 menit.
3. Agen mengunggah langsung ke Worker dengan `X-Upload-Token`, `Content-Type`, dan `Content-Length`. API key agen tidak perlu dikirim pada request PUT kedua.
4. R2 memvalidasi SHA-256 saat menyimpan; Worker meneruskan Request stream tanpa buffering.
5. Agen memanggil `post_artifact` dengan `task_id`, `upload_id`, dan checksum.
6. Download memakai token sekali pakai dari `get_artifact`.

Batas upload Worker yang diterapkan pada aplikasi ini adalah **90 MiB per artefak**. Artefak lebih besar perlu jalur multipart/S3 khusus di milestone berikutnya. Penggunaan R2 tetap tunduk pada kuota dan tarif Cloudflare; Rp0 tidak dijamin bila pemakaian melewati free tier.

## Failover dan jadwal sistem

- Cron setiap 15 menit memeriksa tugas berstatus `claimed` yang tidak diperbarui selama 4 jam.
- Render yang macet pada animator utama otomatis menjadi `superseded` dan dibuat ulang untuk `animator_backup`.
- Render yang macet pada animator cadangan dieskalasi ke CEO/PM, tanpa failover berantai.
- Tugas lain yang macet menjadi `stale`.
- Cron UTC pukul 00.00 membuat satu tugas `daily_report` untuk CEO (07.00 WIB).

## Endpoint PM

Semua endpoint `/pm/*` memerlukan `X-PM-Token: <PM_TOKEN>` atau `Authorization: Bearer <PM_TOKEN>`.

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/pm/approvals` | Daftar persetujuan pending |
| POST | `/pm/approvals/{id}/decision` | JSON `{"decision":"approve"|"reject","note":"..."}` |
| GET | `/pm/videos/{id}` | Status video, artefak, audit, metrik |
| GET | `/pm/artifacts/{id}/download` | Download artefak sebagai PM |
| POST | `/pm/videos/{id}/published` | Catat URL TikTok setelah PM menerbitkan manual |
| POST | `/pm/videos/{id}/metrics` | Simpan metrik window 24h, 72h, atau 7d |

### Secret yang diperlukan

Atur di **Cloudflare Dashboard → Workers & Pages → content-automation-hub → Settings → Variables and Secrets**. Jangan mengirim nilainya melalui chat.

Wajib untuk alur PM API:
- `ADMIN_TOKEN` — sudah dipasang dan dipakai untuk provisioning agen.
- `PM_TOKEN` — token baru yang terpisah untuk endpoint PM.

Opsional untuk notifikasi dan tombol persetujuan Telegram:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_PM_CHAT_ID`
- `TELEGRAM_PM_USER_ID`
- `TELEGRAM_WEBHOOK_SECRET`

Telegram webhook: `https://content-automation-hub.midzpribadi.workers.dev/telegram/webhook`. Webhook memeriksa secret token Telegram, chat ID, dan user ID PM.

## Validasi dan deployment

Workflow `Automation-Content CI` memeriksa Python tests/Ruff, MCP Worker tests, TypeScript, dan `wrangler deploy --dry-run`.

Workflow deploy `.github/workflows/deploy-content-hub.yml` hanya berjalan setelah perubahan Worker masuk ke `main`. Untuk mengaktifkan deploy otomatis, buat GitHub Actions repository secret bernama `CLOUDFLARE_API_TOKEN` dengan scope minimal untuk deploy Worker dan menerapkan migrasi D1. Tanpa secret itu, CI tetap berjalan tetapi deploy sengaja dilewati.

Urutan produksi:
1. Tinjau dan gabungkan PR M3.
2. Pastikan GitHub Actions secret `CLOUDFLARE_API_TOKEN` sudah tersedia.
3. Deploy workflow menerapkan migration D1 remote sebelum mengunggah Worker.
4. Tambahkan `PM_TOKEN` sebagai Cloudflare Worker Secret.
5. Verifikasi `/health`, `/mcp` discovery, 7 identitas agen, permission deny, approval, dan upload/download R2.
6. Baru lakukan satu video uji. Jangan memakai tugas produksi sebelum E2E lolos.

## Batasan yang masih berlaku

- Worker mengorkestrasi agen eksternal; Worker tidak merender video dan tidak menjalankan model AI.
- Pembuatan visual/video dilakukan melalui aplikasi Cue/Muse yang sudah tersambung.
- Tidak ada integrasi TikTok publish otomatis; PM menerbitkan manual dan mencatat URL.
- Dashboard web PM belum termasuk M3; saat ini status video dan metrik dapat dibaca melalui PM API.
- Fact-check gate memeriksa format verdict dan sumber, bukan menilai isi halaman sumber secara otomatis.
- Uji upload R2 dan approval terhadap deployment produksi masih harus dilakukan setelah migration dan secret PM tersedia.
