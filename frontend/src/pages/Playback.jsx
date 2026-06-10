import { useCallback, useEffect, useRef, useState } from 'react'
import { format, subDays, addDays } from 'date-fns'
import { getTimeline, getRecordingStreamUrl, getRecordingDownloadUrl, getContinuousStreamUrl } from '../api/alerts'
import { Timeline } from '../components/Timeline'
import { useToast } from '../components/NotificationToast'

const VERDICT_COLOR = {
  FRAUD:      'var(--fraud)',
  SUSPICIOUS: 'var(--suspicious)',
  NORMAL:     'var(--clear)',
  CLEAR:      'var(--clear)',
  ERROR:      'var(--error)',
}

export function Playback() {
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [timelineData, setTimelineData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [selectedAlert, setSelectedAlert] = useState(null)
  const [activeContinuousRec, setActiveContinuousRec] = useState(null)
  const [currentPlayRatio, setCurrentPlayRatio] = useState(null)
  const [visibleCount, setVisibleCount] = useState(50)
  const audioRef = useRef(null)
  const { addToast } = useToast()

  const loadTimeline = useCallback(async (d) => {
    setLoading(true)
    setSelectedAlert(null)
    setActiveContinuousRec(null)
    setCurrentPlayRatio(null)
    setVisibleCount(50)
    try {
      const data = await getTimeline(d)
      setTimelineData(data)
    } catch (e) {
      addToast({ type: 'warning', title: 'Failed to load timeline', body: e.message })
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => {
    loadTimeline(date)
  }, [date, loadTimeline])

  const handleTimeUpdate = () => {
    if (!audioRef.current) return
    const currentTime = audioRef.current.currentTime

    if (activeContinuousRec) {
      const startTs = new Date(activeContinuousRec.start_time)
      const currentTs = new Date(startTs.getTime() + currentTime * 1000)
      const secondsInDay = currentTs.getHours() * 3600 + currentTs.getMinutes() * 60 + currentTs.getSeconds() + currentTs.getMilliseconds() / 1000
      setCurrentPlayRatio(secondsInDay / 86400)
    } else if (selectedAlert) {
      const alertTs = new Date(selectedAlert.timestamp)
      const preBuffer = selectedAlert.duration_s ? (selectedAlert.duration_s * 0.4) : 10
      const currentTs = new Date(alertTs.getTime() - (preBuffer - currentTime) * 1000)
      const secondsInDay = currentTs.getHours() * 3600 + currentTs.getMinutes() * 60 + currentTs.getSeconds()
      setCurrentPlayRatio(secondsInDay / 86400)
    }
  }

  // Clicking an event in the list → always play ONLY the event's own alert recording
  const handleAlertClick = (alert) => {
    setSelectedAlert(alert)
    setActiveContinuousRec(null)

    setTimeout(() => {
      if (!audioRef.current) return
      if (alert.alert_id) {
        audioRef.current.src = getRecordingStreamUrl(alert.alert_id)
        audioRef.current.load()
        audioRef.current.play().catch(() => {})
      } else {
        addToast({
          type: 'warning',
          title: 'No Recording',
          body: 'No alert recording clip for this segment.',
        })
        audioRef.current.src = ''
      }
    }, 50)
  }

  // Clicking/dragging the timeline track → look for continuous audio at that time
  const handleTrackClick = (ratio) => {
    if (!timelineData) return

    const [year, month, day] = date.split('-').map(Number)
    const targetTimeMs = new Date(year, month - 1, day).getTime() + ratio * 86400 * 1000
    const targetDate = new Date(targetTimeMs)

    const matchingCont = timelineData.continuous_recordings?.find(c => {
      const start = new Date(c.start_time)
      const end = new Date(c.end_time)
      return start <= targetDate && targetDate <= end
    })

    if (matchingCont) {
      const offset = (targetDate.getTime() - new Date(matchingCont.start_time).getTime()) / 1000
      setSelectedAlert(null)

      if (activeContinuousRec && activeContinuousRec.id === matchingCont.id) {
        // Same chunk: seek directly
        if (audioRef.current) {
          audioRef.current.currentTime = offset
          audioRef.current.play().catch(() => {})
        }
      } else {
        setActiveContinuousRec(matchingCont)
        setTimeout(() => {
          if (!audioRef.current) return
          audioRef.current.src = getContinuousStreamUrl(matchingCont.id)
          audioRef.current.load()
          audioRef.current.currentTime = offset
          audioRef.current.play().catch(() => {})
        }, 100)

        addToast({
          type: 'info',
          title: 'Continuous playback',
          body: `Chunk starting at ${format(new Date(matchingCont.start_time), 'HH:mm:ss')}`,
        })
      }
    } else {
      addToast({
        type: 'warning',
        title: 'No continuous recording',
        body: 'No continuous audio recorded at this time.',
      })
    }
  }

  const handleAudioEnded = () => {
    if (activeContinuousRec && timelineData?.continuous_recordings) {
      const currentIdx = timelineData.continuous_recordings.findIndex(c => c.id === activeContinuousRec.id)
      if (currentIdx !== -1 && currentIdx + 1 < timelineData.continuous_recordings.length) {
        const nextCont = timelineData.continuous_recordings[currentIdx + 1]
        const currentEnd = new Date(activeContinuousRec.end_time).getTime()
        const nextStart  = new Date(nextCont.start_time).getTime()
        if (Math.abs(nextStart - currentEnd) < 5000) {
          setActiveContinuousRec(nextCont)
          setTimeout(() => {
            if (!audioRef.current) return
            audioRef.current.src = getContinuousStreamUrl(nextCont.id)
            audioRef.current.load()
            audioRef.current.currentTime = 0
            audioRef.current.play().catch(() => {})
          }, 100)
        }
      }
    }
  }

  const prevDay = () => setDate(format(subDays(new Date(date + 'T12:00:00'), 1), 'yyyy-MM-dd'))
  const nextDay = () => {
    const next = addDays(new Date(date + 'T12:00:00'), 1)
    if (next <= new Date()) setDate(format(next, 'yyyy-MM-dd'))
  }

  return (
    <div className="playback-page">
      {/* ── Header ── */}
      <div className="playback-header">
        <div>
          <div className="page-title">Playback</div>
          <div className="page-subtitle">Timeline · drag to scrub · click event to play clip</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button className="btn btn-ghost btn-sm" onClick={prevDay}>◀</button>
          <input
            type="date"
            className="form-input"
            value={date}
            onChange={e => setDate(e.target.value)}
            max={format(new Date(), 'yyyy-MM-dd')}
            style={{ width: 148 }}
          />
          <button className="btn btn-ghost btn-sm" onClick={nextDay} disabled={date >= format(new Date(), 'yyyy-MM-dd')}>▶</button>
          <button className="btn btn-ghost btn-sm" onClick={() => loadTimeline(date)} title="Refresh">
            {loading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : '↻'}
          </button>
        </div>
      </div>

      {/* ── Timeline card ── */}
      <div className="playback-timeline-card card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {format(new Date(date + 'T12:00:00'), 'EEEE, MMMM d, yyyy')}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {timelineData?.alerts?.length || 0} events
          </span>
        </div>
        {loading ? (
          <div style={{ height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="spinner" />
          </div>
        ) : (
          <Timeline
            alerts={timelineData?.alerts || []}
            continuousRecordings={timelineData?.continuous_recordings || []}
            onAlertClick={handleAlertClick}
            selectedAlertId={selectedAlert?.alert_id}
            selectedSegmentId={selectedAlert?.segment_id}
            currentPlayRatio={currentPlayRatio}
            onTrackClick={handleTrackClick}
          />
        )}
      </div>

      {/* ── Body ── */}
      <div className="playback-body">
        {/* Event list */}
        <div className="playback-events">
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, flexShrink: 0 }}>
            Events ({timelineData?.alerts?.length || 0})
          </div>
          <div className="playback-events-scroll">
            {!timelineData?.alerts?.length ? (
              <div className="empty-state" style={{ padding: 30 }}>
                <div className="empty-state-icon">📅</div>
                <div className="empty-state-title">No events</div>
                <div className="empty-state-sub">No recorded segments on this date</div>
              </div>
            ) : (
              <>
                {timelineData.alerts.slice(0, visibleCount).map(alert => {
                  const isSelected = selectedAlert?.segment_id
                    ? selectedAlert.segment_id === alert.segment_id
                    : (selectedAlert?.alert_id && selectedAlert.alert_id === alert.alert_id)

                  return (
                    <div
                      key={alert.segment_id || alert.alert_id}
                      onClick={() => handleAlertClick(alert)}
                      className={`playback-event-item ${isSelected ? 'selected' : ''}`}
                      style={{
                        borderLeft: `3px solid ${VERDICT_COLOR[alert.verdict] || 'var(--border)'}`,
                        border: `1px solid ${isSelected ? VERDICT_COLOR[alert.verdict] || 'var(--border-active)' : 'var(--border)'}`,
                        borderLeft: `3px solid ${VERDICT_COLOR[alert.verdict] || 'var(--border)'}`,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: VERDICT_COLOR[alert.verdict] || 'var(--text-secondary)' }}>
                          {alert.verdict}
                        </span>
                        {alert.has_recording && <span style={{ fontSize: 10, color: 'var(--clear)' }}>🔊</span>}
                        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                          {format(new Date(alert.timestamp), 'HH:mm:ss')}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        "{alert.transcript || 'No speech recorded'}"
                      </div>
                      {alert.reason && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {alert.reason}
                        </div>
                      )}
                    </div>
                  )
                })}
                {timelineData.alerts.length > visibleCount && (
                  <button
                    className="btn btn-ghost btn-sm w-full"
                    onClick={() => setVisibleCount(prev => prev + 50)}
                    style={{ padding: '8px', fontSize: 11 }}
                  >
                    Load More (+50 of {timelineData.alerts.length - visibleCount} remaining)
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Player */}
        <div className="playback-player">
          {selectedAlert || activeContinuousRec ? (
            <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Player header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                {selectedAlert ? (
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 700,
                      color: VERDICT_COLOR[selectedAlert.verdict] || 'var(--text-secondary)',
                      marginBottom: 3,
                    }}>
                      {selectedAlert.verdict === 'FRAUD' ? '🚨' : selectedAlert.verdict === 'SUSPICIOUS' ? '⚠️' : '✓'} {selectedAlert.verdict}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {format(new Date(selectedAlert.timestamp), 'EEEE, MMM d yyyy — HH:mm:ss')}
                    </div>
                  </div>
                ) : (
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 3 }}>
                      🔊 Continuous Recording
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {format(new Date(activeContinuousRec.start_time), 'HH:mm:ss')} → {format(new Date(activeContinuousRec.end_time), 'HH:mm:ss')}
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {selectedAlert?.has_recording && (
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

              {/* Transcript + reason */}
              {selectedAlert && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ background: 'var(--bg-elevated)', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Transcript</div>
                    <div style={{ color: 'var(--text-primary)', fontStyle: 'italic', fontSize: 13 }}>
                      "{selectedAlert.transcript || 'No speech recorded'}"
                    </div>
                  </div>
                  {selectedAlert.reason && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      {selectedAlert.reason}
                    </div>
                  )}
                </div>
              )}

              {/* Audio player */}
              <div className="audio-player" style={{ marginTop: 'auto' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                  {activeContinuousRec ? 'Continuous Recording' : 'Event Clip'}&nbsp;·&nbsp;
                  {(activeContinuousRec ? activeContinuousRec.duration_s : selectedAlert?.duration_s)?.toFixed(1) || '?'}s
                  &nbsp;·&nbsp;
                  <span style={{ fontStyle: 'italic', opacity: 0.8 }}>
                    {activeContinuousRec ? 'Use timeline to scrub' : 'Click timeline dots for events'}
                  </span>
                </div>
                <audio
                  ref={audioRef}
                  onTimeUpdate={handleTimeUpdate}
                  onEnded={handleAudioEnded}
                  controls
                  style={{ width: '100%', accentColor: 'var(--accent)' }}
                />
              </div>
            </div>
          ) : (
            <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
              <div style={{ fontSize: '2.5rem', opacity: 0.18 }}>▶</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 14, fontWeight: 500 }}>Select an event or scrub the timeline</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', maxWidth: 280 }}>
                Click a dot on the timeline to play a specific event clip, or drag on the orange continuous-recording strips to seek.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
