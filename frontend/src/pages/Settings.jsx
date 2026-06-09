import { useCallback, useEffect, useState } from 'react'
import {
  getConfig, patchConfig, getPrompt, updatePrompt,
  getAudioDevices, changePassword
} from '../api/config'
import { useToast } from '../components/NotificationToast'

const TABS = ['General', 'Audio & VAD', 'STT', 'LLM', 'Recording', 'Notifications', 'System Prompt', 'Security']

export function Settings() {
  const [activeTab, setActiveTab] = useState('General')
  const [config, setConfig] = useState({})
  const [prompt, setPrompt] = useState('')
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const { addToast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cfg, pmt, devs] = await Promise.all([
        getConfig(), getPrompt(), getAudioDevices()
      ])
      setConfig(cfg)
      setPrompt(pmt.system_prompt || '')
      setDevices(devs.devices || [])
    } catch (e) {
      addToast({ type: 'warning', title: 'Failed to load config', body: e.message })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [])

  const save = async (updates) => {
    setSaving(true)
    try {
      await patchConfig(updates)
      setConfig(prev => ({ ...prev, ...updates }))
      addToast({ type: 'success', title: 'Settings saved' })
    } catch (e) {
      addToast({ type: 'warning', title: 'Save failed', body: e.message })
    } finally {
      setSaving(false)
    }
  }

  const savePrompt = async () => {
    setSaving(true)
    try {
      await updatePrompt(prompt)
      addToast({ type: 'success', title: 'System prompt updated' })
    } catch (e) {
      addToast({ type: 'warning', title: 'Save failed', body: e.message })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div className="spinner" style={{ width: 32, height: 32 }} />
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 0', flexShrink: 0 }}>
        <div className="page-title" style={{ marginBottom: 4 }}>Settings</div>
        <div className="page-subtitle">Configure detection, models, and notifications</div>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '16px 24px' }}>
        {/* Tabs */}
        <div className="tabs" style={{ flexShrink: 0 }}>
          {TABS.map(t => (
            <button key={t} className={`tab-btn ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTab(t)}>
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {activeTab === 'General' && <GeneralTab config={config} onSave={save} saving={saving} />}
          {activeTab === 'Audio & VAD' && <AudioTab config={config} devices={devices} onSave={save} saving={saving} showAdvanced={showAdvanced} setShowAdvanced={setShowAdvanced} />}
          {activeTab === 'STT' && <STTTab config={config} onSave={save} saving={saving} />}
          {activeTab === 'LLM' && <LLMTab config={config} onSave={save} saving={saving} />}
          {activeTab === 'Recording' && <RecordingTab config={config} onSave={save} saving={saving} />}
          {activeTab === 'Notifications' && <NotificationsTab config={config} onSave={save} saving={saving} />}
          {activeTab === 'System Prompt' && <PromptTab prompt={prompt} setPrompt={setPrompt} onSave={savePrompt} saving={saving} config={config} />}
          {activeTab === 'Security' && <SecurityTab />}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// Tab components
// ─────────────────────────────────────────────────────────

function SaveBtn({ saving, onClick }) {
  return (
    <button className="btn btn-primary" onClick={onClick} disabled={saving}>
      {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : null}
      {saving ? 'Saving...' : 'Save Changes'}
    </button>
  )
}

function SettingRow({ label, hint, children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      padding: '16px 0', borderBottom: '1px solid var(--border)', gap: 20,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{label}</div>
        {hint && <div className="form-hint">{hint}</div>}
      </div>
      <div style={{ flexShrink: 0, minWidth: 200 }}>{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange }) {
  return (
    <label className="toggle-switch">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="toggle-slider" />
    </label>
  )
}

function GeneralTab({ config, onSave, saving }) {
  const [retDays, setRetDays] = useState(config.retention_days ?? 7)
  const [devName, setDevName] = useState(config.device_name ?? 'BFI-Store-01')

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <SettingRow label="Device Name" hint="Identifier for this store/location in alerts and MQTT">
        <input className="form-input" value={devName} onChange={e => setDevName(e.target.value)} />
      </SettingRow>
      <SettingRow label="Data Retention" hint="Recordings and alerts older than this will be automatically deleted">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="number" className="form-input" value={retDays} onChange={e => setRetDays(Number(e.target.value))} min={1} max={365} style={{ width: 80 }} />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>days</span>
        </div>
      </SettingRow>
      <div style={{ paddingTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <SaveBtn saving={saving} onClick={() => onSave({ retention_days: retDays, device_name: devName })} />
      </div>
    </div>
  )
}

function AudioTab({ config, devices, onSave, saving, showAdvanced, setShowAdvanced }) {
  const [deviceIndex, setDeviceIndex] = useState(config.audio_device_index ?? -1)
  const [threshold, setThreshold] = useState(config.vad_threshold ?? 300)
  const [silenceDuration, setSilenceDuration] = useState(config.vad_silence_duration ?? 1.5)
  const [minSpeech, setMinSpeech] = useState(config.vad_min_speech_duration ?? 0.5)
  const [maxSegment, setMaxSegment] = useState(config.vad_max_segment_duration ?? 15)

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <SettingRow label="Microphone Device" hint="Select the audio input device. -1 = auto-detect">
          <select className="form-select" value={deviceIndex} onChange={e => setDeviceIndex(Number(e.target.value))}>
            <option value={-1}>Auto-detect</option>
            {devices.map(d => (
              <option key={d.index} value={d.index}>{d.index}: {d.name}</option>
            ))}
          </select>
        </SettingRow>

        <SettingRow label="VAD Threshold (RMS)" hint="Energy level to detect speech. Increase in noisy environments">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="range" min={50} max={1000} step={10} value={threshold} onChange={e => setThreshold(Number(e.target.value))} style={{ flex: 1 }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, minWidth: 40 }}>{threshold}</span>
          </div>
        </SettingRow>

        {/* Advanced toggle */}
        <div
          className="collapsible-header"
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{ color: 'var(--accent)', fontSize: 13 }}
        >
          <span>Advanced VAD Settings</span>
          <span>{showAdvanced ? '▲' : '▼'}</span>
        </div>

        {showAdvanced && (
          <>
            <SettingRow label="Silence Duration" hint="Seconds of silence to end a speech segment">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="number" className="form-input" value={silenceDuration} onChange={e => setSilenceDuration(Number(e.target.value))} step={0.1} min={0.1} max={5} style={{ width: 80 }} />
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>seconds</span>
              </div>
            </SettingRow>
            <SettingRow label="Min Speech Duration" hint="Minimum speech segment length to send for STT">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="number" className="form-input" value={minSpeech} onChange={e => setMinSpeech(Number(e.target.value))} step={0.1} min={0.1} max={3} style={{ width: 80 }} />
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>seconds</span>
              </div>
            </SettingRow>
            <SettingRow label="Max Segment Duration" hint="Force-flush segment if speech exceeds this duration">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="number" className="form-input" value={maxSegment} onChange={e => setMaxSegment(Number(e.target.value))} step={1} min={5} max={60} style={{ width: 80 }} />
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>seconds</span>
              </div>
            </SettingRow>
          </>
        )}

        <div style={{ paddingTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <SaveBtn saving={saving} onClick={() => onSave({
            audio_device_index: deviceIndex,
            vad_threshold: threshold,
            vad_silence_duration: silenceDuration,
            vad_min_speech_duration: minSpeech,
            vad_max_segment_duration: maxSegment,
          })} />
        </div>
      </div>
    </>
  )
}

function STTTab({ config, onSave, saving }) {
  const [mode, setMode] = useState(config.stt_mode ?? 'auto')
  const [localModel, setLocalModel] = useState(config.local_whisper_model ?? 'base')

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <SettingRow label="STT Mode" hint="API = Groq Whisper (fast, requires internet). Local = faster-whisper CPU. Auto = try API, fallback to local">
        <select className="form-select" value={mode} onChange={e => setMode(e.target.value)}>
          <option value="auto">Auto (API → Local fallback)</option>
          <option value="api">API Only (Groq Whisper)</option>
          <option value="local">Local Only (faster-whisper)</option>
        </select>
      </SettingRow>
      <SettingRow label="Local Whisper Model" hint="Smaller = faster but less accurate. Recommended: base or small for OrangePi">
        <select className="form-select" value={localModel} onChange={e => setLocalModel(e.target.value)}>
          {['tiny', 'base', 'small', 'medium', 'large-v3'].map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </SettingRow>
      <div style={{ paddingTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <SaveBtn saving={saving} onClick={() => onSave({ stt_mode: mode, local_whisper_model: localModel })} />
      </div>
    </div>
  )
}

function LLMTab({ config, onSave, saving }) {
  const [mode, setMode] = useState(config.llm_mode ?? 'auto')
  const [localUrl, setLocalUrl] = useState(config.local_llm_url ?? 'http://localhost:11434')
  const [localModel, setLocalModel] = useState(config.local_llm_model ?? 'qwen2.5:1.5b')
  const [endpointType, setEndpointType] = useState(config.local_llm_endpoint_type ?? 'ollama')

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <SettingRow label="LLM Mode" hint="API = Groq LLM (fast). Local = Ollama/RKLLama. Auto = try API, fallback to local">
        <select className="form-select" value={mode} onChange={e => setMode(e.target.value)}>
          <option value="auto">Auto (API → Local fallback)</option>
          <option value="api">API Only (Groq)</option>
          <option value="local">Local Only (Ollama/RKLLama)</option>
        </select>
      </SettingRow>
      <SettingRow label="Local LLM URL" hint="Ollama default: http://localhost:11434, RKLLama: http://localhost:8000">
        <input className="form-input" value={localUrl} onChange={e => setLocalUrl(e.target.value)} placeholder="http://localhost:11434" />
      </SettingRow>
      <SettingRow label="Local LLM Model" hint="Model name as installed in Ollama/RKLLama">
        <input className="form-input" value={localModel} onChange={e => setLocalModel(e.target.value)} placeholder="qwen2.5:1.5b" />
      </SettingRow>
      <SettingRow label="Endpoint Type" hint="Ollama = /api/generate format. OpenAI = /v1/chat/completions format">
        <select className="form-select" value={endpointType} onChange={e => setEndpointType(e.target.value)}>
          <option value="ollama">Ollama (/api/generate)</option>
          <option value="openai">OpenAI Compatible (/v1/chat/completions)</option>
        </select>
      </SettingRow>
      <div style={{ paddingTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <SaveBtn saving={saving} onClick={() => onSave({ llm_mode: mode, local_llm_url: localUrl, local_llm_model: localModel, local_llm_endpoint_type: endpointType })} />
      </div>
    </div>
  )
}

function RecordingTab({ config, onSave, saving }) {
  const [preBuffer, setPreBuffer] = useState(config.pre_buffer_seconds ?? 10)
  const [postBuffer, setPostBuffer] = useState(config.post_buffer_seconds ?? 15)
  const [recordOn, setRecordOn] = useState(config.record_on_verdict ?? 'BOTH')

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <SettingRow label="Pre-Event Buffer" hint="Seconds of audio to keep BEFORE the fraud was detected">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="number" className="form-input" value={preBuffer} onChange={e => setPreBuffer(Number(e.target.value))} min={1} max={60} style={{ width: 80 }} />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>seconds</span>
        </div>
      </SettingRow>
      <SettingRow label="Post-Event Buffer" hint="Seconds of audio to continue recording AFTER the fraud was detected">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="number" className="form-input" value={postBuffer} onChange={e => setPostBuffer(Number(e.target.value))} min={1} max={120} style={{ width: 80 }} />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>seconds</span>
        </div>
      </SettingRow>
      <SettingRow label="Record On Verdict" hint="Which verdicts trigger a recording">
        <select className="form-select" value={recordOn} onChange={e => setRecordOn(e.target.value)}>
          <option value="BOTH">Both FRAUD and SUSPICIOUS</option>
          <option value="FRAUD">FRAUD only</option>
          <option value="SUSPICIOUS">SUSPICIOUS only</option>
        </select>
      </SettingRow>
      <div style={{ paddingTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <SaveBtn saving={saving} onClick={() => onSave({ pre_buffer_seconds: preBuffer, post_buffer_seconds: postBuffer, record_on_verdict: recordOn })} />
      </div>
    </div>
  )
}

function NotificationsTab({ config, onSave, saving }) {
  const [mqttEnabled, setMqttEnabled] = useState(config.mqtt_enabled ?? false)
  const [mqttHost, setMqttHost] = useState(config.mqtt_broker_host ?? '')
  const [mqttPort, setMqttPort] = useState(config.mqtt_broker_port ?? 1883)
  const [mqttTopic, setMqttTopic] = useState(config.mqtt_topic ?? 'bfi/fraud/alerts')
  const [mqttUser, setMqttUser] = useState(config.mqtt_username ?? '')
  const [mqttPass, setMqttPass] = useState('')
  const [mqttQos, setMqttQos] = useState(config.mqtt_qos ?? 1)

  const [uploadEnabled, setUploadEnabled] = useState(config.audio_upload_enabled ?? false)
  const [uploadUrl, setUploadUrl] = useState(config.audio_upload_url ?? '')
  const [uploadKey, setUploadKey] = useState('')
  const [uploadIdPath, setUploadIdPath] = useState(config.audio_upload_id_path ?? 'id')

  const handleSave = () => {
    const updates = {
      mqtt_enabled: mqttEnabled,
      mqtt_broker_host: mqttHost,
      mqtt_broker_port: mqttPort,
      mqtt_topic: mqttTopic,
      mqtt_username: mqttUser,
      mqtt_qos: mqttQos,
      audio_upload_enabled: uploadEnabled,
      audio_upload_url: uploadUrl,
      audio_upload_id_path: uploadIdPath,
    }
    if (mqttPass) updates.mqtt_password = mqttPass
    if (uploadKey) updates.audio_upload_api_key = uploadKey
    onSave(updates)
  }

  return (
    <>
      {/* MQTT */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3>MQTT Integration</h3>
          <Toggle checked={mqttEnabled} onChange={setMqttEnabled} />
        </div>

        {mqttEnabled && (
          <>
            <SettingRow label="Broker Host" hint="MQTT broker IP or hostname">
              <input className="form-input" value={mqttHost} onChange={e => setMqttHost(e.target.value)} placeholder="192.168.1.100" />
            </SettingRow>
            <SettingRow label="Broker Port">
              <input type="number" className="form-input" value={mqttPort} onChange={e => setMqttPort(Number(e.target.value))} />
            </SettingRow>
            <SettingRow label="Topic" hint="MQTT topic to publish alerts to">
              <input className="form-input" value={mqttTopic} onChange={e => setMqttTopic(e.target.value)} />
            </SettingRow>
            <SettingRow label="Username">
              <input className="form-input" value={mqttUser} onChange={e => setMqttUser(e.target.value)} />
            </SettingRow>
            <SettingRow label="Password">
              <input type="password" className="form-input" value={mqttPass} onChange={e => setMqttPass(e.target.value)} placeholder="Leave blank to keep current" />
            </SettingRow>
            <SettingRow label="QoS Level">
              <select className="form-select" value={mqttQos} onChange={e => setMqttQos(Number(e.target.value))}>
                <option value={0}>0 - At most once</option>
                <option value={1}>1 - At least once</option>
                <option value={2}>2 - Exactly once</option>
              </select>
            </SettingRow>
            <div style={{ padding: '12px', background: 'var(--bg-elevated)', borderRadius: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
              <strong>MQTT Payload schema:</strong> alert_id, audio_unique_id, verdict, classification, confidence, risk_level, reason, flags, evidence, transcript, timestamp, device_name, session_id
            </div>
          </>
        )}
      </div>

      {/* Audio Upload */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h3>Audio Upload API</h3>
            <div className="form-hint">Upload recordings to external API. The returned unique ID will be included in MQTT payload.</div>
          </div>
          <Toggle checked={uploadEnabled} onChange={setUploadEnabled} />
        </div>

        {uploadEnabled && (
          <>
            <SettingRow label="Upload URL" hint="POST endpoint that receives the audio file as multipart/form-data">
              <input className="form-input" value={uploadUrl} onChange={e => setUploadUrl(e.target.value)} placeholder="https://api.example.com/audio/upload" />
            </SettingRow>
            <SettingRow label="API Key">
              <input type="password" className="form-input" value={uploadKey} onChange={e => setUploadKey(e.target.value)} placeholder="Bearer token / API key" />
            </SettingRow>
            <SettingRow label="ID JSON Path" hint="Dot-notation path to extract unique ID from response. E.g.: 'id' or 'data.id'">
              <input className="form-input" value={uploadIdPath} onChange={e => setUploadIdPath(e.target.value)} placeholder="id" />
            </SettingRow>
          </>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <SaveBtn saving={saving} onClick={handleSave} />
      </div>
    </>
  )
}

function PromptTab({ prompt, setPrompt, onSave, saving, config }) {
  const [categories, setCategories] = useState(config.fraud_categories || [])
  const [newCatKey, setNewCatKey] = useState('')
  const [newCatLabel, setNewCatLabel] = useState('')

  const addCategory = () => {
    if (!newCatKey || !newCatLabel) return
    setCategories(prev => [...prev, { key: newCatKey.toUpperCase(), label: newCatLabel, description: '' }])
    setNewCatKey('')
    setNewCatLabel('')
  }

  const removeCategory = (key) => {
    setCategories(prev => prev.filter(c => c.key !== key))
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <h3 style={{ marginBottom: 4 }}>System Prompt</h3>
          <div className="form-hint">This prompt instructs the AI on how to classify conversations. Changes take effect immediately for new segments.</div>
        </div>
        <textarea
          className="form-textarea"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          style={{ minHeight: 300, fontSize: 12, lineHeight: 1.6 }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <SaveBtn saving={saving} onClick={onSave} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 12 }}>Fraud Categories</h3>
        <div className="form-hint" style={{ marginBottom: 16 }}>
          These categories define what the AI should look for. Add custom categories as needed.
        </div>

        {categories.map(cat => (
          <div key={cat.key} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 0', borderBottom: '1px solid var(--border)',
          }}>
            <span className="badge badge-info" style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>{cat.key}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{cat.label}</div>
              {cat.description && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{cat.description}</div>}
            </div>
            <button className="btn btn-danger btn-sm" onClick={() => removeCategory(cat.key)}>Remove</button>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <input className="form-input" placeholder="KEY (e.g. FRAUD_BRIBE)" value={newCatKey} onChange={e => setNewCatKey(e.target.value)} style={{ flex: 1 }} />
          <input className="form-input" placeholder="Label" value={newCatLabel} onChange={e => setNewCatLabel(e.target.value)} style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={addCategory}>Add</button>
        </div>
      </div>
    </>
  )
}

function SecurityTab() {
  const [current, setCurrent] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState(null)
  const { addToast } = useToast()

  const handleChange = async (e) => {
    e.preventDefault()
    if (newPw !== confirm) { setMsg({ type: 'error', text: 'Passwords do not match' }); return }
    if (newPw.length < 6) { setMsg({ type: 'error', text: 'Password must be at least 6 characters' }); return }
    setLoading(true)
    try {
      await changePassword(current, newPw)
      setMsg({ type: 'success', text: 'Password changed successfully' })
      setCurrent(''); setNewPw(''); setConfirm('')
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.detail || 'Failed to change password' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card" style={{ maxWidth: 480 }}>
      <h3 style={{ marginBottom: 20 }}>Change Password</h3>
      <form onSubmit={handleChange}>
        <div className="form-group">
          <label className="form-label">Current Password</label>
          <input type="password" className="form-input" value={current} onChange={e => setCurrent(e.target.value)} required />
        </div>
        <div className="form-group">
          <label className="form-label">New Password</label>
          <input type="password" className="form-input" value={newPw} onChange={e => setNewPw(e.target.value)} required />
        </div>
        <div className="form-group">
          <label className="form-label">Confirm New Password</label>
          <input type="password" className="form-input" value={confirm} onChange={e => setConfirm(e.target.value)} required />
        </div>
        {msg && (
          <div style={{ padding: '10px', borderRadius: 8, fontSize: 13, marginBottom: 12,
            background: msg.type === 'error' ? 'var(--fraud-bg)' : 'var(--clear-bg)',
            color: msg.type === 'error' ? 'var(--fraud)' : 'var(--clear)',
            border: `1px solid ${msg.type === 'error' ? 'var(--fraud-border)' : 'var(--clear-border)'}`,
          }}>
            {msg.text}
          </div>
        )}
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : null}
          Change Password
        </button>
      </form>
    </div>
  )
}
