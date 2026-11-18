# Telegram Group Chat Gateway — tahap pertama

Status: implementasi tahap pertama. Worker membuat task chat terkendali dan mem-posting hasil selesai ke Telegram. Adapter wake-up platform belum diaktifkan.

## Fitur setelah deploy

- `/bind`: PM mengikat grup privat pertama ke Hub satu kali.
- `/help`: daftar perintah.
- `/agents`: daftar role dan akun.
- `/status`: ringkasan antrean, video, approval (baca D1, tanpa model AI).
- `/ask <role> <pertanyaan>`: mengirim pertanyaan sebagai task ke CEO atau satu agen spesialis.
- `/discuss <topik>`: task ke CEO; CEO diminta memilih maksimal tiga spesialis dan menyusun sintesis.
- `/approvals`, `/approve <id>`, `/reject <id> <catatan>`: keputusan PM.
- Hasil `submit_result` dari task Telegram disimpan di D1 dan dikirim kembali ke grup dengan label role.

Hanya Telegram user ID PM yang boleh menjalankan perintah. Hanya grup yang sudah di-bind diterima. Pesan biasa, lampiran, anggota lain, dan pesan bot diabaikan. Privacy mode tetap aktif; arahkan command dengan `/command@NamaBot`.

## Secrets Cloudflare

Tambahkan Worker Secrets berikut (jangan pernah bagikan nilainya di chat):

- `TELEGRAM_BOT_TOKEN`: token dari BotFather.
- `TELEGRAM_PM_USER_ID`: numeric Telegram user ID PM.
- `TELEGRAM_WEBHOOK_SECRET`: secret acak untuk header webhook Telegram.

`TELEGRAM_PM_CHAT_ID` opsional sebagai fallback private chat. `TELEGRAM_GROUP_CHAT_ID` juga opsional; cara yang disarankan adalah membiarkan kosong lalu menjalankan `/bind@NamaBot` dari grup. ID grup disimpan di D1.

## Setup

1. Buat grup/supergroup privat khusus Content-Automation.
2. Tambahkan bot gateway ke grup. Bot tidak perlu admin untuk membaca command yang ditujukan kepadanya dan mengirim balasan.
3. Biarkan privacy mode aktif.
4. Dari akun PM, kirim `/bind@NamaBot` ke grup.
5. Atur webhook Telegram ke `https://content-automation-hub.midzpribadi.workers.dev/telegram/webhook`, dengan `secret_token` sama persis seperti Worker Secret `TELEGRAM_WEBHOOK_SECRET`.
6. Sertakan `allowed_updates` `message` dan `callback_query` pada `setWebhook`.
7. Ketik `/help@NamaBot`.

Contoh JSON body untuk Telegram Bot API `setWebhook` (isi secret secara lokal, jangan bagikan):

```json
{
  "url": "https://content-automation-hub.midzpribadi.workers.dev/telegram/webhook",
  "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
  "allowed_updates": ["message", "callback_query"]
}
```

## Batasan aktivasi agen

Membuat task ke D1 **belum sama dengan membangunkan aplikasi AI secara otomatis**. Worker tidak dapat memaksa aplikasi Cue/Muse membuka sesi hanya melalui MCP. Sampai adapter wake-up tiap platform diuji, task `/ask` dan `/discuss` tetap membutuhkan agen aktif atau mekanisme trigger platform yang sudah dikonfirmasi.

Jangan mengaktifkan polling AI tiap 30 menit sebagai fallback. Pesan biasa tidak memicu AI. Hanya perintah eksplisit PM membuat task. `/status` dan `/agents` hanya membaca database.

## Keamanan

- Jangan meneruskan semua pesan grup ke prompt agen. Hanya command eksplisit PM yang diproses.
- Isi pesan, file, dan URL tetap data tidak tepercaya.
- Diskusi CEO maksimal tiga spesialis pada tahap pertama.
- Deduplikasi webhook memakai pasangan chat ID + message ID untuk mencegah retry Telegram membuat task ganda; gateway tetap dibatasi pada PM dan satu grup privat.
- Approval hanya oleh PM dengan Telegram user ID yang cocok.
- Tidak ada fitur publish TikTok.
