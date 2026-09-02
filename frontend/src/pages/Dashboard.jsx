import { useEffect, useRef, useState, useMemo } from 'react'
import { AudioVisualizer } from '../components/AudioVisualizer'
import { SnapshotModal } from '../components/SnapshotModal'
import { AudioPlayer } from '../components/AudioPlayer'
import { format } from 'date-fns'
import { startPipeline, stopPipeline, getSegments, getSessions, getConfig } from '../api/config'
import { getRecordingStreamUrl, getSnapshotUrl } from '../api/alerts'
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
function SystemPanel({ pipelineStatus, feed, activeSessionId }) {
  const sttTimes = feed.filter(f => f.stt_ms > 0).map(f => f.stt_ms).slice(-20)
  const llmTimes = feed.filter(f => f.llm_ms > 0).map(f => f.llm_ms).slice(-20)

  const rows = [
    { label: 'Session', value: `#${activeSessionId || '—'}` },
    { label: 'Active Mic', value: pipelineStatus?.stats?.active_mic_name || '—' },
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
function FeedItem({ item, isNew, onPlayClick, onSnapshotClick, categories = [] }) {
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: cfg.color }}>
            {cfg.icon} {item.classification || item.verdict}
          </span>
          {item.flags?.map(f => {
            const cat = categories.find(c => c.key === f);
            const label = cat?.label || f.replace(/_/g, ' ');
            const cls = cat?.classification || 'FRAUD';
            let badgeClass = 'badge badge-fraud';
            if (cls === 'NORMAL') badgeClass = 'badge badge-normal';
            else if (cls === 'SUSPICIOUS') badgeClass = 'badge badge-suspicious';

            return (
              <span key={f} className={badgeClass} style={{ fontSize: 9, padding: '1px 6px' }}>
                {label}
              </span>
            );
          })}
          {item.snapshot_path && (
            <span
              onClick={(e) => { e.stopPropagation(); onSnapshotClick?.(item); }}
              className="badge"
              style={{
                fontSize: 9,
                padding: '1px 6px',
                background: 'rgba(255, 122, 0, 0.14)',
                color: 'var(--accent-light)',
                border: '1px solid rgba(255, 122, 0, 0.3)',
                cursor: 'pointer',
              }}
              title="Camera snapshot captured · Click to view full image"
            >
              📷 SNAPSHOT
            </span>
          )}
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
                border: '1px solid rgba(255,122,0,0.3)',
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
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: 4 }}>
          {item.reason}
        </div>
      )}

      {/* Compact Snapshot Preview Thumbnail Bar */}
      {item.snapshot_path && (
        <div
          onClick={(e) => { e.stopPropagation(); onSnapshotClick?.(item); }}
          style={{
            marginTop: 6,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '4px 10px 4px 5px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 7,
            cursor: 'pointer',
            transition: 'all var(--t-fast)',
            maxWidth: '100%',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
          title="Click to open full-resolution camera snapshot modal"
        >
          <div style={{
            width: 48,
            height: 34,
            borderRadius: 4,
            overflow: 'hidden',
            background: '#000',
            flexShrink: 0,
            border: '1px solid var(--border)',
            position: 'relative',
          }}>
            <img
              src={getSnapshotUrl(item.snapshot_path)}
              alt="Snapshot"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              onError={(e) => { e.target.style.display = 'none' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span>📷</span> <span>Camera Evidence</span>
            </span>
            <span style={{ fontSize: 9, color: 'var(--accent-light)' }}>
              Click to view snapshot ↗
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Audio Playback Modal ─── */
function PlaybackModal({ item, onClose, onSnapshotClick }) {
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
              {item.verdict}
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

          {item.snapshot_path && (
            <div
              onClick={() => onSnapshotClick?.(item)}
              style={{
                marginTop: 10,
                padding: '6px 10px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <img
                src={getSnapshotUrl(item.snapshot_path)}
                alt="Snapshot"
                style={{ width: 44, height: 30, objectFit: 'cover', borderRadius: 4, background: '#000' }}
                onError={(e) => { e.target.style.display = 'none' }}
              />
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>📷 Camera Snapshot Attached</div>
                <div style={{ fontSize: 9, color: 'var(--accent-light)' }}>Click to view high-resolution image ↗</div>
              </div>
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
  const [activeCounterId, setActiveCounterId] = useState('all') // 'all' or specific cId
  const [countersState, setCountersState] = useState({})
  const [playingRecording, setPlayingRecording] = useState(null)
  const [viewingSnapshot, setViewingSnapshot] = useState(null)
  const [categories, setCategories] = useState([])
  const [pipelineLoading, setPipelineLoading] = useState(false)
  const feedRef = useRef(null)
  const { addToast } = useToast()

  // Load configuration and counters list on mount
  useEffect(() => {
    getConfig()
      .then(cfg => {
        if (cfg?.fraud_categories) {
          setCategories(cfg.fraud_categories)
        }
        if (cfg?.counters) {
          setCountersState(prev => {
            const newState = { ...prev }
            cfg.counters.forEach(c => {
              if (!newState[c.id]) {
                newState[c.id] = {
                  id: c.id,
                  name: c.name,
                  running: false,
                  active_mic_name: '',
                  rms: 0,
                  vadState: 'silence',
                  lastVerdict: null,
                  stats: { FRAUD: 0, SUSPICIOUS: 0, NORMAL: 0, segments: 0 },
                  feed: [],
                }
              }
            })
            return newState
          })
        }
      })
      .catch(err => console.error('Failed to load initial config:', err))
  }, [])

  // Sync counter run-state and database session-ids from pipelineStatus updates
  useEffect(() => {
    if (pipelineStatus?.counters) {
      setCountersState(prev => {
        const newState = { ...prev }
        Object.keys(pipelineStatus.counters).forEach(cId => {
          const c = pipelineStatus.counters[cId]
          const existing = prev[cId] || {
            id: cId,
            name: c.name || cId,
            rms: 0,
            vadState: 'silence',
            lastVerdict: null,
            feed: [],
            stats: { FRAUD: 0, SUSPICIOUS: 0, NORMAL: 0, segments: 0 },
          }
          newState[cId] = {
            ...existing,
            id: cId,
            name: c.name || cId,
            running: c.running,
            active_mic_name: c.stats?.active_mic_name || '',
            stats: {
              FRAUD: c.stats?.FRAUD || 0,
              SUSPICIOUS: c.stats?.SUSPICIOUS || 0,
              NORMAL: c.stats?.NORMAL || 0,
              segments: c.stats?.segments || 0,
            },
            activeSessionId: c.stats?.session_id || null,
          }
        })
        return newState
      })
    }
  }, [pipelineStatus])

  // Load initial segment history for each counter
  useEffect(() => {
    getSegments({ limit: 100 })
      .then(data => {
        if (data?.items) {
          setCountersState(prev => {
            const newState = { ...prev }
            // Clear feeds first
            Object.keys(newState).forEach(cId => {
              if (newState[cId]) {
                newState[cId].feed = []
              }
            })

            data.items.forEach(s => {
              const cId = s.counter_id || 'default'
              if (!newState[cId]) {
                newState[cId] = {
                  id: cId,
                  name: cId === 'default' ? 'Default Counter' : cId,
                  running: false,
                  rms: 0,
                  vadState: 'silence',
                  lastVerdict: null,
                  stats: { FRAUD: 0, SUSPICIOUS: 0, NORMAL: 0, segments: 0 },
                  feed: [],
                }
              }
              newState[cId].feed.push({
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
                snapshot_path: s.snapshot_path,
              })
            })
            return newState
          })
        }
      })
      .catch(err => console.error('Failed to load segment history:', err))
  }, [pipelineStatus])

  // WebSocket event processor for real-time VU levels, VAD indicators, and classification verdicts
  useEffect(() => {
    if (!liveEvents || liveEvents.length === 0) return
    const event = liveEvents[liveEvents.length - 1]
    if (!event) return

    const cId = event.counter_id || 'default'

    setCountersState(prev => {
      // Create lazy defaults if a counter sends events but is not yet in state
      const current = prev[cId] || {
        id: cId,
        name: cId === 'default' ? 'Default Counter' : cId,
        running: false,
        rms: 0,
        vadState: 'silence',
        lastVerdict: null,
        stats: { FRAUD: 0, SUSPICIOUS: 0, NORMAL: 0, segments: 0 },
        feed: [],
      }

      const updated = { ...current }

      switch (event.type) {
        case 'audio_level':
          updated.rms = event.rms || 0
          updated.vadState = event.vad_state || 'silence'
          break

        case 'vad_state':
          updated.vadState = event.state
          break

        case 'segment_result':
          updated.lastVerdict = event.verdict
          updated.feed = [{
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
            snapshot_path:  event.snapshot_path,
          }, ...current.feed].slice(0, MAX_FEED)

          updated.stats = {
            ...current.stats,
            segments: (current.stats.segments || 0) + 1,
            [event.verdict]: (current.stats[event.verdict] || 0) + 1,
          }
          break

        case 'alert':
          updated.feed = current.feed.map(item =>
            item.id === event.segment_id ? { ...item, alert_id: event.alert_id, snapshot_path: event.snapshot_path || item.snapshot_path } : item
          )
          addToast({
            type:     event.verdict === 'FRAUD' ? 'fraud' : 'warning',
            title:    `${event.verdict === 'FRAUD' ? '⚠ FRAUD DETECTED' : '◈ SUSPICIOUS'} - ${current.name}`,
            body:     event.reason?.slice(0, 120) || '',
            duration: 8000,
          })
          break

        case 'alert_recording_ready':
          updated.feed = current.feed.map(item =>
            (item.alert_id === event.alert_id || item.id === event.segment_id)
              ? { ...item, has_recording: true, alert_id: event.alert_id }
              : item
          )
          break

        case 'pipeline_status':
          if (event.counters && event.counters[cId]) {
            const cs = event.counters[cId]
            updated.running = cs.running
            if (cs.stats) {
              updated.stats = {
                FRAUD: cs.stats.FRAUD || 0,
                SUSPICIOUS: cs.stats.SUSPICIOUS || 0,
                NORMAL: cs.stats.NORMAL || 0,
                segments: cs.stats.segments || 0,
              }
              updated.activeSessionId = cs.stats.session_id || null
              updated.active_mic_name = cs.stats.active_mic_name || ''
            }
          }
          break
      }

      return {
        ...prev,
        [cId]: updated
      }
    })
  }, [liveEvents, addToast])

  // Start or Stop the pipeline for a single counter/mic
  const handleToggleCounter = async (counterId) => {
    const c = countersState[counterId]
    if (!c) return

    setPipelineLoading(true)
    try {
      if (c.running) {
        await stopPipeline(counterId)
      } else {
        await startPipeline(counterId)
      }
    } catch (e) {
      addToast({ type: 'warning', title: 'Pipeline error', body: e.message })
    } finally {
      setPipelineLoading(false)
    }
  }

  // Start or Stop ALL counters concurrently
  const handleToggleAll = async (stopAll = false) => {
    setPipelineLoading(true)
    try {
      if (stopAll) {
        await stopPipeline()
        addToast({ type: 'info', title: 'All counters stopped' })
      } else {
        await startPipeline()
        addToast({ type: 'success', title: 'All counters started' })
      }
    } catch (e) {
      addToast({ type: 'warning', title: 'Pipeline error', body: e.message })
    } finally {
      setPipelineLoading(false)
    }
  }

  // Derive aggregate stats across all counters
  const aggregateStats = useMemo(() => {
    const agg = { FRAUD: 0, SUSPICIOUS: 0, NORMAL: 0, segments: 0 }
    Object.values(countersState).forEach(c => {
      agg.FRAUD += c.stats?.FRAUD || 0
      agg.SUSPICIOUS += c.stats?.SUSPICIOUS || 0
      agg.NORMAL += c.stats?.NORMAL || 0
      agg.segments += c.stats?.segments || 0
    })
    return agg
  }, [countersState])

  // Derive active focus counter details
  const focusedCounter = activeCounterId === 'all' ? null : countersState[activeCounterId]

  const stats = useMemo(() => {
    if (activeCounterId === 'all') return aggregateStats
    return focusedCounter?.stats || { FRAUD: 0, SUSPICIOUS: 0, NORMAL: 0, segments: 0 }
  }, [activeCounterId, aggregateStats, focusedCounter])

  const sopScore = useMemo(() => {
    const total = stats.segments || 0
    if (total === 0) return 100
    const nonCompliant = (stats.FRAUD || 0) + (stats.SUSPICIOUS || 0)
    return Math.max(0, Math.round(((total - nonCompliant) / total) * 100))
  }, [stats])

  // Combine and sort feeds depending on the selected filter
  const combinedFeed = useMemo(() => {
    if (activeCounterId !== 'all') {
      const c = countersState[activeCounterId]
      if (!c) return []
      return c.feed.map(item => ({ ...item, counterName: c.name }))
    }

    const items = []
    Object.keys(countersState).forEach(cId => {
      const c = countersState[cId]
      c.feed.forEach(item => {
        items.push({ ...item, counterId: cId, counterName: c.name })
      })
    })

    return items
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, MAX_FEED)
  }, [activeCounterId, countersState])

  const recentBad = useMemo(() => {
    return combinedFeed.filter(f => f.verdict === 'FRAUD' || f.verdict === 'SUSPICIOUS').slice(0, 3)
  }, [combinedFeed])

  const getScoreColor = (score) => {
    if (score >= 90) return 'var(--clear)'
    if (score >= 75) return 'var(--suspicious)'
    return 'var(--fraud)'
  }

  const getScoreIcon = (score) => {
    if (score >= 90) return '🛡️'
    if (score >= 75) return '⚠️'
    return '🚨'
  }

  const isRunning = Object.values(countersState).some(c => c.running)

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
            Monitoring {Object.keys(countersState).length} desks · {activeCounterId === 'all' ? 'All Counters Selected' : `Selected: ${focusedCounter?.name}`}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ProcessingState events={liveEvents} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn btn-primary"
              onClick={() => handleToggleAll(false)}
              disabled={pipelineLoading}
              style={{ fontSize: 12 }}
            >
              ▶ Start All
            </button>
            <button
              className="btn btn-danger"
              onClick={() => handleToggleAll(true)}
              disabled={pipelineLoading}
              style={{ fontSize: 12 }}
            >
              ⏹ Stop All
            </button>
          </div>
        </div>
      </div>

      {/* ── Counters Grid Selection (Top Section) ── */}
      <div style={{ padding: '16px 24px 8px', flexShrink: 0, borderBottom: '1px solid var(--border-light)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 10 }}>
          Customer Service Counters
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 12,
        }}>
          {/* "All Counters" selector card */}
          <div
            onClick={() => setActiveCounterId('all')}
            style={{
              background: 'var(--bg-card)',
              border: activeCounterId === 'all' ? '1.5px solid var(--accent)' : '1px solid var(--border)',
              borderRadius: 8,
              padding: '12px 14px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              transition: 'all var(--t-fast)',
              boxShadow: activeCounterId === 'all' ? '0 0 10px rgba(124,106,247,0.1)' : 'none',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>All Counters (Overview)</span>
              <span style={{ fontSize: 10, color: 'var(--accent-light)', fontWeight: 600 }}>AGGREGATE</span>
            </div>
            <div style={{ height: 18, margin: '8px 0', fontSize: 11, color: 'var(--text-muted)' }}>
              Showing consolidated live audio feed
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)' }}>
              <span>Total CS: {Object.keys(countersState).length}</span>
              <span>Total Segs: {aggregateStats.segments}</span>
            </div>
          </div>

          {/* Individual Counter Cards */}
          {Object.keys(countersState).map(cId => {
            const c = countersState[cId]
            const isSelected = activeCounterId === cId
            const isBad = c.lastVerdict === 'FRAUD' || c.lastVerdict === 'SUSPICIOUS'

            return (
              <div
                key={cId}
                onClick={() => setActiveCounterId(cId)}
                style={{
                  background: 'var(--bg-card)',
                  border: isSelected
                    ? '1.5px solid var(--accent)'
                    : isBad
                      ? '1px solid var(--fraud-border)'
                      : '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '12px 14px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  transition: 'all var(--t-fast)',
                  boxShadow: isSelected ? '0 0 10px rgba(124,106,247,0.1)' : 'none',
                  ...(isBad && c.lastVerdict === 'FRAUD' ? { boxShadow: '0 0 8px var(--fraud-glow)' } : {}),
                }}
              >
                {/* Card Title & State */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div className={`status-dot ${c.running ? 'status-dot-green' : 'status-dot-gray'} ${c.vadState === 'speech' ? 'status-dot-pulse' : ''}`} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{c.name}</span>
                  </div>
                  <span style={{
                    fontSize: 9,
                    fontWeight: 700,
                    padding: '1px 5px',
                    borderRadius: 4,
                    background: c.running ? 'rgba(46,204,113,0.12)' : 'rgba(120,120,120,0.12)',
                    color: c.running ? 'var(--clear)' : 'var(--text-muted)'
                  }}>{c.running ? 'ACTIVE' : 'OFFLINE'}</span>
                </div>

                {/* Real-time VU Levels */}
                <div style={{
                  height: 22,
                  background: 'var(--bg-elevated)',
                  borderRadius: 5,
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 8px',
                  justifyContent: 'space-between',
                  fontSize: 10,
                  position: 'relative',
                  overflow: 'hidden'
                }}>
                  <span style={{ color: 'var(--text-secondary)', zIndex: 2, fontSize: 9 }}>
                    {c.running ? (c.vadState === 'speech' ? '🎙️ Speech' : 'Silence') : 'Offline'}
                  </span>
                  {c.running && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-dim)', zIndex: 2 }}>
                      {Math.round(c.rms)}
                    </span>
                  )}
                  {/* Dynamic RMS fill background */}
                  {c.running && (
                    <div style={{
                      position: 'absolute',
                      left: 0, top: 0, bottom: 0,
                      width: `${Math.min((c.rms / 2000) * 100, 100)}%`,
                      background: c.vadState === 'speech' ? 'var(--accent-glow)' : 'rgba(255,255,255,0.03)',
                      transition: 'width 0.1s ease',
                      zIndex: 1,
                    }} />
                  )}
                </div>

                {/* Counters Metrics & Control Action */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', display: 'flex', gap: 6 }}>
                    <span>Segs: <strong>{c.stats.segments}</strong></span>
                    {c.stats.FRAUD > 0 && <span style={{ color: 'var(--fraud)' }}>F: {c.stats.FRAUD}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    {/* Compact listen button */}
                    <AudioPlayer counterId={cId} isRunning={c.running} compact />
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggleCounter(cId) }}
                      className={`btn ${c.running ? 'btn-danger' : 'btn-primary'}`}
                      style={{
                        padding: '2px 8px',
                        fontSize: 9,
                        borderRadius: 4,
                      }}
                      disabled={pipelineLoading}
                    >
                      {c.running ? '⏹ Stop' : '▶ Start'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Stat bar (5 cards) ── */}
      <div className="stat-bar" style={{ flexShrink: 0, borderBottom: '1px solid var(--border-light)' }}>
        {[
          {
            label: 'Segments',
            value: stats.segments,
            sub: activeCounterId === 'all' ? 'Across all active CS' : 'Selected counter',
            color: 'var(--accent-light)',
            icon: '◎',
          },
          {
            label: 'SOP Compliance',
            value: `${sopScore}%`,
            sub: sopScore >= 90 ? 'Excellent standards' : sopScore >= 75 ? 'Needs review' : 'Critical attention',
            color: getScoreColor(sopScore),
            icon: getScoreIcon(sopScore),
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
      <div style={{ flex: 1, display: 'flex', gap: 0, overflow: 'hidden', minHeight: 0 }}>

        {/* Left panel: audio + system + distribution */}
        <div className="dashboard-left-panel">
          {/* Audio Visualizer card (Active counter or generic) */}
          <div className="card" style={{ padding: '14px 16px', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyBetween: 'space-between', marginBottom: 10 }}>
              <span className="section-label">
                Audio Visualizer {focusedCounter ? `(${focusedCounter.name})` : '(Combined Overview)'}
              </span>
              <VadIndicator vadState={focusedCounter ? focusedCounter.vadState : 'silence'} />
            </div>
            <AudioVisualizer
              rms={focusedCounter ? focusedCounter.rms : 0}
              vadState={focusedCounter ? focusedCounter.vadState : 'silence'}
              verdict={focusedCounter ? focusedCounter.lastVerdict : null}
            />
          </div>

          {/* Audio Live Monitor — full player when a specific running counter is selected */}
          {focusedCounter && focusedCounter.running && (
            <AudioPlayer counterId={focusedCounter.id} isRunning={focusedCounter.running} />
          )}

          {/* Verdict distribution */}
          <VerdictDistribution stats={stats} />

          {/* System info */}
          <SystemPanel
            pipelineStatus={pipelineStatus}
            feed={combinedFeed}
            activeSessionId={focusedCounter ? focusedCounter.activeSessionId : null}
          />

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
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: cfg.color }}>{item.verdict}</span>
                          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{item.counterName}</span>
                        </div>
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
        <div className="dashboard-right-panel">
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
              {combinedFeed.length} segments
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
            {combinedFeed.length === 0 ? (
              <div className="empty-state" style={{ marginTop: 40 }}>
                <div className="empty-state-icon">🎙</div>
                <div className="empty-state-title">No segments yet</div>
                <div className="empty-state-sub">
                  {isRunning
                    ? 'Listening… speak near counter microphones to begin detection.'
                    : 'Start pipelines to begin real-time monitoring.'}
                </div>
              </div>
            ) : (
              combinedFeed.map((item, i) => (
                <div key={item.id} style={{ position: 'relative' }}>
                  {/* Small tag showing which CS counter this segment belongs to */}
                  <span style={{
                    position: 'absolute',
                    top: -5,
                    right: 15,
                    fontSize: 8,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    padding: '1px 6px',
                    color: 'var(--text-secondary)',
                    fontWeight: 700,
                    zIndex: 10,
                  }}>
                    {item.counterName}
                  </span>
                  <FeedItem
                    item={item}
                    isNew={i === 0}
                    onPlayClick={setPlayingRecording}
                    onSnapshotClick={setViewingSnapshot}
                    categories={categories}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Audio Playback Modal ── */}
      {playingRecording && (
        <PlaybackModal
          item={playingRecording}
          onClose={() => setPlayingRecording(null)}
          onSnapshotClick={setViewingSnapshot}
        />
      )}

      {/* ── Camera Snapshot Lightbox Modal ── */}
      {viewingSnapshot && (
        <SnapshotModal
          item={viewingSnapshot}
          onClose={() => setViewingSnapshot(null)}
        />
      )}
    </div>
  )
}
