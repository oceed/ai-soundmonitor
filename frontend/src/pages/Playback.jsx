import { useCallback, useEffect, useRef, useState } from 'react'
import { format, subDays, addDays } from 'date-fns'
import { getTimeline, getRecordingStreamUrl, getRecordingDownloadUrl } from '../api/alerts'
import { Timeline } from '../components/Timeline'
import { useToast } from '../components/NotificationToast'

export function Playback() {
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [timelineData, setTimelineData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [selectedAlert, setSelectedAlert] = useState(null)
  const audioRef = useRef(null)
  const { addToast } = useToast()

  const loadTimeline = useCallback(async (d) => {
    setLoading(true)
    setSelectedAlert(null)
    try {
      const data = await getTimeline(d)
      setTimelineData(data)
    } catch (e) {
      addToast({ type: 'warning', title: 'Failed to load timeline', body: e.message })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTimeline(date)
  }, [date])

  const handleAlertClick = (alert) => {
    setSelectedAlert(alert)
    setTimeout(() => {
      audioRef.current?.load()
      audioRef.current?.play().catch(() => {})
    }, 100)
  }

  const prevDay = () => setDate(format(subDays(new Date(date), 1), 'yyyy-MM-dd'))
  const nextDay = () => {
    const next = addDays(new Date(date), 1)
    if (next <= new Date()) setDate(format(next, 'yyyy-MM-dd'))
  }

  const VERDICT_COLOR = {
    FRAUD: 'var(--fraud)',
    SUSPICIOUS: 'var(--suspicious)',
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div className="page-header" style={{ flexShrink: 0, padding: '20px 24px 0' }}>
        <div>
          <div className="page-title">Playback</div>
          <div className="page-subtitle">NVR-style timeline with alert markers</div>
        </div>
        {/* Date picker */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={prevDay}>◀</button>
          <input
            type="date"
            className="form-input"
            value={date}
            onChange={e => setDate(e.target.value)}
            max={format(new Date(), 'yyyy-MM-dd')}
            style={{ width: 160 }}
          />
          <button className="btn btn-ghost btn-sm" onClick={nextDay} disabled={date >= format(new Date(), 'yyyy-MM-dd')}>▶</button>
          <button className="btn btn-ghost btn-sm" onClick={() => loadTimeline(date)}>
            {loading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : '↻'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
        {/* Timeline */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {format(new Date(date + 'T12:00:00'), 'EEEE, MMMM d, yyyy')}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {timelineData?.total || 0} events
            </span>
          </div>
          {loading ? (
            <div style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="spinner" />
            </div>
          ) : (
            <Timeline
              alerts={timelineData?.alerts || []}
              onAlertClick={handleAlertClick}
              selectedAlertId={selectedAlert?.alert_id}
            />
          )}
        </div>

        {/* Content area */}
        <div style={{ flex: 1, display: 'flex', gap: 16, minHeight: 0, overflow: 'hidden' }}>
          {/* Alert list */}
          <div style={{ flex: '0 0 340px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              Events ({timelineData?.alerts?.length || 0})
            </div>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {timelineData?.alerts?.length === 0 ? (
                <div className="empty-state" style={{ padding: 30 }}>
                  <div className="empty-state-icon">📅</div>
                  <div className="empty-state-title">No events</div>
                  <div className="empty-state-sub">No fraud alerts on this date</div>
                </div>
              ) : (
                timelineData?.alerts?.map(alert => (
                  <div
                    key={alert.alert_id}
                    onClick={() => handleAlertClick(alert)}
                    style={{
                      padding: '10px 12px',
                      background: selectedAlert?.alert_id === alert.alert_id ? 'var(--bg-hover)' : 'var(--bg-card)',
                      border: `1px solid ${selectedAlert?.alert_id === alert.alert_id ? VERDICT_COLOR[alert.verdict] || 'var(--border-active)' : 'var(--border)'}`,
                      borderLeft: `3px solid ${VERDICT_COLOR[alert.verdict] || 'var(--border)'}`,
                      borderRadius: 8,
                      cursor: 'pointer',
                      transition: 'all var(--t-fast)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: VERDICT_COLOR[alert.verdict] || 'var(--text-secondary)' }}>
                        {alert.verdict}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{alert.confidence}%</span>
                      {alert.has_recording && <span style={{ fontSize: 10, color: 'var(--clear)' }}>🔊</span>}
                    </div>
                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                      {format(new Date(alert.timestamp), 'HH:mm:ss')}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {alert.reason}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Player */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {selectedAlert ? (
              <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{
                      fontSize: 13, fontWeight: 700,
                      color: VERDICT_COLOR[selectedAlert.verdict] || 'var(--text-secondary)',
                      marginBottom: 4,
                    }}>
                      {selectedAlert.verdict === 'FRAUD' ? '🚨' : '⚠️'} {selectedAlert.verdict} — {selectedAlert.confidence}% confidence
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {format(new Date(selectedAlert.timestamp), 'EEEE, MMM d yyyy — HH:mm:ss')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {selectedAlert.has_recording && (
                      <a
                        href={getRecordingDownloadUrl(selectedAlert.alert_id)}
                        download
                        className="btn btn-ghost btn-sm"
                      >
                        ↓ Download
                      </a>
                    )}
                  </div>
                </div>

                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {selectedAlert.reason}
                </div>

                {selectedAlert.has_recording ? (
                  <div className="audio-player" style={{ marginTop: 'auto' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                      Recording · {selectedAlert.duration_s?.toFixed(1) || '?'}s
                    </div>
                    <audio
                      ref={audioRef}
                      src={getRecordingStreamUrl(selectedAlert.alert_id)}
                      controls
                      style={{ width: '100%', accentColor: 'var(--accent)' }}
                    />
                  </div>
                ) : (
                  <div style={{ marginTop: 'auto', padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, border: '1px dashed var(--border)', borderRadius: 8 }}>
                    No recording available for this event
                  </div>
                )}
              </div>
            ) : (
              <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                <div style={{ fontSize: 3 + 'rem', opacity: 0.2 }}>▶</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 14, fontWeight: 500 }}>Select an event to play</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Click a marker on the timeline or an event in the list</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
