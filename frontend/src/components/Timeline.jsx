import { useMemo, useRef, useCallback, useEffect, useState } from 'react'
import { format } from 'date-fns'

const VERDICT_COLORS = {
  FRAUD:      'var(--fraud)',
  SUSPICIOUS: 'var(--suspicious)',
  NORMAL:     'var(--clear)',
  CLEAR:      'var(--clear)',
  ERROR:      'var(--error)',
}

export function Timeline({
  alerts = [],
  continuousRecordings = [],
  onAlertClick,
  selectedAlertId,
  selectedSegmentId,
  currentPlayRatio = null,
  onTrackClick,
}) {
  const trackRef = useRef(null)
  const isDragging = useRef(false)
  const dragMoved = useRef(false)
  const [hoverRatio, setHoverRatio] = useState(null)
  const [scrubRatio, setScrubRatio] = useState(null)

  const markers = useMemo(() => {
    return alerts
      .filter(a => a.timestamp)
      .map(a => {
        const ts = new Date(a.timestamp)
        const secondsInDay = ts.getHours() * 3600 + ts.getMinutes() * 60 + ts.getSeconds()
        return { ...a, position: secondsInDay / 86400 }
      })
  }, [alerts])

  const continuousRanges = useMemo(() => {
    return (continuousRecordings || []).map(c => {
      const startTs = new Date(c.start_time)
      const endTs   = new Date(c.end_time)
      const startSec = startTs.getHours() * 3600 + startTs.getMinutes() * 60 + startTs.getSeconds()
      const endSec   = endTs.getHours()   * 3600 + endTs.getMinutes()   * 60 + endTs.getSeconds()
      return {
        ...c,
        left:  startSec / 86400,
        width: (endSec - startSec) / 86400,
      }
    })
  }, [continuousRecordings])

  const getRatioFromEvent = useCallback((e) => {
    if (!trackRef.current) return null
    const rect = trackRef.current.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  }, [])

  const getTimeLabel = (ratio) => {
    if (ratio === null || ratio === undefined) return ''
    const s = Math.round(ratio * 86400)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sc = s % 60
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`
  }

  // Mouse down — start potential drag
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return
    isDragging.current = true
    dragMoved.current = false
    const ratio = getRatioFromEvent(e)
    if (ratio !== null) setScrubRatio(ratio)

    const handleMouseMove = (ev) => {
      if (!isDragging.current) return
      dragMoved.current = true
      const r = getRatioFromEvent(ev)
      if (r !== null) {
        setScrubRatio(r)
        onTrackClick?.(r)
      }
    }

    const handleMouseUp = (ev) => {
      if (!isDragging.current) return
      const r = getRatioFromEvent(ev)
      if (!dragMoved.current && r !== null) {
        // Pure click — fire track click
        onTrackClick?.(r)
      }
      isDragging.current = false
      dragMoved.current = false
      setScrubRatio(null)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [getRatioFromEvent, onTrackClick])

  const handleMouseMove = useCallback((e) => {
    if (isDragging.current) return
    setHoverRatio(getRatioFromEvent(e))
  }, [getRatioFromEvent])

  const handleMouseLeave = useCallback(() => {
    if (!isDragging.current) setHoverRatio(null)
  }, [])

  // Active scrub head = scrubRatio while dragging, else currentPlayRatio
  const displayHeadRatio = scrubRatio !== null ? scrubRatio : currentPlayRatio

  const hourTicks = Array.from({ length: 25 }, (_, i) => i)

  return (
    <div style={{ userSelect: 'none', width: '100%' }}>
      {/* Hour labels */}
      <div style={{ position: 'relative', height: 18, marginBottom: 4 }}>
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map(h => (
          <div key={h} style={{
            position: 'absolute',
            left: `${(h / 24) * 100}%`,
            transform: 'translateX(-50%)',
            fontSize: 9,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            fontWeight: 500,
            whiteSpace: 'nowrap',
          }}>
            {String(h).padStart(2, '0')}:00
          </div>
        ))}
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{
          position: 'relative',
          height: 56,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          cursor: 'crosshair',
          overflow: 'visible',
          touchAction: 'none',
        }}
      >
        {/* Hour grid lines */}
        <div style={{ position: 'absolute', inset: 0, borderRadius: 8, overflow: 'hidden', pointerEvents: 'none' }}>
          {hourTicks.map(h => (
            <div key={h} style={{
              position: 'absolute',
              left: `${(h / 24) * 100}%`,
              top: 0, bottom: 0,
              width: 1,
              background: h % 6 === 0
                ? 'rgba(139,148,194,0.14)'
                : 'rgba(139,148,194,0.04)',
            }} />
          ))}

          {/* Continuous recording strips */}
          {continuousRanges.map(range => (
            <div
              key={range.id}
              style={{
                position: 'absolute',
                left: `${range.left * 100}%`,
                width: `max(${range.width * 100}%, 0.4%)`,
                top: 0, bottom: 0,
                background: 'var(--accent-glow)',
                borderLeft:  '1px solid rgba(255, 122, 0, 0.28)',
                borderRight: '1px solid rgba(255, 122, 0, 0.12)',
              }}
            />
          ))}
        </div>

        {/* Hover time tooltip */}
        {hoverRatio !== null && !isDragging.current && (
          <div style={{
            position: 'absolute',
            left: `${hoverRatio * 100}%`,
            bottom: '100%',
            transform: 'translateX(-50%)',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-active)',
            color: 'var(--text-secondary)',
            fontSize: 9,
            padding: '2px 5px',
            borderRadius: 4,
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'nowrap',
            marginBottom: 6,
            pointerEvents: 'none',
            zIndex: 20,
          }}>
            {getTimeLabel(hoverRatio)}
          </div>
        )}

        {/* Segment markers — click triggers ONLY alert selection, not continuous lookup */}
        {markers.map(marker => {
          const isSelected = selectedSegmentId
            ? marker.segment_id === selectedSegmentId
            : (marker.alert_id && marker.alert_id === selectedAlertId)
          const isNormal   = marker.verdict === 'NORMAL' || marker.verdict === 'CLEAR'
          const color      = VERDICT_COLORS[marker.verdict] || 'var(--text-muted)'
          const dotSize    = isSelected ? 14 : (isNormal ? 7 : 10)

          return (
            <div
              key={marker.segment_id || marker.alert_id}
              className="timeline-marker-hit-area"
              style={{ left: `${marker.position * 100}%` }}
              onMouseDown={(e) => {
                // Prevent track drag from starting when clicking a marker
                e.stopPropagation()
              }}
              onClick={(e) => {
                e.stopPropagation()
                onAlertClick?.(marker)
              }}
              title={`${format(new Date(marker.timestamp), 'HH:mm:ss')} — ${marker.verdict}\n"${marker.transcript || ''}"`}
            >
              <div style={{
                width:        dotSize,
                height:       dotSize,
                borderRadius: '50%',
                background:   color,
                border:       `2px solid ${isSelected ? '#fff' : 'transparent'}`,
                boxShadow:    `0 0 ${isSelected ? 10 : (isNormal ? 3 : 6)}px ${color}`,
                transition:   'all var(--t-fast)',
                flexShrink:   0,
              }} />
            </div>
          )
        })}

        {/* Playback / scrub head */}
        {displayHeadRatio !== null && (
          <div style={{
            position: 'absolute',
            left:     `${displayHeadRatio * 100}%`,
            top: 0, bottom: 0,
            width: 2,
            background: scrubRatio !== null ? 'var(--accent)' : 'var(--accent-light)',
            zIndex: 8,
            boxShadow: `0 0 6px ${scrubRatio !== null ? 'var(--accent)' : 'rgba(255,163,82,0.7)'}`,
            pointerEvents: 'none',
          }}>
            {/* Triangle handle */}
            <div style={{
              position: 'absolute',
              top: -6,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0, height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: `7px solid ${scrubRatio !== null ? 'var(--accent)' : 'var(--accent-light)'}`,
            }} />
            <div style={{
              position: 'absolute',
              bottom: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 9,
              padding: '2px 5px',
              borderRadius: 3,
              fontFamily: 'var(--font-mono)',
              whiteSpace: 'nowrap',
              marginBottom: 10,
              display: scrubRatio !== null ? 'block' : 'none',
            }}>
              {getTimeLabel(displayHeadRatio)}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8, fontSize: 11, color: 'var(--text-muted)', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--fraud)' }} />
          <span>Fraud</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--suspicious)' }} />
          <span>Suspicious</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--clear)' }} />
          <span>Clear</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 20, height: 6, borderRadius: 3, background: 'var(--accent-glow)', border: '1px solid rgba(255, 122, 0, 0.35)' }} />
          <span>Continuous Recording</span>
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
          {markers.length} event{markers.length !== 1 ? 's' : ''}
          {continuousRecordings.length > 0 && ` · ${continuousRecordings.length} chunk${continuousRecordings.length !== 1 ? 's' : ''}`}
        </span>
      </div>
    </div>
  )
}
