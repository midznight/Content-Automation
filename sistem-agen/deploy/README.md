# Jalankan Automation-Content Hub dengan biaya Rp0

Dokumen ini memilih jalur paling sederhana untuk pemula yang belum memiliki modal: **jalankan Hub pada PC Windows yang sudah dimiliki**, lalu buat URL publik sementara dengan Cloudflare Quick Tunnel. Tidak ada VPS, domain berbayar, kartu pembayaran, atau Docker Desktop yang wajib dibeli.

## Yang gratis dan batasannya

| Komponen | Cara pakai | Biaya |
|---|---|---:|
| GitHub repository | Source code dan riwayat perubahan | Rp0 |
| GitHub Actions | Tes dan build pada repository publik | Rp0 untuk standard hosted runners public repo |
| Python 3.12 | Menjalankan Hub di PC | Rp0 |
| Cloudflare Quick Tunnel | HTTPS sementara dari internet ke PC lokal | Rp0 |
| SQLite | Database tersimpan di disk PC sendiri | Rp0 |
| Domain/VPS | Tidak digunakan pada jalur ini | Rp0 |

**Kompromi penting:** ini adalah hosting dari PC sendiri, bukan server cloud 24/7. PC, listrik, dan koneksi internet harus aktif saat agen Muse/Cue membutuhkan Hub. Ketika PC mati, tidur, atau internet terputus, Hub tidak bisa dijangkau.

Quick Tunnel membuat URL acak *.trycloudflare.com; URL berganti setiap kali tunnel dibuat ulang, tidak memiliki uptime guarantee, dan tidak mendukung SSE. Karena itu Hub dikonfigurasi untuk mengirim respons MCP JSON pada pemanggilan tool. Kecocokan konfigurasi JSON ini tetap harus dibuktikan dengan uji koneksi Muse dan Cue yang benar-benar dipakai.

## 1. Persiapan satu kali di Windows

Pasang:
1. **Python 3.12**: https://www.python.org/downloads/windows/ (aktifkan Python Launcher saat instalasi).
2. **Git for Windows**: https://git-scm.com/download/win
3. **cloudflared**: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

Tidak perlu membuat akun Oracle, Render, Railway, VPS, atau membeli domain untuk jalur ini.

## 2. Ambil source proyek

Buka PowerShell:

    git clone https://github.com/midznight/Content-Automation.git
    cd Content-Automation\sistem-agen

Untuk update berikutnya:

    cd ..\..
    git pull --ff-only origin main
    cd sistem-agen

## 3. Jalankan Hub + tunnel

Dari folder sistem-agen:

    Set-ExecutionPolicy -Scope Process Bypass
    .\Start-ContentHub.ps1

Script akan:
- Membuat virtual environment Python lokal.
- Memasang dependensi proyek.
- Membuat folder data dan database data\hub.db (data tetap tersimpan di PC).
- Menjalankan migrasi Alembic.
- Membuat Cloudflare Quick Tunnel.
- Membatasi Host header hanya ke URL tunnel yang dibuat dan localhost.
- Menjalankan FastAPI + MCP pada 127.0.0.1.

Setelah siap, PowerShell menampilkan URL, misalnya:

    https://nama-acak.trycloudflare.com/mcp

Gunakan URL yang benar-benar ditampilkan oleh script, bukan contoh di atas. Biarkan jendela PowerShell tetap terbuka selama Hub digunakan. Tekan Ctrl+C untuk menghentikan server dan tunnel.

## 4. Buat identitas agen dan simpan kunci

Buka PowerShell kedua, masuk ke folder yang sama, lalu buat kunci CEO:

    .\.venv\Scripts\python.exe -m hub.admin create-agent cue_ceo ceo --vendor cue

Buat pula identitas untuk setiap agen Muse/Cue yang akan diuji menggunakan role yang sesuai. Simpan masing-masing kunci langsung ke secure credential store platform agen. Jangan kirim kunci melalui chat, issue GitHub, atau file repository.

