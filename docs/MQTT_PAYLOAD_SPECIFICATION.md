# VoiceGuard — Comprehensive MQTT Payload Specification & Architecture Guide

Dokumen ini berisi spesifikasi teknis lengkap mengenai seluruh kemungkinan **MQTT Payload** yang dipublikasikan oleh aplikasi **VoiceGuard** ke MQTT Data Broker (termasuk broker lokal maupun Cloud MQTT Broker seperti `72.60.78.162`).

---

## 1. Ringkasan Topik & Kategori Event

VoiceGuard mengelompokkan pesan MQTT ke dalam **2 Topik Utama**:

| Topik MQTT | Kategori Event | Kondisi Pemicu (Trigger Condition) | Default QOS |
| :--- | :--- | :--- | :--- |
| `voiceguard/fraud/alerts` | **Fraud & Suspicious Alerts** | Terpemicu otomatis saat AI LLM menentukan klasifikasi `FRAUD` atau `SUSPICIOUS`. | `QoS 1` |
| `voiceguard/normal/events` | **Normal Conversations (SOP)** | Terpemicu jika klasifikasi `NORMAL` dan opsi `send_normal_conversations_to_mqtt` diaktifkan di Settings. | `QoS 1` |

> 💡 **Wildcard Subscription:**  
> Untuk menerima seluruh event (*alerts* maupun *normal*), subscriber dapat melakukan subscribe ke topik wildcard: **`voiceguard/#`**.

---

## 2. Struktur & Penjelasan Semantik Setiap Field Payload

Setiap payload MQTT berformat **JSON UTF-8** dengan struktur field sebagai berikut:

| Nama Field | Tipe Data | Deskripsi & Semantik | Kondisi & Nilai Default |
| :--- | :--- | :--- | :--- |
| `alert_id` / `segment_id` | `Integer` | Unique Auto-increment ID transaksi di Database VoiceGuard lokal. | `alert_id` pada topik Alerts, `segment_id` pada topik Normal. |
| `session_id` | `Integer` | ID sesi jalannya aplikasi pipeline VoiceGuard. | Mengidentifikasi siklus start/stop engine. |
| `audio_id` | `String (UUID)` | ID unik file rekaman audio dari return API Cloud Upload (`ProtectQube AI Cloud`). | Mengembalikan string UUID jika `audio_upload_enabled: True` dan audio direkam. Mengembalikan `""` jika audio tidak direkam/diunggah. |
| `audio_unique_id` | `String (UUID)` | Alias dari `audio_id` untuk backward compatibility. | Sama dengan `audio_id`. |
| `snapshot_id` | `String (UUID)` | ID unik foto snapshot kamera dari return API Cloud Upload (`ProtectQube AI Cloud`). | Mengembalikan string UUID jika `camera_snapshot_enabled: True` dan `snapshot_upload_enabled: True`. Mengembalikan `""` jika snapshot tidak diunggah. |
| `snapshot_unique_id` | `String (UUID)` | Alias dari `snapshot_id` untuk backward compatibility. | Sama dengan `snapshot_id`. |
| `verdict` | `String` | Keputusan utama dari evaluasi AI. | Nilai: `"FRAUD"`, `"SUSPICIOUS"`, `"NORMAL"`, `"ERROR"`. |
| `classification` | `String` | Klasifikasi mendalam dari AI LLM. | Nilai: `"FRAUD"`, `"SUSPICIOUS"`, `"NORMAL"`, `"ERROR"`. |
| `confidence` | `Float/Int` | Tingkat kepastian analisis AI (0 - 100%). | Default: `100`. |
| `risk_level` | `String` | Tingkat risiko indikasi pelanggaran. | `"high"` (Fraud), `"medium"` (Suspicious), `"low"` (Normal/Error). |
| `reason` | `String` | Penjelasan ringkas AI LLM mengenai alasan di balik keputusan klasifikasi. | String teks penjelasan atau `""` jika tidak ada penjelasan khusus. |
| `flags` | `Array[String]` | Daftar indikator/kategori kecurangan yang terlanggar. | **Dinamis!** (Lihat penjelasan Bab 3 di bawah). Mengembalikan `[]` untuk `NORMAL`. |
| `evidence` | `Array[String]` | Kutipan kalimat langsung dari transkrip yang menjadi bukti pelanggaran. | Berisi list kutipan teks untuk `FRAUD`/`SUSPICIOUS`. Mengembalikan `[]` untuk `NORMAL`. |
| `transcript` | `String` | Teks hasil transkripsi lengkap dari Speech-To-Text (Whisper). | Teks percakapan bahasa Indonesia / Inggris / Auto-detect. |
| `snapshot_path` | `String` | Path file lokal foto snapshot yang tersimpan di disk Edge Node. | Contoh: `"snapshots/snap_counter_1_SUSPICIOUS_20260813_111522_261.jpg"`. |
| `timestamp` | `String (ISO-8601)` | Waktu presisi kejadian dalam format UTC. | Contoh: `"2026-08-13T11:15:19.520591+00:00"`. |
| `device_name` | `String` | Nama identitas perangkat Edge Node (misal OrangePi). | Configurable via `device_name` (misal: `"VoiceGuard-Store-01"`). |
| `counter_id` | `String` | Slug identifikasi lokasi Meja CS / Counter / Kasir. | Configurable via Counters (misal: `"counter_1"`, `"kasir_meja_2"`). |

