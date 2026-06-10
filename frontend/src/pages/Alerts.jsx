import { useCallback, useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { getAlerts, deleteAlert, getRecordingStreamUrl, getRecordingDownloadUrl } from '../api/alerts'
import { useToast } from '../components/NotificationToast'

const VERDICT_CFG = {
  FRAUD: { color: 'var(--fraud)', bg: 'var(--fraud-bg)', border: 'var(--fraud-border)', icon: '🚨', label: 'FRAUD' },
  SUSPICIOUS: { color: 'var(--suspicious)', bg: 'var(--suspicious-bg)', border: 'var(--suspicious-border)', icon: '⚠️', label: 'SUSPICIOUS' },
}

export function Alerts({ liveEvents }) {
  const [alerts, setAlerts] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('ALL')
  const [expandedId, setExpandedId] = useState(null)
  const [page, setPage] = useState(0)
  const { addToast } = useToast()
  const LIMIT = 30

  const load = useCallback(async (p = 0, f = filter) => {
    setLoading(true)
    try {
      const params = { skip: p * LIMIT, limit: LIMIT }
      if (f !== 'ALL') params.verdict = f
      const data = await getAlerts(params)
      setAlerts(p === 0 ? data.items : prev => [...prev, ...data.items])
      setTotal(data.total)
      setPage(p)
    } catch (e) {
      addToast({ type: 'warning', title: 'Failed to load alerts', body: e.message })
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    load(0)
  }, [filter])

  // Push new alerts from WebSocket
  useEffect(() => {
    if (!liveEvents?.length) return
    const ev = liveEvents[liveEvents.length - 1]
    if (ev?.type === 'alert') {
      // Reload first page to show new alert
      setTimeout(() => load(0), 500)
    }
  }, [liveEvents])

  const handleDelete = async (id, e) => {
    e.stopPropagation()
    if (!confirm('Delete this alert and its recording?')) return
    try {
      await deleteAlert(id)
      setAlerts(prev => prev.filter(a => a.id !== id))
      setTotal(prev => prev - 1)
      addToast({ type: 'success', title: 'Alert deleted' })
    } catch {
      addToast({ type: 'warning', title: 'Delete failed' })
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div className="page-header" style={{ flexShrink: 0, padding: '20px 24px 0' }}>
        <div>
          <div className="page-title">Alert Events</div>
          <div className="page-subtitle">{total} total alerts recorded</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {['ALL', 'FRAUD', 'SUSPICIOUS'].map(f => (
            <button
              key={f}
              className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading && alerts.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
            <div className="spinner" style={{ width: 32, height: 32 }} />
          </div>
        ) : alerts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🔕</div>
            <div className="empty-state-title">No alerts found</div>
            <div className="empty-state-sub">
              {filter !== 'ALL' ? `No ${filter} alerts. Try changing the filter.` : 'No fraud or suspicious activity detected yet.'}
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {alerts.map(alert => (
              <AlertRow
                key={alert.id}
                alert={alert}
                expanded={expandedId === alert.id}
                onToggle={() => setExpandedId(prev => prev === alert.id ? null : alert.id)}
                onDelete={handleDelete}
              />
            ))}
            {alerts.length < total && (
              <button className="btn btn-ghost w-full" onClick={() => load(page + 1)}>
                {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Load more'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function AlertRow({ alert, expanded, onToggle, onDelete }) {
  const cfg = VERDICT_CFG[alert.verdict] || VERDICT_CFG.SUSPICIOUS
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)

  const togglePlay = (e) => {
    e.stopPropagation()
    if (!alert.recording_ready) return
    if (playing) {
      audioRef.current?.pause()
      setPlaying(false)
    } else {
      audioRef.current?.play()
      setPlaying(true)
    }
  }

  return (
    <div
      onClick={onToggle}
      style={{
        background: 'var(--bg-card)',
        border: `1px solid ${expanded ? cfg.border : 'var(--border)'}`,
        borderLeft: `3px solid ${cfg.color}`,
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'all var(--t-normal)',
        ...(alert.verdict === 'FRAUD' && expanded ? { boxShadow: '0 0 20px var(--fraud-glow)' } : {}),
      }}
    >
      {/* Row */}
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 18 }}>{cfg.icon}</span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: cfg.color }}>{alert.verdict}</span>
            {alert.flags?.slice(0, 2).map(f => (
              <span key={f} className="badge badge-fraud" style={{ fontSize: 9 }}>{f.replace(/_/g, ' ')}</span>
            ))}
            {alert.recording_ready && (
              <span className="badge badge-info" style={{ fontSize: 9 }}>🔊 REC</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            "{alert.transcript}"
          </div>
        </div>

        <div style={{ display: 'flex', align: 'center', gap: 8, flexShrink: 0 }}>
          <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-muted)' }}>
            <div>{alert.timestamp ? format(new Date(alert.timestamp), 'MMM d, HH:mm:ss') : '—'}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>#{alert.id}</div>
          </div>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={e => onDelete(alert.id, e)}
            title="Delete alert"
          >🗑</button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ borderTop: `1px solid var(--border)`, padding: '16px', background: 'var(--bg-elevated)' }}>
          <div className="grid-2" style={{ gap: 20, marginBottom: 16 }}>
            <div>
              <div className="form-label" style={{ marginBottom: 8 }}>Transcript</div>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)', fontStyle: 'italic' }}>
                "{alert.transcript}"
              </div>
            </div>
            <div>
              <div className="form-label" style={{ marginBottom: 8 }}>Analysis</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>{alert.reason}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span className="badge badge-info">Risk: {alert.risk_level}</span>
                {alert.flags?.map(f => (
                  <span key={f} className="badge badge-fraud">{f.replace(/_/g, ' ')}</span>
                ))}
              </div>
            </div>
          </div>

          {alert.evidence?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="form-label" style={{ marginBottom: 6 }}>Evidence</div>
              {alert.evidence.map((e, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                  • {e}
                </div>
              ))}
            </div>
          )}

          {/* Audio player */}
          {alert.recording_ready && (
            <div className="audio-player">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  className={`btn btn-sm ${playing ? 'btn-danger' : 'btn-primary'}`}
                  onClick={togglePlay}
                >
                  {playing ? '⏸ Pause' : '▶ Play Recording'}
                </button>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {alert.recording_duration_s?.toFixed(1)}s
                  · Pre: {alert.pre_buffer_s}s · Post: {alert.post_buffer_s}s
                </span>
                <a
                  href={getRecordingDownloadUrl(alert.id)}
                  download
                  className="btn btn-ghost btn-sm"
                  onClick={e => e.stopPropagation()}
                >
                  ↓ Download
                </a>
              </div>
              <audio
                ref={audioRef}
                src={getRecordingStreamUrl(alert.id)}
                style={{ width: '100%', marginTop: 10, accentColor: 'var(--accent)' }}
                controls
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
              />
            </div>
          )}

          {alert.mqtt_sent && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--clear)', display: 'flex', gap: 6 }}>
              <span>✓ MQTT sent</span>
              {alert.audio_upload_id && <span>· Audio ID: <code style={{ fontFamily: 'var(--font-mono)' }}>{alert.audio_upload_id}</code></span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
