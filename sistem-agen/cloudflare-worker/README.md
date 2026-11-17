# Content-Automation — Cloudflare Worker + D1

Backend cloud terpisah untuk proyek Content-Automation. Tidak menggunakan Worker, database, domain, atau kredensial Automation-Business maupun Seiton.

## Komponen

- Cloudflare Worker: `content-automation-hub`
- D1: `content-automation-hub-prod` (APAC)
- MCP: Cloudflare Agents SDK dan MCP SDK v2, Streamable HTTP di `/mcp`
- Database: tabel agents, videos, tasks, artifacts, approvals, events, metrics, dan rate_limits
- Autentikasi: API key per agen; hanya hash SHA-256 yang disimpan di D1
- Admin API: dilindungi oleh secret `ADMIN_TOKEN`

## Lokasi endpoint

Setelah Worker dideploy, endpoint MCP menggunakan:

`https://content-automation-hub.midzpribadi.workers.dev/mcp`

URL health:

`https://content-automation-hub.midzpribadi.workers.dev/health`

## Deployment dan migrasi pertama

Konfigurasi `wrangler.toml` sudah menunjuk ke D1 khusus Content-Automation. Jalankan perintah dari folder ini setelah autentikasi Cloudflare tersedia:

```bash
npm install
npm run check
npx wrangler d1 migrations apply content-automation-hub-prod --remote
npx wrangler deploy
```

Alternatif deploy otomatis: hubungkan repository GitHub `midznight/Content-Automation` melalui Cloudflare Workers Builds, lalu set build root directory ke `sistem-agen/cloudflare-worker`. Jalankan migrasi D1 pertama kali secara terpisah sebelum agen digunakan. Setiap perubahan berikutnya pada folder migrations harus diterapkan ke database target sebelum fitur yang memerlukannya diaktifkan.

## Secret admin

Tambahkan `ADMIN_TOKEN` sebagai **secret** di pengaturan Worker Cloudflare. Buat token acak panjang dan jangan simpan nilainya di GitHub atau di chat. Tanpa secret ini, endpoint admin akan menolak semua permintaan.

## Admin API

Semua endpoint admin memerlukan salah satu header berikut:

- `Authorization: Bearer <ADMIN_TOKEN>`
- `X-Admin-Token: <ADMIN_TOKEN>`

Buat agen (kunci mentah hanya dikembalikan satu kali):

```http
POST /admin/agents
Content-Type: application/json

{"name":"cue-ceo","role":"ceo","vendor":"cue"}
```

Daftar agen (tidak mengembalikan key atau hash):

```http
GET /admin/agents
```

Cabut akses agen:

```http
POST /admin/agents/cue-ceo/revoke
```

Rotasi kunci:

```http
POST /admin/agents/cue-ceo/rotate
```

Nama dan role untuk 7 akun produksi harus ditentukan sebelum provisioning. Jangan membagikan satu API key ke beberapa agen.

## MCP tools

Worker mempertahankan enam tool baseline:

- `whoami`
- `inbox`
- `claim_task`
- `submit_result`
- `send_task`
- `list_tasks`

Role permissions, task routing, serta transisi status mengikuti implementasi Python baseline. Klaim tugas dan penulisan event dilakukan di D1 batch yang sama agar tidak terjadi klaim ganda dan event status tidak terpisah dari perubahan status.

## Uji dan keterbatasan

- `npm run check` menjalankan uji matriks izin dan pemeriksaan TypeScript.
- Workflow GitHub tetap menjalankan pytest dan Ruff untuk aplikasi Python lokal.
- Uji integrasi wajib dilakukan terhadap endpoint Worker sebenarnya: MCP discovery/list tools, whoami per agen, kirim/claim/submit task, akses ditolak, rate limit, dan admin provisioning.
- Endpoint ini menangani orkestrasi dan metadata tugas. Pembuatan/render video tetap dilakukan oleh aplikasi/agen eksternal; jangan menjalankan proses video berat di Worker.
- Workers Free memiliki batas CPU 10 ms per request dan 100.000 request per hari; pantau pemakaian serta kuota D1 sebelum produksi. Layanan gratis bukan jaminan biaya nol bila kuota terlampaui atau fitur berbayar diaktifkan.
- Worker hanya menerima permintaan MCP POST di `/mcp` dan mengharuskan API key di header `Authorization: Bearer` atau `X-API-Key`. Pastikan connector Cue/Muse mendukung header autentikasi dan Streamable HTTP.
- Aplikasi Python dan launcher lokal tetap disimpan sebagai jalur pengembangan/cadangan sampai kompatibilitas Cue dan Muse terbukti.
