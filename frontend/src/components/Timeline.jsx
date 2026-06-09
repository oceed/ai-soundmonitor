import { useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'

const VERDICT_COLORS = {
  FRAUD: 'var(--fraud)',
  SUSPICIOUS: 'var(--suspicious)',
}

export function Timeline({
  alerts = [],
  continuousRecordings = [],
  onAlertClick,
  selectedAlertId,
  currentPlayRatio = null,
  onTrackClick
}) {
  const trackRef = useRef(null)

  // Map alert timestamp to position (0..1) across 24h
  const markers = useMemo(() => {
    return alerts
      .filter(a => a.has_recording || continuousRecordings.length > 0) // Show all alerts if we have continuous recording
      .map(a => {
        const ts = new Date(a.timestamp)
        const secondsInDay = ts.getHours() * 3600 + ts.getMinutes() * 60 + ts.getSeconds()
        const position = secondsInDay / 86400
        return { ...a, position }
      })
  }, [alerts, continuousRecordings])

  const continuousRanges = useMemo(() => {
    return (continuousRecordings || []).map(c => {
      const startTs = new Date(c.start_time)
      const endTs = new Date(c.end_time)
      const startSec = startTs.getHours() * 3600 + startTs.getMinutes() * 60 + startTs.getSeconds()
      const endSec = endTs.getHours() * 3600 + endTs.getMinutes() * 60 + endTs.getSeconds()
      
      const left = startSec / 86400
      const width = (endSec - startSec) / 86400
      
      return {
        ...c,
        left,
        width,
      }
    })
  }, [continuousRecordings])

  const handleTrackClick = (e) => {
    if (!trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const ratio = Math.max(0, Math.min(1, x / rect.width))
    onTrackClick?.(ratio)
  }

  const getTimeLabel = (ratio) => {
    if (ratio === null) return ''
    const totalSeconds = Math.round(ratio * 86400)
    const h = Math.floor(totalSeconds / 3600)
    const m = Math.floor((totalSeconds % 3600) / 60)
    const s = Math.floor(totalSeconds % 60)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  // Hour ticks
  const hourTicks = Array.from({ length: 25 }, (_, i) => i)

  return (
    <div style={{ userSelect: 'none' }}>
      {/* Hour labels */}
      <div style={{ position: 'relative', height: 20, marginBottom: 4 }}>
        {[0, 6, 12, 18, 24].map(h => (
          <div key={h} style={{
            position: 'absolute',
            left: `${(h / 24) * 100}%`,
            transform: 'translateX(-50%)',
            fontSize: 10,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
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
          height: 56,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          cursor: 'crosshair',
          overflow: 'hidden',
        }}
      >
        {/* Hour grid */}
        {hourTicks.map(h => (
          <div key={h} style={{
            position: 'absolute',
            left: `${(h / 24) * 100}%`,
            top: 0, bottom: 0,
            width: 1,
            background: h % 6 === 0 ? 'rgba(99, 130, 255, 0.15)' : 'rgba(99, 130, 255, 0.04)',
            zIndex: 2,
          }} />
        ))}

        {/* Continuous recordings background ranges */}
        {continuousRanges.map(range => (
          <div
            key={range.id}
            style={{
              position: 'absolute',
              left: `${range.left * 100}%`,
              width: `${range.width * 100}%`,
              top: 0, bottom: 0,
              background: 'rgba(255, 120, 0, 0.15)',
              borderLeft: '1px solid rgba(255, 120, 0, 0.3)',
              borderRight: '1px solid rgba(255, 120, 0, 0.3)',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />
        ))}

        {/* Alert markers */}
        {markers.map(marker => (
          <div
            key={marker.alert_id}
            onClick={(e) => { e.stopPropagation(); onAlertClick?.(marker) }}
            title={`${format(new Date(marker.timestamp), 'HH:mm:ss')} — ${marker.verdict} (${marker.confidence}%)\n${marker.reason}`}
            style={{
              position: 'absolute',
              left: `${marker.position * 100}%`,
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: marker.alert_id === selectedAlertId ? 14 : 10,
              height: marker.alert_id === selectedAlertId ? 14 : 10,
              borderRadius: '50%',
              background: VERDICT_COLORS[marker.verdict] || 'var(--suspicious)',
              border: `2px solid ${marker.alert_id === selectedAlertId ? '#fff' : 'transparent'}`,
              boxShadow: `0 0 ${marker.alert_id === selectedAlertId ? 12 : 6}px ${VERDICT_COLORS[marker.verdict] || 'var(--suspicious)'}`,
              cursor: 'pointer',
              zIndex: marker.alert_id === selectedAlertId ? 10 : 5,
              transition: 'all var(--t-fast)',
            }}
          />
        ))}

        {/* Live Playback head */}
        {currentPlayRatio !== null && (
          <div style={{
            position: 'absolute',
            left: `${currentPlayRatio * 100}%`,
            top: 0, bottom: 0,
            width: 2,
            background: 'var(--accent)',
            zIndex: 8,
            boxShadow: '0 0 8px var(--accent)',
            pointerEvents: 'none',
          }}>
            <div style={{
              position: 'absolute',
              top: -20, left: '50%',
              transform: 'translateX(-50%)',
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 10,
              padding: '2px 5px',
              borderRadius: 3,
              fontFamily: 'var(--font-mono)',
              whiteSpace: 'nowrap',
            }}>
              {getTimeLabel(currentPlayRatio)}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--fraud)', boxShadow: '0 0 4px var(--fraud)' }} />
          Fraud
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--suspicious)', boxShadow: '0 0 4px var(--suspicious)' }} />
          Suspicious
        </div>
        <div style={{ marginLeft: 'auto' }}>
          {markers.length} event{markers.length !== 1 ? 's' : ''} with recordings
        </div>
      </div>
    </div>
  )
}
