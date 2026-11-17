# Glosarium

| Istilah | Arti dalam proyek ini |
|---|---|
| Hub | Server MCP buatan sendiri tempat semua agen mengambil dan menyerahkan tugas |
| MCP | Model Context Protocol, standar terbuka agar agen AI memanggil tool dan layanan eksternal |
| Muse | Agen pribadi Meta yang berjalan di Muse Secure VM miliknya |
| Cue | Aplikasi agen pribadi Manus; tiap agen punya email, nomor telepon, dompet, dan komputer sendiri |
| Custom connector | Cara menambah server MCP ke Muse; dibuat lewat permintaan di chat |
| Sentinel | Agen pengawas Muse yang memeriksa akses internet dan tindakan sensitif |
| PM | Project Manager: pemilik proyek, manusia, pemberi keputusan akhir |
| Role | Peran agen: ceo, strategist, fact_checker, animator, animator_backup, analyst, social |
| Tugas (task) | Satu unit pekerjaan di hub dengan tipe, payload, status, dan pemilik |
| Amplop | Format JSON baku sebuah tugas (`03` bagian 8) |
| Handoff | Penyerahan hasil satu role ke role berikutnya lewat hub |
| Gerbang (gate) | Titik yang tidak bisa dilewati tanpa syarat: fact-check, persetujuan topik, persetujuan akhir |
| gate_pass | Nilai `true` bila semua klaim inti sebuah skrip berstatus `verified` |
| Klaim inti | Pernyataan fakta yang menjadi dasar video; tiap video punya 1 sampai 3 |
| Verdict | Penilaian klaim: `verified`, `uncertain`, atau `rejected` |
| Failover | Pengalihan tugas render dari animator ke animator_backup saat terblokir |
| blocked_reason | Alasan terblokir: `limit`, `error`, `needs_info`, `needs_human` |
| Stale | Status tugas yang diambil lebih dari 4 jam tanpa pembaruan |
| Artefak | Berkas hasil kerja: skrip, mp4, srt, sampul, caption |
| Bake-off | Uji adu dua agen pada tugas yang sama untuk memilih yang utama |
| label_ai | Penanda bahwa video memuat suara atau visual realistis buatan AI dan perlu label di TikTok |