Daftar agen tanpa menampilkan kunci:

    .\.venv\Scripts\python.exe -m hub.admin list-agents

Endpoint konektor ialah URL tunnel yang ditampilkan + /mcp. Setiap agen memakai API key masing-masing melalui Authorization: Bearer <kunci> atau X-API-Key.

## 5. URL, keamanan, dan batas operasional

- Quick Tunnel bersifat publik. Siapa pun yang mengetahui URL bisa mencapai endpoint, tetapi tool tetap memerlukan API key agen yang valid.
- Gunakan kunci berbeda untuk tiap agen. Cabut dan rotasi kunci jika bocor.
- Jangan menaruh database atau file .env ke GitHub. Database lokal berada di data\hub.db.
- Jangan biarkan Windows sleep saat Hub harus melayani agen.
- URL acak berubah saat tunnel dihentikan atau dijalankan ulang; perbarui URL pada semua konektor Muse/Cue sesudahnya.
- Quick Tunnel ditujukan untuk development/testing dan tidak memberi jaminan uptime.
- Belum ada backup cloud otomatis pada jalur ini. Salin data\hub.db ke media lain secara berkala ketika Hub sudah dihentikan dengan benar.
- Sebelum operasi konten nyata, selesaikan T1/T2/T3 yang relevan dan milestone pipeline berikutnya. M1 yang hidup tidak berarti M3-M6 sudah selesai.

## 6. Tes koneksi pertama (wajib sebelum mengandalkan agen)

1. Pastikan https://<URL-TUNNEL>/health menunjukkan database sehat.
2. Sambungkan satu agen CEO dan satu agen Muse menggunakan URL /mcp serta API key masing-masing.
3. Jalankan ping-pong T1: CEO kirim task echo, Muse mengambil, membalas, lalu CEO membaca hasilnya.
4. Uji respons JSON melalui konektor aktual. Quick Tunnel tidak membawa SSE; bila connector Cue/Muse mewajibkan SSE dan gagal dalam negosiasi, jangan lanjutkan produksi. Catat bukti kegagalan dan evaluasi tunnel berkemampuan SSE.
5. Pastikan pemanggilan tanpa key / dengan key salah ditolak.

## 7. Tentang CI otomatis GitHub

Workflow .github/workflows/content-hub.yml hanya menjalankan validasi gratis pada perubahan source: pytest, Ruff, konfigurasi Compose, Docker image build, dan smoke test container + migrasi database. Karena repo ini publik, standard GitHub-hosted Actions runners gratis.

Workflow **tidak** mengontrol PC Windows secara otomatis. Ini disengaja: tidak perlu membuka SSH dari internet, memasang runner yang punya akses ke PC, atau memasukkan credential perangkat pribadi ke GitHub. Untuk memperbarui Hub, jalankan git pull --ff-only origin main, lalu jalankan kembali script.

## 8. Kenapa tidak memakai Render Free untuk database ini?

Render Free web services bisa tidur setelah 15 menit tanpa traffic dan filesystem lokalnya bersifat ephemeral. Database SQLite lokal dapat hilang saat restart, redeploy, atau spin down; karena itu layanan tersebut tidak cocok untuk deployment Hub ini tanpa mengubah database dan menerima batasan layanan gratis.

## 9. Jalur cloud selalu aktif di masa depan (opsional)

Oracle OCI memiliki resource Always Free, tetapi proses pendaftaran mengharuskan kartu kredit/debit yang berfungsi seperti kartu kredit untuk verifikasi dan dapat menimbulkan authorization hold sementara. Itu tidak cocok dijadikan prasyarat untuk deployment Rp0 tanpa kartu. Tidak perlu mendaftar sekarang.

Bila kelak ada komputer/server lain yang bisa dibiarkan menyala, jalur hosting dapat dipindah tanpa mengubah pemisahan proyek. Automation-Content tetap memakai database dan kredensial sendiri, terpisah dari Automation-Business.
