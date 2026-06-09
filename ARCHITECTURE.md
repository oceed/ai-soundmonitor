# VoiceGuard Voice Fraud Detection — Architecture

## Overview

Real-time voice fraud detection system by ProtectQube. Continuously listens via microphone, transcribes speech with STT, classifies for fraud with LLM, records pre/post-event audio clips, and broadcasts alerts via WebSocket UI and MQTT.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     OrangePi 5 Pro (RK3588)                     │
│                                                                  │
│  ┌────────────┐                                                  │
│  │ Microphone │──[ALSA/PyAudio]──►                              │
│  └────────────┘                  │                              │
│                         ┌────────▼────────────────────────────┐ │
│                         │         Backend (FastAPI)           │ │
│                         │                                     │ │
│                         │  ┌─────────────────────────────┐   │ │
│                         │  │     Pipeline Orchestrator    │   │ │
│                         │  │                             │   │ │
│                         │  │  AudioCapture               │   │ │
│                         │  │    │ PCM chunks + ring buf  │   │ │
│                         │  │    ▼                        │   │ │
│                         │  │  VAD (Energy / Silero ONNX) │   │ │
│                         │  │    │ speech segments        │   │ │
│                         │  │    ▼                        │   │ │
│                         │  │  STT Queue                  │   │ │
│                         │  │    │ WAV bytes              │   │ │
│                         │  │    ▼                        │   │ │
│                         │  │  STT Worker                 │   │ │
│                         │  │  ├─ Groq Whisper API        │   │ │
│                         │  │  └─ faster-whisper (local)  │   │ │
│                         │  │    │ transcript text        │   │ │
│                         │  │    ▼                        │   │ │
│                         │  │  LLM Worker                 │   │ │
│                         │  │  ├─ Groq LLM API            │   │ │
│                         │  │  └─ Ollama/RKLLama (local)  │   │ │
│                         │  │    │ verdict + metadata     │   │ │
│                         │  │    ▼                        │   │ │
│                         │  │  Result Handler             │   │ │
│                         │  │  ├─ Save to SQLite          │   │ │
│                         │  │  ├─ WebSocket broadcast     │   │ │
│                         │  │  └─ IF FRAUD/SUSPICIOUS:    │   │ │
│                         │  │     ├─ Save recording       │   │ │
│                         │  │     ├─ Upload to Audio API  │   │ │
│                         │  │     └─ Publish to MQTT      │   │ │
│                         │  └─────────────────────────────┘   │ │
│                         │                                     │ │
│                         │  REST API + WebSocket               │ │
│                         └────────────┬────────────────────────┘ │
│                                      │                           │
│                         ┌────────────▼────────────────────────┐ │
│                         │      Frontend (Vite + React)        │ │
│                         │  ├─ Dashboard (live monitor)        │ │
│                         │  ├─ Alerts (event log)              │ │
│                         │  ├─ Playback (NVR timeline)         │ │
│                         │  └─ Settings (full config)          │ │
│                         └─────────────────────────────────────┘ │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
         │ MQTT Publish                    │ Audio Upload
         ▼                                ▼
   [MQTT Broker]                   [External Audio API]
   Topic: config/topic              POST multipart/form-data
   Payload: {alert_id,              Response: {id: "unique-id"}
             audio_unique_id,
             verdict, confidence,
             reason, flags,
             timestamp}
