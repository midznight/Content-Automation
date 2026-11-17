# Spesifikasi Teknis: Hub Multi-Agen

Versi 1.0 · 17 November 2026 · Acuan: `02-prd.md`

## 1. Arsitektur

```
 PM ──Telegram bot (notifikasi, setuju/tolak, /metrik)──┐
 PM ──dashboard baca-saja (M5)───────────────────────────┤
                                                         ▼
 Cue#1 CEO ──┐                                   ┌───────────────┐
 Cue#2 Anim ─┤                                   │      HUB      │
 Muse#1 Str ─┤   MCP streamable HTTP  (/mcp)     │ FastAPI + MCP │
 Muse#2 Fact ┼──────────────────────────────────▶│ SQLite (WAL)  │
 Muse#3 Anal ┤   Authorization: Bearer <kunci>   │ audit log     │
 Muse#4 Soc ─┤                                   └──────┬────────┘
 Muse#5 Bkp ─┘                                          │ URL bertanda tangan
                                                        ▼
                                              Penyimpanan artefak (S3-compatible)
```

Semua agen hanya berbicara dengan hub. Agen tidak pernah berbicara langsung satu sama lain.

## 2. Keputusan teknis dan alasan
| Keputusan | Alasan |
|---|---|
| Hub-and-spoke, CEO sebagai pengarah | Aturan sederhana, satu titik audit, agen pekerja tidak perlu tahu cara memilih tujuan |
| Polling (agen memanggil `inbox`), bukan push | Muse dan Cue tidak punya endpoint masuk yang bisa dipanggil. Satu-satunya arah yang pasti ada adalah agen memanggil tool |
| Kunci API per agen, hash SHA-256 | Cabut satu agen tanpa mengganggu yang lain |
| Terima `Authorization: Bearer` dan `X-API-Key` | Contoh konektor Muse yang terdokumentasi memakai header kunci API; konektor lain memakai bearer |
| SQLite mode WAL | 7 penulis dengan beban kecil. Cadangan sederhana. Migrasi ke Postgres lewat SQLAlchemy |
| Artefak besar lewat URL unggah bertanda tangan | Payload MCP dibatasi 256 KB. Video harus lewat jalur lain |
| Telegram hanya untuk PM, lewat bot milik PM | Agen tidak login ke Telegram, jadi penangguhan akun agen tidak memutus alur |
| Tidak ada tool `publish` | Mencegah aksi publik tanpa persetujuan manusia |

Stack: Python 3.12+, FastAPI, SDK MCP resmi untuk Python (transport streamable HTTP), SQLAlchemy 2.x dengan Alembic, pytest, ruff, Docker Compose, Caddy. Versi dan API SDK diverifikasi dari dokumentasi resmi saat implementasi.

## 3. Alur peristiwa
`send_task` → status `queued` → penerima `claim_task` (`claimed`) → `submit_result` (`done`, `blocked`, atau `failed`). Setiap `submit_result` membuat item inbox untuk ceo bertipe `result_ready`. Bila `blocked` dengan `limit` atau `failed` pada tugas `render`, item bertipe `needs_reassign`.

## 4. Skema data
| Tabel | Kolom utama |
|---|---|
| agents | id, name, role, vendor, key_hash, active, created_at, last_seen_at |
| videos | id, topic, pillar, stage, label_ai, created_at, published_at, tiktok_url |
| tasks | id, parent_id, video_id, type, title, payload (JSON), priority, from_agent, to_agent, status, blocked_reason, result (JSON), attempt, reassigned_from, created_at, claimed_at, updated_at, due_at |
| artifacts | id, task_id, video_id, kind, name, uri, sha256, size_bytes, created_by, created_at |
| approvals | id, video_id, stage, requested_at, decided_at, decision, decided_by, note |
| events | id, ts, actor, action, task_id, video_id, detail (JSON). Append-only |
| metrics | video_id, captured_at, window (24h, 72h, 7d), views, avg_watch_pct, likes, comments, shares, saves, follows |

