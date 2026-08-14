# VoiceGuard — Streamlined MQTT Payload Specification & Architecture Guide

Dokumen ini berisi spesifikasi teknis lengkap dan ringkas mengenai **MQTT Payload** yang dipublikasikan oleh aplikasi **VoiceGuard** ke MQTT Data Broker (termasuk broker lokal maupun Cloud MQTT Broker seperti `72.60.78.162`).

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

Setiap payload MQTT berformat **JSON UTF-8** yang ringkas tanpa redundansi alias field. Berikut adalah daftar resmi seluruh field:

| Nama Field | Tipe Data | Deskripsi & Semantik | Kondisi & Nilai Default |
| :--- | :--- | :--- | :--- |
| `alert_id` / `segment_id` | `Integer` | Unique Auto-increment ID transaksi di Database VoiceGuard lokal. | `alert_id` pada topik Alerts, `segment_id` pada topik Normal. |
| `session_id` | `Integer` | ID sesi jalannya aplikasi pipeline VoiceGuard. | Mengidentifikasi siklus start/stop engine. |
| `audio_id` | `String (UUID)` | ID unik file rekaman audio dari return API Cloud Upload (`ProtectQube AI Cloud`). | Mengembalikan string UUID jika `audio_upload_enabled: True` dan audio direkam. Mengembalikan `""` jika audio tidak direkam/diunggah. |
| `snapshot_id` | `String (UUID)` | ID unik foto snapshot kamera dari return API Cloud Upload (`ProtectQube AI Cloud`). | Mengembalikan string UUID jika `camera_snapshot_enabled: True` dan `snapshot_upload_enabled: True`. Mengembalikan `""` jika snapshot tidak diunggah. |
| `verdict` | `String` | Keputusan utama dari evaluasi AI. | Nilai: `"FRAUD"`, `"SUSPICIOUS"`, `"NORMAL"`, `"ERROR"`. |
| `classification` | `String` | Klasifikasi mendalam dari AI LLM. | Nilai: `"FRAUD"`, `"SUSPICIOUS"`, `"NORMAL"`, `"ERROR"`. |
| `confidence` | `Float/Int` | Tingkat kepastian analisis AI (0 - 100%). | Default: `100`. |
| `risk_level` | `String` | Tingkat risiko indikasi pelanggaran. | `"high"` (Fraud), `"medium"` (Suspicious), `"low"` (Normal/Error). |
| `reason` | `String` | Penjelasan ringkas AI LLM mengenai alasan di balik keputusan klasifikasi. | String teks penjelasan atau `""` jika tidak ada penjelasan khusus. |
| `flags` | `Array[String]` | Daftar indikator/kategori kecurangan yang terlanggar. | **Dinamis!** (Lihat penjelasan Bab 3). Mengembalikan `[]` untuk `NORMAL`. |
| `evidence` | `Array[String]` | Kutipan kalimat langsung dari transkrip yang menjadi bukti pelanggaran. | Berisi list kutipan teks untuk `FRAUD`/`SUSPICIOUS`. Mengembalikan `[]` untuk `NORMAL`. |
| `transcript` | `String` | Teks hasil transkripsi lengkap dari Speech-To-Text (Whisper). | Teks percakapan bahasa Indonesia / Inggris / Auto-detect. |
| `snapshot_path` | `String` | Path file lokal foto snapshot yang tersimpan di disk Edge Node. | Contoh: `"snapshots/snap_counter_1_SUSPICIOUS_20260813_111522_261.jpg"`. |
| `timestamp` | `String (ISO-8601)` | Waktu presisi kejadian dalam format UTC. | Contoh: `"2026-08-13T11:15:19.520591+00:00"`. |
| `device_id` | `String` | Unique Identifier Perangkat Edge Node (Hardware/Node ID). | Contoh: `"edge-device-01"`. |
| `device_name` | `String` | Nama identitas lokasi/perangkat Edge Node. | Contoh: `"VoiceGuard-Store-01"`. |
| `counter_id` | `String` | Slug identifikasi lokasi Meja CS / Counter / Kasir. | Contoh: `"counter_1"`, `"kasir_meja_2"`. |

---

## 3. Dinamika Flags & Perilaku Event Normal

### A. Penyederhanaan Key (Penggabungan Field Alias Redundan)
Field alias lama seperti `audio_unique_id` dan `snapshot_unique_id` telah **dihapus** demi menghemat ukuran payload dan mencegah kebingungan data. Sistem kini secara konsisten hanya menggunakan **`audio_id`** dan **`snapshot_id`**.

