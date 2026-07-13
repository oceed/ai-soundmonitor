# IoT/Edge DevOps & OTA (Over-The-Air) Update Strategy

Dokumen ini berisi panduan arsitektur DevOps, distribusi perangkat lunak, pembaruan OTA (Over-The-Air), serta mekanisme ketahanan (*self-healing*) untuk ekosistem perangkat VoiceGuard, ProtectQube AI, dan Device Manager.

---

## 1. Arsitektur Modular & Manajemen Add-On

Untuk mendukung instalasi dinamis di mana suatu perangkat bisa memiliki `device-manager` saja, `device-manager` + `voiceguard`, atau `device-manager` + `protectqube-ai`, arsitektur harus dirancang secara kontainerisasi (Docker-based).

### Pembagian Peran Komponen:
*   **Host OS (Sistem Operasi Perangkat)**: Minimal Linux (seperti Debian/Ubuntu Server ARM64 untuk Orange Pi) yang dikonfigurasi seminimal mungkin agar ringan dan stabil.
*   **Device Manager (Core Agent)**: Berjalan langsung sebagai OS Service (`systemd`). Tugasnya adalah menghubungkan perangkat ke Cloud, melaporkan metrik vital (CPU, RAM, Suhu), dan bertindak sebagai **Orchestrator Lokal** yang mengontrol kontainer Docker add-on via Docker Engine API.
*   **Add-on Services (VoiceGuard & ProtectQube AI)**: Berjalan sebagai kontainer Docker independen. Penambahan atau penghapusan add-on cukup dilakukan dengan menjalankan perintah `docker run` atau `docker stop` oleh Device Manager berdasarkan instruksi dari Cloud Dashboard.

---

## 2. Strategi Pembaruan OTA (Over-The-Air)

Pembaruan perangkat lunak di ribuan lokasi memiliki tantangan besar pada kecepatan transfer data, keamanan, dan stabilitas proses instalasi.

### Mengapa Git & ZIP Tidak Direkomendasikan untuk Production?
*   **Git (TIDAK AMAN)**: 
    *   Memerlukan kunci SSH / Token Git yang disimpan lokal di perangkat. Jika perangkat dicuri atau diakses fisiknya secara ilegal, repositori kode perusahaan Anda terekspos.
    *   Memerlukan proses *build* lokal (seperti compiling library C/C++ atau `pip install`). Hal ini rawan gagal jika koneksi internet terputus di tengah jalan, membuat aplikasi rusak setengah jalan.
*   **ZIP (TIDAK KONSISTEN)**:
    *   Meskipun lebih baik dari Git, ZIP tidak mengisolasi sistem operasi perangkat. Jika ada library OS yang ter-update di latar belakang dan tidak cocok dengan aplikasi Anda, sistem akan langsung crash.

### Solusi Terbaik: Docker Layering & Delta Updates
Gunakan Docker Container Registry dengan mengoptimalkan ukuran image melalui pemisahan layer:
1.  **Base Image (Jarang Berubah)**: Berisi library sistem operasi, runtime Python, dependensi AI (seperti PyTorch, Whisper, Ollama, ONNX Runtime). Ukuran layer ini berkisar antara **3GB - 8GB**. Unduh layer ini hanya sekali di awal (pabrikasi).
2.  **Application Layer (Sering Berubah)**: Hanya berisi file source code backend (FastAPI, Python scripts) dan frontend build. Ketika Anda melakukan update kode, Docker hanya akan mengunduh layer aplikasi ini yang ukurannya **hanya beberapa Megabyte (MB)**.

---

## 3. Mekanisme Ketahanan Perangkat (Self-Healing & Industrial Grade)

Untuk memastikan perangkat tidak mati total (*brick*) di lapangan saat terjadi kegagalan sistem, terapkan aturan ketahanan berikut:

### A. Mekanisme Rollback Otomatis (A/B Testing)
Sebelum menghapus versi kontainer yang stabil, lakukan proses berikut:
1.  Unduh image versi baru.
2.  Jalankan kontainer baru secara paralel di port sementara.
3.  Jalankan pengujian kesehatan lokal (*Local Health Check*) dengan mengirimkan request ke endpoint `/health` kontainer baru.
4.  Jika dalam waktu 3 menit kontainer baru tidak sehat (atau crash), matikan kontainer baru, pertahankan kontainer lama yang stabil, lalu laporkan error ke Cloud Server.

