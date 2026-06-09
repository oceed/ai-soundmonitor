import { useEffect, useRef, useState, useMemo } from 'react'
import { AudioVisualizer } from '../components/AudioVisualizer'
import { format } from 'date-fns'
import { startPipeline, stopPipeline, getSegments } from '../api/config'
import { getRecordingStreamUrl } from '../api/alerts'
import { useToast } from '../components/NotificationToast'

const MAX_FEED = 80

const VERDICT_CONFIG = {
  FRAUD:      { color: 'var(--fraud)',      bg: 'var(--fraud-bg)',      border: 'var(--fraud-border)',      icon: '⚠' },
  SUSPICIOUS: { color: 'var(--suspicious)', bg: 'var(--suspicious-bg)', border: 'var(--suspicious-border)', icon: '◈' },
  NORMAL:     { color: 'var(--clear)',      bg: 'var(--clear-bg)',      border: 'var(--clear-border)',       icon: '✓' },
  CLEAR:      { color: 'var(--clear)',      bg: 'var(--clear-bg)',      border: 'var(--clear-border)',       icon: '✓' },
  ERROR:      { color: 'var(--error)',      bg: 'rgba(240,82,82,0.08)', border: 'rgba(240,82,82,0.2)',      icon: '✕' },
}

/* ─── small helpers ─── */
function pct(a, total) {
  if (!total) return 0
  return Math.round((a / total) * 100)
}

function avg(arr) {
  if (!arr || arr.length === 0) return 0
  return Math.round(arr.reduce((s, v) => s + v, 0) / arr.length)
}

/* ─── MiniBar: tiny horizontal stacked bar showing fraud/sus/normal ─── */
function VerdictBar({ fraud, suspicious, normal }) {
  const total = fraud + suspicious + normal
  if (!total) return (
    <div style={{ height: 8, background: 'var(--bg-elevated)', borderRadius: 4, width: '100%' }} />
  )
  return (
    <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', width: '100%', gap: 1 }}>
      {fraud > 0 && (
        <div style={{ flex: fraud, background: 'var(--fraud)', transition: 'flex 0.5s ease' }} title={`Fraud: ${fraud}`} />
      )}
      {suspicious > 0 && (
        <div style={{ flex: suspicious, background: 'var(--suspicious)', transition: 'flex 0.5s ease' }} title={`Suspicious: ${suspicious}`} />
      )}
      {normal > 0 && (
        <div style={{ flex: normal, background: 'var(--clear)', opacity: 0.6, transition: 'flex 0.5s ease' }} title={`Clear: ${normal}`} />
      )}
    </div>
  )
}

/* ─── Mini sparkline-like latency graph (last 20 segments) ─── */
function LatencyGraph({ values = [], color = 'var(--accent)', label = '' }) {
  const h = 36, w = 120
  if (values.length < 2) {
    return (
      <div style={{ width: w, height: h, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-muted)' }}>
        No data
      </div>
    )
  }
  const mx = Math.max(...values, 1)
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = h - (v / mx) * h
    return `${x},${y}`
  }).join(' ')

  return (
    <div style={{ position: 'relative' }}>
      <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
        <polyline
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.8}
        />
        {/* fill under */}
        <polyline
          points={`0,${h} ${pts} ${w},${h}`}
          fill={color}
          opacity={0.08}
        />
      </svg>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
        {label} avg {avg(values)}ms
      </div>
    </div>
  )
}

