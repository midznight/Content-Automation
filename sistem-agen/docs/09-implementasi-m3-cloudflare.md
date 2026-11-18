# M3 — Pipeline Produksi Content-Automation (Cloudflare)

## Ruang lingkup

Implementasi M3 menambahkan state machine video, verifikasi struktur script/fact-check, penyimpanan artefak R2, persetujuan PM, failover animator, pemeriksaan tugas stale, notifikasi Telegram opsional, dan laporan harian.

M3 adalah perubahan pada proyek **Content-Automation** saja. Jangan menggunakan database atau Worker Automation-Business.

## Alur satu video

1. Cue CEO memanggil `create_video` setelah memilih topik.
2. Cue CEO memanggil `request_approval(stage=topic)`.
3. PM menyetujui lewat endpoint PM atau tombol Telegram; tahap menjadi `topic_approved`.
4. CEO membuat task `script` untuk Strategist.
5. Strategist mengirim script lewat `submit_result`; Hub memvalidasi hook, beats, klaim, dan durasi, lalu mengubah tahap ke `scripted`.
6. CEO membuat task `fact_check` untuk Fact Checker.
7. Hub mengevaluasi klaim inti dari script terhadap verdict Fact Checker. Setiap klaim inti harus `verified` dan punya sekurangnya dua hostname HTTPS berbeda yang ditandai `independent: true`. Hanya hasil yang lolos mengubah tahap ke `fact_checked`.
8. CEO membuat task `render` untuk Animator.
9. Animator meminta sesi upload untuk MP4, SRT, dan cover; upload langsung ke R2; lalu mendaftarkan setiap artefak dengan `post_artifact`. Setelah ketiganya terdaftar, render dapat diselesaikan dan tahap menjadi `animated`.
10. CEO membuat task `package` untuk Social. Hasil harus mengandung caption, 1–8 hashtag, dan cover_text. Tahap menjadi `packaged`.
11. CEO memanggil `request_approval(stage=final)`. Hub memeriksa artefak dan paket social sebelum tahap menjadi `awaiting_approval`.
12. PM menyetujui atau menolak. Jika disetujui, tahap menjadi `approved`.
13. PM menerbitkan manual di TikTok dan mencatat URL melalui endpoint `/pm/videos/{id}/published`.
14. PM/Analyst dapat mencatat metrik di endpoint PM.

## Kontrak MCP tambahan

### create_video (CEO)
Input: `topic` (5–255 karakter), `pillar` opsional.
Output: `video_id`, tahap `topic`.

### request_upload (pemilik task)
Input:
- `task_id`
- `kind`: `video_mp4`, `subtitle_srt`, `cover_png`, `storyboard`, `source_report`, `caption_pack`
- `file_name`, `content_type`
- `size_bytes`: 1 sampai 90 MiB
- `sha256`: SHA-256 hex 64 karakter atas berkas sumber

Output: URL PUT, token `X-Upload-Token` sekali pakai, Content-Type, batas dan expiry 15 menit.

Upload:
- Method PUT.
- Header `X-Upload-Token`, `Content-Type`, `Content-Length`.
- Body: byte berkas asli.
- Jangan membungkus Request body ke TransformStream sebelum R2 PUT karena R2 memerlukan stream dengan known length.

### post_artifact
Input: `task_id`, `upload_id`, `sha256`.
Output: metadata artefak terdaftar di D1. Unique upload_id mencegah registrasi artefak yang sama dua kali.

### get_artifact
Output: URL unduh dan token `X-Download-Token` sekali pakai, berlaku 15 menit. Token di-hash dalam D1.

## State dan penjaga transisi

| Tahap saat ini | Operasi valid | Tahap berikut |
|---|---|---|
| topic | Permintaan approval topik | awaiting_topic_approval |
| awaiting_topic_approval | PM approve | topic_approved |
| topic_approved | Script valid selesai | scripted |
| scripted | Fact-check lolos | fact_checked |
| fact_checked | Render selesai dan 3 artefak ada | animated |
| animated | Paket social valid | packaged |
| packaged | Permintaan approval final dengan artefak wajib | awaiting_approval |
| awaiting_approval | PM approve | approved |
| approved | PM mencatat URL TikTok | published |

