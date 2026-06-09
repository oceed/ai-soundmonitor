# BFI Finance — Voice Fraud Detection System

Real-time voice fraud detection for BFI Finance store locations. Continuously monitors conversations via microphone, transcribes speech (Groq Whisper API or local faster-whisper), classifies fraud indicators (Groq LLM or local Ollama), and alerts via web dashboard + MQTT.

## Quick Start (OrangePi 5 Pro)

```bash
# 1. Clone repository
git clone <repo-url> bfi-fraud-detection
cd bfi-fraud-detection

# 2. Configure environment
cp .env.example .env
nano .env  # Set your Groq API key, MQTT config, etc.

# 3. Make sure audio group is available
sudo usermod -aG audio $USER

# 4. Start the system
docker-compose up -d

# 5. Access the web dashboard
# Open: http://<orangepi-ip>:3000
# Default login: admin / admin123
```

## Requirements (Host System)

- Docker + Docker Compose
- Audio device accessible at `/dev/snd`
- Ollama/RKLLama installed natively (for local LLM mode)

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full system architecture, data models, and API reference.

## Configuration

All settings configurable via web UI at `http://<device>:3000/settings`:

| Setting | Description |
|---------|-------------|
| STT Mode | `api` (Groq), `local` (faster-whisper), `auto` |
| LLM Mode | `api` (Groq), `local` (Ollama/RKLLama), `auto` |
| Mic Device | Auto-detect or specify device index |
| Pre/Post Buffer | Seconds to record before/after fraud detection |
| Retention | Days to keep recordings and alerts |
| MQTT | Alert publishing to MQTT broker |
| Audio Upload | Upload recordings to external API for unique ID |
| System Prompt | Fully editable fraud detection instructions |

## Default Credentials

- Username: `admin`
- Password: `admin123`

⚠️ **Change the password immediately after first login!**

## Updating System Prompt

Navigate to `Settings → System Prompt` to edit the AI instructions. Changes take effect immediately for new speech segments without restart.

## MQTT Payload

When MQTT is enabled, each alert publishes:

```json
{
  "alert_id": 42,
  "audio_unique_id": "ext-api-returned-uuid",
  "verdict": "FRAUD",
  "classification": "FRAUD_PAYMENT_DIVERSION",
  "confidence": 91,
  "risk_level": "critical",
  "reason": "Agen mengarahkan pembayaran ke rekening pribadi",
  "flags": ["payment_diversion"],
  "transcript": "...",
  "timestamp": "2025-01-15T10:30:00Z",
  "device_name": "BFI-Store-01",
  "session_id": 7
}
```