### B. Read-Only Root Filesystem (Mencegah Corrupt Data)
Kerusakan sistem file akibat mati listrik tiba-tiba adalah masalah yang sangat sering terjadi di toko/retail.
*   Konfigurasikan partisi OS utama (`/`) sebagai **Read-Only**.
*   Buat partisi khusus terpisah yang bersifat **Read-Write** hanya untuk menyimpan data dinamis (SQLite database `/app/storage/` dan file rekaman suara `/app/storage/recordings/`).
*   Jika terjadi pemadaman listrik saat penulisan data, hanya partisi data yang mungkin mengalami kerusakan (bisa dipulihkan dengan recovery SQLite otomatis), sementara OS utama tetap aman dan bisa boot kembali dengan normal.

### C. Watchdog (Hardware & Software)
*   **Software Watchdog**: Gunakan `systemd` untuk memantau status `device-manager`. Jika agent tersebut mati, OS akan otomatis merestart service dalam 5 detik.
*   **Hardware Watchdog**: Aktifkan modul Watchdog bawaan SoC (Orange Pi RK3588). Aplikasi harus mengirim sinyal *heartbeat* berkala ke hardware. Jika OS atau CPU hang total dan tidak mengirimkan sinyal dalam 15 detik, chip hardware akan memaksa mesin melakukan hard-reboot.

---

## 4. Rekomendasi Platform: Balena.io (BalenaCloud)

Untuk mengelola deployment edge device skala besar, **Balena.io** adalah platform industri yang paling direkomendasikan karena dirancang khusus untuk IoT/Edge DevOps.

### Scope Fitur Balena.io:
*   **BalenaOS**: Sistem operasi Linux berbasis Yocto yang minimal, read-only secara bawaan, dan sangat tahan banting.
*   **BalenaEngine**: Modul container runtime modifikasi Docker yang dioptimalkan untuk perangkat IoT (hemat penggunaan disk dan RAM).
*   **BalenaCloud Dashboard**: Dashboard terpusat untuk memantau ribuan perangkat, melihat log konsol secara langsung (*Remote Logging*), serta melacak lokasi GPS perangkat.
*   **Natively Solve Delta Updates**: Balena membandingkan image Docker lama dengan yang baru di tingkat binary (*block-level diff*). Jika Anda meng-update file code berukuran 100KB di dalam kontainer berukuran 3GB, Balena **hanya akan mengirimkan paket update sebesar 100KB** ke perangkat di lapangan!
*   **Built-in Secure VPN Tunnel**: Semua perangkat terhubung secara aman ke BalenaCloud tanpa perlu IP publik atau port forwarding di lokasi toko. Anda dapat mengakses terminal perangkat dari mana saja secara aman.
*   **Multi-Container Support**: Mendukung file `docker-compose.yml` untuk memetakan aplikasi Anda ke banyak kontainer (Device Manager + VoiceGuard + ProtectQube AI) secara modular.
*   **Auto-Rollback**: Jika pembaruan kontainer gagal boot atau gagal melewati uji kesehatan, Balena Engine akan membatalkan pembaruan dan mengembalikan kontainer sebelumnya secara otomatis.

### Apakah Balena Gratis?
*   **Ya, Gratis untuk Skala Kecil**: Balena menyediakan **Free Tier selamanya untuk 10 perangkat pertama** dengan akses ke seluruh fitur premium dashboard dan OTA. Ini sangat cocok untuk tahap pengembangan, prototyping, uji coba lapangan (*pilot project*), dan deployment awal.
*   **Skala Berbayar (Scaling)**: Di atas 10 perangkat, tarifnya berbasis langganan per perangkat per bulan (mulai dari ~$1.5 hingga ~$3 per device/bulan tergantung tingkat support dan jumlah perangkat).

---

## 5. Alternatif Open-Source / Gratis Sepenuhnya (Self-Hosted)

Jika proyek Anda berkembang ke ratusan perangkat dan Anda menginginkan sistem yang 100% gratis tanpa biaya bulanan pihak ketiga, berikut alternatifnya:

| Platform | Kelebihan | Kekurangan | Biaya |
| :--- | :--- | :--- | :--- |
| **Portainer Edge Agent** | Antarmuka grafis mudah untuk memantau kontainer Docker perangkat di lapangan dari satu server pusat. | Harus menyiapkan server registry Docker dan secure tunnel (seperti WireGuard atau OpenVPN) sendiri. | **Gratis (Open-Source)** |
| **K3s (Kubernetes Edge) + ArgoCD** | Standar Kubernetes yang sangat kuat untuk deklarasi GitOps dan pembaruan add-on. | Konsumsi memori RAM yang cukup besar untuk perangkat edge (tidak ramah untuk RAM di bawah 2GB). Setup sangat rumit. | **Gratis (Open-Source)** |
| **Custom Agent + MQTT/TLS** | Device Manager buatan sendiri yang membaca perintah update dari server pusat, lalu menjalankan skrip bash penarik docker image. | Harus merancang enkripsi, keamanan koneksi, sistem rollback, dan kompresi data update sendiri secara manual dari nol. | **Gratis (Biaya Development)** |
