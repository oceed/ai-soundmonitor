# Panduan Demo & Skenario Percakapan VoiceGuard (Konteks: Multifinance)

Dokumen ini berisi contoh skenario dan teks uji coba (skrip demo) yang umum menjadi perhatian dalam industri pembiayaan multifinance. Skrip ini dirancang untuk mendemonstrasikan fleksibilitas VoiceGuard dalam menangkap indikator risiko operasional (negatif) maupun indikator kinerja/kualitas pelayanan (positif).

Tersedia versi **2 Arah (Percakapan)** dan **1 Arah (Monolog)** agar Anda dapat melakukan pengujian secara mandiri tanpa lawan bicara.

---

## 1. Analisis Relevansi Skenario di Industri Pembiayaan

Dalam operasional harian jaringan kantor cabang, interaksi pelayanan terjadi di meja Customer Service, Kasir, maupun saat proses verifikasi survei. Sistem VoiceGuard dikonfigurasi untuk membantu tim operasional menyaring percakapan berdasarkan 7 indikator universal berikut:

### Kategori Risiko & Kepatuhan (Negative & Suspicious)
1.  **Leasing Redirection (`leasing_redirection` - RISIKO)**: Deteksi potensi ketika petugas secara halus mengarahkan calon nasabah ke perusahaan pembiayaan kompetitor di luar proses resmi yang berlaku.
2.  **Personal Contact (`personal_contact` - PERHATIAN)**: Penanda ketika petugas mengalihkan komunikasi transaksi resmi kantor ke kontak WhatsApp pribadi petugas.
3.  **Outside Process (`outside_process` - PERHATIAN)**: Penanda ketika transaksi atau proses tanda tangan berkas diusulkan untuk dilakukan di luar jalur lokasi kantor resmi agar lebih praktis.
4.  **Data Manipulation (`data_manipulation` - RISIKO)**: Deteksi ketika terdapat indikasi penyesuaian atau pengeditan data nasabah secara tidak resmi agar memperbesar peluang disetujui komite kredit (*approval*).
5.  **Payment Diversion (`payment_diversion` - RISIKO)**: Deteksi ketika terdapat arahan pembayaran angsuran nasabah ke rekening pribadi petugas sebagai titipan sementara.

### Kategori Kualitas Layanan & Performa (Service Quality & Sales)
6.  **Unprofessional Language (`unprofessional_language` - RISIKO)**: Deteksi ketika petugas menggunakan kalimat kurang ramah, tidak sopan, bernada ketus, merendahkan, atau defensif yang dapat merusak kualitas pelayanan.
7.  **Upsell & Cross-sell (`upsell_cross_sell` - NORMAL/POSITIF)**: Mengidentifikasi ketika petugas secara aktif menawarkan produk tambahan atau fasilitas penambahan dana (*top-up*) kepada nasabah.

> [!NOTE]
> **Fleksibilitas Konfigurasi**: Indikator spesifik lainnya seperti ucapan salam wajib (*Greeting SOP*), kalimat penutup (*Closing SOP*), maupun kalimat wajib sesuai standar operasional internal perusahaan dapat dengan mudah ditambahkan ke dalam sistem melalui Category Manager di dashboard Settings setelah proses instalasi selesai.

---

## 2. Skrip Ujicoba Demo Kategori (Subtil & Realistis)

*Catatan: Ucapkan teks di bawah ini dekat mikrofon yang aktif pada perangkat VoiceGuard Anda.*

---

### KATEGORI 1: Leasing Redirection (`leasing_redirection` - RISIKO)
*Petugas mengarahkan pengajuan nasabah ke perusahaan kompetitor secara halus.*

*   **2 Arah (Percakapan)**:
    *   **Nasabah**: "Halo Pak, saya mau mengajukan pinjaman jaminan BPKB Mobil Avanza tahun 2020 di sini bisa ya?"
    *   **Petugas**: "Kalau di sini kemungkinan nilai pencairan plafonnya tidak terlalu besar untuk Avanza tahun itu, Bu. Coba pertimbangkan perusahaan lain juga, biasanya di leasing sebelah sedang ada program promo bunga yang lebih rendah dan cocok dengan profil Ibu. Nanti saya bantu koordinasikan dengan rekan saya di sana saja ya."
*   **1 Arah (Monolog Petugas)**:
    *   "Halo Bu, untuk pengajuan jaminan BPKB mobil Avanza Ibu, kalau di kantor kita potongannya lagi agak tinggi. Bagaimana kalau saya bantu arahkan ke perusahaan pembiayaan lain saja? Kebetulan di sana sedang ada promo pencairan dana lebih besar. Biar data ibu saya kirim ke sana saja."

---

### KATEGORI 2: Personal Contact (`personal_contact` - PERHATIAN)
*Petugas mengalihkan komunikasi resmi ke nomor chat pribadi.*

*   **2 Arah (Percakapan)**:
    *   **Nasabah**: "Pak, untuk memantau berkas survei saya nanti saya hubungi ke mana ya?"
    *   **Petugas**: "Oh, kalau ada perkembangan atau ingin bertanya langsung chat ke WhatsApp pribadi saya saja ya Pak di nomor 0812-3456-7890 supaya responnya bisa lebih cepat dan tidak perlu menunggu antrean sistem customer relation."