## 5. Tool MCP
| Tool | Role yang boleh | Input | Output |
|---|---|---|---|
| `whoami` | semua | tanpa | name, role, status akun |
| `inbox` | semua | status (default `queued`), limit | daftar tugas dan item notifikasi untuk peran itu |
| `claim_task` | semua pekerja dan ceo | task_id | tugas lengkap, atau galat bila sudah diambil |
| `submit_result` | pemilik tugas | task_id, status, result, blocked_reason | konfirmasi |
| `send_task` | ceo | to, type, title, payload, video_id, priority, due_at, reassigned_from | task_id |
| `list_tasks` | ceo (semua), lainnya (milik sendiri) | filter status, video_id, type | daftar tugas |
| `request_upload` | semua pekerja | name, size_bytes, content_type | URL PUT bertanda tangan (berlaku 15 menit) dan `upload_id` |
| `post_artifact` | pemilik tugas | task_id, kind, name, teks (maks 256 KB) atau upload_id dan sha256 | artifact_id |
| `get_artifact` | role yang menjadi penerima tugas berikutnya pada video itu | artifact_id | teks atau URL unduh 15 menit |
| `request_approval` | ceo | video_id, stage (`topic` atau `final`), ringkasan | approval_id |

Hanya PM yang bisa menyetujui, lewat Telegram atau dashboard (bukan tool MCP). Hanya PM yang bisa mencatat metrik dan status `published`.

## 6. Matriks izin per role (ditegakkan di `hub/domain/permissions.py`)
| Tipe tugas | Pengirim | Penerima sah |
|---|---|---|
| topic_candidates | ceo | strategist |
| script | ceo | strategist |
| fact_check | ceo | fact_checker |
| render | ceo | animator, animator_backup |
| package | ceo | social |
| metrics_report | ceo atau sistem | analyst |
| daily_report | sistem | ceo |
| echo (hanya untuk uji T1) | ceo | semua role pekerja |

Tipe tugas di luar tabel ditolak. Role pekerja tidak punya hak `send_task`.

## 7. State machine
Tugas: `queued → claimed → done | blocked | failed`. `claimed` lebih dari 4 jam tanpa pembaruan menjadi `stale`. `blocked` atau `failed` pada `render` yang dialihkan menjadi `superseded`.

Video: `topic → scripted → fact_checked → animated → packaged → awaiting_approval → approved → published → analyzed`.

Penjaga transisi:
- `scripted → fact_checked` hanya bila tugas `fact_check` terbaru berstatus `done` dan `result.gate_pass = true`.
- `render` hanya bisa dibuat untuk video berstatus `fact_checked`.
- `awaiting_approval` hanya bila artefak mp4, srt, sampul, dan paket caption semuanya ada dan checksum cocok.
- `approved` hanya dicatat oleh PM.
- Revisi maksimal satu putaran per tahap. Putaran kedua menghasilkan `blocked` dengan `needs_human`.

## 8. Format tugas (amplop)
```json
{
  "task_id": "tsk_01J...",
  "parent_id": null,
  "video_id": "vid_0007",
  "type": "script",
  "title": "Skrip: [judul kerja]",
  "from": "ceo",
  "to": "strategist",
  "priority": "normal",
  "due_at": "2026-11-20T09:00:00+09:00",
  "attempt": 1,
  "reassigned_from": null,
  "payload": {},
  "status": "queued"
}
```

Contoh `result` untuk `script` (agen strategist):
```json
{
  "hook": "Kalimat 3 detik pertama",
  "beats": [
    {"t": "0-3", "narasi": "...", "visual": "...", "teks_layar": "..."}
  ],
  "claims": [
    {"id": "c1", "text": "Klaim inti yang bisa diverifikasi", "core": true}
  ],
  "cta": "...",
  "durasi_detik": 42,
  "risk_flags": [],
  "notes": ""
}
```

Contoh `result` untuk `fact_check` (agen fact_checker):
```json
{
  "verdicts": [
    {"claim_id": "c1", "verdict": "verified",
     "sources": [
       {"title": "...", "url": "...", "publisher": "...", "date": "2024-05-01", "independent": true},
       {"title": "...", "url": "...", "publisher": "...", "date": "2023-11-12", "independent": true}
     ],
     "note": "Ringkasan bukti dengan kata sendiri"}
  ],
  "gate_pass": true,
  "notes": ""
}
```
`gate_pass` bernilai `true` bila semua klaim `core` berstatus `verified`. Hub menghitung ulang nilai ini dari `verdicts` dan menolak hasil bila isinya tidak konsisten.

