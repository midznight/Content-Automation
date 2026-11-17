# Paket Dokumen: Sistem Multi-Agen Produksi TikTok

Versi 1.0 · 17 November 2026 · Status: siap dieksekusi setelah variabel diisi

Sistem ini menghubungkan 5 akun Muse dan 2 akun Cue lewat satu hub MCP buatan sendiri, lalu memakai ketujuhnya sebagai tim produksi video animasi "fakta yang jarang diketahui" untuk akun TikTok baru. Pemilik berperan sebagai Project Manager.

## Isi folder

| Berkas | Fungsi |
|---|---|
| `AGENTS.md` | Aturan kerja permanen untuk Antigravity. Taruh di akar repo. |
| `docs/00-brief.md` | Masalah, tujuan, ruang lingkup, variabel yang harus Anda isi |
| `docs/01-target-metrik.md` | Target terukur 30 dan 90 hari |
| `docs/02-prd.md` | PRD: role, alur, user story, kebutuhan, cakupan MVP |
| `docs/03-spesifikasi-teknis.md` | Arsitektur hub, skema data, tool MCP, izin, cara menyambung agen |
| `docs/04-roadmap.md` | Milestone M0 sampai M6 dan tugasnya |
| `docs/05-rencana-uji.md` | Uji hub, uji integrasi, bake-off animator, checklist penerimaan |
| `docs/06-risiko.md` | Risiko dan mitigasi |
| `docs/07-panduan-konten.md` | Pilar, struktur skrip, nada, aturan topik |
| `docs/08-glosarium.md` | Istilah proyek |
| `prompts/00-build-hub-antigravity.md` | Tiga prompt eksekusi untuk membangun hub di Antigravity |
| `prompts/agen/01..07-*.md` | Prompt siap tempel untuk tiap agen (CEO, Strategist, Fact-Checker, Animator, Animator Cadangan, Analyst, Social) |

## Peta alur (dari ide sampai berjalan)

| # | Langkah | Output | Dokumen / prompt |
|---|---|---|---|
| 1 | Putuskan variabel akun | Nama akun, bahasa, 3 pilar, gaya visual | `docs/00-brief.md` bagian Variabel |
| 2 | Siapkan fondasi | VPS, domain, repo, token Telegram bot | `docs/04-roadmap.md` M0 |
| 3 | Bangun hub | Hub MCP berjalan, tes lulus | `prompts/00` Prompt A, `AGENTS.md` |
| 4 | Sambungkan agen | Uji ping-pong nyata Muse dan CEO, jawaban soal Cue | `docs/03` Lampiran A, `prompts/agen/` |
| 5 | Pipeline dan bake-off animator | 1 video draf end-to-end, animator utama dipilih | `prompts/00` Prompt B, `docs/05` |
| 6 | 10 video percobaan lalu evaluasi | Laporan evaluasi, keputusan fase 2 | `docs/01`, `docs/05`, `docs/06` |

## Memakai di Antigravity

1. Buka folder `sistem-agen` sebagai workspace. `AGENTS.md` di akar dibaca sebagai aturan kerja.
2. Tempel Prompt A dari `prompts/00-build-hub-antigravity.md` sebagai tugas pertama. Minta rencana dulu, setujui, baru eksekusi.
3. Prompt B dan C dipakai setelah milestone sebelumnya lulus tesnya.
4. Dokumen ini hidup. Bila keputusan berubah, ubah dokumennya dulu, baru kodenya.
