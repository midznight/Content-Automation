# Deploy Automation-Content Hub ke VPS

Dokumen ini menyiapkan **M1 Hub inti** sebagai layanan uji integrasi Muse/Cue. Ini bukan pernyataan bahwa seluruh pipeline produksi sudah selesai. Fitur M3 (artefak dan penyimpanan S3-compatible, Telegram approvals, failover pipeline), M4 bake-off, M5 dashboard baca, backup off-site terjadwal, dan uji integrasi nyata masih merupakan gerbang sebelum operasional harian.

## 1. Infrastruktur yang dibutuhkan

Gunakan VPS Linux Ubuntu LTS dengan Docker Engine + Docker Compose Plugin, alamat IPv4 publik, dan domain/subdomain yang memang disediakan khusus untuk Automation-Content.

Rekomendasi awal: **2 vCPU / 4 GiB RAM / 80 GiB SSD di Singapore**. Sebagai patokan harga, DigitalOcean Basic Droplet dengan ukuran 4 GiB / 2 vCPU / 80 GiB tercantum **US$24/bulan**; datacenter Singapore tersedia sebagai region `SGP1`. Harga tidak termasuk domain, backup tambahan, atau storage artefak. Pakai VPS yang sudah dimiliki bila kapasitas dan kontrolnya memadai.

- Harga: https://www.digitalocean.com/pricing/droplets
- Region: https://docs.digitalocean.com/platform/regional-availability/
- Docker Engine: https://docs.docker.com/engine/install/ubuntu/
- Docker Compose: https://docs.docker.com/compose/install/linux/

## 2. DNS dan firewall

Buat DNS `A` record untuk hostname khusus Automation-Content yang mengarah ke IPv4 VPS. Contoh dokumentasi: `content-hub.example.com`; ganti dengan domain Anda sendiri. Jangan menggunakan hostname atau database Automation-Business.

Buka hanya port:
- TCP 22 untuk SSH (batasi alamat sumber bila memungkinkan).
- TCP 80 dan 443 untuk Caddy/HTTPS.
- Jangan membuka port 8000 ke internet. MCP hanya diekspos melalui Caddy.

Caddy meminta dan memperbarui sertifikat HTTPS otomatis. Bila memakai Cloudflare DNS proxy, selesaikan validasi/konfigurasi TLS sesuai mode proxy; konfigurasi paling sederhana untuk bootstrap adalah DNS-only sampai sertifikat Caddy aktif.

## 3. Siapkan direktori di VPS

Buat akun deploy tersendiri (jangan gunakan login root untuk workflow). Instal Docker Engine dan Compose Plugin sesuai dokumentasi resmi. Akun deploy perlu menjalankan Docker; keanggotaan grup `docker` setara dengan hak root pada host, jadi batasi siapa yang dapat memakai akun dan kuncinya.

Clone repository publik ini ke path tetap, misalnya:

```bash
sudo mkdir -p /opt/automation-content
sudo chown "$USER":"$USER" /opt/automation-content
git clone --branch main https://github.com/midznight/Content-Automation.git /opt/automation-content
cd /opt/automation-content/sistem-agen
```

Siapkan konfigurasi runtime dan volume database:

```bash
cp .env.example .env
nano .env
mkdir -p data
sudo chown -R 10001:10001 data
chmod 700 data
```

Isi `.env` dengan hostname sebenarnya:

```dotenv
DOMAIN=content-domain-anda.example
MCP_ALLOWED_HOSTS=content-domain-anda.example,content-domain-anda.example:*
MCP_ALLOWED_ORIGINS=
ACME_EMAIL=email-anda@example.com
```

Jangan commit `.env`. Jangan memasukkan API key agen, private key SSH, token Telegram, atau kredensial storage ke GitHub source.

## 4. Deploy pertama kali secara manual

Dari `/opt/automation-content/sistem-agen`:

```bash
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 hub caddy
```

Saat container mulai, Alembic menjalankan migrasi `upgrade head` terhadap `DATABASE_URL=sqlite:////data/hub.db`. Database runtime berada di direktori persisten `sistem-agen/data/`, bukan file `hub.db` yang ikut terunggah ke source repository. Endpoint kesehatan:

- `https://DOMAIN-ANDA/health`
- MCP Streamable HTTP: `https://DOMAIN-ANDA/mcp`

