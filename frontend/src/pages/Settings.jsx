import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import {
  getConfig, patchConfig, getPrompt, updatePrompt,
  getAudioDevices, changePassword
} from '../api/config'
import { useToast } from '../components/NotificationToast'

const ADMIN_TABS = ['General', 'Counters', 'Audio & VAD', 'STT', 'LLM', 'Recording', 'Notifications & Cloud', 'System Prompt', 'Security']
const USER_TABS = ['General', 'Counters', 'Audio & VAD', 'Recording', 'Detection Rules', 'Security']

export function Settings({ liveDevices }) {
  const { user } = useAuth()
  const isAdmin = (user?.role ?? 'admin') === 'admin' && user?.username !== 'user'

  const tabs = useMemo(() => {
    return isAdmin ? ADMIN_TABS : USER_TABS
  }, [isAdmin])

  const [activeTab, setActiveTab] = useState('General')

  // Auto-switch tab if current active tab is not accessible
  useEffect(() => {
    if (!tabs.includes(activeTab)) {
      setActiveTab(tabs[0] || 'General')
    }
  }, [tabs, activeTab])
  const [config, setConfig] = useState({})
  const [prompt, setPrompt] = useState('')
  const [promptBase, setPromptBase] = useState('')
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
      setPromptBase(pmt.system_prompt_base || '')
      setDevices(devs.devices || [])
    } catch (e) {
      addToast({ type: 'warning', title: 'Failed to load config', body: e.message })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [])

  // Auto-update device list when backend pushes a hotplug event via WebSocket
  useEffect(() => {
    if (liveDevices === null) return          // not yet received; keep initial REST data
    setDevices(liveDevices)
    addToast({
      type: 'info',
      title: 'Audio device change detected',
      body: `${liveDevices.length} input device(s) connected.`,
    })
  }, [liveDevices]) // eslint-disable-line react-hooks/exhaustive-deps

  const refreshDevices = useCallback(async () => {
    try {
      const devs = await getAudioDevices()
      setDevices(devs.devices || [])
      addToast({ type: 'info', title: 'Device list updated', body: `Found ${devs.devices?.length || 0} active audio input devices.` })
    } catch (e) {
      addToast({ type: 'warning', title: 'Failed to refresh devices', body: e.message })
    }
  }, [addToast])

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

  const savePrompt = async (base, cats) => {
    setSaving(true)
    try {
      const result = await updatePrompt({
        system_prompt_base: base,
        fraud_categories: cats
      })
      setPrompt(result.system_prompt || '')
      setPromptBase(base)
      setConfig(prev => ({ ...prev, fraud_categories: cats }))
      addToast({ type: 'success', title: 'System prompt and categories updated' })
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
          {tabs.map(t => (
            <button key={t} className={`tab-btn ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTab(t)}>
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {activeTab === 'General' && <GeneralTab config={config} onSave={save} saving={saving} />}
          {activeTab === 'Counters' && (
            <CountersTab
              config={config}
              devices={devices}
              onSave={save}
              saving={saving}
            />
          )}
          {activeTab === 'Audio & VAD' && (
            <AudioTab
              config={config}
              devices={devices}
              refreshDevices={refreshDevices}
              onSave={save}
              saving={saving}
              showAdvanced={showAdvanced}
              setShowAdvanced={setShowAdvanced}
            />
          )}
          {isAdmin && activeTab === 'STT' && <STTTab config={config} onSave={save} saving={saving} />}
          {isAdmin && activeTab === 'LLM' && <LLMTab config={config} onSave={save} saving={saving} />}
          {activeTab === 'Recording' && <RecordingTab config={config} onSave={save} saving={saving} />}
          {isAdmin && activeTab === 'Notifications & Cloud' && <NotificationsTab config={config} onSave={save} saving={saving} />}
          {(activeTab === 'System Prompt' || activeTab === 'Detection Rules') && (
            <PromptTab
              prompt={prompt}
              setPrompt={setPrompt}
              promptBase={promptBase}
              setPromptBase={setPromptBase}
              onSave={savePrompt}
              saving={saving}
              config={config}
              isAdmin={isAdmin}
            />
          )}
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
  const [devId, setDevId] = useState(config.device_id ?? 'edge-device-01')
  const [devName, setDevName] = useState(config.device_name ?? 'VoiceGuard-Store-01')

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <SettingRow label="Device ID" hint="Unique hardware/node identifier in alerts and MQTT (e.g. edge-device-01)">
        <input className="form-input" value={devId} onChange={e => setDevId(e.target.value)} />
      </SettingRow>
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
        <SaveBtn saving={saving} onClick={() => onSave({ retention_days: retDays, device_name: devName, device_id: devId })} />
      </div>
    </div>
  )
}

function AudioTab({ config, devices, refreshDevices, onSave, saving, showAdvanced, setShowAdvanced }) {
  const [deviceIndex, setDeviceIndex] = useState(config.audio_device_index ?? -1)
  const [threshold, setThreshold] = useState(config.vad_threshold ?? 300)
  const [silenceDuration, setSilenceDuration] = useState(config.vad_silence_duration ?? 1.5)
  const [minSpeech, setMinSpeech] = useState(config.vad_min_speech_duration ?? 0.5)
  const [maxSegment, setMaxSegment] = useState(config.vad_max_segment_duration ?? 15)
  const [useSilero, setUseSilero] = useState(config.vad_use_silero ?? false)
  const [autoCalibrate, setAutoCalibrate] = useState(config.vad_auto_calibrate ?? true)
  const [sampleRate, setSampleRate] = useState(config.sample_rate ?? 16000)
  const [channels, setChannels] = useState(config.channels ?? 1)
  const [chunkSize, setChunkSize] = useState(config.chunk_size ?? 512)
  const [showHardware, setShowHardware] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async (e) => {
    e.preventDefault()
    setRefreshing(true)
    await refreshDevices()
    setRefreshing(false)
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>Microphone Device</span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 10, fontWeight: 600, letterSpacing: '0.05em',
              padding: '2px 7px', borderRadius: 99,
              background: 'rgba(34,197,94,0.15)', color: '#22c55e',
              border: '1px solid rgba(34,197,94,0.3)',
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', background: '#22c55e',
                animation: 'pulse 2s infinite',
              }} />
              LIVE
            </span>
          </div>
          <div className="form-hint">Device list updates automatically when you plug or unplug a USB microphone.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <select className="form-select" value={deviceIndex} onChange={e => setDeviceIndex(Number(e.target.value))} style={{ flex: 1 }}>
            <option value={-1}>Auto-detect</option>
            {devices.map(d => (
              <option key={d.index} value={d.index}>{d.index}: {d.name}</option>
            ))}
          </select>
          <button
            className="btn btn-ghost"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh device list"
            style={{
              padding: '0 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              flexShrink: 0
            }}
          >
            {refreshing ? <span className="spinner" style={{ width: 14, height: 14 }} /> : '↻'}
          </button>
        </div>

        <SettingRow label="VAD Mode" hint="Silero VAD uses a neural network to detect actual speech. Energy VAD uses volume (RMS) threshold.">
          <select className="form-select" value={useSilero ? 'silero' : 'energy'} onChange={e => {
            const val = e.target.value === 'silero'
            setUseSilero(val)
            if (val) setAutoCalibrate(false)
          }}>
            <option value="energy">Energy VAD (RMS threshold)</option>
            <option value="silero">Silero VAD (ONNX Neural Net)</option>
          </select>
        </SettingRow>

        {!useSilero && (
          <SettingRow label="Auto-Calibrate Threshold" hint="Measure background noise on startup to set threshold automatically.">
            <Toggle checked={autoCalibrate} onChange={setAutoCalibrate} />
          </SettingRow>
        )}

        {!useSilero && !autoCalibrate && (
          <SettingRow label="VAD Threshold (RMS)" hint="Energy level to detect speech. Increase in noisy environments">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="range" min={50} max={1000} step={10} value={threshold} onChange={e => setThreshold(Number(e.target.value))} style={{ flex: 1 }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, minWidth: 40 }}>{threshold}</span>
            </div>
          </SettingRow>
        )}

        {/* Advanced toggle */}
        <div
          className="collapsible-header"
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{ color: 'var(--accent)', fontSize: 13, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', marginTop: 12 }}
        >
          <span>Advanced VAD Settings</span>
          <span>{showAdvanced ? '▲' : '▼'}</span>
        </div>

        {showAdvanced && (
          <div style={{ marginTop: 8 }}>
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
          </div>
        )}

        {/* Hardware toggle */}
        <div
          className="collapsible-header"
          onClick={() => setShowHardware(!showHardware)}
          style={{ color: 'var(--accent)', fontSize: 13, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', marginTop: 12 }}
        >
          <span>Audio Hardware & Format Settings</span>
          <span>{showHardware ? '▲' : '▼'}</span>
        </div>

        {showHardware && (
          <div style={{ marginTop: 8 }}>
            <SettingRow label="Sample Rate (Hz)" hint="Frequency of audio capture. Recommended: 16000 for speech detection models.">
              <select className="form-select" value={sampleRate} onChange={e => setSampleRate(Number(e.target.value))}>
                <option value={8000}>8000 Hz</option>
                <option value={16000}>16000 Hz (Recommended)</option>
                <option value={32000}>32000 Hz</option>
                <option value={44100}>44100 Hz</option>
                <option value={48000}>48000 Hz</option>
              </select>
            </SettingRow>
            <SettingRow label="Audio Channels" hint="Mono is standard. Stereo is mixed down.">
              <select className="form-select" value={channels} onChange={e => setChannels(Number(e.target.value))}>
                <option value={1}>1 (Mono)</option>
                <option value={2}>2 (Stereo)</option>
              </select>
            </SettingRow>
            <SettingRow label="Chunk Size (Frames)" hint="Buffer size for capture. Lower values reduce latency but increase CPU load.">
              <select className="form-select" value={chunkSize} onChange={e => setChunkSize(Number(e.target.value))}>
                <option value={256}>256</option>
                <option value={512}>512 (Recommended)</option>
                <option value={1024}>1024</option>
                <option value={2048}>2048</option>
              </select>
            </SettingRow>
          </div>
        )}

        <div style={{ paddingTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <SaveBtn saving={saving} onClick={() => onSave({
            audio_device_index: deviceIndex,
            vad_threshold: threshold,
            vad_silence_duration: silenceDuration,
            vad_min_speech_duration: minSpeech,
            vad_max_segment_duration: maxSegment,
            vad_use_silero: useSilero,
            vad_auto_calibrate: autoCalibrate,
            sample_rate: sampleRate,
            channels: channels,
            chunk_size: chunkSize,
          })} />
        </div>
      </div>
    </>
  )
}

const KNOWN_STT_MODELS = ['whisper-large-v3-turbo', 'whisper-large-v3', 'distil-whisper-large-v3-en']

function STTTab({ config, onSave, saving }) {
  const [mode, setMode] = useState(config.stt_mode ?? 'auto')
  const [localModel, setLocalModel] = useState(config.local_whisper_model ?? 'base')
  const [language, setLanguage] = useState(config.stt_language ?? 'id')
  const [groqApiKey, setGroqApiKey] = useState('')
  const [groqSttModel, setGroqSttModel] = useState('whisper-large-v3-turbo')
  const [customSttModel, setCustomSttModel] = useState('')

  useEffect(() => {
    const cur = config.groq_stt_model || 'whisper-large-v3-turbo'
    if (KNOWN_STT_MODELS.includes(cur)) {
      setGroqSttModel(cur)
      setCustomSttModel('')
    } else {
      setGroqSttModel('custom')
      setCustomSttModel(cur)
    }
  }, [config.groq_stt_model])

  const handleSave = () => {
    const targetModel = groqSttModel === 'custom' ? customSttModel.trim() : groqSttModel
    const updates = {
      stt_mode: mode,
      local_whisper_model: localModel,
      stt_language: language,
      groq_stt_model: targetModel || 'whisper-large-v3-turbo',
    }
    if (groqApiKey) updates.groq_api_key = groqApiKey
    onSave(updates)
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <SettingRow label="STT Mode" hint="API = Groq Whisper (fast, requires internet). Local = faster-whisper CPU. Auto = try API, fallback to local">
        <select className="form-select" value={mode} onChange={e => setMode(e.target.value)}>
          <option value="auto">Auto (API → Local fallback)</option>
          <option value="api">API Only (Groq Whisper)</option>
          <option value="local">Local Only (faster-whisper)</option>
        </select>
      </SettingRow>

      <SettingRow label="Groq API Key" hint="API Key for Groq Cloud STT & LLM services">
        <input
          type="password"
          className="form-input"
          value={groqApiKey}
          onChange={e => setGroqApiKey(e.target.value)}
          placeholder="Leave blank to keep current (gsk_...)"
        />
      </SettingRow>

      <SettingRow label="Groq STT Model (API)" hint="Select Speech-to-Text Whisper model for Groq API">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <select className="form-select" value={groqSttModel} onChange={e => {
            setGroqSttModel(e.target.value)
            if (e.target.value !== 'custom') setCustomSttModel('')
          }}>
            <option value="whisper-large-v3-turbo">whisper-large-v3-turbo (Recommended, Fast & Multilingual)</option>
            <option value="whisper-large-v3">whisper-large-v3 (Highest Accuracy)</option>
            <option value="distil-whisper-large-v3-en">distil-whisper-large-v3-en (English Only, Ultra Fast)</option>
            <option value="custom">Custom Model Name...</option>
          </select>
          {groqSttModel === 'custom' && (
            <input
              type="text"
              className="form-input mono"
              value={customSttModel}
              onChange={e => setCustomSttModel(e.target.value)}
              placeholder="Enter custom Groq STT model string"
              style={{ fontSize: 11 }}
            />
          )}
        </div>
      </SettingRow>

      <SettingRow label="STT Language" hint="Target transcription language. Select Auto-detect to support tourists or other languages dynamically.">
        <select className="form-select" value={language} onChange={e => setLanguage(e.target.value)}>
          <option value="id">Bahasa Indonesia</option>
          <option value="en">English</option>
          <option value="auto">Auto-detect (Multi-language)</option>
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
        <SaveBtn saving={saving} onClick={handleSave} />
      </div>
    </div>
  )
}

const KNOWN_LLM_MODELS = ['groq/compound', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768']

function LLMTab({ config, onSave, saving }) {
  const [mode, setMode] = useState(config.llm_mode ?? 'auto')
  const [groqApiKey, setGroqApiKey] = useState('')
  const [groqLlmModel, setGroqLlmModel] = useState('groq/compound')
  const [customLlmModel, setCustomLlmModel] = useState('')
  const [localUrl, setLocalUrl] = useState(config.local_llm_url ?? 'http://localhost:11434')
  const [localModel, setLocalModel] = useState(config.local_llm_model ?? 'qwen2.5:1.5b')
  const [endpointType, setEndpointType] = useState(config.local_llm_endpoint_type ?? 'ollama')
  const [contextLimit, setContextLimit] = useState(config.context_limit ?? 5)
  const [contextMaxAge, setContextMaxAge] = useState(config.context_max_age_seconds ?? 300)
  const [contextGap, setContextGap] = useState(config.context_gap_threshold_seconds ?? 90)

  useEffect(() => {
    const cur = config.groq_llm_model || 'groq/compound'
    if (KNOWN_LLM_MODELS.includes(cur)) {
      setGroqLlmModel(cur)
      setCustomLlmModel('')
    } else {
      setGroqLlmModel('custom')
      setCustomLlmModel(cur)
    }
  }, [config.groq_llm_model])

  const handleSave = () => {
    const targetModel = groqLlmModel === 'custom' ? customLlmModel.trim() : groqLlmModel
    const updates = {
      llm_mode: mode,
      groq_llm_model: targetModel || 'groq/compound',
      local_llm_url: localUrl,
      local_llm_model: localModel,
      local_llm_endpoint_type: endpointType,
      context_limit: contextLimit,
      context_max_age_seconds: contextMaxAge,
      context_gap_threshold_seconds: contextGap,
    }
    if (groqApiKey) updates.groq_api_key = groqApiKey
    onSave(updates)
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <SettingRow label="LLM Mode" hint="API = Groq LLM (fast). Local = Ollama/RKLLama. Auto = try API, fallback to local">
        <select className="form-select" value={mode} onChange={e => setMode(e.target.value)}>
          <option value="auto">Auto (API → Local fallback)</option>
          <option value="api">API Only (Groq)</option>
          <option value="local">Local Only (Ollama/RKLLama)</option>
        </select>
      </SettingRow>

      <SettingRow label="Groq API Key" hint="API Key for Groq Cloud LLM & STT services">
        <input
          type="password"
          className="form-input"
          value={groqApiKey}
          onChange={e => setGroqApiKey(e.target.value)}
          placeholder="Leave blank to keep current (gsk_...)"
        />
      </SettingRow>

      <SettingRow label="Groq LLM Model (API)" hint="Select LLM model for Groq Cloud API analysis">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <select className="form-select" value={groqLlmModel} onChange={e => {
            const val = e.target.value
            setGroqLlmModel(val)
            if (val !== 'custom') setCustomLlmModel('')
          }}>
            <option value="groq/compound">groq/compound (Recommended Default)</option>
            <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile (High Reasoning & Multilingual)</option>
            <option value="llama-3.1-8b-instant">llama-3.1-8b-instant (Fast & Compact)</option>
            <option value="mixtral-8x7b-32768">mixtral-8x7b-32768 (MoE Architecture)</option>
            <option value="custom">Custom Model String...</option>
          </select>
          {groqLlmModel === 'custom' && (
            <input
              type="text"
              className="form-input mono"
              value={customLlmModel}
              onChange={e => setCustomLlmModel(e.target.value)}
              placeholder="Enter custom Groq LLM model string (e.g. groq/compound)"
              style={{ fontSize: 11 }}
            />
          )}
        </div>
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

      <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <h3 style={{ marginBottom: 12 }}>Conversation Context Memory</h3>
        <div className="form-hint" style={{ marginBottom: 16 }}>
          Configure how many past conversation segments are sent to the LLM to provide context for the current analysis.
        </div>
        <SettingRow label="Context Message Limit" hint="Maximum number of recent segments to include as history.">
          <input type="number" className="form-input" value={contextLimit} onChange={e => setContextLimit(Number(e.target.value))} min={0} max={20} style={{ width: 80 }} />
        </SettingRow>
        <SettingRow label="Context Max Age" hint="Exclude segments older than this duration (in seconds).">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="number" className="form-input" value={contextMaxAge} onChange={e => setContextMaxAge(Number(e.target.value))} min={10} max={1800} style={{ width: 80 }} />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>seconds</span>
          </div>
        </SettingRow>
        <SettingRow label="Context Gap Threshold" hint="If a gap between segments exceeds this duration (in seconds), break context.">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="number" className="form-input" value={contextGap} onChange={e => setContextGap(Number(e.target.value))} min={5} max={600} style={{ width: 80 }} />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>seconds</span>
          </div>
        </SettingRow>
      </div>

      <div style={{ paddingTop: 16, display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', marginTop: 16 }}>
        <SaveBtn saving={saving} onClick={handleSave} />
      </div>
    </div>
  )
}

function RecordingTab({ config, onSave, saving }) {
  const [preBuffer, setPreBuffer] = useState(config.pre_buffer_seconds ?? 10)
  const [maxDiskUsage, setMaxDiskUsage] = useState(config.max_disk_usage_percent ?? 85)
  const [continuousMaxGb, setContinuousMaxGb] = useState(config.continuous_max_storage_gb ?? 15)
  const [postBuffer, setPostBuffer] = useState(config.post_buffer_seconds ?? 15)
  const [recordOn, setRecordOn] = useState(config.record_on_verdict ?? 'BOTH')
  const [continuousEnabled, setContinuousEnabled] = useState(config.continuous_recording_enabled ?? false)
  const [continuousMinutes, setContinuousMinutes] = useState(config.continuous_chunk_minutes ?? 10)
  const [recordingFormat, setRecordingFormat] = useState(config.recording_format ?? 'ogg')
  const [alertRecordingMode, setAlertRecordingMode] = useState(config.alert_recording_mode ?? 'exact_segment')

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <SettingRow label="Continuous 24/7 Recording" hint="Record all audio continuously in fixed-size chunks, independent of alerts.">
        <Toggle checked={continuousEnabled} onChange={setContinuousEnabled} />
      </SettingRow>

      {continuousEnabled && (
        <SettingRow label="Continuous Chunk Duration" hint="Length of each continuous audio recording chunk file.">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="number" className="form-input" value={continuousMinutes} onChange={e => setContinuousMinutes(Number(e.target.value))} min={1} max={60} style={{ width: 80 }} />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>minutes</span>
          </div>
        </SettingRow>
      )}

      <SettingRow label="Alert Recording Mode" hint="Pilih mode perekaman audio saat terjadi alert kecurangan.">
        <select className="form-select" value={alertRecordingMode} onChange={e => setAlertRecordingMode(e.target.value)}>
          <option value="exact_segment">Pas Segmen Transkrip (Sangat Robust & Aman dari Crash)</option>
          <option value="buffer">Menggunakan Pre/Post Buffer (Bisa Mengambil Suara Sebelum Alert Terjadi)</option>
        </select>
      </SettingRow>

      <SettingRow label="Audio File Format" hint="Pilih format file audio yang disimpan. Format WAV (tanpa kompresi) menggunakan library Python standar dan 100% aman dari crash sistem.">
        <select className="form-select" value={recordingFormat} onChange={e => setRecordingFormat(e.target.value)}>
          <option value="ogg">OGG (Ukuran File Lebih Kecil)</option>
          <option value="wav">WAV (Sangat Stabil & Native)</option>
        </select>
      </SettingRow>

      {alertRecordingMode === 'buffer' && (
        <>
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
        </>
      )}

      <SettingRow label="Record On Verdict" hint="Which verdicts trigger a recording">
        <select className="form-select" value={recordOn} onChange={e => setRecordOn(e.target.value)}>
          <option value="BOTH">Both FRAUD and SUSPICIOUS</option>
          <option value="FRAUD">FRAUD only</option>
          <option value="SUSPICIOUS">SUSPICIOUS only</option>
          <option value="ALL">ALL (Merekam semua segmen, termasuk NORMAL)</option>
        </select>
      </SettingRow>
      <div style={{ margin: '20px 0 16px', borderTop: '1px solid var(--border-color)' }} />
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
        Disk Protection & Storage Limits
      </div>
      <SettingRow label="Max Disk Usage Limit" hint="Pembersihan otomatis (FIFO): jika penggunaan kapasitas disk mencapai batas ini, rekaman continuous tertua akan otomatis dihapus bertahap agar disk tidak 100% penuh">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="number" className="form-input" value={maxDiskUsage} onChange={e => setMaxDiskUsage(Number(e.target.value))} min={50} max={95} style={{ width: 80 }} />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>%</span>
        </div>
      </SettingRow>
      <SettingRow label="Max Continuous Storage Quota" hint="Batas kuota penyimpanan maksimum khusus untuk folder continuous recording (0 = tidak terbatas, hanya mengikuti batas Max Disk Usage)">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="number" className="form-input" value={continuousMaxGb} onChange={e => setContinuousMaxGb(Number(e.target.value))} min={0} max={1000} style={{ width: 80 }} />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>GB</span>
        </div>
      </SettingRow>

      <div style={{ paddingTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <SaveBtn saving={saving} onClick={() => onSave({
          pre_buffer_seconds: preBuffer,
          post_buffer_seconds: postBuffer,
          record_on_verdict: recordOn,
          continuous_recording_enabled: continuousEnabled,
          continuous_chunk_minutes: continuousMinutes,
          recording_format: recordingFormat,
          alert_recording_mode: alertRecordingMode,
          max_disk_usage_percent: maxDiskUsage,
          continuous_max_storage_gb: continuousMaxGb,
        })} />
      </div>
    </div>
  )
}

function NotificationsTab({ config, onSave, saving }) {
  // MQTT
  const [mqttEnabled, setMqttEnabled] = useState(config.mqtt_enabled ?? false)
  const [mqttHost, setMqttHost] = useState(config.mqtt_broker_host ?? '')
  const [mqttPort, setMqttPort] = useState(config.mqtt_broker_port ?? 1883)
  const [mqttTopic, setMqttTopic] = useState(config.mqtt_topic ?? 'voiceguard/fraud/alerts')
  const [mqttNormalTopic, setMqttNormalTopic] = useState(config.mqtt_normal_topic ?? 'voiceguard/normal/events')
  const [mqttUser, setMqttUser] = useState(config.mqtt_username ?? '')
  const [mqttPass, setMqttPass] = useState('')
  const [mqttQos, setMqttQos] = useState(config.mqtt_qos ?? 1)
  const [sendNormalMqtt, setSendNormalMqtt] = useState(config.send_normal_conversations_to_mqtt ?? false)

  // Audio Upload API
  const [audioUploadEnabled, setAudioUploadEnabled] = useState(config.audio_upload_enabled ?? false)
  const [audioUploadUrl, setAudioUploadUrl] = useState(config.audio_upload_url ?? 'https://api.protectqube.ai/api/v1/voice/ai-alerts/file')
  const [audioUploadKey, setAudioUploadKey] = useState('')
  const [audioUploadCategory, setAudioUploadCategory] = useState(config.audio_upload_category ?? 'detections')
  const [audioUploadIdPath, setAudioUploadIdPath] = useState(config.audio_upload_id_path ?? 'data.id')

  // Snapshot Upload API
  const [snapshotUploadEnabled, setSnapshotUploadEnabled] = useState(config.snapshot_upload_enabled ?? false)
  const [snapshotUploadUrl, setSnapshotUploadUrl] = useState(config.snapshot_upload_url ?? 'https://api.protectqube.ai/api/v1/voice/ai-alerts/file')
  const [snapshotUploadKey, setSnapshotUploadKey] = useState('')
  const [snapshotUploadCategory, setSnapshotUploadCategory] = useState(config.snapshot_upload_category ?? 'detections')
  const [snapshotUploadIdPath, setSnapshotUploadIdPath] = useState(config.snapshot_upload_id_path ?? 'data.id')

  // Camera Snapshot Settings
  const [cameraEnabled, setCameraEnabled] = useState(config.camera_snapshot_enabled ?? false)
  const [cameraSource, setCameraSource] = useState(config.camera_snapshot_source ?? 'protectqube')
  const [cameraPqUrl, setCameraPqUrl] = useState(config.camera_snapshot_protectqube_url ?? 'http://localhost:8000')
  const [cameraTimeout, setCameraTimeout] = useState(config.camera_snapshot_timeout ?? 5)
  const [cameraVerdicts, setCameraVerdicts] = useState(config.camera_snapshot_on_verdicts ?? ['FRAUD', 'SUSPICIOUS'])
  const [snapOnNormal, setSnapOnNormal] = useState(config.snapshot_on_normal_conversation ?? false)

  const toggleVerdict = (verdict) => {
    setCameraVerdicts(prev =>
      prev.includes(verdict) ? prev.filter(v => v !== verdict) : [...prev, verdict]
    )
  }

  const handleSave = () => {
    const updates = {
      // MQTT
      mqtt_enabled: mqttEnabled,
      mqtt_broker_host: mqttHost,
      mqtt_broker_port: mqttPort,
      mqtt_topic: mqttTopic,
      mqtt_normal_topic: mqttNormalTopic,
      mqtt_username: mqttUser,
      mqtt_qos: mqttQos,
      send_normal_conversations_to_mqtt: sendNormalMqtt,
      // Audio Upload API
      audio_upload_enabled: audioUploadEnabled,
      audio_upload_url: audioUploadUrl,
      audio_upload_category: audioUploadCategory,
      audio_upload_id_path: audioUploadIdPath,
      // Snapshot Upload API
      snapshot_upload_enabled: snapshotUploadEnabled,
      snapshot_upload_url: snapshotUploadUrl,
      snapshot_upload_category: snapshotUploadCategory,
      snapshot_upload_id_path: snapshotUploadIdPath,
      // Camera Snapshot
      camera_snapshot_enabled: cameraEnabled,
      camera_snapshot_source: cameraSource,
      camera_snapshot_protectqube_url: cameraPqUrl,
      camera_snapshot_timeout: cameraTimeout,
      camera_snapshot_on_verdicts: cameraVerdicts,
      snapshot_on_normal_conversation: snapOnNormal,
    }
    if (mqttPass) updates.mqtt_password = mqttPass
    if (audioUploadKey) updates.audio_upload_api_key = audioUploadKey
    if (snapshotUploadKey) updates.snapshot_upload_api_key = snapshotUploadKey
    onSave(updates)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 840 }}>
      {/* MQTT Integration */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h3>MQTT Data Broker Integration</h3>
            <div className="form-hint">Publishes JSON alerts (containing transcript, audio_id, snapshot_id, verdict) to MQTT broker.</div>
          </div>
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
            <SettingRow label="Fraud/Alert Topic" hint="MQTT topic to publish fraud/suspicious alert events">
              <input className="form-input" value={mqttTopic} onChange={e => setMqttTopic(e.target.value)} />
            </SettingRow>
            <SettingRow label="Publish Normal Conversations" hint="Publish non-fraud (SOP compliance / greeting) events to MQTT">
              <Toggle checked={sendNormalMqtt} onChange={setSendNormalMqtt} />
            </SettingRow>
            {sendNormalMqtt && (
              <SettingRow label="Normal Event Topic" hint="MQTT topic name for normal conversation events">
                <input className="form-input" value={mqttNormalTopic} onChange={e => setMqttNormalTopic(e.target.value)} placeholder="voiceguard/normal/events" />
              </SettingRow>
            )}
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
              <strong>MQTT Unified Payload Schema:</strong> alert_id, audio_id, snapshot_id, verdict, classification, confidence, risk_level, reason, flags, evidence, transcript, snapshot_path, timestamp, device_name, counter_id, session_id
            </div>
          </>
        )}
      </div>

      {/* Audio Cloud Upload API */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h3>Audio Evidence Cloud Upload API</h3>
            <div className="form-hint">Uploads recording file (multipart/form-data) to Cloud API. The returned audio_id is sent in MQTT payload.</div>
          </div>
          <Toggle checked={audioUploadEnabled} onChange={setAudioUploadEnabled} />
        </div>

        {audioUploadEnabled && (
          <>
            <SettingRow label="Upload Endpoint URL" hint="POST endpoint that receives the audio file (e.g. ProtectQube AI Cloud API)">
              <input className="form-input" value={audioUploadUrl} onChange={e => setAudioUploadUrl(e.target.value)} placeholder="https://api.protectqube.ai/api/v1/voice/ai-alerts/file" />
            </SettingRow>
            <SettingRow label="API Key / Token">
              <input type="password" className="form-input" value={audioUploadKey} onChange={e => setAudioUploadKey(e.target.value)} placeholder="Bearer token / API key" />
            </SettingRow>
            <SettingRow label="Form Field Category" hint="Text field key 'category' sent in multipart form-data (e.g. 'detections')">
              <input className="form-input" value={audioUploadCategory} onChange={e => setAudioUploadCategory(e.target.value)} placeholder="detections" />
            </SettingRow>
            <SettingRow label="Response ID Path" hint="Dot-notation path to extract unique audio ID from JSON response (e.g. 'id' or 'data.id')">
              <input className="form-input" value={audioUploadIdPath} onChange={e => setAudioUploadIdPath(e.target.value)} placeholder="id" />
            </SettingRow>
          </>
        )}
      </div>

      {/* Snapshot Cloud Upload API & Camera Settings */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h3>Snapshot Evidence & Camera Capture</h3>
            <div className="form-hint">Capture camera snapshot images on events and optionally upload to Cloud API for snapshot_id evidence.</div>
          </div>
          <Toggle checked={cameraEnabled} onChange={setCameraEnabled} />
        </div>

        {cameraEnabled && (
          <>
            <SettingRow label="Snapshot Source Mode" hint="Select how camera images are captured">
              <select className="form-select" value={cameraSource} onChange={e => setCameraSource(e.target.value)}>
                <option value="protectqube">ProtectQube AI Engine API (Recommended)</option>
                <option value="rtsp">Direct RTSP Stream Capture (OpenCV)</option>
                <option value="http">Direct HTTP Snapshot URL</option>
              </select>
            </SettingRow>

            {cameraSource === 'protectqube' && (
              <SettingRow label="ProtectQube AI Base URL" hint="URL endpoint of ProtectQube AI backend server">
                <input className="form-input" value={cameraPqUrl} onChange={e => setCameraPqUrl(e.target.value)} placeholder="http://localhost:8000" />
              </SettingRow>
            )}

            <SettingRow label="Snapshot Capture Timeout" hint="Maximum seconds to wait for camera snapshot response">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="number" className="form-input" value={cameraTimeout} onChange={e => setCameraTimeout(Number(e.target.value))} min={1} max={30} style={{ width: 80 }} />
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>seconds</span>
              </div>
            </SettingRow>

            <SettingRow label="Trigger Snapshot on Verdicts" hint="Select which event classifications trigger camera snapshot">
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 6 }}>
                {['FRAUD', 'SUSPICIOUS', 'NORMAL'].map(v => (
                  <label key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={cameraVerdicts.includes(v)} onChange={() => toggleVerdict(v)} />
                    <span style={{ fontWeight: 500 }}>{v}</span>
                  </label>
                ))}
              </div>
            </SettingRow>

            <SettingRow label="Take Snapshot on Normal Conversations" hint="Capture camera photo even when conversation is evaluated as NORMAL">
              <Toggle checked={snapOnNormal} onChange={setSnapOnNormal} />
            </SettingRow>

            {/* Snapshot Cloud Upload Sub-section */}
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px dashed var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <h4 style={{ margin: 0 }}>Snapshot Cloud Upload API</h4>
                  <div className="form-hint">Uploads snapshot photo (multipart/form-data) to Cloud API. Returned snapshot_id is sent in MQTT payload.</div>
                </div>
                <Toggle checked={snapshotUploadEnabled} onChange={setSnapshotUploadEnabled} />
              </div>

              {snapshotUploadEnabled && (
                <>
                  <SettingRow label="Upload Endpoint URL" hint="POST endpoint that receives the snapshot image file">
                    <input className="form-input" value={snapshotUploadUrl} onChange={e => setSnapshotUploadUrl(e.target.value)} placeholder="https://api.protectqube.ai/api/v1/voice/ai-alerts/file" />
                  </SettingRow>
                  <SettingRow label="API Key / Token">
                    <input type="password" className="form-input" value={snapshotUploadKey} onChange={e => setSnapshotUploadKey(e.target.value)} placeholder="Bearer token / API key" />
                  </SettingRow>
                  <SettingRow label="Form Field Category" hint="Text field key 'category' sent in multipart form-data (e.g. 'detections')">
                    <input className="form-input" value={snapshotUploadCategory} onChange={e => setSnapshotUploadCategory(e.target.value)} placeholder="detections" />
                  </SettingRow>
                  <SettingRow label="Response ID Path" hint="Dot-notation path to extract unique snapshot ID from JSON response (e.g. 'id' or 'data.id')">
                    <input className="form-input" value={snapshotUploadIdPath} onChange={e => setSnapshotUploadIdPath(e.target.value)} placeholder="id" />
                  </SettingRow>
                </>
              )}
            </div>
          </>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8 }}>
        <SaveBtn saving={saving} onClick={handleSave} />
      </div>
    </div>
  )
}

function PromptTab({ prompt, setPrompt, promptBase, setPromptBase, onSave, saving, config, isAdmin = true }) {
  const [categories, setCategories] = useState([]);
  const [localBase, setLocalBase] = useState('');
  
  // Edit mode states for a specific category
  const [editingKey, setEditingKey] = useState(null);
  const [editForm, setEditForm] = useState({ key: '', label: '', description: '', classification: 'FRAUD' });

  // Add new category states
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newClass, setNewClass] = useState('FRAUD');

  const [showPreview, setShowPreview] = useState(false);

  // Sync with props on mount or config load
  useEffect(() => {
    if (config.fraud_categories) {
      setCategories(config.fraud_categories);
    }
  }, [config.fraud_categories]);

  useEffect(() => {
    if (promptBase) {
      setLocalBase(promptBase);
    }
  }, [promptBase]);

  const compilePromptLocal = (base, cats) => {
    if (!base) return '';
    const catsStr = cats.map((cat, i) => `${i+1}. ${cat.key}: ${cat.description || cat.label}`).join('\n');
    const flagsStr = cats.map(cat => `    "${cat.key}": false`).join(',\n');
    return `${base.trim()}

Deteksi indikator kecurangan (fraud flags) berikut:
${catsStr}

Output HARUS hanya berupa JSON valid tanpa penjelasan tambahan di luar JSON. Jangan gunakan markdown block \`\`\`json.

Format JSON Output:
{
  "fraud_flags": {
${flagsStr}
  },
  "evidence": [],
  "reason": ""
}

Keterangan:
- "fraud_flags": bernilai true jika indikator tersebut terdeteksi dalam transkrip percakapan, jika tidak bernilai false.
- "evidence": daftar kutipan kalimat langsung dari transkrip yang menjadi bukti adanya indikator kecurangan tersebut. Jika tidak ada, biarkan kosong [].
- "reason": penjelasan singkat dan jelas mengapa indikator tersebut terdeteksi atau tidak terdeteksi.`;
  };

  const handleSaveAll = () => {
    onSave(isAdmin ? localBase : null, categories);
  };

  const handleResetLocal = () => {
    setLocalBase(promptBase);
    setCategories(config.fraud_categories || []);
    setEditingKey(null);
  };

  // Category Actions
  const startEditing = (cat) => {
    setEditingKey(cat.key);
    setEditForm({ ...cat });
  };

  const saveCategoryEdit = () => {
    if (!editForm.key || !editForm.label) return;
    const cleanKey = editForm.key.toLowerCase().replace(/[^a-z0-9_]/g, '');
    
    // Check key uniqueness if key changed
    if (cleanKey !== editingKey && categories.some(c => c.key === cleanKey)) {
      alert('Category key already exists');
      return;
    }

    setCategories(prev => prev.map(c => c.key === editingKey ? { ...editForm, key: cleanKey } : c));
    setEditingKey(null);
  };

  const deleteCategory = (key) => {
    if (window.confirm(`Are you sure you want to remove the category "${key}"?`)) {
      setCategories(prev => prev.filter(c => c.key !== key));
    }
  };

  const addNewCategory = () => {
    if (!newKey || !newLabel) return;
    const cleanKey = newKey.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (categories.some(c => c.key === cleanKey)) {
      alert('Category key already exists');
      return;
    }
    
    setCategories(prev => [...prev, {
      key: cleanKey,
      label: newLabel,
      description: newDesc,
      classification: newClass
    }]);

    setNewKey('');
    setNewLabel('');
    setNewDesc('');
  };

  const getBadgeClass = (classification) => {
    if (classification === 'FRAUD') return 'badge-fraud';
    if (classification === 'SUSPICIOUS') return 'badge-suspicious';
    return 'badge-clear';
  };

  const liveCompiled = compilePromptLocal(localBase, categories);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Dynamic Form Layout */}
      <div style={{ display: 'flex', flexDirection: 'row', gap: 24, flexWrap: 'wrap', alignItems: 'stretch' }}>
        
        {/* Left Column: Base System Instructions & Live Preview (Admin Only) */}
        {isAdmin && (
          <div style={{ flex: '1 1 500px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <h3 style={{ marginBottom: 4 }}>Base System Instructions</h3>
                <div className="form-hint">Set role, compliance guidelines, objective reasoning, and other rules. Avoid hardcoding categories here.</div>
              </div>
              <textarea
                className="form-textarea"
                value={localBase}
                onChange={e => setLocalBase(e.target.value)}
                style={{ flex: 1, minHeight: 250, fontSize: 12, lineHeight: 1.6 }}
              />
            </div>

            <div className="card">
              <div 
                onClick={() => setShowPreview(!showPreview)} 
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', color: 'var(--accent)', fontWeight: 500, fontSize: 13 }}
              >
                <span>Live Compiled Prompt Preview</span>
                <span>{showPreview ? '▲' : '▼'}</span>
              </div>
              {showPreview && (
                <textarea
                  className="form-textarea"
                  value={liveCompiled}
                  readOnly
                  style={{ height: 280, fontSize: 11, lineHeight: 1.5, background: 'var(--bg-elevated)', border: '1px solid var(--border)', marginTop: 12 }}
                />
              )}
            </div>
          </div>
        )}

        {/* Categories Manager Column */}
        <div style={{ flex: isAdmin ? '1 1 500px' : '1 1 100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ marginBottom: 4 }}>{isAdmin ? 'Fraud & Suspicious Categories' : 'Aturan & Kategori Deteksi Pelanggaran'}</h3>
              <div className="form-hint">
                {isAdmin 
                  ? 'Define behavior flags the LLM will output. Verdict mappings dynamically adjust alert severity.' 
                  : 'Daftar aturan deteksi pelanggaran. Anda dapat menambah, mengedit, atau menghapus kriteria indikator di bawah ini.'}
              </div>
            </div>

            {/* Scrollable Categories List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 400, overflowY: 'auto', paddingRight: 4, flex: 1 }}>
              {categories.map(cat => {
                const isEditing = editingKey === cat.key;
                return (
                  <div 
                    key={cat.key} 
                    className="card" 
                    style={{ 
                      padding: 14, 
                      background: 'var(--bg-elevated)', 
                      borderColor: isEditing ? 'var(--accent)' : 'var(--border)',
                      boxShadow: isEditing ? 'var(--shadow-glow)' : 'none'
                    }}
                  >
                    {isEditing ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <div style={{ flex: 1 }}>
                            <label className="form-label" style={{ fontSize: 10 }}>Key (Unique identifier)</label>
                            <input 
                              className="form-input mono" 
                              value={editForm.key} 
                              onChange={e => setEditForm({ ...editForm, key: e.target.value })} 
                              style={{ fontSize: 11, padding: '6px 10px' }}
                            />
                          </div>
                          <div style={{ flex: 1.5 }}>
                            <label className="form-label" style={{ fontSize: 10 }}>Label</label>
                            <input 
                              className="form-input" 
                              value={editForm.label} 
                              onChange={e => setEditForm({ ...editForm, label: e.target.value })} 
                              style={{ fontSize: 11, padding: '6px 10px' }}
                            />
                          </div>
                        </div>
                        <div>
                          <label className="form-label" style={{ fontSize: 10 }}>Description</label>
                          <textarea 
                            className="form-textarea" 
                            value={editForm.description} 
                            onChange={e => setEditForm({ ...editForm, description: e.target.value })} 
                            style={{ minHeight: 60, fontSize: 11, padding: '6px 10px' }}
                          />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="form-label" style={{ fontSize: 10, textTransform: 'none' }}>Verdict:</span>
                            <select 
                              className="form-select" 
                              value={editForm.classification} 
                              onChange={e => setEditForm({ ...editForm, classification: e.target.value })}
                              style={{ width: 120, padding: '4px 8px', fontSize: 11 }}
                            >
                              <option value="NORMAL">NORMAL</option>
                              <option value="SUSPICIOUS">SUSPICIOUS</option>
                              <option value="FRAUD">FRAUD</option>
                            </select>
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => setEditingKey(null)}>Cancel</button>
                            <button className="btn btn-primary btn-sm" onClick={saveCategoryEdit}>Update</button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span className={`badge ${getBadgeClass(cat.classification)}`}>{cat.classification}</span>
                          <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{cat.key}</span>
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{cat.label}</div>
                          {cat.description && (
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, fontStyle: 'italic', lineHeight: 1.4 }}>
                              {cat.description}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid rgba(255,122,0,0.05)', paddingTop: 8, marginTop: 4 }}>
                          <button className="btn btn-ghost btn-sm" style={{ padding: '3px 8px' }} onClick={() => startEditing(cat)}>Edit</button>
                          <button className="btn btn-danger btn-sm" style={{ padding: '3px 8px' }} onClick={() => deleteCategory(cat.key)}>Delete</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {categories.length === 0 && (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                  No categories defined. Sistem tidak akan mendeteksi pelanggaran khusus.
                </div>
              )}
            </div>

            {/* Add New Category Section */}
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 16 }}>
              <h4 style={{ marginBottom: 10, fontSize: 12 }}>Add New Category</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input 
                    className="form-input mono" 
                    placeholder="key (e.g. bribing)" 
                    value={newKey} 
                    onChange={e => setNewKey(e.target.value)} 
                    style={{ flex: 1, fontSize: 11 }}
                  />
                  <input 
                    className="form-input" 
                    placeholder="Display Label" 
                    value={newLabel} 
                    onChange={e => setNewLabel(e.target.value)} 
                    style={{ flex: 1.5, fontSize: 11 }}
                  />
                </div>
                <textarea 
                  className="form-textarea" 
                  placeholder="Behavior description (what to scan for...)" 
                  value={newDesc} 
                  onChange={e => setNewDesc(e.target.value)} 
                  style={{ minHeight: 60, fontSize: 11 }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="form-label" style={{ fontSize: 10 }}>Verdict:</span>
                    <select 
                      className="form-select" 
                      value={newClass} 
                      onChange={e => setNewClass(e.target.value)}
                      style={{ width: 120, padding: '4px 8px', fontSize: 11 }}
                    >
                      <option value="NORMAL">NORMAL</option>
                      <option value="SUSPICIOUS">SUSPICIOUS</option>
                      <option value="FRAUD">FRAUD</option>
                    </select>
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={addNewCategory}>Add Category</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Global save/reset footer bar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 12, padding: '16px 0', borderTop: '1px solid var(--border)' }}>
        <button className="btn btn-ghost" onClick={handleResetLocal}>Reset to Saved</button>
        <SaveBtn saving={saving} onClick={handleSaveAll} />
      </div>
    </div>
  );
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



function CountersTab({ config, devices, onSave, saving }) {
  const [counters, setCounters] = useState(() => {
    return config.counters || [
      { id: 'counter_1', name: 'Meja CS 1', audio_device_index: -1, enabled: true, camera_id: 'cam_cs_1', rtsp_url: '', snapshot_url: '' }
    ]
  })

  const handleChange = (index, field, value) => {
    setCounters(prev => {
      const copy = [...prev]
      copy[index] = { ...copy[index], [field]: value }
      return copy
    })
  }

  const handleAdd = () => {
    setCounters(prev => [
      ...prev,
      {
        id: `counter_${prev.length + 1}`,
        name: `Meja CS ${prev.length + 1}`,
        audio_device_index: -1,
        enabled: true,
        camera_id: `cam_cs_${prev.length + 1}`,
        rtsp_url: '',
        snapshot_url: '',
      }
    ])
  }

  const handleDelete = (index) => {
    setCounters(prev => prev.filter((_, i) => i !== index))
  }

  const handleSave = () => {
    onSave({ counters })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900 }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
          <div>
            <h3>Manage CS Counters & Camera Mapping</h3>
            <p className="form-help" style={{ marginTop: 2 }}>Define multiple customer service desks, microphone devices, and linked camera IDs.</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleAdd}>+ Add Counter</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {counters.map((c, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {/* Enabled Switch */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 700 }}>Enable</span>
                  <input
                    type="checkbox"
                    checked={c.enabled ?? true}
                    onChange={e => handleChange(idx, 'enabled', e.target.checked)}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                </div>

                {/* Counter ID (slug) */}
                <div style={{ flex: 1 }}>
                  <label className="form-label" style={{ fontSize: 10, marginBottom: 4 }}>Counter ID (Slug)</label>
                  <input
                    type="text"
                    className="form-input mono"
                    value={c.id}
                    onChange={e => handleChange(idx, 'id', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    placeholder="counter_1"
                    style={{ fontSize: 11, padding: '6px 10px' }}
                  />
                </div>

                {/* Counter Name (display) */}
                <div style={{ flex: 1.5 }}>
                  <label className="form-label" style={{ fontSize: 10, marginBottom: 4 }}>Counter Display Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={c.name}
                    onChange={e => handleChange(idx, 'name', e.target.value)}
                    placeholder="Meja CS 1"
                    style={{ fontSize: 11, padding: '6px 10px' }}
                  />
                </div>

                {/* Audio Input Device Mapping */}
                <div style={{ flex: 2 }}>
                  <label className="form-label" style={{ fontSize: 10, marginBottom: 4 }}>Microphone Input Device</label>
                  <select
                    className="form-select"
                    value={c.audio_device_index}
                    onChange={e => handleChange(idx, 'audio_device_index', parseInt(e.target.value))}
                    style={{ fontSize: 11, padding: '5px 8px' }}
                  >
                    <option value={-1}>System Default Mic (-1)</option>
                    {devices.map(d => (
                      <option key={d.index} value={d.index}>
                        [{d.index}] {d.name} ({d.max_input_channels} ch)
                      </option>
                    ))}
                  </select>
                </div>

                {/* Delete Button */}
                <button
                  className="btn btn-danger"
                  onClick={() => handleDelete(idx)}
                  style={{
                    padding: '6px 10px',
                    fontSize: 12,
                    marginTop: 18,
                    height: 'fit-content'
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Camera Mapping Inputs */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: 12,
                paddingTop: 8,
                borderTop: '1px dashed var(--border)',
              }}>
                <div>
                  <label className="form-label" style={{ fontSize: 10, marginBottom: 4 }}>ProtectQube Camera ID</label>
                  <input
                    type="text"
                    className="form-input mono"
                    value={c.camera_id || ''}
                    onChange={e => handleChange(idx, 'camera_id', e.target.value)}
                    placeholder="cam_cs_1"
                    style={{ fontSize: 11, padding: '5px 8px' }}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: 10, marginBottom: 4 }}>Direct RTSP Stream URL (Optional)</label>
                  <input
                    type="text"
                    className="form-input mono"
                    value={c.rtsp_url || ''}
                    onChange={e => handleChange(idx, 'rtsp_url', e.target.value)}
                    placeholder="rtsp://admin:pass@192.168.1.50:554/stream1"
                    style={{ fontSize: 11, padding: '5px 8px' }}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: 10, marginBottom: 4 }}>HTTP Snapshot URL (Optional)</label>
                  <input
                    type="text"
                    className="form-input mono"
                    value={c.snapshot_url || ''}
                    onChange={e => handleChange(idx, 'snapshot_url', e.target.value)}
                    placeholder="http://192.168.1.50/snapshot.jpg"
                    style={{ fontSize: 11, padding: '5px 8px' }}
                  />
                </div>
              </div>
            </div>
          ))}

          {counters.length === 0 && (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              No counters defined. At least one counter is recommended for monitoring.
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
        <button
          className="btn btn-ghost"
          onClick={() => {
            setCounters(config.counters || [{ id: 'counter_1', name: 'Meja CS 1', audio_device_index: -1, enabled: true, camera_id: 'cam_cs_1', rtsp_url: '', snapshot_url: '' }])
          }}
        >
          Reset changes
        </button>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? <span className="spinner" style={{ width: 12, height: 12 }} /> : null}
          Save Counters Setup
        </button>
      </div>
    </div>
  )
}
