import { useEffect, useRef, useState } from 'react'
import { AudioVisualizer } from '../components/AudioVisualizer'
import { format } from 'date-fns'
import { startPipeline, stopPipeline, getSegments } from '../api/config'
import { getRecordingStreamUrl } from '../api/alerts'
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
  const [playingRecording, setPlayingRecording] = useState(null)
  const feedRef = useRef(null)
  const { addToast } = useToast()

  // Sync stats when pipeline status loads/polls
  useEffect(() => {
    if (pipelineStatus?.stats) {
      setStats({
        FRAUD: pipelineStatus.stats.FRAUD || 0,
        SUSPICIOUS: pipelineStatus.stats.SUSPICIOUS || 0,
        NORMAL: pipelineStatus.stats.NORMAL || 0,
        segments: pipelineStatus.stats.segments || 0,
      })
    }
  }, [pipelineStatus])

  // Load initial feed when session changes or on mount
  useEffect(() => {
    const sessionId = pipelineStatus?.stats?.session_id
    if (!sessionId) {
      setFeed([])
      return
    }

    setPipelineLoading(true)
    getSegments({ session_id: sessionId, limit: MAX_FEED })
      .then(data => {
        if (data && data.items) {
          const mapped = data.items.map(s => ({
            id: s.id,
            timestamp: s.timestamp,
            verdict: s.verdict,
            classification: s.verdict,
            confidence: s.confidence,
            transcript: s.transcript,
            reason: s.reason,
            flags: s.flags || [],
            stt_ms: s.stt_ms,
            llm_ms: s.llm_ms,
            stt_mode: s.stt_mode,
            llm_mode: s.llm_mode,
            has_recording: s.has_recording,
            alert_id: s.alert_id,
          }))
          setFeed(mapped)
        }
      })
      .catch(err => {
        console.error('Failed to load initial segments:', err)
      })
      .finally(() => {
        setPipelineLoading(false)
      })
  }, [pipelineStatus?.stats?.session_id])

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
          id: event.segment_id || event.segment_no || Date.now(),
          timestamp: event.timestamp || new Date().toISOString(),
          verdict: event.verdict,
          classification: event.classification || event.verdict,
          confidence: event.confidence,
          transcript: event.transcript,
          reason: event.reason,
          flags: event.flags || [],
          stt_ms: event.stt_ms,
          llm_ms: event.llm_ms,
          stt_mode: event.stt_mode,
          llm_mode: event.llm_mode,
          has_recording: false,
          alert_id: null,
        }, ...prev].slice(0, MAX_FEED))

        // Update stats locally
        setStats(prev => {
          const verdictKey = event.verdict
          return {
            ...prev,
            segments: (prev.segments || 0) + 1,
            [verdictKey]: (prev[verdictKey] || 0) + 1,
          }
        })
        break

      case 'alert':
        // Link alert_id to feed segment
        setFeed(prev => prev.map(item => {
          if (item.id === event.segment_id) {
            return { ...item, alert_id: event.alert_id }
          }
          return item
        }))
        addToast({
          type: event.verdict === 'FRAUD' ? 'fraud' : 'warning',
          title: `${event.verdict === 'FRAUD' ? '🚨 FRAUD' : '⚠️ SUSPICIOUS'} — ${event.confidence}% confidence`,
          body: event.reason?.slice(0, 100) || '',
          duration: 8000,
        })
        break

      case 'alert_recording_ready':
        // Set has_recording = true on feed segment
        setFeed(prev => prev.map(item => {
          if (item.alert_id === event.alert_id || item.id === event.segment_id) {
            return { ...item, has_recording: true, alert_id: event.alert_id }
          }
          return item
        }))
        break

      case 'pipeline_status':
        if (event.stats) {
          setStats({
            FRAUD: event.stats.FRAUD || 0,
            SUSPICIOUS: event.stats.SUSPICIOUS || 0,
            NORMAL: event.stats.NORMAL || 0,
            segments: event.stats.segments || 0,
          })
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
              { label: 'Segments', value: stats.segments, cls: 'stat-accent' },
              { label: 'FRAUD', value: stats.FRAUD, cls: 'stat-fraud' },
              { label: 'Suspicious', value: stats.SUSPICIOUS, cls: 'stat-suspicious' },
              { label: 'Clear', value: stats.NORMAL, cls: 'stat-clear' },
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
                <FeedItem key={item.id} item={item} isNew={i === 0} onPlayClick={setPlayingRecording} />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Audio Playback Popup Modal */}
      {playingRecording && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px',
        }}>
          <div className="card" style={{
            width: '100%',
            maxWidth: '480px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '16px',
            padding: '24px',
            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                Play Recording
              </h3>
              <button
                onClick={() => setPlayingRecording(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: 18,
                  cursor: 'pointer',
                  padding: 4
                }}
              >
                ✕
              </button>
            </div>

            <div style={{
              background: 'var(--bg-elevated)',
              padding: '12px 14px',
              borderRadius: 8,
              borderLeft: `3px solid ${VERDICT_CONFIG[playingRecording.verdict]?.color || 'var(--accent)'}`,
              fontSize: 13,
            }}>
              <div style={{ fontWeight: 700, color: VERDICT_CONFIG[playingRecording.verdict]?.color, marginBottom: 4 }}>
                {playingRecording.classification || playingRecording.verdict} — {playingRecording.confidence}% confidence
              </div>
              <div style={{ color: 'var(--text-primary)', fontStyle: 'italic', marginBottom: 4 }}>
                "{playingRecording.transcript}"
              </div>
              {playingRecording.reason && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 4 }}>
                  {playingRecording.reason}
                </div>
              )}
            </div>

            <div className="audio-player" style={{ marginTop: 8 }}>
              <audio
                autoPlay
                src={getRecordingStreamUrl(playingRecording.alert_id)}
                controls
                style={{ width: '100%', accentColor: 'var(--accent)' }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FeedItem({ item, isNew, onPlayClick }) {
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          <span>STT {item.stt_ms}ms</span>
          <span>LLM {item.llm_ms}ms</span>
          <span>{item.timestamp ? format(new Date(item.timestamp), 'HH:mm:ss') : ''}</span>
          {item.has_recording && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onPlayClick(item)
              }}
              className="btn btn-primary btn-sm"
              style={{
                padding: '2px 8px',
                fontSize: '9px',
                height: 'auto',
                lineHeight: 1,
                marginLeft: 4,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                cursor: 'pointer',
              }}
            >
              ▶ Listen
            </button>
          )}
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
