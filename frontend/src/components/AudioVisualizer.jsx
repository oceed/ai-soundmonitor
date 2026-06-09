import { useEffect, useRef } from 'react'

const HISTORY_SIZE = 120
const GRADIENT_COLORS = {
  speech: ['#4f8dff', '#a78bfa'],
  silence: ['#1e3a6e', '#162d58'],
  fraud: ['#ff4757', '#ff6b9d'],
}

export function AudioVisualizer({ rms = 0, vadState = 'silence', verdict = null }) {
  const canvasRef = useRef(null)
  const historyRef = useRef(new Array(HISTORY_SIZE).fill(0))
  const animRef = useRef(null)

  useEffect(() => {
    historyRef.current.push(rms)
    historyRef.current = historyRef.current.slice(-HISTORY_SIZE)
  }, [rms])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    const draw = () => {
      const W = canvas.width
      const H = canvas.height
      const history = historyRef.current
      const maxRms = 2000

      ctx.clearRect(0, 0, W, H)

      // Background
      ctx.fillStyle = 'rgba(10, 14, 26, 0.95)'
      ctx.fillRect(0, 0, W, H)

      // Grid lines
      ctx.strokeStyle = 'rgba(99, 130, 255, 0.06)'
      ctx.lineWidth = 1
      for (let i = 0; i < 5; i++) {
        const y = (H / 5) * i
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(W, y)
        ctx.stroke()
      }

      // Determine colors based on state
      const isFraud = verdict && verdict !== 'NORMAL' && verdict !== 'CLEAR'
      const colorKey = isFraud ? 'fraud' : vadState
      const [c1, c2] = GRADIENT_COLORS[colorKey] || GRADIENT_COLORS.silence

      // Draw waveform
      const barWidth = W / HISTORY_SIZE
      const gradient = ctx.createLinearGradient(0, 0, W, 0)
      gradient.addColorStop(0, c2 + '40')
      gradient.addColorStop(1, c1)

      ctx.beginPath()
      ctx.moveTo(0, H / 2)

      history.forEach((val, i) => {
        const x = i * barWidth
        const normalizedRms = Math.min(val / maxRms, 1)
        const barH = normalizedRms * (H / 2) * 0.9
        const y = H / 2 - barH

        if (i === 0) {
          ctx.moveTo(x, H / 2)
        }
        ctx.lineTo(x + barWidth / 2, y)
      })

      // Mirror bottom
      for (let i = history.length - 1; i >= 0; i--) {
        const x = i * barWidth
        const normalizedRms = Math.min(history[i] / maxRms, 1)
        const barH = normalizedRms * (H / 2) * 0.9
        ctx.lineTo(x + barWidth / 2, H / 2 + barH)
      }

      ctx.closePath()
      ctx.fillStyle = gradient
      ctx.fill()

      // Glow effect when speech
      if (vadState === 'speech' || isFraud) {
        ctx.shadowColor = isFraud ? 'var(--fraud)' : c1
        ctx.shadowBlur = 12
        ctx.strokeStyle = c1 + '80'
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.shadowBlur = 0
      }

      animRef.current = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(animRef.current)
  }, [vadState, verdict])

  const normalizedRms = Math.min(rms / 2000, 1)
  const dbLabel = rms > 0 ? `${Math.round(20 * Math.log10(rms + 1))} dB` : '— dB'

  return (
    <div style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        width={560}
        height={160}
        style={{
          width: '100%',
          height: 160,
          borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
          display: 'block',
        }}
      />
      {/* Status overlay */}
      <div style={{
        position: 'absolute',
        top: 10, left: 14,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div className={`status-dot ${vadState === 'speech' ? 'status-dot-green status-dot-pulse' : 'status-dot-gray'}`} />
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {vadState === 'speech' ? 'SPEECH' : 'SILENCE'}
        </span>
      </div>
      <div style={{
        position: 'absolute',
        top: 10, right: 14,
        fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
      }}>
        RMS {Math.round(rms)} · {dbLabel}
      </div>
      {/* VU bar */}
      <div style={{
        position: 'absolute',
        bottom: 10, left: 14, right: 14,
      }}>
        <div className="progress-bar" style={{ height: 3 }}>
          <div
            className="progress-fill"
            style={{
              width: `${normalizedRms * 100}%`,
              background: normalizedRms > 0.7
                ? 'linear-gradient(90deg, var(--suspicious), var(--fraud))'
                : 'linear-gradient(90deg, var(--accent), #a78bfa)',
            }}
          />
        </div>
      </div>
    </div>
  )
}
