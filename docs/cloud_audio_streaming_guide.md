# VoiceGuard Real-Time Audio Live Monitoring — Cloud Developer Integration Guide

Dokumen ini panduan teknis untuk **Developer Cloud / Web Dashboard ProtectQube** untuk mengintegrasikan fitur **Real-Time Audio Live Monitoring (Dengar Suara Mic Counter secara Live)** dari perangkat VoiceGuard (Edge Device) ke Web Dashboard Cloud.

---

## 🏗 1. Arsitektur & Spesifikasi Audio

```
[VoiceGuard Device] ─── WebSocket Outbound (Ingest) ───► [Cloud Server Relay] ─── WS Relay ───► [Browser Cloud Dashboard]
 (Push Raw PCM Bytes)                                    (/ws/audio-ingest/...)                   (Web Audio API Playback 🔊)
```

### Spesifikasi Format Audio:
- **Format:** Raw PCM (Uncompressed Binary Bytes)
- **Sample Rate:** `16000 Hz` (16 kHz)
- **Bit Depth:** `16-bit Signed Integer` (Little Endian, 2 bytes per sample)
- **Channels:** `1` (Mono)
- **Bitrate Data:** `32 KB/detik` (sangat ringan untuk streaming bandwidth)
- **Chunk Size:** Sent every ~100ms (~3.2 KB per frame)

---

## 🛰 2. Sisi Backend Cloud (Relay Server)

Developer Cloud perlu membuat **2 Endpoint WebSocket**:

### A. Endpoint Ingest (Menerima Audio dari Device VoiceGuard)

* **URL Path:** `WS /ws/audio-ingest/{device_id}/{counter_id}?token={device_token}`
* **Tipe Data Diterima:** Binary Frames (`ArrayBuffer` / `bytes`)
* **Behavior:** 
  1. Validasi `token` device.
  2. Menerima binary frames PCM dari VoiceGuard.
  3. Meneruskan (*relay*) binary frames tersebut ke semua browser listener yang terhubung di `(device_id, counter_id)`.

#### Contoh Kode Server (Python FastAPI):
```python
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query

app = FastAPI()

# In-memory subscription storage: (device_id, counter_id) -> Set[WebSocket]
dashboard_listeners = {}

@app.websocket("/ws/audio-ingest/{device_id}/{counter_id}")
async def audio_ingest_endpoint(websocket: WebSocket, device_id: str, counter_id: str, token: str = Query(...)):
    # 1. Validasi Token Device
    if token != "YOUR_CONFIGURED_DEVICE_TOKEN":
        await websocket.close(code=4001, reason="Unauthorized device token")
        return

    await websocket.accept()
    channel_key = f"{device_id}:{counter_id}"
    print(f"🟢 Device [{device_id}] counter [{counter_id}] connected to stream audio")

    try:
        while True:
            # Terima binary chunk PCM dari VoiceGuard
            pcm_bytes = await websocket.receive_bytes()
            
            # Relay ke semua browser listeners di channel ini
            listeners = dashboard_listeners.get(channel_key, set()).copy()
            for client_ws in listeners:
                try:
                    await client_ws.send_bytes(pcm_bytes)
                except Exception:
                    dashboard_listeners.get(channel_key, set()).discard(client_ws)
    except (WebSocketDisconnect, Exception):
        print(f"🔴 Device [{device_id}] counter [{counter_id}] disconnected")
```

