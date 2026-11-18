# Uji integrasi produksi terisolasi

Workflow: **Actions → Content Automation Production E2E → Run workflow**.

Workflow memakai repository secret \`CLOUDFLARE_API_TOKEN\` yang sudah dipakai workflow deployment, dengan izin Workers Editor dan D1 Edit.

## Cakupan

- Health Worker, koneksi D1, dan binding R2.
- Endpoint PM tanpa autentikasi harus menolak permintaan dengan HTTP 401.
- MCP Streamable HTTP: initialize, daftar tool, dan identitas agen CEO.
- Tool \`create_video\` dan \`request_approval\`, serta persistensi state ke D1.

## Isolasi dan pembersihan

Run membuat satu agen CEO sementara dengan API key acak satu kali, satu video bertanda \`E2E QA ONLY\`, dan satu approval topik. Setelah tes, workflow menghapus agen, video, approval, event audit, dan tabel anak yang terkait. Nilai key tidak dicetak dan tidak mengganti tujuh akun agen aktif.

## Batas cakupan

Ini adalah smoke test API/MCP dan persistensi. Tes ini belum merender MP4, belum mengunggah byte ke R2, belum melakukan keputusan approval memakai PM_TOKEN, dan tidak memublikasikan TikTok. Pengujian render dan upload membutuhkan keterlibatan agen Cue/Muse serta artefak nyata.