### B. Penambahan `device_id`
Field **`device_id`** telah ditambahkan ke seluruh payload MQTT untuk memudahkan pemetaan dan identifikasi hardware Edge Node di sistem cloud/central analytics.

### C. Karakteristik Event NORMAL vs ALERT
* **Field `flags` & `evidence`:** Tetap disertakan di semua payload dengan nilai **`[]`** (empty array) pada event `NORMAL`.
* **Field `flags` Dinamis:** Kategori pelanggaran bersifat dinamis berdasarkan Prompt Configurator di Web UI. Jika pengguna menambah kategori baru seperti `upsell_cross_sell`, `unprofessional_language`, atau `standard_greeting`, kategori tersebut akan otomatis muncul di dalam array `flags` saat terdeteksi.

---

## 4. Contoh Payload Resmi (Single Unified JSON Payload Schema)

### Contoh 1: Fraud Alert Event (`voiceguard/fraud/alerts`)
> **Kondisi:** AI mendeteksi indikasi Fraud pengalihan ke leasing kompetitor. Audio & Snapshot berhasil diunggah.

```json
{
  "alert_id": 35,
  "session_id": 7051,
  "audio_id": "8f9a2b1c-9912-4cfc-88ab-123456789abc",
  "snapshot_id": "d9e8f7a6-1122-3344-5566-778899aabbcc",
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
  "device_id": "edge-device-01",
  "device_name": "VoiceGuard-Store-01",
  "counter_id": "counter_1"
}
```

---

### Contoh 2: Suspicious Event Kategori Kustom Dinamis (`voiceguard/fraud/alerts`)
> **Kondisi:** AI mendeteksi pelanggaran bahasa tidak sopan (`unprofessional_language`).

```json
{
  "alert_id": 32,
  "session_id": 7051,
  "audio_id": "7233f631-2bd5-4da4-a9de-97aa4e68db5c",
  "snapshot_id": "c83d4714-7b62-4720-ba31-7eb1b9b5982f",
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
  "device_id": "edge-device-01",
  "device_name": "VoiceGuard-Store-01",
  "counter_id": "counter_1"
}
```

---

### Contoh 3: Normal Event dengan Audio & Snapshot (`voiceguard/normal/events`)
> **Kondisi:** Percakapan Normal dengan `record_on_verdict: "ALL"`. `audio_id` dan `snapshot_id` keduanya terisi.

```json
{
  "segment_id": 2475,
  "session_id": 7052,
  "audio_id": "a9b8c7d6-1234-5678-90ab-cdef12345678",
  "snapshot_id": "3f5f818d-0c79-4aa1-87ce-3f0adaeee3ea",
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
  "device_id": "edge-device-01",
  "device_name": "VoiceGuard-Store-01",
  "counter_id": "counter_1"
}
```

---

### Contoh 4: Normal Event Snapshot Only (`voiceguard/normal/events`)
> **Kondisi:** Percakapan Normal dengan `record_on_verdict: "BOTH"`. `snapshot_id` terisi, `audio_id` bernilai `""`.

```json
{
  "segment_id": 2473,
  "session_id": 7052,
  "audio_id": "",
  "snapshot_id": "3f5f818d-0c79-4aa1-87ce-3f0adaeee3ea",
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
  "device_id": "edge-device-01",
  "device_name": "VoiceGuard-Store-01",
  "counter_id": "counter_1"
}
```

---

## 5. Ringkasan Matriks Kondisi Field Terbaru

| Kondisi / Skenario | `verdict` | `flags` | `evidence` | `audio_id` | `snapshot_id` | `device_id` | Topik MQTT |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Fraud + Upload Audio & Foto** | `"FRAUD"` | List Flag Terpemicu | List Kutipan Bukti | UUID String | UUID String | `"edge-device-01"` | `voiceguard/fraud/alerts` |
| **Suspicious + Upload Audio & Foto** | `"SUSPICIOUS"` | List Flag Dinamis | List Kutipan Bukti | UUID String | UUID String | `"edge-device-01"` | `voiceguard/fraud/alerts` |
| **Normal + Record ALL + Snapshot** | `"NORMAL"` | `[]` | `[]` | UUID String | UUID String | `"edge-device-01"` | `voiceguard/normal/events` |
| **Normal + Record BOTH + Snapshot** | `"NORMAL"` | `[]` | `[]` | `""` | UUID String | `"edge-device-01"` | `voiceguard/normal/events` |
| **Offline Mode (Tanpa Cloud Upload)** | `"FRAUD"` / `"NORMAL"` | Sesuai Verdict | Sesuai Verdict | `""` | `""` | `"edge-device-01"` | Sesuai Topik |