#### Contoh Kode Server (Node.js / Express-WS):
```javascript
const ws = require('ws');
const wss = new ws.Server({ port: 8080 });

const listeners = new Map(); // "device_id:counter_id" -> Set of client WS

wss.on('connection', (socket, req) => {
  const url = new URL(req.url, 'http://localhost');
  const pathParts = url.pathname.split('/').filter(Boolean); // ['ws', 'audio-ingest', 'device_id', 'counter_id']
  const type = pathParts[1]; // 'audio-ingest' or 'audio-listen'
  const deviceId = pathParts[2];
  const counterId = pathParts[3];
  const channelKey = `${deviceId}:${counterId}`;

  if (type === 'audio-ingest') {
    // Receive from VoiceGuard Edge Device
    socket.on('message', (pcmBuffer, isBinary) => {
      if (!isBinary) return;
      const channelClients = listeners.get(channelKey);
      if (channelClients) {
        for (const client of channelClients) {
          if (client.readyState === ws.OPEN) {
            client.send(pcmBuffer, { binary: true });
          }
        }
      }
    });
  } else if (type === 'audio-listen') {
    // Register Browser Dashboard Client
    if (!listeners.has(channelKey)) listeners.set(channelKey, new Set());
    listeners.get(channelKey).add(socket);

    socket.on('close', () => {
      listeners.get(channelKey)?.delete(socket);
    });
  }
});
```

---

### B. Endpoint Listen (Menyediakan Stream Audio ke Browser Dashboard)

* **URL Path:** `WS /ws/audio-listen/{device_id}/{counter_id}?token={user_jwt}`
* **Tipe Data Dikirim:** Binary Frames (Raw PCM bytes dari device)
* **Behavior:** Menyambungkan WebSocket browser dashboard pengguna ke channel `(device_id, counter_id)`.

#### Contoh Kode Server (Python FastAPI):
```python
@app.websocket("/ws/audio-listen/{device_id}/{counter_id}")
async def audio_listen_endpoint(websocket: WebSocket, device_id: str, counter_id: str, token: str = Query(...)):
    # 1. Validasi Token JWT User Dashboard
    # user = validate_jwt(token)
    
    await websocket.accept()
    channel_key = f"{device_id}:{counter_id}"
    if channel_key not in dashboard_listeners:
        dashboard_listeners[channel_key] = set()
    dashboard_listeners[channel_key].add(websocket)
    print(f"👤 Browser Dashboard listening to [{channel_key}]")

    try:
        while True:
            # Keepalive ping/pong
            msg = await websocket.receive_text()
    except (WebSocketDisconnect, Exception):
        dashboard_listeners.get(channel_key, set()).discard(websocket)
        print(f"👤 Browser Dashboard stopped listening to [{channel_key}]")
```

---

## 🔊 3. Sisi Frontend Cloud (Web Audio API Playback di Browser)

Di browser dashboard Cloud (React / Vue / Vanilla JS), browser menerima `ArrayBuffer` (raw PCM 16kHz Int16) via WebSocket, lalu di-decode menjadi `Float32` dan di-play tanpa celah (*gapless playback*) menggunakan **Web Audio API**.

### Custom React Hook (`useCloudAudioStream.js`):