Worker menolak pembuatan task script/fact_check/render/package di tahap yang salah. CEO tidak bisa mengklaim atau menyerahkan hasil atas nama worker; hanya role penerima yang dapat claim/submit tugasnya.

## Fact-check gate: batasan

Hub menghitung sendiri gate berdasarkan objek hasil:
- daftar klaim inti dari hasil script (claim `core: true`);
- verdict dengan `claim_id` yang cocok;
- verdict harus `verified`;
- minimal dua URL HTTPS dengan hostname berbeda dan field `independent: true`.

Nilai `gate_pass` yang ditulis oleh agen diabaikan dan diganti hasil perhitungan Hub. Pemeriksaan ini **tidak meng-fetch atau menilai isi sumber secara mandiri** dan tidak bisa membuktikan sumber benar-benar independen; Fact Checker dan PM tetap harus meninjau substansi sumber.

## R2 upload dan checksum

- Bucket: `content-automation-artifacts-prod`, APAC, Standard.
- Maksimum aplikasi per objek: 90 MiB.
- Masa berlaku sesi: 15 menit.
- SHA-256 diharapkan diberikan sebelum upload; R2 memvalidasi checksum saat `put()` dan metadata checksum disimpan pada objek. Worker hanya meneruskan Request body dengan known length.
- Upload token di-hash pada D1, dipakai satu kali, diikat ke task, agent, dan status claimed.
- Download token di-hash, diikat ke agent yang meminta artefak, dan dipakai satu kali.
- `upload_id` unik pada tabel artifacts mencegah duplikasi saat retry.

## Failover, stale, dan laporan

- Cron `*/15 * * * *` (UTC): periksa tugas `claimed` yang tidak diperbarui selama 4 jam.
- Render stale milik `animator`: task lama menjadi `superseded`, task pengganti dibuat untuk `animator_backup`, audit dua langkah dicatat.
- Render stale milik `animator_backup`: status `stale`, notifikasi eskalasi untuk review CEO/PM; tidak ada failover berulang.
- Task lain stale: ditandai `stale` dan notifikasi.
- Cron `0 0 * * *` UTC: buat satu task `daily_report` ke CEO untuk tanggal UTC saat ini. Waktunya 07.00 Asia/Jakarta.

## Persetujuan PM dan Telegram

Endpoint PM selalu memerlukan `PM_TOKEN`, terpisah dari `ADMIN_TOKEN`.

- `GET /pm/approvals`
- `POST /pm/approvals/{id}/decision` dengan decision `approve` atau `reject`
- `GET /pm/videos/{id}`
- `GET /pm/artifacts/{id}/download`
- `POST /pm/videos/{id}/published`
- `POST /pm/videos/{id}/metrics`

Telegram opsional memakai bot token, chat ID, user ID PM, dan webhook secret. Callback approval diverifikasi dengan secret Telegram, chat ID, dan user ID PM.

## Migrasi dan deployment

1. PR M3 digabung ke main.
2. Tambahkan repository secret `CLOUDFLARE_API_TOKEN` ke GitHub Actions untuk deployment dan migrasi D1.
3. Workflow deploy menerapkan `0002_pipeline_artifacts_approvals.sql` ke D1 remote, lalu deploy Worker.
4. Tambahkan Cloudflare Worker Secret `PM_TOKEN` (token acak baru, berbeda dari ADMIN_TOKEN).
5. Telegram optional: tambahkan `TELEGRAM_BOT_TOKEN`, `TELEGRAM_PM_CHAT_ID`, `TELEGRAM_PM_USER_ID`, `TELEGRAM_WEBHOOK_SECRET` lalu daftarkan webhook ke `/telegram/webhook`.
6. Verifikasi endpoint health, MCP tools, tujuh agen, deny matrix, upload/download, approval, cron failover, dan satu video percobaan.

## Hal yang belum termasuk M3

- Dashboard web PM dan grafik metrik (M5).
- Mesin render video/AI: tetap dijalankan melalui aplikasi Cue/Muse.
- Publish otomatis TikTok: tetap manual oleh PM.
- Upload multipart untuk berkas di atas 90 MiB.
- Crawling/penilaian isi sumber fakta secara independen oleh Hub.
