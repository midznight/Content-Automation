# Cue Agent Wake-up — Manus API

Dokumen ini menjelaskan adapter untuk membangunkan sesi persisten Cue (CEO dan Animator) ketika task Hub berstatus queued.

## Cara kerja

1. Hub membuat task di D1 dan catatan outbox agent_dispatches dalam batch yang sama.
2. Worker mengirim task.sendMessage ke task_id utama milik Cue agent melalui Manus API.
3. Pesan meminta sesi Cue memakai konektor MCP Hub yang sudah ada, mengambil task ID yang tepat dari inbox, melakukan claim, memproses, lalu submit_result.
4. Hasil tetap dikirim kembali oleh MCP Hub ke grup Telegram.
5. Outbox menyimpan status, jumlah percobaan, dan error yang aman. Cron 15 menit mencoba ulang pengiriman sementara yang gagal.

Adapter tidak mengirim instruksi ke akun Cue melalui Telegram dan tidak membuat task Manus baru. Ia mengirim pesan lanjutan ke main task milik agent yang sudah ada. Request task.sendMessage sengaja tidak menyertakan message.connectors, agar pilihan konektor pada sesi persisten tidak diganti.

## Konfigurasi

Worker Secret:
- MANUS_API_KEY — API key akun Manus yang memiliki akses ke Cue agent.

Worker variable:
- MANUS_CEO_TASK_ID — nilai task_id dari agent Cue CEO pada agent.list.
- MANUS_ANIMATOR_TASK_ID — opsional; nilai task_id utama untuk Cue Animator.

Gunakan task_id milik agent, bukan agent.id. Dalam dokumentasi Manus, task_id adalah percakapan utama persisten agent dan memang menjadi target task.sendMessage.

Cara mengambil daftar agent dari PowerShell (API key dimasukkan secara tersembunyi, tidak perlu dibagikan ke chat):

~~~powershell
$secure = Read-Host "Manus API key" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $manusKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    $response = Invoke-RestMethod -Method Get -Uri "https://api.manus.ai/v2/agent.list" -Headers @{ "x-manus-api-key" = $manusKey }
    $response.data | Select-Object nickname, task_id, about | Format-Table -AutoSize
}
finally {
    if ($ptr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
    Remove-Variable manusKey -ErrorAction SilentlyContinue
    $secure.Dispose()
}
~~~

Simpan API key sebagai Worker Secret dan task ID sebagai Worker variable melalui Cloudflare Dashboard → Workers & Pages → content-automation-hub → Settings → Variables and Secrets. Deploy setelah menyimpan perubahan.

## Perintah operasional

- /ask ceo <pertanyaan> — buat task dan kirim wake-up ke Cue CEO.
- /discuss <topik> — buat task diskusi untuk CEO dan kirim wake-up.
- /wake <hub_task_id> — kirim ulang wake-up untuk task Cue yang masih queued, termasuk task yang dibuat sebelum adapter diaktifkan.
- /status — tetap hanya membaca D1, tanpa memanggil AI.

Role Muse belum dikirimi wake-up otomatis oleh adapter ini. Task mereka tetap masuk antrean Hub sampai integrasi pemicu Muse yang didukung resmi tersedia. Jangan menganggap task yang berstatus queued telah dikerjakan.

## Arti status dispatch

- pending / retry — menunggu pengiriman atau percobaan ulang.
- sending — Worker sedang memanggil Manus API.
- dispatched — Manus API menerima pesan wake-up; ini bukan bukti task Hub sudah selesai.
- awaiting_config — API key atau task ID utama belum disetel.
- failed — pengiriman gagal permanen atau batas retry tercapai.

Keberhasilan proses baru terbukti saat task Hub berubah ke claimed lalu done / blocked / failed melalui MCP.

## Biaya dan batasan

Cloudflare D1/outbox dan Cron tidak menjalankan model AI. Namun pesan yang membangunkan Cue akan membuat Manus melanjutkan eksekusi agent dan dapat menggunakan kuota/kredit akun Manus sesuai paket dan penggunaan. Dispatch hanya dilakukan ketika task baru atau retry eksplisit diperlukan; tidak ada polling AI berkala untuk inbox kosong.

## Referensi resmi

- https://open.manus.ai/docs/v2/agents-overview
- https://open.manus.ai/docs/v2/agent.list
- https://open.manus.ai/docs/v2/task.sendMessage
