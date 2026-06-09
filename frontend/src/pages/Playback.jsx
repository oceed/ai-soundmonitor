import { useCallback, useEffect, useRef, useState } from 'react'
import { format, subDays, addDays } from 'date-fns'
import { getTimeline, getRecordingStreamUrl, getRecordingDownloadUrl, getContinuousStreamUrl } from '../api/alerts'
import { Timeline } from '../components/Timeline'
import { useToast } from '../components/NotificationToast'

export function Playback() {
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [timelineData, setTimelineData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [selectedAlert, setSelectedAlert] = useState(null)
  const [activeContinuousRec, setActiveContinuousRec] = useState(null)
  const [currentPlayRatio, setCurrentPlayRatio] = useState(null)
  const audioRef = useRef(null)
  const { addToast } = useToast()

  const loadTimeline = useCallback(async (d) => {
    setLoading(true)
    setSelectedAlert(null)
    setActiveContinuousRec(null)
    setCurrentPlayRatio(null)
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

  const handleAlertClick = (alert) => {
    setSelectedAlert(alert)
    
    // Find if there is a continuous recording that covers this alert's timestamp
    const alertTime = new Date(alert.timestamp)
    const matchingCont = timelineData?.continuous_recordings?.find(c => {
      const start = new Date(c.start_time)
      const end = new Date(c.end_time)
      return start <= alertTime && alertTime <= end
    })

    setTimeout(() => {
      if (!audioRef.current) return
      
      if (matchingCont) {
        setActiveContinuousRec(matchingCont)
        const offset = (alertTime.getTime() - new Date(matchingCont.start_time).getTime()) / 1000
        const seekTime = Math.max(0, offset - 10) // Seek to 10s before alert for context
        
        audioRef.current.src = getContinuousStreamUrl(matchingCont.id)
        audioRef.current.load()
        audioRef.current.currentTime = seekTime
        audioRef.current.play().catch(() => {})
      } else {
        setActiveContinuousRec(null)
        if (alert.alert_id) {
          audioRef.current.src = getRecordingStreamUrl(alert.alert_id)
          audioRef.current.load()
          audioRef.current.play().catch(() => {})
        } else {
          addToast({
            type: 'warning',
            title: 'No Recording Available',
            body: 'Continuous recording was not active at this time, and no alert clip exists for clear segments.'
          })
          audioRef.current.src = ''
        }
      }
    }, 100)
  }

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
      setActiveContinuousRec(matchingCont)
      const offset = (targetDate.getTime() - new Date(matchingCont.start_time).getTime()) / 1000
      
      setSelectedAlert(null)
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
        body: `Playing chunk starting at ${format(new Date(matchingCont.start_time), 'HH:mm:ss')}`
      })
    } else {
      addToast({
        type: 'warning',
        title: 'No continuous recording',
        body: 'No continuous audio recorded at this specific hour.'
      })
    }
  }

  const prevDay = () => setDate(format(subDays(new Date(date + 'T12:00:00'), 1), 'yyyy-MM-dd'))
  const nextDay = () => {
    const next = addDays(new Date(date + 'T12:00:00'), 1)
    if (next <= new Date()) setDate(format(next, 'yyyy-MM-dd'))
  }

  const VERDICT_COLOR = {
    FRAUD: 'var(--fraud)',
    SUSPICIOUS: 'var(--suspicious)',
    NORMAL: 'var(--clear)',
    CLEAR: 'var(--clear)',
    ERROR: 'var(--error)',
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div className="page-header" style={{ flexShrink: 0, padding: '20px 24px 0' }}>
        <div>
          <div className="page-title">Playback</div>
          <div className="page-subtitle">NVR-style timeline with continuous recording support</div>
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
              {timelineData?.alerts?.length || 0} events
            </span>
          </div>
          {loading ? (
            <div style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
                  <div className="empty-state-sub">No recorded segments on this date</div>
                </div>
              ) : (
                timelineData?.alerts?.map(alert => {
                  const isSelected = selectedAlert?.segment_id 
                    ? selectedAlert.segment_id === alert.segment_id 
                    : (selectedAlert?.alert_id && selectedAlert.alert_id === alert.alert_id)
                  
                  return (
                    <div
                      key={alert.segment_id || alert.alert_id}
                      onClick={() => handleAlertClick(alert)}
                      style={{
                        padding: '10px 12px',
                        background: isSelected ? 'var(--bg-hover)' : 'var(--bg-card)',
                        border: `1px solid ${isSelected ? VERDICT_COLOR[alert.verdict] || 'var(--border-active)' : 'var(--border)'}`,
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
                      <div style={{ fontSize: 12, color: 'var(--text-primary)', marginTop: 4, fontWeight: 500 }}>
                        "{alert.transcript || 'No speech recorded'}"
                      </div>
                      {alert.reason && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {alert.reason}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Player */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {selectedAlert || activeContinuousRec ? (
              <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  {selectedAlert ? (
                    <div>
                      <div style={{
                        fontSize: 13, fontWeight: 700,
                        color: VERDICT_COLOR[selectedAlert.verdict] || 'var(--text-secondary)',
                        marginBottom: 4,
                      }}>
                        {selectedAlert.verdict === 'FRAUD' ? '🚨' : selectedAlert.verdict === 'SUSPICIOUS' ? '⚠️' : '✓'} {selectedAlert.verdict} — {selectedAlert.confidence}% confidence
                        {activeContinuousRec && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: 'var(--accent)' }}>(Continuous Mode)</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {format(new Date(selectedAlert.timestamp), 'EEEE, MMM d yyyy — HH:mm:ss')}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>
                        🔊 Playing Continuous Audio Chunk
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {format(new Date(activeContinuousRec.start_time), 'HH:mm:ss')} - {format(new Date(activeContinuousRec.end_time), 'HH:mm:ss')}
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    {selectedAlert?.has_recording && !activeContinuousRec && (
                      <a
                        href={getRecordingDownloadUrl(selectedAlert.alert_id)}
                        download
                        className="btn btn-ghost btn-sm"
                      >
                        ↓ Download Clip
                      </a>
                    )}
                  </div>
                </div>

                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {selectedAlert && (
                    <div style={{ background: 'var(--bg-elevated)', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Transcript</div>
                      <div style={{ color: 'var(--text-primary)', fontStyle: 'italic' }}>"{selectedAlert.transcript || 'No speech recorded'}"</div>
                    </div>
                  )}
                  <div>
                    {selectedAlert ? (selectedAlert.reason || 'Clear segment with no compliance violations flagged.') : 'Listening to the continuous timeline. Click on any event or markers to jump to specific points.'}
                  </div>
                </div>

                <div className="audio-player" style={{ marginTop: 'auto' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                    {activeContinuousRec ? 'Continuous Recording' : 'Event Clip'} · {activeContinuousRec ? activeContinuousRec.duration_s?.toFixed(1) : selectedAlert?.duration_s?.toFixed(1)}s
                  </div>
                  <audio
                    ref={audioRef}
                    onTimeUpdate={handleTimeUpdate}
                    controls
                    style={{ width: '100%', accentColor: 'var(--accent)' }}
                  />
                </div>
              </div>
            ) : (
              <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                <div style={{ fontSize: 3 + 'rem', opacity: 0.2 }}>▶</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 14, fontWeight: 500 }}>Select an event or time to play</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Click on the continuous violet areas in the timeline or select a specific event from the list.</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
