import { useMemo, useRef } from 'react'
import { format } from 'date-fns'

const VERDICT_COLORS = {
  FRAUD:      'var(--fraud)',
  SUSPICIOUS: 'var(--suspicious)',
  NORMAL:     'var(--clear)',
  CLEAR:      'var(--clear)',
  ERROR:      'var(--error)',
}

const VERDICT_BG = {
  FRAUD:      'var(--fraud-bg)',
  SUSPICIOUS: 'var(--suspicious-bg)',
  NORMAL:     'var(--clear-bg)',
  CLEAR:      'var(--clear-bg)',
  ERROR:      'rgba(240,82,82,0.08)',
}

export function Timeline({
  alerts = [],
  continuousRecordings = [],
  onAlertClick,
  selectedAlertId,
  selectedSegmentId,
  currentPlayRatio = null,
  onTrackClick
}) {
  const trackRef = useRef(null)

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

  const handleTrackClick = (e) => {
    if (!trackRef.current) return
    const rect  = trackRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    onTrackClick?.(ratio)
  }

  const getTimeLabel = (ratio) => {
    if (ratio === null) return ''
    const s = Math.round(ratio * 86400)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sc = s % 60
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`
  }

  const hourTicks = Array.from({ length: 25 }, (_, i) => i)

  return (
    <div style={{ userSelect: 'none' }}>
      {/* Hour labels */}
      <div style={{ position: 'relative', height: 18, marginBottom: 6 }}>
        {[0, 6, 12, 18, 24].map(h => (
          <div key={h} style={{
            position: 'absolute',
            left: `${(h / 24) * 100}%`,
            transform: 'translateX(-50%)',
            fontSize: 10,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            fontWeight: 500,
          }}>
            {String(h).padStart(2, '0')}:00
          </div>
        ))}
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        onClick={handleTrackClick}
        style={{
          position: 'relative',
          height: 52,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          cursor: 'crosshair',
          overflow: 'visible',
        }}
      >
        {/* Hour grid lines (inside) */}
        <div style={{ position: 'absolute', inset: 0, borderRadius: 8, overflow: 'hidden', pointerEvents: 'none' }}>
          {hourTicks.map(h => (
            <div key={h} style={{
              position: 'absolute',
              left: `${(h / 24) * 100}%`,
              top: 0, bottom: 0,
              width: 1,
              background: h % 6 === 0
                ? 'rgba(139,148,194,0.12)'
                : 'rgba(139,148,194,0.04)',
            }} />
          ))}

          {/* Continuous recordings — subtle fill strips */}
          {continuousRanges.map(range => (
            <div
              key={range.id}
              style={{
                position: 'absolute',
                left: `${range.left * 100}%`,
                width: `max(${range.width * 100}%, 0.4%)`,
                top: 0, bottom: 0,
                background: 'var(--accent-glow)',
                borderLeft:  '1px solid rgba(255, 122, 0, 0.24)',
                borderRight: '1px solid rgba(255, 122, 0, 0.12)',
              }}
            />
          ))}
        </div>

        {/* Continuous recording click targets — invisible wide hit zone */}
        {continuousRanges.map(range => (
          <div
            key={`hit-${range.id}`}
            onClick={(e) => {
              e.stopPropagation()
              // Calculate click offset within this range
              const rect  = trackRef.current?.getBoundingClientRect()
              if (!rect) return
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
              onTrackClick?.(ratio)
            }}
            style={{
              position: 'absolute',
              left: `max(${range.left * 100}%, 0px)`,
              width: `max(${range.width * 100}%, 1.5%)`,
              top: 0, bottom: 0,
              cursor: 'pointer',
              zIndex: 3,
            }}
          />
        ))}

        {/* Segment markers — wide invisible hit area per marker */}
        {markers.map(marker => {
          const isSelected = selectedSegmentId
            ? marker.segment_id === selectedSegmentId
            : (marker.alert_id && marker.alert_id === selectedAlertId)
          const isNormal   = marker.verdict === 'NORMAL' || marker.verdict === 'CLEAR'
          const color      = VERDICT_COLORS[marker.verdict] || 'var(--text-muted)'
          const dotSize    = isSelected ? 13 : (isNormal ? 7 : 10)

          return (
            <div
              key={marker.segment_id || marker.alert_id}
              className="timeline-marker-hit-area"
              style={{ left: `${marker.position * 100}%` }}
              onClick={(e) => { e.stopPropagation(); onAlertClick?.(marker) }}
              title={`${format(new Date(marker.timestamp), 'HH:mm:ss')} — ${marker.verdict}\n"${marker.transcript || ''}"`}
            >
              {/* Visual dot */}
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

        {/* Playback head */}
        {currentPlayRatio !== null && (
          <div style={{
            position: 'absolute',
            left:     `${currentPlayRatio * 100}%`,
            top: 0, bottom: 0,
            width: 2,
            background: 'var(--accent-light)',
            zIndex: 8,
            boxShadow: '0 0 6px var(--accent)',
            pointerEvents: 'none',
          }}>
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
              marginBottom: 4,
            }}>
              {getTimeLabel(currentPlayRatio)}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 11, color: 'var(--text-muted)', alignItems: 'center' }}>
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
          <span>Continuous</span>
        </div>
        <span style={{ marginLeft: 'auto' }}>
          {markers.length} event{markers.length !== 1 ? 's' : ''}
          {continuousRecordings.length > 0 && ` · ${continuousRecordings.length} recording chunk${continuousRecordings.length !== 1 ? 's' : ''}`}
        </span>
      </div>
    </div>
  )
}