/* ─── System info panel ─── */
function SystemPanel({ pipelineStatus, feed }) {
  const sttTimes = feed.filter(f => f.stt_ms > 0).map(f => f.stt_ms).slice(-20)
  const llmTimes = feed.filter(f => f.llm_ms > 0).map(f => f.llm_ms).slice(-20)

  const rows = [
    { label: 'Session', value: `#${pipelineStatus?.stats?.session_id || '—'}` },
    { label: 'STT Mode', value: pipelineStatus?.stats?.stt_mode || '—', mono: true },
    { label: 'LLM Mode', value: pipelineStatus?.stats?.llm_mode || '—', mono: true },
    { label: 'Avg STT', value: sttTimes.length ? `${avg(sttTimes)} ms` : '—', mono: true },
    { label: 'Avg LLM', value: llmTimes.length ? `${avg(llmTimes)} ms` : '—', mono: true },
  ]

  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div className="section-label" style={{ marginBottom: 10 }}>System Info</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {rows.map(r => (
          <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.label}</span>
            <span style={{
              fontSize: 11, fontWeight: 600,
              color: 'var(--text-secondary)',
              fontFamily: r.mono ? 'var(--font-mono)' : 'inherit',
            }}>{r.value}</span>
          </div>
        ))}
      </div>

      {(sttTimes.length > 1 || llmTimes.length > 1) && (
        <>
          <div style={{ height: 1, background: 'var(--border)', margin: '12px 0' }} />
          <div style={{ display: 'flex', gap: 16, justifyContent: 'space-between' }}>
            <LatencyGraph values={sttTimes} color="var(--accent-light)" label="STT" />
            <LatencyGraph values={llmTimes} color="var(--suspicious)" label="LLM" />
          </div>
        </>
      )}
    </div>
  )
}

/* ─── Verdict distribution mini-card ─── */
function VerdictDistribution({ stats }) {
  const total = stats.FRAUD + stats.SUSPICIOUS + (stats.NORMAL || 0)
  const fraudRate = pct(stats.FRAUD, total)
  const susRate   = pct(stats.SUSPICIOUS, total)
  const clearRate = pct(stats.NORMAL, total)

  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div className="section-label" style={{ marginBottom: 10 }}>Session Distribution</div>

      <VerdictBar fraud={stats.FRAUD} suspicious={stats.SUSPICIOUS} normal={stats.NORMAL} />

      <div style={{ display: 'flex', gap: 0, marginTop: 10 }}>
        {[
          { label: 'Fraud', pct: fraudRate, color: 'var(--fraud)' },
          { label: 'Suspicious', pct: susRate, color: 'var(--suspicious)' },
          { label: 'Clear', pct: clearRate, color: 'var(--clear)' },
        ].map(({ label, pct: p, color }) => (
          <div key={label} style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color, letterSpacing: '-0.03em', lineHeight: 1 }}>{p}%</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Processing indicator ─── */
function ProcessingState({ events = [] }) {
  const lastEvent = events?.[events.length - 1]
  if (!lastEvent) return null

  const stateMap = {
    stt_progress: { label: 'Transcribing audio...', color: 'var(--accent-light)' },
    llm_progress: { label: 'Analyzing for fraud...', color: 'var(--suspicious)' },
  }

  const state = stateMap[lastEvent?.type]
  if (!state) return null

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '9px 12px',
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      fontSize: 12, color: state.color,
      animation: 'fadeIn 0.2s ease',
    }}>
      <div className="spinner" style={{ width: 13, height: 13, borderTopColor: state.color }} />
      <span>{state.label}</span>
      {lastEvent?.text && (
        <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180, flex: 1 }}>
          "{lastEvent.text}"
        </span>
      )}
    </div>
  )
}