Health endpoint publik hanya untuk pemeriksaan status. Tool MCP memerlukan API key agen pada header `Authorization: Bearer ...` atau `X-API-Key`.

Buat agen melalui CLI di dalam container. Contoh CEO Cue:

```bash
docker compose exec hub python -m hub.admin create-agent cue_ceo ceo --vendor cue
```

Kunci mentah hanya ditampilkan satu kali. Masukkan langsung ke secure credential store platform agen; jangan kirim ke chat, issue, log, atau file repository. Daftar agen tanpa kunci:

```bash
docker compose exec hub python -m hub.admin list-agents
```

## 5. Aktifkan automatic deployment dari GitHub

Workflow `.github/workflows/content-hub.yml` menjalankan:
1. Install package Python 3.12 dan dependensi dev.
2. `pytest -q`.
3. `ruff check .` dan `ruff format --check .`.
4. Validasi konfigurasi Docker Compose dan build image.
5. Untuk push ke `main` setelah semua tes lulus, SSH ke VPS lalu `git pull --ff-only` dan rebuild/restart Compose.

Di GitHub, buat **Settings → Environments → New environment** dengan nama tepat `production`; batasi deployment branch ke `main`. Simpan secrets berikut di environment `production`:

| Secret | Isi |
|---|---|
| `VPS_HOST` | IPv4 atau hostname VPS |
| `VPS_SSH_PORT` | Port SSH (biasanya `22`) |
| `VPS_SSH_USER` | Akun deploy khusus |
| `VPS_SSH_PRIVATE_KEY` | Private key khusus untuk GitHub Actions |
| `VPS_KNOWN_HOSTS` | Baris host key SSH yang telah diverifikasi |
| `VPS_DEPLOY_PATH` | Path absolut repo, misalnya `/opt/automation-content` |

Tambahkan public key pasangannya ke `~/.ssh/authorized_keys` milik akun deploy. Isi `VPS_KNOWN_HOSTS` dari host key VPS yang fingerprint-nya telah diverifikasi melalui console provider; jangan mempercayai hasil `ssh-keyscan` tanpa verifikasi. Workflow menggunakan StrictHostKeyChecking dan tidak menonaktifkan pemeriksaan host.

Job deploy memakai GitHub Environment `production`, sehingga secrets hanya tersedia di job deployment. Setelah semua secret ada, push ke `main` akan deploy otomatis **hanya sesudah tes, lint, validasi Compose, Docker image build, serta smoke test container dan migrasi SQLite sukses**. Pull request tidak pernah menerima secrets production. Bila secret deployment belum lengkap, workflow sengaja melewati langkah deploy dan memberi notice; validasi CI tetap berjalan. Pull request dan branch fitur tidak mengubah VPS production.

## 6. Operasi, backup, dan status kesiapan

- Database SQLite WAL hanya disimpan di `sistem-agen/data/`; jangan menghapus folder itu ketika memperbarui container.
- Saat ini belum ada backup off-site terjadwal yang terpasang. Sebelum menyimpan data kerja nyata, implementasikan backup SQLite konsisten (SQLite backup API / `.backup`) ke penyimpanan S3-compatible terpisah dan uji restore. Simpan sekurangnya 14 hari sesuai spesifikasi.
- Artefak video besar, signed upload/download S3, Telegram notifications/approvals, pipeline state machine video, dan dashboard belum tersedia pada M1 ini. Jangan mengaktifkan 7 agen untuk produksi harian hanya karena `/health` merespons.
- Ketika ada perubahan skema selanjutnya, buat migration Alembic baru dan pastikan CI serta backup/restore diuji sebelum deploy.
- Revoke/rotate API key agen melalui `python -m hub.admin revoke-agent` / `rotate-key` bila key diduga bocor.

## 7. Rollback aplikasi

Simpan commit deployment terakhir pada catatan rilis. Untuk kembali ke versi source sebelumnya, checkout commit yang diketahui aman pada VPS lalu jalankan:

```bash
cd /opt/automation-content
git checkout <commit-sha-yang-diketahui-aman>
cd sistem-agen
docker compose build --pull hub
docker compose up -d --remove-orphans
```

Rollback source tidak membatalkan perubahan database. Ambil backup valid sebelum menjalankan migration yang mengubah skema.