---

## 3. Jawaban Spesifik: Apakah Payload Bersifat Dinamis & Bagaimana dengan Event Normal?

### A. Apakah `flags` dan `evidence` Tetap Ada di Event Normal?
* **Ya, field `flags` dan `evidence` tetap disertakan** di dalam payload JSON agar struktur schema konsisten dan memudahkan sistem backend pengumpul data (*parsing/ingestion*).
* **Namun nilainya pada Event NORMAL adalah kosong (`[]`)**, karena pada percakapan normal yang mematuhi SOP, tidak ada flag kecurangan yang terlanggar dan tidak ada bukti pelanggaran.

### B. Bagaimana `flags` Bisa Sifatnya Dinamis? (Dynamic Categories & Flags)
Field `flags` bersifat **Dinamis**. Kategori pelanggaran tidak di-*hardcode* di dalam program, melainkan dibentuk secara dinamis berdasarkan konfigurasi **System Prompt & Categories Configurator** di Web Dashboard:

1. **5 Kategori Standar (Bawaan BFI/Retail):**
   * `leasing_redirection` (Pengalihan ke kompetitor)
   * `personal_contact` (Membagikan kontak/WA pribadi)
   * `payment_diversion` (Mengarahkan bayar ke rekening pribadi)
   * `outside_process` (Transaksi di luar prosedur resmi)
   * `data_manipulation` (Pemalsuan/manipulasi data)

2. **Kategori Kustom Tambahan (Custom Dynamic Categories):**
   Anda dapat menambah atau mengubah kategori baru di Web Dashboard (**Settings $\rightarrow$ System Prompt**), misalnya:
   * `upselling` / `cross_selling` (Penawaran produk tambahan)
   * `unprofessional_language` (Bahasa tidak sopan / kata kasar)
   * `sop_greeting_violation` (Tidak mengucapkan salam standar)
   * `discount_bribe` (Janji diskon / imbalan ilegal)

Jika AI LLM menemukan percakapan yang cocok dengan aturan kategori kustom tersebut, **nama kategori tersebut akan muncul secara otomatis di dalam array `flags` di payload MQTT!**

---

## 4. Dokumentasi Semua Kemungkinan Payload JSON

Berikut adalah contoh nyata (*real-world*) untuk semua kemungkinan payload yang dihasilkan oleh VoiceGuard:

### Kemungkinan 1: Fraud Alert Event (`voiceguard/fraud/alerts`)
> **Kondisi:** AI mendeteksi pelanggaran tingkat tinggi (misal: Pengalihan ke Leasing Kompetitor). Audio dan Snapshot Kamera berhasil diunggah ke Cloud API.