```javascript
import { useCallback, useEffect, useRef, useState } from 'react';

const SAMPLE_RATE = 16000; // Raw PCM 16kHz dari VoiceGuard
const CHANNELS = 1;

export function useCloudAudioStream(deviceId, counterId, cloudWsBaseUrl, userToken) {
  const [isListening, setIsListening] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [volume, setVolumeState] = useState(1.0);
  const [error, setError] = useState(null);

  const wsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const gainNodeRef = useRef(null);
  const nextPlayTimeRef = useRef(0);

  // Set Volume (0.0 to 2.0)
  const setVolume = useCallback((v) => {
    setVolumeState(v);
    if (gainNodeRef.current && audioCtxRef.current) {
      gainNodeRef.current.gain.setTargetAtTime(v, audioCtxRef.current.currentTime, 0.02);
    }
  }, []);

  // Decode raw Int16 PCM bytes -> Float32 AudioBuffer & schedule playback
  const schedulePcmChunk = useCallback((arrayBuffer) => {
    if (!audioCtxRef.current || !gainNodeRef.current) return;

    const ctx = audioCtxRef.current;
    const int16 = new Int16Array(arrayBuffer);
    const float32 = new Float32Array(int16.length);

    // Normalize Int16 [-32768, 32767] -> Float32 [-1.0, 1.0]
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0;
    }

    const audioBuffer = ctx.createBuffer(CHANNELS, float32.length, SAMPLE_RATE);
    audioBuffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gainNodeRef.current);

    // Schedule playback seamlessly right after previous chunk finishes
    const now = ctx.currentTime;
    const startAt = Math.max(now, nextPlayTimeRef.current);
    source.start(startAt);
    nextPlayTimeRef.current = startAt + audioBuffer.duration;
  }, []);

  const stop = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
      gainNodeRef.current = null;
    }
    nextPlayTimeRef.current = 0;
    setIsListening(false);
    setIsConnected(false);
  }, []);

  const start = useCallback(() => {
    if (isListening || !deviceId || !counterId) return;

    // 1. Initialize Web Audio Context
    const ctx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: SAMPLE_RATE,
      latencyHint: 'playback',
    });
    const gainNode = ctx.createGain();
    gainNode.gain.value = volume;
    gainNode.connect(ctx.destination);

    audioCtxRef.current = ctx;
    gainNodeRef.current = gainNode;
    nextPlayTimeRef.current = ctx.currentTime + 0.08; // 80ms startup buffer

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    // 2. Connect to Cloud WebSocket Listen Endpoint
    const wsUrl = `${cloudWsBaseUrl.replace(/^http/, 'ws')}/ws/audio-listen/${deviceId}/${counterId}?token=${userToken}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer'; // PENTING: Set binaryType to arraybuffer
    wsRef.current = ws;

    ws.onopen = () => {
      setIsListening(true);
      setIsConnected(true);
      setError(null);
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer && event.data.byteLength > 0) {
        schedulePcmChunk(event.data);
      }
    };

    ws.onerror = () => {
      setError('Connection error — VoiceGuard device may be offline');
    };

    ws.onclose = () => {
      setIsConnected(false);
      setIsListening(false);
    };
  }, [deviceId, counterId, cloudWsBaseUrl, userToken, isListening, volume, schedulePcmChunk]);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return { isListening, isConnected, volume, setVolume, error, start, stop };
}
```

---

### Contoh Komponen UI Tombol "Listen Live" di React Cloud Dashboard:

```jsx
import React from 'react';
import { useCloudAudioStream } from './useCloudAudioStream';

export function CounterAudioMonitor({ deviceId, counterId, cloudUrl, userToken }) {
  const { isListening, isConnected, volume, setVolume, error, start, stop } =
    useCloudAudioStream(deviceId, counterId, cloudUrl, userToken);

  return (
    <div style={{ padding: 12, border: '1px solid #ccc', borderRadius: 8 }}>
      <h4>🎙 Live Audio Monitor — {counterId}</h4>
      
      {error && <p style={{ color: 'red' }}>⚠️ {error}</p>}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          onClick={isListening ? stop : start}
          style={{
            background: isListening ? '#e74c3c' : '#2ecc71',
            color: '#fff',
            padding: '6px 12px',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          {isListening ? '⏹ Stop Listening' : '🎙 Listen Live'}
        </button>

        {isListening && (
          <>
            <span>{isConnected ? '🔴 LIVE (Streaming)' : 'Connecting...'}</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              title="Volume"
            />
          </>
        )}
      </div>
    </div>
  );
}
```

---

## ⚡ Summary Checklist untuk Developer Cloud:

1. [ ] Buat WebSocket endpoint `WS /ws/audio-ingest/{device_id}/{counter_id}` untuk terima bytes dari VoiceGuard.
2. [ ] Buat WebSocket endpoint `WS /ws/audio-listen/{device_id}/{counter_id}` untuk me-relay bytes ke browser pengguna.
3. [ ] Gunakan `binaryType = 'arraybuffer'` di JavaScript browser saat terima data.
4. [ ] Gunakan Web Audio API (`AudioContext` 16000Hz + `Float32Array` conversion) untuk memainkan audio dengan lancar (*gapless*).
