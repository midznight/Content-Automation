# Brief Proyek

## Masalah
Pemilik ingin menjalankan satu akun TikTok dari nol dengan konten "fakta yang jarang diketahui" dalam bentuk video animasi penjelasan. Tenaga kerjanya 5 akun Muse (Meta) dan 2 akun Cue (Manus), masing-masing agen dengan VM sendiri. Pemilik tidak punya waktu membangun atau menjaga sistem hariannya.

Hambatan teknis: agen Muse dan Cue tidak punya jalur komunikasi lintas vendor bawaan. Tanpa wadah penghubung, tiap agen bekerja sendiri dan pemilik menjadi kurir salin-tempel.

## Tujuan
Membangun hub (server MCP self-hosted) dan 7 role agen yang menghasilkan draf video terverifikasi setiap hari dengan waktu kerja pemilik paling banyak 60 menit per hari. Pemilik menjadi Project Manager (PM): memilih arah dan menyetujui.

## Ruang lingkup MVP
Hub MCP, 7 role agen, pipeline topik sampai draf video, notifikasi Telegram ke PM, persetujuan manual oleh PM, input metrik manual.

## Di luar MVP
Unggah otomatis ke TikTok, balasan komentar atau DM otomatis, bisnis ke-2 dan ke-3, dashboard interaktif, monetisasi, integrasi API TikTok, pembayaran oleh agen.

## Keputusan yang sudah diambil
1. Hub di server sendiri, bukan di VM salah satu agen. Alasan: tidak bergantung pada satu akun atau vendor.
2. Pola hub-and-spoke: CEO jadi pengarah tugas. Alasan: aturan sederhana, mudah diaudit.
3. PM yang menekan tombol publish pada MVP. Alasan: belum ada agen yang terbukti andal mengunggah, dan akun baru perlu riwayat sehat.
4. SQLite dulu, Postgres bila perlu. Alasan: 7 agen dan beban kecil.

## Variabel yang harus diisi PM
| Variabel | Isi | Dipakai di |
|---|---|---|
| NAMA_AKUN | [ISI] | semua prompt agen |
| BAHASA_KONTEN | [ISI, asumsi: Indonesia] | semua prompt agen |
| PILAR_1, PILAR_2, PILAR_3 | [ISI, usulan ada di docs/07] | CEO, Strategist |
| GAYA_VISUAL | [ISI, 1 paragraf atau tautan referensi] | Animator, Animator Cadangan |
| VIDEO_PER_MINGGU | [ISI, usulan 5] | CEO |
| VOICEOVER | [ya, suara sintetis / tidak, hanya teks] | Animator |
| JAM_AKTIF_PM dan ZONA_WAKTU | [ISI] | CEO |
| HUB_URL | diisi setelah deploy | semua agen |

## Asumsi
- Penonton utama berbahasa Indonesia (belum diputuskan pemilik).
- Satu akun TikTok, didaftarkan dan dikendalikan PM sendiri dengan nomor dan email milik PM.