```json
{
  "alert_id": 35,
  "session_id": 7051,
  "audio_id": "8f9a2b1c-9912-4cfc-88ab-123456789abc",
  "audio_unique_id": "8f9a2b1c-9912-4cfc-88ab-123456789abc",
  "snapshot_id": "d9e8f7a6-1122-3344-5566-778899aabbcc",
  "snapshot_unique_id": "d9e8f7a6-1122-3344-5566-778899aabbcc",
  "verdict": "FRAUD",
  "classification": "FRAUD",
  "confidence": 98.5,
  "risk_level": "high",
  "reason": "Petugas secara aktif menyarankan nasabah untuk mengajukan pembiayaan ke BFI Finance daripada aplikasi resmi toko.",
  "flags": [
    "leasing_redirection"
  ],
  "evidence": [
    "Mendingan ke BFI Finance aja mas, bunganya lebih murah dan cairnya hari ini juga"
  ],
  "transcript": "Selamat siang mas, kalau untuk pengajuan ini mendingan ke BFI Finance aja mas, bunganya lebih murah dan cairnya hari ini juga, nanti saya bantu urus.",
  "snapshot_path": "snapshots/snap_counter_1_FRAUD_20260814_140000_123.jpg",
  "timestamp": "2026-08-14T14:00:00.123456+00:00",
  "device_name": "VoiceGuard-Store-01",
  "counter_id": "counter_1"
}
```

---

### Kemungkinan 2: Suspicious Event dengan Kategori Kustom Dinamis (`voiceguard/fraud/alerts`)
> **Kondisi:** AI mendeteksi pelanggaran sedang menggunakan kategori kustom `unprofessional_language` yang diatur di Prompt Configurator.

```json
{
  "alert_id": 32,
  "session_id": 7051,
  "audio_id": "7233f631-2bd5-4da4-a9de-97aa4e68db5c",
  "audio_unique_id": "7233f631-2bd5-4da4-a9de-97aa4e68db5c",
  "snapshot_id": "c83d4714-7b62-4720-ba31-7eb1b9b5982f",
  "snapshot_unique_id": "c83d4714-7b62-4720-ba31-7eb1b9b5982f",
  "verdict": "SUSPICIOUS",
  "classification": "SUSPICIOUS",
  "confidence": 100.0,
  "risk_level": "medium",
  "reason": "Bahasa yang digunakan oleh petugas tidak sopan dan mengandung kata-kata kasar.",
  "flags": [
    "unprofessional_language"
  ],
  "evidence": [
    "komen-komen disini bangsa semua ya. Kota-kota denger ya, Ajin."
  ],
  "transcript": "Kota-kota ini aja ya, baca-kota ini komen-komen disini bangsa semua ya. Kota-kota denger ya, Ajin.",
  "snapshot_path": "snapshots/snap_counter_1_SUSPICIOUS_20260813_111522_261.jpg",
  "timestamp": "2026-08-13T11:15:19.520591+00:00",
  "device_name": "VoiceGuard-Store-01",
  "counter_id": "counter_1"
}
```

---

### Kemungkinan 3: Normal Event dengan Audio + Snapshot (`voiceguard/normal/events`)
> **Kondisi:** Percakapan mematuhi SOP (NORMAL). Opsi `record_on_verdict: "ALL"` aktif, sehingga Audio dan Snapshot sama-sama diunggah dan menghasilkan `audio_id` serta `snapshot_id`.

```json
{
  "segment_id": 2475,
  "session_id": 7052,
  "audio_id": "a9b8c7d6-1234-5678-90ab-cdef12345678",
  "audio_unique_id": "a9b8c7d6-1234-5678-90ab-cdef12345678",
  "snapshot_id": "3f5f818d-0c79-4aa1-87ce-3f0adaeee3ea",
  "snapshot_unique_id": "3f5f818d-0c79-4aa1-87ce-3f0adaeee3ea",
  "verdict": "NORMAL",
  "classification": "NORMAL",
  "confidence": 100.0,
  "risk_level": "low",
  "reason": "Percakapan pelayanan sesuai dengan standar SOP dan ramah.",
  "flags": [],
  "evidence": [],
  "transcript": "Selamat datang Bapak, ada yang bisa saya bantu untuk pembayaran angsuran hari ini?",
  "snapshot_path": "snapshots/snap_counter_1_NORMAL_20260813_111828_829.jpg",
  "timestamp": "2026-08-13T11:18:27.149992+00:00",
  "device_name": "VoiceGuard-Store-01",
  "counter_id": "counter_1"
}
```