/* ─── Feed item ─── */
function FeedItem({ item, isNew, onPlayClick }) {
  const cfg = VERDICT_CONFIG[item.verdict] || VERDICT_CONFIG.ERROR
  const isBad = item.verdict === 'FRAUD' || item.verdict === 'SUSPICIOUS'

  return (
    <div
      className={isNew ? 'animate-in' : ''}
      style={{
        background: 'var(--bg-card)',
        border: `1px solid ${isBad ? cfg.border : 'var(--border)'}`,
        borderLeft: `3px solid ${cfg.color}`,
        borderRadius: 'var(--radius)',
        padding: '11px 13px',
        transition: 'all var(--t-fast)',
        ...(item.verdict === 'FRAUD' ? { boxShadow: '0 0 10px var(--fraud-glow)' } : {}),
      }}
    >
      {/* Top row: verdict + meta */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: cfg.color }}>
            {cfg.icon} {item.classification || item.verdict}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 700,
            color: cfg.color, opacity: 0.75,
            fontFamily: 'var(--font-mono)',
          }}>
            {item.confidence}%
          </span>
          {item.flags?.map(f => (
            <span key={f} className="badge badge-fraud" style={{ fontSize: 9, padding: '1px 6px' }}>{f}</span>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {item.stt_ms > 0 && (
            <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              STT {item.stt_ms}ms
            </span>
          )}
          {item.llm_ms > 0 && (
            <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              LLM {item.llm_ms}ms
            </span>
          )}
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {item.timestamp ? format(new Date(item.timestamp), 'HH:mm:ss') : ''}
          </span>
          {item.has_recording && (
            <button
              onClick={(e) => { e.stopPropagation(); onPlayClick(item) }}
              style={{
                background: 'var(--accent-glow)',
                border: '1px solid rgba(124,106,247,0.3)',
                borderRadius: 4,
                color: 'var(--accent-light)',
                fontSize: 9,
                fontWeight: 700,
                padding: '2px 7px',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                letterSpacing: '0.03em',
              }}
            >
              ▶ PLAY
            </button>
          )}
        </div>
      </div>

      {/* Transcript */}
      <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.55, marginBottom: 4 }}>
        "{item.transcript}"
      </div>

      {/* Reason */}
      {item.reason && (
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
          {item.reason}
        </div>
      )}

      {/* Confidence bar */}
      <div className="confidence-bar" style={{ marginTop: 7 }}>
        <div className="confidence-track">
          <div
            className={`confidence-fill confidence-${item.verdict?.toLowerCase() === 'fraud' ? 'fraud' : item.verdict?.toLowerCase() === 'suspicious' ? 'suspicious' : 'normal'}`}
            style={{ width: `${item.confidence}%` }}
          />
        </div>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', minWidth: 28 }}>
          {item.confidence}%
        </span>
      </div>
    </div>
  )
}

