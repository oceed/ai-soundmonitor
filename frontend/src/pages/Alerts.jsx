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
  const [timeFilter, setTimeFilter] = useState('ALL')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [page, setPage] = useState(1)
  const { addToast } = useToast()

  const LIMIT = 15
  const totalPages = Math.ceil(total / LIMIT) || 1

  const getTimeRange = (tf, start, end) => {
    let dateFrom = null
    let dateTo = null

    const now = new Date()
    if (tf === 'TODAY') {
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
      dateFrom = startOfToday.toISOString()
    } else if (tf === 'YESTERDAY') {
      const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0)
      const endOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999)
      dateFrom = startOfYesterday.toISOString()
      dateTo = endOfYesterday.toISOString()
    } else if (tf === 'LAST_7_DAYS') {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      dateFrom = sevenDaysAgo.toISOString()
    } else if (tf === 'LAST_30_DAYS') {
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      dateFrom = thirtyDaysAgo.toISOString()
    } else if (tf === 'CUSTOM') {
      if (start) {
        dateFrom = new Date(start + 'T00:00:00').toISOString()
      }
      if (end) {
        dateTo = new Date(end + 'T23:59:59').toISOString()
      }
    }
    return { dateFrom, dateTo }
  }

  const load = useCallback(async (targetPage = 1, currentVerdictFilter = filter, currentTimeFilter = timeFilter, customStart = customStartDate, customEnd = customEndDate) => {
    setLoading(true)
    try {
      const skip = (targetPage - 1) * LIMIT
      const params = { skip, limit: LIMIT }
      if (currentVerdictFilter !== 'ALL') params.verdict = currentVerdictFilter

      const { dateFrom, dateTo } = getTimeRange(currentTimeFilter, customStart, customEnd)
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo

      const data = await getAlerts(params)
      setAlerts(data.items)
      setTotal(data.total)
      setPage(targetPage)
    } catch (e) {
      addToast({ type: 'warning', title: 'Failed to load alerts', body: e.message })
    } finally {
      setLoading(false)
    }
  }, [filter, timeFilter, customStartDate, customEndDate, LIMIT, addToast])

  useEffect(() => {
    if (timeFilter !== 'CUSTOM') {
      load(1)
    }
  }, [filter, timeFilter])

  // Push new alerts from WebSocket
  useEffect(() => {
    if (!liveEvents?.length) return
    const ev = liveEvents[liveEvents.length - 1]
    if (ev?.type === 'alert') {
      if (page === 1) {
        setTimeout(() => load(1), 500)
      } else {
        addToast({ type: 'info', title: 'New Alert Detected', body: `A new ${ev.verdict} alert has been recorded.` })
      }
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
    <div className="page-content">
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 16 }}>
        <div>
          <div className="page-title">Alert Events</div>
          <div className="page-subtitle">{total} total alerts recorded</div>
        </div>
      </div>

      {/* Filter Card */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center' }}>
          {/* Verdict Filter */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="form-label" style={{ fontSize: 10 }}>Verdict Filter</span>
            <div style={{ display: 'flex', gap: 6 }}>
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

          {/* Time Filter */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="form-label" style={{ fontSize: 10 }}>Time Filter</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[
                { key: 'ALL', label: 'All Time' },
                { key: 'TODAY', label: 'Today' },
                { key: 'YESTERDAY', label: 'Yesterday' },
                { key: 'LAST_7_DAYS', label: 'Last 7 Days' },
                { key: 'LAST_30_DAYS', label: 'Last 30 Days' },
                { key: 'CUSTOM', label: 'Custom Date' }
              ].map(t => (
                <button
                  key={t.key}
                  className={`btn btn-sm ${timeFilter === t.key ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setTimeFilter(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Custom Date Range Picker */}
        {timeFilter === 'CUSTOM' && (
          <div className="animate-in" style={{ display: 'flex', gap: 12, alignItems: 'flex-end', background: 'var(--bg-elevated)', padding: 12, borderRadius: 'var(--radius-sm)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="form-label" style={{ fontSize: 9 }}>Start Date</span>
              <input
                type="date"
                className="form-input"
                value={customStartDate}
                onChange={e => setCustomStartDate(e.target.value)}
                style={{ width: 140, padding: '6px 10px' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="form-label" style={{ fontSize: 9 }}>End Date</span>
              <input
                type="date"
                className="form-input"
                value={customEndDate}
                onChange={e => setCustomEndDate(e.target.value)}
                style={{ width: 140, padding: '6px 10px' }}
              />
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => load(1)}
              style={{ height: 32 }}
            >
              Apply Range
            </button>
          </div>
        )}
      </div>

      {/* Main List Area */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
            <div className="spinner" style={{ width: 32, height: 32 }} />
          </div>
        ) : alerts.length === 0 ? (
          <div className="empty-state card">
            <div className="empty-state-icon">🔕</div>
            <div className="empty-state-title">No alerts found</div>
            <div className="empty-state-sub">
              Try changing your verdict or time filters.
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {alerts.map(alert => (
                <AlertRow
                  key={alert.id}
                  alert={alert}
                  expanded={expandedId === alert.id}
                  onToggle={() => setExpandedId(prev => prev === alert.id ? null : alert.id)}
                  onDelete={handleDelete}
                />
              ))}
            </div>

            {/* Pagination Controls */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                Showing <span style={{ fontWeight: 600 }}>{Math.min(total, (page - 1) * LIMIT + 1)}</span> to <span style={{ fontWeight: 600 }}>{Math.min(total, page * LIMIT)}</span> of <span style={{ fontWeight: 600 }}>{total}</span> alerts
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => load(page - 1)}
                  disabled={page <= 1 || loading}
                >
                  ◀ Previous
                </button>

                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Page <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{page}</span> of <span style={{ fontWeight: 600 }}>{totalPages}</span>
                </span>

                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => load(page + 1)}
                  disabled={page >= totalPages || loading}
                >
                  Next ▶
                </button>
              </div>
            </div>
          </>
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