```

---

## Directory Structure

```
voiceguard-fraud-detection/
├── ARCHITECTURE.md           ← This file
├── docker-compose.yml        ← Orchestration
├── .env.example              ← Environment template
├── .env                      ← Runtime secrets (gitignored)
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py               ← FastAPI app entry point
│   ├── config.py             ← Pydantic settings + runtime config cache
│   ├── database.py           ← SQLAlchemy (SQLite async)
│   ├── models.py             ← ORM models
│   │
│   ├── pipeline/             ← Audio processing pipeline
│   │   ├── audio_capture.py  ← PyAudio microphone capture + ring buffer
│   │   ├── vad.py            ← Voice Activity Detection (Energy + Silero)
│   │   ├── stt.py            ← Speech-to-Text (Groq API + faster-whisper)
│   │   ├── llm.py            ← Fraud LLM (Groq API + Ollama local)
│   │   ├── recorder.py       ← Pre/post buffer WAV/OGG recording
│   │   └── orchestrator.py   ← Pipeline thread coordinator
│   │
│   ├── services/             ← External integrations
│   │   ├── mqtt_service.py   ← MQTT publish (paho-mqtt)
│   │   ├── audio_upload.py   ← Upload audio → get unique ID
│   │   └── retention.py      ← APScheduler cleanup job
│   │
│   ├── api/                  ← FastAPI routers
│   │   ├── auth.py           ← JWT auth endpoints
│   │   ├── ws.py             ← WebSocket endpoint
│   │   ├── alerts.py         ← Alert CRUD
│   │   ├── recordings.py     ← Serve audio files
│   │   ├── config_router.py  ← Runtime config GET/PATCH
│   │   ├── devices.py        ← List audio input devices
│   │   └── sessions.py       ← Session statistics
│   │
│   └── storage/              ← Persistent volume (Docker mount)
│       ├── fraud_detection.db
│       └── recordings/
│           └── YYYY-MM-DD/
│               └── HH-MM-SS_VERDICT.ogg
│
└── frontend/
    ├── Dockerfile
    ├── nginx.conf
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── index.css           ← Design system (CSS variables, dark theme)
        ├── api/                ← REST API client modules
        │   ├── client.js       ← Axios instance with auth interceptor
        │   ├── alerts.js
        │   ├── config.js
        │   └── recordings.js
        ├── hooks/
        │   ├── useWebSocket.js ← Auto-reconnect WS hook
        │   └── useAuth.js      ← JWT auth state
        ├── pages/
        │   ├── Login.jsx
        │   ├── Dashboard.jsx   ← Live waveform + transcript feed
        │   ├── Alerts.jsx      ← Filterable alert event log
        │   ├── Playback.jsx    ← NVR timeline with markers
        │   └── Settings.jsx    ← Tabbed full config
        └── components/
            ├── Layout.jsx
            ├── Sidebar.jsx
            ├── AudioVisualizer.jsx
            ├── Timeline.jsx
            ├── AlertCard.jsx
            ├── ProtectedRoute.jsx
            ├── NotificationToast.jsx
            └── StatusBar.jsx
```

---

## Data Models

### Config (SQLite key-value store)
Runtime-editable configuration persisted in DB and cached in memory.

### RecordingSession
One entry per pipeline start/stop cycle. Tracks aggregate stats.

### Segment
Every STT+LLM cycle produces one segment regardless of verdict.

### Alert
Created only when verdict is FRAUD or SUSPICIOUS. Links to recording file.

---

## Pipeline Flow (Thread Model)

```
Main Thread (FastAPI/uvicorn)
  │
  ├── Orchestrator.start()
  │     ├── Thread: AudioCapture    — continuous mic read → ring buffer + VAD
  │     ├── Thread: STT Worker      — dequeue PCM → transcribe
  │     └── Thread: LLM Worker      — dequeue transcript → analyze → handle result
  │
  └── APScheduler                  — retention cleanup every 6h
```

## WebSocket Event Types

| type | direction | description |
|------|-----------|-------------|
| `vad_state` | server→client | `{state: "speech"|"silence", rms: float}` |
| `stt_progress` | server→client | `{segment_id: int, status: "transcribing"|"done", text: str}` |
| `llm_progress` | server→client | `{segment_id: int, status: "analyzing"|"done"}` |
| `segment_result` | server→client | Full segment result `{id, verdict, confidence, reason, flags, transcript, stt_ms, llm_ms}` |
| `alert` | server→client | `{alert_id, verdict, confidence, timestamp, has_recording}` |
| `pipeline_status` | server→client | `{running, stt_mode, llm_mode, device_name, session_id}` |
| `system_error` | server→client | `{message, component}` |

## MQTT Payload Schema

```json
{
  "alert_id": 42,
  "audio_unique_id": "ext-api-returned-uuid",
  "verdict": "FRAUD",
  "confidence": 91,
  "reason": "Agen mengarahkan pembayaran ke rekening pribadi",
  "flags": ["payment_diversion", "personal_contact"],
  "transcript": "...",
  "timestamp": "2025-01-15T10:30:00Z",
  "device_name": "VoiceGuard-Store-01",
  "session_id": 7
}
```

## Security

- JWT (HS256) with configurable expiry
- Username/password stored as bcrypt hash in DB
- All API endpoints (except `/api/auth/login`) require Bearer token
- WebSocket auth via token query param `?token=<jwt>`
- CORS restricted to configured origins

## Deployment

```bash
# OrangePi 5 Pro (Ubuntu/Debian ARM64)
git clone <repo> && cd voiceguard-fraud-detection
cp .env.example .env
# Edit .env with your Groq API key, MQTT config, etc.
docker-compose up -d
# Access: http://<device-ip>:3000
```