/* ─── Audio Playback Modal ─── */
function PlaybackModal({ item, onClose }) {
  if (!item) return null
  const cfg = VERDICT_CONFIG[item.verdict] || VERDICT_CONFIG.ERROR

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="card animate-in"
        style={{
          width: '100%', maxWidth: 480,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-active)',
          borderRadius: 14,
          padding: 22,
          boxShadow: 'var(--shadow-lg)',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color, boxShadow: `0 0 8px ${cfg.color}` }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Recording Playback</span>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            fontSize: 18, cursor: 'pointer', padding: '2px 6px', borderRadius: 4,
          }}>✕</button>
        </div>

        {/* Verdict block */}
        <div style={{
          background: 'var(--bg-card)',
          padding: '12px 14px',
          borderRadius: 8,
          borderLeft: `3px solid ${cfg.color}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: cfg.color }}>
              {item.verdict} — {item.confidence}%
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {item.timestamp ? format(new Date(item.timestamp), 'HH:mm:ss') : ''}
            </span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', fontStyle: 'italic', marginBottom: 6 }}>
            "{item.transcript}"
          </div>
          {item.reason && (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', borderTop: '1px solid var(--border)', paddingTop: 6 }}>
              {item.reason}
            </div>
          )}
        </div>

        {/* Audio */}
        <div className="audio-player">
          <audio
            autoPlay
            src={getRecordingStreamUrl(item.alert_id)}
            controls
            style={{ width: '100%' }}
          />
        </div>
      </div>
    </div>
  )
}

/* ─── VAD indicator ─── */
function VadIndicator({ vadState }) {
  const s = vadState === 'speech'
    ? { label: 'Speech Detected', color: 'var(--clear)', pulse: true }
    : { label: 'Silence / Background', color: 'var(--text-muted)', pulse: false }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div
        className={`status-dot ${s.pulse ? 'status-dot-green status-dot-pulse' : 'status-dot-gray'}`}
        style={{ width: 7, height: 7 }}
      />
      <span style={{ fontSize: 11, fontWeight: 600, color: s.color, transition: 'color 0.2s' }}>
        {s.label}
      </span>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   Main Dashboard
══════════════════════════════════════════════════════════ */
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

  /* Sync stats from pipeline poll */
  useEffect(() => {
    if (pipelineStatus?.stats) {
      setStats({
        FRAUD:      pipelineStatus.stats.FRAUD      || 0,
        SUSPICIOUS: pipelineStatus.stats.SUSPICIOUS || 0,
        NORMAL:     pipelineStatus.stats.NORMAL     || 0,
        segments:   pipelineStatus.stats.segments   || 0,
      })
    }
  }, [pipelineStatus])

  /* Load initial feed when session changes */
  useEffect(() => {
    const sessionId = pipelineStatus?.stats?.session_id
    if (!sessionId) { setFeed([]); return }

    getSegments({ session_id: sessionId, limit: MAX_FEED })
      .then(data => {
        if (data?.items) {
          setFeed(data.items.map(s => ({
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
          })))
        }
      })
      .catch(err => console.error('Failed to load segments:', err))
  }, [pipelineStatus?.stats?.session_id])

  /* WebSocket event processor */
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
          id:             event.segment_id || Date.now(),
          timestamp:      event.timestamp || new Date().toISOString(),
          verdict:        event.verdict,
          classification: event.classification || event.verdict,
          confidence:     event.confidence,
          transcript:     event.transcript,
          reason:         event.reason,
          flags:          event.flags || [],
          stt_ms:         event.stt_ms,
          llm_ms:         event.llm_ms,
          has_recording:  false,
          alert_id:       null,
        }, ...prev].slice(0, MAX_FEED))
        setStats(prev => ({
          ...prev,
          segments: (prev.segments || 0) + 1,
          [event.verdict]: (prev[event.verdict] || 0) + 1,
        }))
        break

      case 'alert':
        setFeed(prev => prev.map(item =>
          item.id === event.segment_id ? { ...item, alert_id: event.alert_id } : item
        ))
        addToast({
          type:     event.verdict === 'FRAUD' ? 'fraud' : 'warning',
          title:    `${event.verdict === 'FRAUD' ? '⚠ FRAUD DETECTED' : '◈ SUSPICIOUS'} — ${event.confidence}%`,
          body:     event.reason?.slice(0, 120) || '',
          duration: 8000,
        })
        break

      case 'alert_recording_ready':
        setFeed(prev => prev.map(item =>
          (item.alert_id === event.alert_id || item.id === event.segment_id)
            ? { ...item, has_recording: true, alert_id: event.alert_id }
            : item
        ))
        break

      case 'pipeline_status':
        if (event.stats) {
          setStats({
            FRAUD:      event.stats.FRAUD      || 0,
            SUSPICIOUS: event.stats.SUSPICIOUS || 0,
            NORMAL:     event.stats.NORMAL     || 0,
            segments:   event.stats.segments   || 0,
          })
        }
        break
    }
  }, [liveEvents, addToast])

  const handleTogglePipeline = async () => {
    setPipelineLoading(true)
    try {
      if (pipelineStatus?.running) await stopPipeline()
      else await startPipeline()
    } catch (e) {
      addToast({ type: 'warning', title: 'Pipeline error', body: e.message })
    } finally {
      setPipelineLoading(false)
    }
  }

  const isRunning = pipelineStatus?.running

  /* Derived: recent fraud/sus count for alert strip */
  const recentBad = useMemo(() => feed.filter(f => f.verdict === 'FRAUD' || f.verdict === 'SUSPICIOUS').slice(0, 3), [feed])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── Page header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 24px 14px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
            Live Monitor
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
            Real-time fraud detection · Session #{pipelineStatus?.stats?.session_id || '—'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ProcessingState events={liveEvents} />
          <button
            id="pipeline-toggle-btn"
            className={`btn ${isRunning ? 'btn-danger' : 'btn-primary'}`}
            onClick={handleTogglePipeline}
            disabled={pipelineLoading}
          >
            {pipelineLoading ? <span className="spinner" style={{ width: 13, height: 13 }} /> : null}
            {isRunning ? '⏹ Stop' : '▶ Start Pipeline'}
          </button>
        </div>
      </div>

      {/* ── Stat bar (4 cards) ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 12, padding: '14px 24px', flexShrink: 0,
        borderBottom: '1px solid var(--border)',
      }}>
        {[
          {
            label: 'Total Segments',
            value: stats.segments,
            sub: `This session`,
            color: 'var(--accent-light)',
            icon: '◎',
          },
          {
            label: 'Fraud Detected',
            value: stats.FRAUD,
            sub: `${pct(stats.FRAUD, stats.segments)}% of segments`,
            color: 'var(--fraud)',
            icon: '⚠',
          },
          {
            label: 'Suspicious',
            value: stats.SUSPICIOUS,
            sub: `${pct(stats.SUSPICIOUS, stats.segments)}% of segments`,
            color: 'var(--suspicious)',
            icon: '◈',
          },
          {
            label: 'Clear / Normal',
            value: stats.NORMAL,
            sub: `${pct(stats.NORMAL, stats.segments)}% of segments`,
            color: 'var(--clear)',
            icon: '✓',
          },
        ].map(s => (
          <div key={s.label} style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            transition: 'all var(--t-fast)',
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: `color-mix(in srgb, ${s.color} 12%, transparent)`,
              border: `1px solid color-mix(in srgb, ${s.color} 25%, transparent)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, color: s.color, flexShrink: 0,
            }}>
              {s.icon}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {s.label}
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.04em', color: s.color, lineHeight: 1.1 }}>
                {s.value}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1 }}>
                {s.sub}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Main body: 2-column layout ── */}
      <div style={{
        flex: 1, display: 'flex', gap: 0,
        overflow: 'hidden', minHeight: 0,
      }}>

        {/* Left panel: audio + system + distribution */}
        <div style={{
          width: 320, flexShrink: 0,
          display: 'flex', flexDirection: 'column', gap: 12,
          padding: '16px 0 16px 24px',
          borderRight: '1px solid var(--border)',
          overflowY: 'auto',
        }}>
          {/* Audio Visualizer card */}
          <div className="card" style={{ padding: '14px 16px', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span className="section-label">Audio Input</span>
              <VadIndicator vadState={vadState} />
            </div>
            <AudioVisualizer rms={rms} vadState={vadState} verdict={lastVerdict} />
          </div>

          {/* Verdict distribution */}
          <VerdictDistribution stats={stats} />

          {/* System info */}
          <SystemPanel pipelineStatus={pipelineStatus} feed={feed} />

          {/* Recent bad events */}
          {recentBad.length > 0 && (
            <div className="card" style={{ padding: '14px 16px' }}>
              <div className="section-label" style={{ marginBottom: 10 }}>Recent Alerts</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {recentBad.map(item => {
                  const cfg = VERDICT_CONFIG[item.verdict] || VERDICT_CONFIG.ERROR
                  return (
                    <div key={item.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 10px',
                      background: 'var(--bg-elevated)',
                      borderLeft: `3px solid ${cfg.color}`,
                      borderRadius: 6,
                      cursor: item.has_recording ? 'pointer' : 'default',
                    }}
                      onClick={() => item.has_recording && setPlayingRecording(item)}
                    >
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: cfg.color }}>{item.verdict}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.transcript || '—'}
                        </div>
                      </div>
                      <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                        {item.timestamp ? format(new Date(item.timestamp), 'HH:mm') : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right panel: live transcript feed */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px 10px',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="section-label">Transcript Feed</span>
              {isRunning && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div className="status-dot status-dot-green status-dot-pulse" />
                  <span style={{ fontSize: 10, color: 'var(--clear)' }}>LIVE</span>
                </div>
              )}
            </div>
            <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              {feed.length} / {MAX_FEED}
            </span>
          </div>

          <div
            ref={feedRef}
            style={{
              flex: 1, overflowY: 'auto',
              display: 'flex', flexDirection: 'column', gap: 8,
              padding: '0 20px 16px',
            }}
          >
            {feed.length === 0 ? (
              <div className="empty-state" style={{ marginTop: 40 }}>
                <div className="empty-state-icon">🎙</div>
                <div className="empty-state-title">No segments yet</div>
                <div className="empty-state-sub">
                  {isRunning
                    ? 'Listening… speak near your microphone to begin detection.'
                    : 'Start the pipeline to begin real-time monitoring.'}
                </div>
              </div>
            ) : (
              feed.map((item, i) => (
                <FeedItem
                  key={item.id}
                  item={item}
                  isNew={i === 0}
                  onPlayClick={setPlayingRecording}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Audio Playback Modal ── */}
      {playingRecording && (
        <PlaybackModal item={playingRecording} onClose={() => setPlayingRecording(null)} />
      )}
    </div>
  )
}