*   **1 Arah (Monolog Petugas)**:
    *   "Baik Bu, nanti untuk foto kelengkapan KTP dan KK silakan langsung kirim ke nomor WhatsApp pribadi saya saja di 0812-3456-7890 agar langsung saya cek nanti malam."

---

### KATEGORI 3: Outside Process (`outside_process` - PERHATIAN)
*Transaksi atau proses berkas di luar prosedur survei lokasi resmi.*

*   **2 Arah (Percakapan)**:
    *   **Nasabah**: "Pak, besok jadi survei ke rumah saya untuk cek fisik kendaraan?"
    *   **Petugas**: "Kalau Bapak sedang sibuk bekerja, kita ketemu saja di luar kantor supaya lebih praktis. Nanti berkas kontrak dan cek fisiknya saya bawa, kita bisa cek di warung kopi dekat kantor Bapak nanti sore."
*   **1 Arah (Monolog Petugas)**:
    *   "Halo Pak, untuk penandatanganan dokumen pengajuan dana ini kita tidak usah lakukan di kantor cabang BFI. Nanti kita ketemu saja di luar setelah jam kantor biar lebih santai dan cepat prosesnya."

---

### KATEGORI 4: Data Manipulation (`data_manipulation` - RISIKO)
*Mengusulkan penyesuaian dokumen nasabah secara tidak resmi agar lolos kredit.*

*   **2 Arah (Percakapan)**:
    *   **Nasabah**: "Pak, tapi slip gaji saya sebulan cuma 3 juta, kira-kira pengajuan jaminan sertifikat saya bisa lolos komite?"
    *   **Petugas**: "Tenang Pak, nanti datanya kita sesuaikan saja di komputer kantor supaya peluang approval lebih besar. Beberapa kolom slip gaji dan data usaha bapak bisa kita rapikan di sistem agar profil risikonya terlihat aman bagi komite kredit."
*   **1 Arah (Monolog Petugas)**:
    *   "Tenang Bu, kalau masalah slip gaji kecil atau status rumah sewa, nanti berkasnya kita bantu sesuaikan formatnya agar lolos verifikasi sistem BI checking."

---

### KATEGORI 5: Payment Diversion (`payment_diversion` - RISIKO)
*Mengalihkan angsuran resmi ke rekening titipan pribadi.*

*   **2 Arah (Percakapan)**:
    *   **Nasabah**: "Pak, saya mau bayar angsuran bulan ini, sistem Virtual Account-nya kok tidak bisa diakses ya?"
    *   **Petugas**: "Kalau Ibu sedang kesulitan bayar lewat Virtual Account hari ini, nanti saya bantu dulu prosesnya. Saya kirim nomor rekening bank yang biasa saya gunakan untuk titipan pembayaran nasabah, setelah uangnya masuk dan sistem kantor normal langsung saya input bu."
*   **1 Arah (Monolog Petugas)**:
    *   "Halo Pak, sistem kasir hari ini sedang dalam pemeliharaan berkala. Supaya bapak tidak terkena denda jatuh tempo hari ini, bapak bisa titipkan pembayarannya melalui transfer rekening saya dulu."

---

### KATEGORI 6: Unprofessional Language (`unprofessional_language` - RISIKO)
*Petugas berbicara dengan nada ketus, merendahkan, defensif, atau tidak profesional.*

*   **2 Arah (Percakapan)**:
    *   **Nasabah**: "Bisa dijelaskan kembali Pak? Saya masih kurang paham tentang rincian dendanya."
    *   **Petugas**: "Kan sudah saya jelaskan dari tadi, Pak. Masih belum mengerti juga? Kalau Bapak tidak mau mengikuti aturan denda keterlambatannya ya silakan ajukan di tempat lain saja."
*   **1 Arah (Monolog Petugas)**:
    *   "Sudah dibilang berkali-kali ya Pak, kalau tidak sanggup bayar dendanya tidak usah banyak alasan, itu salah Bapak sendiri kenapa telat bayar."

---

### KATEGORI 7: Upsell & Cross-sell (`upsell_cross_sell` - NORMAL/POSITIF)
*Menawarkan fasilitas top-up limit pinjaman atau pembiayaan silang.*

*   **2 Arah (Percakapan)**:
    *   **Nasabah**: "Saya mau menanyakan sisa pinjaman kontrak motor saya Pak."
    *   **Petugas**: "Baik Pak. Mengingat catatan pembayaran angsuran bapak sangat baik dan selalu tepat waktu, bapak mendapatkan penawaran eksklusif fasilitas **Top-Up limit pinjaman** tanpa perlu survei ulang. Apakah bapak tertarik memanfaatkannya untuk modal usaha?"
*   **1 Arah (Monolog Petugas)**:
    *   "Selamat siang Pak, karena riwayat pembayaran bapak sangat bagus selama 12 bulan ini, kami menawarkan program penambahan dana pinjaman kembali dengan bunga promo khusus tanpa proses administrasi rumit."
