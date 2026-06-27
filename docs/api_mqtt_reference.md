# VoiceGuard - API & MQTT Reference Documentation

This document describes the APIs, real-time WebSocket streams, external audio uploads, and MQTT payloads utilized by the VoiceGuard application. It details how local applications can fetch audio alerts and how fraud events are exported outside.

---

## 1. System Automation & Operating Modes

| Feature / Service | Mode | Trigger | Description |
| :--- | :--- | :--- | :--- |
| **Audio Capture** | Automatic | Silence / VAD | Automatically records audio inputs, segments them using Voice Activity Detection (VAD), and pushes them to pipeline. |
| **Speech-To-Text (STT)** | Automatic | Segment Ready | Transcribes recorded segments to text in real-time (Local Whisper or Cloud Groq). |
| **Fraud Analysis (LLM)** | Automatic | Transcript Ready | Analyzes segment transcripts using AI models to evaluate fraud risk and assign flags. |
| **WebSocket Stream** | Automatic | State Change | Broadcasts system states, waveforms, RMS volume, and detection progress. |
| **Audio File Upload** | Automatic | Fraud Event | Puts a multipart request of the suspect WAV/OGG file to external storage when marked as FRAUD or SUSPICIOUS. |
| **MQTT Alert Publish** | Automatic | Fraud Event | Publishes the JSON summary of the alert immediately to the MQTT broker. |
| **Capture Control** | Manual | User Action / API POST | Toggles the recording/pipeline process (Start/Stop). |
| **Alert Management** | Manual | User Action / API DELETE| Removes fraud log entries and local audio wav clips from disk. |

---

## 2. Local REST API Endpoints
All API endpoints run on **Port 8013** (Backend service) and require a JWT token in the headers as `Authorization: Bearer <token>` (except public endpoints).

### 2.1. Local Configuration & Alert Retrieval

#### `GET /api/alerts`
- **Description**: Returns list of recorded fraud alerts with optional query filtering (`verdict`, `date_from`, `date_to`, `session_id`).
- **Response Payload Example (`application/json`)**:
```json
{
  "total": 1,
  "skip": 0,
  "limit": 50,
  "items": [
    {
      "id": 24,
      "segment_id": 185,
      "session_id": 8,
      "timestamp": "2026-06-16T11:42:00.000Z",
      "verdict": "FRAUD",
      "classification": "FRAUD",
      "confidence": 0.89,
      "risk_level": "HIGH",
      "reason": "Caller requested confirmation of OTP and bank passwords.",
      "flags": ["otp_request", "social_engineering"],
      "evidence": ["'send me the code now'"],
      "transcript": "Okay, I see. Now please send me the code you received on your SMS so I can verify your card.",
      "recording_path": "data/recordings/session_8/alert_24.wav",
      "recording_filename": "alert_24.wav",
      "recording_duration_s": 12.5,
      "recording_ready": true,
      "pre_buffer_s": 10.0,
      "post_buffer_s": 15.0,
      "audio_upload_id": "cloud_file_id_999",
      "audio_upload_sent": true,
      "mqtt_sent": true,
      "mqtt_sent_at": "2026-06-16T11:42:05.123Z"
    }
  ]
}
```

#### `GET /api/alerts/stats`
- **Description**: Returns summary counts of verdicts and risk levels.
- **Response Payload Example (`application/json`)**:
```json
{
  "total": 45,
  "by_verdict": {
    "FRAUD": 12,
    "SUSPICIOUS": 8,
    "NORMAL": 25
  },
  "by_risk": {
    "HIGH": 12,
    "MEDIUM": 8,
    "LOW": 25
  }
}
```

#### `GET /api/devices`
- **Description**: Lists host capture devices (microphones).
- **Response Payload Example (`application/json`)**:
```json
[
  {
    "id": 0,
    "name": "Built-in Microphone (Analog)",
    "channels": 2,
    "sample_rate": 48000
  }
]
```

#### `GET /api/config`
- **Description**: Get the runtime configurations (VAD settings, STT modes, LLM model choice, external endpoints).
- **Response Payload Example (`application/json`)**:
```json
{
  "device_name": "orange-pi-edge-node",
  "audio_device_index": 0,
  "stt_mode": "local",
  "llm_mode": "local",
  "vad_threshold": 0.5,
  "pre_buffer_seconds": 10.0,
  "post_buffer_seconds": 15.0,
  "mqtt_enabled": true,
  "mqtt_broker_host": "192.168.1.100",
  "mqtt_broker_port": 1883,
  "mqtt_topic": "voiceguard/fraud/alerts",
  "audio_upload_enabled": true,
  "audio_upload_url": "https://api.voiceguard.cloud/v1/audio/upload"
}
```

---

## 3. WebSockets Real-Time Pipeline Events
WebSockets connect on `WS /api/ws`.

- **Events Emitted**:
  - `pipeline_status`: Emitted when pipeline starts/stops.
  - `vad_state`: Broadcasts live volume RMS and VAD status (`speech` or `silence`).
  - `stt_progress`: Broadcasts when a segment is transcribing.
  - `llm_progress`: Broadcasts when transcript is undergoing LLM valuation.
  - `segment_result`: Broadcasts final transcription + verdict for EVERY segment.
  - `alert`: Emitted immediately if the classification is marked as FRAUD/SUSPICIOUS.

- **Example JSON WebSockets Payload (`segment_result`)**:
```json
{
  "type": "segment_result",
  "segment_no": 18,
  "segment_id": 185,
  "transcript": "Hello, I am calling from the bank help desk.",
  "verdict": "SUSPICIOUS",
  "classification": "SUSPICIOUS",
  "confidence": 0.65,
  "risk_level": "MEDIUM",
  "reason": "Caller claims representation of bank help desk.",
  "flags": ["bank_impersonation"],
  "evidence": ["calling from the bank"],
  "stt_ms": 320,
  "llm_ms": 1100,
  "stt_mode": "groq",
  "llm_mode": "groq",
  "timestamp": "2026-06-16T11:42:00.000Z"
}
```

---

## 4. External Integrations (Cloud Uploads & MQTT)

### 4.1. Audio REST Upload
- **URL**: Configurable via `audio_upload_url`
- **Method**: `POST` (Multipart form-data)
- **Headers**: `Authorization: Bearer <api_key>` (if configured)
- **Files Field**: `file` (Suspect `.wav` file binary)
- **Response Extract**: Extracts unique ID via dot path config (e.g., `id` or `data.id`).
- **Response Payload Example (`application/json`)**:
```json
{
  "success": true,
  "id": "cloud_file_id_999",
  "data": {
    "id": "cloud_file_id_999"
  }
}
```

### 4.2. MQTT Alert Publish
- **Topic**: Configurable (Default: `voiceguard/fraud/alerts`)
- **Trigger**: Automatic publish immediately after alert processing and audio upload.
- **JSON Payload Format**:
```json
{
  "alert_id": 24,
  "audio_unique_id": "cloud_file_id_999",
  "verdict": "FRAUD",
  "classification": "FRAUD",
  "confidence": 0.89,
  "risk_level": "HIGH",
  "reason": "Caller requested confirmation of OTP and bank passwords.",
  "flags": ["otp_request", "social_engineering"],
  "evidence": ["'send me the code now'"],
  "transcript": "Okay, I see. Now please send me the code you received on your SMS so I can verify your card.",
  "timestamp": "2026-06-16T11:42:00.000Z",
  "device_name": "orange-pi-edge-node",
  "session_id": 8
}
```
