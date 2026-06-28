# Panduan Demo & Skenario Percakapan VoiceGuard (Konteks: BFI Finance)

Dokumen ini berisi penjelasan kecocokan kategori dengan lapangan nyata di **BFI Finance Indonesia** serta teks ujicoba (skrip demo) untuk kategori negatif (Fraud/Suspicious) dan positif (Quality Assurance).

Tersedia versi **2 Arah (Percakapan Agen & Nasabah)** dan **1 Arah (Monolog Agen/Petugas)** agar Anda bisa melakukan pengujian secara mandiri tanpa lawan bicara.

---

## 1. Analisis Relevansi Lapangan di BFI Finance

**BFI Finance** adalah salah satu perusahaan pembiayaan (multifinance) terbesar di Indonesia yang menawarkan pinjaman dengan jaminan BPKB motor, mobil, dan sertifikat rumah. Dalam operasional sehari-hari, interaksi terjadi melalui telesales, telemarketing, surveyor, customer service, dan petugas kolektor.

Kategori yang kita miliki sangat akurat mencerminkan risiko riil di lapangan:
1. **Leasing Redirection (FRAUD)**: Terjadi saat agen BFI bersekongkol dengan kompetitor. Saat ada calon nasabah (lead) yang ingin mengajukan kredit di BFI, agen justru mengarahkan nasabah tersebut ke perusahaan leasing lain karena ditawari komisi (kickback) pribadi yang lebih besar.
2. **Personal Contact (SUSPICIOUS)**: Agen meminta nasabah menghubungi nomor WhatsApp pribadi mereka daripada nomor kantor/resmi. Ini biasanya pintu masuk untuk penipuan atau transaksi luar sistem.
3. **Outside Process (SUSPICIOUS)**: Agen meminta nasabah bertransaksi di luar kantor atau tanpa melalui survei resmi dengan janji "bisa dibantu lolos".
4. **Data Manipulation (FRAUD)**: Dikenal sebagai "tembak data" atau "up data". Agen memanipulasi slip gaji nasabah, memalsukan status kepemilikan rumah, atau merekayasa foto aset agar pengajuan kredit disetujui komite kredit BFI.
5. **Payment Diversion (FRAUD)**: Kasus penggelapan dana di mana agen/kolektor meminta nasabah mentransfer pembayaran angsuran ke rekening pribadi agen (atau e-wallet miliknya) dengan alasan sistem BFI sedang gangguan.

#### Kategori Positif Tambahan (Quality Assurance & Business Value):
Untuk memberi nilai tambah bisnis ke manajemen BFI Finance, kami menambahkan kategori positif:
6. **Upsell & Cross-sell (NORMAL)**: Agen secara aktif menawarkan penambahan plafon pinjaman (top-up) bagi nasabah yang memiliki pembayaran bagus, atau menawarkan produk lain (misal dari jaminan BPKB motor ditawari pinjaman jaminan sertifikat).

---

## 2. Skrip Ujicoba Demo Kategori

*Catatan: Ucapkan teks di bawah ini dekat mikrofon yang aktif pada perangkat VoiceGuard Anda.*

---

### KATEGORI 1: Leasing Redirection (`leasing_redirection` - FRAUD)
*Agen mengarahkan pengajuan nasabah ke leasing kompetitor.*

#### Versi 2 Arah (Percakapan)
*   **Nasabah**: "Halo pak, saya mau mengajukan pinjaman jaminan BPKB Mobil Avanza tahun 2020 di BFI Finance bisa?"
*   **Agen**: "Aduh bu, kalau Avanza tahun 2020 nilai pencairan di BFI lagi kecil sekali, potongan adminnya juga besar. Bagaimana kalau saya ajukan ke leasing sebelah saja, ke Adira atau Adira Finance? Kebetulan saya punya kenalan di sana, pencairannya bisa lebih tinggi dan bunganya lebih murah dari BFI. Nanti data ibu saya bantu pindahkan ke sana saja ya."

#### Versi 1 Arah (Monolog Agen)
*   "Halo bu, dengar-dengar ibu mau ajukan pinjaman ya? Kalau di BFI potongan adminnya lagi tinggi bu. Mending saya arahkan ke Adira Finance atau leasing sebelah aja, kebetulan bunga di sana lagi promo dan pencairan BPKB mobil ibu bisa lebih tinggi. Nanti data ibu saya kirim ke teman saya di sana ya, jangan lewat sistem BFI."

---

### KATEGORI 2: Personal Contact (`personal_contact` - SUSPICIOUS)
*Agen meminta nasabah bertransaksi lewat nomor WA pribadi.*

#### Versi 2 Arah (Percakapan)
*   **Nasabah**: "Pak, untuk progres survei berkas saya nanti dikabari lewat mana ya?"
*   **Agen**: "Oh nanti langsung hubungi nomor WhatsApp pribadi saya saja bu di nomor 0812-3456-7890. Jangan hubungi nomor resmi kantor BFI ya, soalnya kalau lewat sistem resmi kantor biasanya lambat responnya. Lewat WA pribadi saya saja biar langsung saya urus cepat."