---

### Kemungkinan 4: Normal Event Snapshot Only (`voiceguard/normal/events`)
> **Kondisi:** Opsi `record_on_verdict` diatur ke `"BOTH"` (hanya merekam audio jika Fraud/Suspicious), tetapi `snapshot_on_normal_conversation` diatur ke `True`. `snapshot_id` terisi, sedangkan `audio_id` bernilai `""`.

```json
{
  "segment_id": 2473,
  "session_id": 7052,
  "audio_id": "",
  "audio_unique_id": "",
  "snapshot_id": "3f5f818d-0c79-4aa1-87ce-3f0adaeee3ea",
  "snapshot_unique_id": "3f5f818d-0c79-4aa1-87ce-3f0adaeee3ea",
  "verdict": "NORMAL",
  "classification": "NORMAL",
  "confidence": 100.0,
  "risk_level": "low",
  "reason": "Agen menawarkan produk tambahan secara sopan",
  "flags": [],
  "evidence": [],
  "transcript": "Terlalu keti Kau bantu siapin makan Sama minumnya...",
  "snapshot_path": "snapshots/snap_counter_1_NORMAL_20260813_111828_829.jpg",
  "timestamp": "2026-08-13T11:18:27.149992+00:00",
  "device_name": "VoiceGuard-Store-01",
  "counter_id": "counter_1"
}
```

---

### Kemungkinan 5: Event Tanpa Kamera / Tanpa Cloud Upload (Offline Standalone Mode)
> **Kondisi:** Perangkat Edge dijalankan dalam mode offline lokal tanpa terhubung ke Kamera atau Cloud API Upload. Nilai `audio_id` dan `snapshot_id` bernilai `""`, tetapi metadata analisis teks tetap terisi penuh ke MQTT.

```json
{
  "alert_id": 36,
  "session_id": 7053,
  "audio_id": "",
  "audio_unique_id": "",
  "snapshot_id": "",
  "snapshot_unique_id": "",
  "verdict": "SUSPICIOUS",
  "classification": "SUSPICIOUS",
  "confidence": 95.0,
  "risk_level": "medium",
  "reason": "Petugas membagikan nomor WhatsApp pribadi ke pelanggan",
  "flags": [
    "personal_contact"
  ],
  "evidence": [
    "Nanti catat aja WA saya 08123456789"
  ],
  "transcript": "Nanti catat aja WA saya 08123456789 biar gampang komunikasinya mas.",
  "snapshot_path": "",
  "timestamp": "2026-08-14T15:30:00.000000+00:00",
  "device_name": "VoiceGuard-Store-01",
  "counter_id": "counter_2"
}
```

---

## 5. Ringkasan Matriks Kondisi Field

| Kondisi / Skenario | `verdict` | `flags` | `evidence` | `audio_id` | `snapshot_id` | Topik MQTT |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Fraud + Upload Audio & Foto** | `"FRAUD"` | List Flag Terpemicu | List Kutipan Bukti | UUID String | UUID String | `voiceguard/fraud/alerts` |
| **Suspicious + Upload Audio & Foto** | `"SUSPICIOUS"` | List Flag Terpemicu | List Kutipan Bukti | UUID String | UUID String | `voiceguard/fraud/alerts` |
| **Normal + Record ALL + Snapshot** | `"NORMAL"` | `[]` | `[]` | UUID String | UUID String | `voiceguard/normal/events` |
| **Normal + Record BOTH + Snapshot** | `"NORMAL"` | `[]` | `[]` | `""` | UUID String | `voiceguard/normal/events` |
| **Normal + Audio Only** | `"NORMAL"` | `[]` | `[]` | UUID String | `""` | `voiceguard/normal/events` |
| **Normal Standalone (Tanpa Upload)** | `"NORMAL"` | `[]` | `[]` | `""` | `""` | `voiceguard/normal/events` |
