import { useEffect, useRef, useState } from 'react'
import { AudioVisualizer } from '../components/AudioVisualizer'
import { format } from 'date-fns'
import { startPipeline, stopPipeline } from '../api/config'
import { useToast } from '../components/NotificationToast'

const MAX_FEED = 80

const VERDICT_CONFIG = {
  FRAUD: { color: 'var(--fraud)', bg: 'var(--fraud-bg)', border: 'var(--fraud-border)', icon: '🚨' },
  SUSPICIOUS: { color: 'var(--suspicious)', bg: 'var(--suspicious-bg)', border: 'var(--suspicious-border)', icon: '⚠️' },
  NORMAL: { color: 'var(--clear)', bg: 'var(--clear-bg)', border: 'var(--clear-border)', icon: '✓' },
  CLEAR: { color: 'var(--clear)', bg: 'var(--clear-bg)', border: 'var(--clear-border)', icon: '✓' },
  ERROR: { color: 'var(--error)', bg: 'rgba(255,107,107,0.08)', border: 'rgba(255,107,107,0.2)', icon: '✕' },
}

export function Dashboard({ liveEvents, pipelineStatus }) {
  const [rms, setRms] = useState(0)
  const [vadState, setVadState] = useState('silence')
  const [feed, setFeed] = useState([])
  const [stats, setStats] = useState({ FRAUD: 0, SUSPICIOUS: 0, NORMAL: 0, segments: 0 })
  const [lastVerdict, setLastVerdict] = useState(null)
  const [pipelineLoading, setPipelineLoading] = useState(false)
  const feedRef = useRef(null)
  const { addToast } = useToast()

  // Process incoming WebSocket events
  useEffect(() => {
    if (!liveEvents || liveEvents.length === 0) return
    const event = liveEvents[liveEvents.length - 1]
    if (!event) return

    switch (event.type) {
      case 'audio_level':
        setRms(event.rms || 0)
        setVadState(event.vad_state || 'silence')
        break

      case 'vad_state':
        setVadState(event.state)
        break

      case 'segment_result':
        setLastVerdict(event.verdict)
        setFeed(prev => [{
          id: event.segment_no || Date.now(),
          timestamp: event.timestamp || new Date().toISOString(),
          verdict: event.verdict,
          classification: event.classification,
          confidence: event.confidence,
          transcript: event.transcript,
          reason: event.reason,
          flags: event.flags || [],
          stt_ms: event.stt_ms,
          llm_ms: event.llm_ms,
          stt_mode: event.stt_mode,
          llm_mode: event.llm_mode,
        }, ...prev].slice(0, MAX_FEED))
        break

      case 'alert':
        addToast({
          type: event.verdict === 'FRAUD' ? 'fraud' : 'warning',
          title: `${event.verdict === 'FRAUD' ? '🚨 FRAUD' : '⚠️ SUSPICIOUS'} — ${event.confidence}% confidence`,
          body: event.reason?.slice(0, 100) || '',
          duration: 8000,
        })
        break

      case 'pipeline_status':
        if (event.stats) {
          setStats(s => ({ ...s, ...event.stats }))
        }
        break
    }
  }, [liveEvents, addToast])

  const handleTogglePipeline = async () => {
    setPipelineLoading(true)
    try {
      if (pipelineStatus?.running) {
        await stopPipeline()
      } else {
        await startPipeline()
      }
    } catch (e) {
      addToast({ type: 'warning', title: 'Pipeline error', body: e.message })
    } finally {
      setPipelineLoading(false)
    }
  }

  const isRunning = pipelineStatus?.running

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div className="page-header" style={{ flexShrink: 0, padding: '20px 24px 0' }}>
        <div>
          <div className="page-title">Live Monitor</div>
          <div className="page-subtitle">
            Real-time fraud detection · Session #{pipelineStatus?.stats?.session_id || '—'}
          </div>
        </div>
        <button
          id="pipeline-toggle-btn"
          className={`btn ${isRunning ? 'btn-danger' : 'btn-primary'}`}
          onClick={handleTogglePipeline}
          disabled={pipelineLoading}
        >
          {pipelineLoading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : null}
          {isRunning ? '⏹ Stop Pipeline' : '▶ Start Pipeline'}
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', padding: '20px 24px', display: 'flex', gap: 20, minHeight: 0 }}>
        {/* Left column */}
        <div style={{ flex: '0 0 55%', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {/* Visualizer */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Audio Input
              </span>
              <div style={{ display: 'flex', gap: 8, fontSize: 11 }}>
                <span style={{ color: 'var(--text-muted)' }}>
                  STT: <span style={{ color: 'var(--accent)' }}>{pipelineStatus?.stats?.stt_mode || '—'}</span>
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  LLM: <span style={{ color: 'var(--accent)' }}>{pipelineStatus?.stats?.llm_mode || '—'}</span>
                </span>
              </div>
            </div>
            <AudioVisualizer rms={rms} vadState={vadState} verdict={lastVerdict} />
          </div>

          {/* Stats */}
          <div className="grid-4" style={{ gap: 12 }}>
            {[
              { label: 'Segments', value: pipelineStatus?.stats?.segments || stats.segments || 0, cls: 'stat-accent' },
              { label: 'FRAUD', value: pipelineStatus?.stats?.FRAUD || stats.FRAUD || 0, cls: 'stat-fraud' },
              { label: 'Suspicious', value: pipelineStatus?.stats?.SUSPICIOUS || stats.SUSPICIOUS || 0, cls: 'stat-suspicious' },
              { label: 'Clear', value: pipelineStatus?.stats?.NORMAL || stats.NORMAL || 0, cls: 'stat-clear' },
            ].map(s => (
              <div key={s.label} className={`stat-card ${s.cls}`}>
                <div className="stat-label">{s.label}</div>
                <div className="stat-value">{s.value}</div>
              </div>
            ))}
          </div>

          {/* Current processing state */}
          <ProcessingState events={liveEvents} />
        </div>

        {/* Right column — Live feed */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 10,
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Transcript Feed
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{feed.length} segments</span>
          </div>

          <div
            ref={feedRef}
            style={{
              flex: 1, overflowY: 'auto',
              display: 'flex', flexDirection: 'column', gap: 8,
            }}
          >
            {feed.length === 0 ? (
              <div className="empty-state" style={{ padding: 40 }}>
                <div className="empty-state-icon">🎙</div>
                <div className="empty-state-title">Waiting for speech...</div>
                <div className="empty-state-sub">Start speaking near the microphone to begin detection</div>
              </div>
            ) : (
              feed.map((item, i) => (
                <FeedItem key={item.id} item={item} isNew={i === 0} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function FeedItem({ item, isNew }) {
  const cfg = VERDICT_CONFIG[item.verdict] || VERDICT_CONFIG.ERROR

  return (
    <div
      className={isNew ? 'animate-in' : ''}
      style={{
        background: 'var(--bg-card)',
        border: `1px solid ${item.verdict === 'FRAUD' || item.verdict === 'SUSPICIOUS' ? cfg.border : 'var(--border)'}`,
        borderLeft: `3px solid ${cfg.color}`,
        borderRadius: 'var(--radius)',
        padding: '12px 14px',
        ...(item.verdict === 'FRAUD' ? { boxShadow: '0 0 12px var(--fraud-glow)' } : {}),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>{cfg.icon}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: cfg.color }}>
            {item.classification || item.verdict}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {item.confidence}%
          </span>
          {item.flags?.length > 0 && item.flags.map(f => (
            <span key={f} className="badge badge-fraud" style={{ fontSize: 9 }}>{f}</span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          <span>STT {item.stt_ms}ms</span>
          <span>LLM {item.llm_ms}ms</span>
          <span>{item.timestamp ? format(new Date(item.timestamp), 'HH:mm:ss') : ''}</span>
        </div>
      </div>

      <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4, lineHeight: 1.5 }}>
        "{item.transcript}"
      </div>

      {item.reason && (
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
          {item.reason}
        </div>
      )}

      {/* Confidence bar */}
      <div className="confidence-bar" style={{ marginTop: 8 }}>
        <div className="confidence-track">
          <div
            className={`confidence-fill confidence-${item.verdict?.toLowerCase() === 'fraud' ? 'fraud' : item.verdict?.toLowerCase() === 'suspicious' ? 'suspicious' : 'normal'}`}
            style={{ width: `${item.confidence}%` }}
          />
        </div>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', minWidth: 30 }}>
          {item.confidence}%
        </span>
      </div>
    </div>
  )
}

function ProcessingState({ events = [] }) {
  const lastEvent = events?.[events.length - 1]
  if (!lastEvent) return null

  const stateMap = {
    stt_progress: { label: 'Transcribing...', color: 'var(--accent)' },
    llm_progress: { label: 'Analyzing for fraud...', color: 'var(--suspicious)' },
    vad_state: null,
    audio_level: null,
  }

  const state = stateMap[lastEvent?.type]
  if (!state) return null

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 14px',
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      fontSize: 12, color: state.color,
    }}>
      <div className="spinner" style={{ width: 14, height: 14, borderTopColor: state.color }} />
      {state.label}
      {lastEvent?.text && (
        <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
          "{lastEvent.text}"
        </span>
      )}
    </div>
  )
}