Contoh `result` untuk `render` (animator atau animator_backup):
```json
{
  "method": "html-canvas+ffmpeg",
  "render_seconds": 410,
  "artifact_ids": {"video": "art_...", "srt": "art_...", "cover": "art_...", "storyboard": "art_..."},
  "label_ai": true,
  "assets": [{"name": "...", "origin": "dibuat sendiri", "license": "-"}],
  "notes": ""
}
```

## 9. Autentikasi dan keamanan
- Kunci dibuat oleh `hub.admin create-agent` dan ditampilkan sekali. Disimpan hanya sebagai hash.
- HTTPS lewat Caddy. Hub tidak menerima HTTP polos dari luar.
- Rate limit 60 permintaan per menit per agen. Payload JSON maksimal 256 KB.
- Semua isi dari agen dianggap data tak tepercaya. Hub tidak mengeksekusi isi apa pun dan tidak meneruskan teks agen sebagai perintah ke sistem lain.
- Log tidak boleh memuat kunci. Tes otomatis menelusuri log uji untuk string kunci uji.
- Telegram: webhook atau polling hanya melayani `chat_id` PM yang terdaftar di `.env`.
- Kunci agen dimasukkan lewat penyimpanan kredensial aman milik platform agen (untuk Muse: Secure Credentials Store), bukan lewat chat.

## 10. Penyebaran
- VPS 2 vCPU dan 2 sampai 4 GB RAM (perkiraan, sesuaikan setelah uji beban). Domain sendiri.
- Docker Compose berisi: hub, caddy, cron cadangan.
- Cadangan harian: salinan SQLite (`.backup`) ke penyimpanan S3-compatible terpisah, simpan 14 hari.
- Runbook pemulihan di `deploy/README.md`: VPS baru, restore cadangan, rotasi semua kunci.

## 11. Observabilitas
Log JSON terstruktur. Endpoint `/health` memeriksa DB dan penyimpanan. Notifikasi Telegram bila `/health` gagal dua kali berturut-turut (pemeriksa eksternal gratis atau cron di VPS lain).

## Lampiran A. Menyambungkan agen ke hub

### Muse (custom connector)
Muse tidak punya halaman pengaturan MCP. Konektor dibuat dengan meminta Muse di chat. Tempel ke chat baru Muse:

```
Buat Custom Connector ke server MCP jarak jauh:
- Nama: hub
- Transport: remote streamable HTTP
- URL: [HUB_URL]/mcp
- Autentikasi: API key lewat header X-API-Key
Buka Secure Credentials Store agar saya memasukkan kunci di sana, bukan di chat ini.
Setelah terhubung, tampilkan daftar tool-nya, lalu panggil whoami.
```
Hanya sambungkan URL milik Anda sendiri. Meta tidak meninjau custom connector.

### Cue
Per akhir September 2026 belum ada dokumentasi connector khusus Cue, dan belum jelas bagaimana agen Cue memakai MCP. Uji di M2:
1. Minta agen Cue menambah custom MCP connector dengan URL dan header yang sama seperti di atas, lalu panggil `whoami`.
2. Bila berhasil: lanjut sesuai rencana.
3. Bila gagal untuk CEO: jalankan CEO dari aplikasi Manus biasa, yang punya tab Custom MCP terdokumentasi.
4. Bila gagal untuk animator (Cue #2): jadikan Muse #5 animator utama dan Cue #2 cadangan, atau PM meneruskan tugas secara manual hanya pada masa uji.

### Menjadwalkan agen
Agen tidak bisa diam menunggu. Urutan uji untuk membangunkan agen (O-2): tugas terjadwal di Muse; Automations di Manus untuk Cue; bila keduanya tidak ada, PM mengetik "cek inbox hub" di chat agen. Mulai dengan CEO 3 kali sehari dan pekerja 2 kali sehari, lalu sesuaikan dengan pemakaian token.
