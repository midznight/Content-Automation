# Target dan Metrik

Akun mulai dari nol, jadi baseline performa konten belum ada. Target operasional (M1 sampai M8) bersifat tegas. Target performa konten (M9 dan M10) adalah hipotesis awal dan dikalibrasi ulang setelah 20 video terbit.

| # | Metrik | Baseline | 30 hari | 90 hari | Cara ukur |
|---|---|---|---|---|---|
| M1 | Video terbit | 0 | 15 atau lebih | 60 atau lebih | Hitung baris `videos` berstatus `published` |
| M2 | Video terbit yang lolos gerbang fact-check | belum ada | 100% | 100% | Hub menolak `approved` tanpa `gate_pass=true`; audit tiap minggu |
| M3 | Koreksi atau penghapusan video karena kesalahan fakta | belum ada | 0 | 0 | Catatan PM dan tabel `events` |
| M4 | Median waktu dari topik disetujui sampai draf siap ditinjau | belum ada | 24 jam atau kurang | 12 jam atau kurang | Selisih timestamp pada `tasks` |
| M5 | Tugas selesai tanpa intervensi manusia | belum ada | 80% atau lebih | 90% atau lebih | `done` dibagi total, di luar `needs_human` |
| M6 | Waktu failover animator (blocked sampai tugas jalan di cadangan) | belum ada | 60 menit atau kurang | 30 menit atau kurang | Selisih timestamp di `events` |
| M7 | Waktu kerja PM per hari | belum ada | 60 menit atau kurang | 30 menit atau kurang | Catatan PM sendiri tiap akhir hari |
| M8 | Insiden keamanan (kunci bocor, aksi di luar wewenang) | 0 | 0 | 0 | Audit log `events`, tinjau mingguan |
| M9 | Rata-rata persen ditonton per video (hipotesis) | belum ada | Tetapkan baseline setelah 20 video | Median naik 10% relatif terhadap baseline | Tabel `metrics`, diisi PM |
| M10 | Pengikut akun (hipotesis) | 0 | tidak ditargetkan | 1.000 atau lebih | TikTok analytics, dicatat PM mingguan |

## Aturan membaca
- M2 dan M3 adalah syarat nyawa akun. Satu pelanggaran menghentikan penerbitan sampai penyebabnya ditemukan.
- M9 dan M10 tidak dipakai untuk menilai keberhasilan sistem sebelum 20 video terbit. Sebelum itu sampelnya terlalu kecil.