#### Versi 1 Arah (Monolog Agen)
*   "Baik bu, nanti untuk pengiriman foto KTP dan KK langsung dikirim ke WhatsApp pribadi saya saja ya di 0812-3456-7890. Jangan lewat nomor hotline kantor BFI atau sistem, biar saya sendiri yang proses berkasnya langsung malam ini."

---

### KATEGORI 3: Outside Process (`outside_process` - SUSPICIOUS)
*Transaksi atau negosiasi di luar prosedur survei resmi.*

#### Versi 2 Arah (Percakapan)
*   **Nasabah**: "Pak, besok jadi survei ke rumah saya ya untuk cek fisik kendaraan?"
*   **Agen**: "Tidak usah survei ke rumah bu, repot nanti malah ketahuan tetangga. Kita ketemuan saja di kedai kopi dekat pertigaan jalan baru nanti sore. Ibu bawa aja berkasnya ke sana, nanti kita tanda tangan kontrak di sana tanpa perlu survei ke rumah ibu."

#### Versi 1 Arah (Monolog Agen)
*   "Halo pak, untuk tanda tangan formulir pengajuan dana BPKB mobil ini kita tidak usah lakukan di kantor cabang BFI ya. Kita ketemu di luar saja nanti malam jam 7 di kafe dekat bioskop, nanti berkasnya saya bawa dan kita tanda tangan di sana saja agar cepat beres."

---

### KATEGORI 4: Data Manipulation (`data_manipulation` - FRAUD)
*Agen menawarkan pemalsuan data/dokumen agar disetujui.*

#### Versi 2 Arah (Percakapan)
*   **Nasabah**: "Pak, tapi slip gaji saya sebulan cuma 3 juta, apa bisa lolos untuk pinjaman jaminan sertifikat ini?"
*   **Agen**: "Tenang saja pak, itu gampang diatur. Nanti slip gajinya saya edit dan manipulasi nilainya jadi 7 juta di komputer kantor biar komite kredit BFI langsung setuju. Nanti untuk foto usaha toko bapak juga bisa saya carikan foto toko lain biar kelihatan usahanya besar. Bapak siapkan saja uang rokok buat saya ya."

#### Versi 1 Arah (Monolog Agen)
*   "Tenang bu, kalau masalah rumah kontrak atau slip gaji kecil itu bisa saya bantu manipulasi datanya. Slip gajinya nanti saya edit jadi 8 juta rupiah biar lolos sistem BI Checking dan komite kredit BFI. Ibu tinggal tunggu pencairan saja, nanti bagi hasil saja dengan saya."

---

### KATEGORI 5: Payment Diversion (`payment_diversion` - FRAUD)
*Agen mengalihkan pembayaran nasabah ke rekening pribadi.*

#### Versi 2 Arah (Percakapan)
*   **Nasabah**: "Pak, saya mau bayar angsuran BFI bulan ini, nomor Virtual Account-nya berapa?"
*   **Agen**: "Oh untuk bulan ini pembayaran jangan lewat Virtual Account atau kasir kantor BFI bu, soalnya sistem BFI sedang error dan maintenance seminggu. Ibu transfer langsung saja ke rekening pribadi saya atas nama Budi Santoso di Bank BCA. Nanti bukti transfernya saya input manual ke sistem kantor kalau sistemnya sudah bagus."

#### Versi 1 Arah (Monolog Agen)
*   "Halo pak, sistem Virtual Account BFI lagi gangguan hari ini. Supaya bapak tidak kena denda keterlambatan, bapak transfer saja uang angsurannya ke rekening pribadi saya dulu, nanti saya yang bayarkan ke kasir kantor besok pagi kalau sistem sudah normal kembali."

---

### KATEGORI 6: Upsell & Cross-sell (`upsell_cross_sell` - NORMAL/POSITIVE)
*Agen menawarkan produk tambahan atau top-up pinjaman.*

#### Versi 2 Arah (Percakapan)
*   **Nasabah**: "Saya mau melunasi sisa kontrak pinjaman motor saya pak."
*   **Agen**: "Baik pak. Sekadar informasi, karena bapak memiliki riwayat pembayaran yang sangat bagus di BFI Finance, bapak mendapatkan penawaran eksklusif berupa **Top-Up pinjaman** dengan bunga lebih rendah tanpa perlu survei ulang. Atau jika bapak butuh dana tambahan untuk usaha, kami juga memiliki produk pembiayaan jaminan sertifikat rumah dengan tenor hingga 5 tahun. Apakah bapak tertarik?"

#### Versi 1 Arah (Monolog Agen)
*   "Selamat siang pak, karena pembayaran angsuran motor bapak di BFI selalu tepat waktu selama setahun ini, kami menawarkan fasilitas top-up pencairan dana kembali dengan bunga khusus dan limit lebih besar tanpa harus survei ulang rumah. Barangkali bapak butuh tambahan modal usaha saat ini?"
