/**
 * AudioPlayer.jsx — Live audio monitoring button for a counter.
 *
 * Shows a "Listen Live" button that starts real-time audio playback from the
 * counter microphone via WebSocket stream → Web Audio API.
 *
 * Props:
 *   counterId  {string}  - Counter ID to stream
 *   isRunning  {boolean} - Whether the counter pipeline is running
 *   compact    {boolean} - If true, renders a small icon-only button
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAudioStream } from '../hooks/useAudioStream'

/* ── Animated waveform bars (CSS keyframe via inline style) ────────────── */
function WaveformBars({ active }) {
  const bars = [0.4, 0.9, 0.6, 1.0, 0.7, 0.5, 0.85, 0.55]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 16 }}>
      {bars.map((h, i) => (
        <div
          key={i}
          style={{
            width: 2.5,
            height: active ? `${h * 14}px` : 3,
            background: active ? 'var(--clear)' : 'var(--text-dim)',
            borderRadius: 2,
            transition: `height ${0.1 + i * 0.04}s ease`,
            animation: active
              ? `waveBar ${0.5 + (i % 3) * 0.15}s ease-in-out ${i * 0.06}s infinite alternate`
              : 'none',
          }}
        />
      ))}
      <style>{`
        @keyframes waveBar {
          from { transform: scaleY(0.4); }
          to   { transform: scaleY(1); }
        }
      `}</style>
    </div>
  )
}

/* ── Volume slider ─────────────────────────────────────────────────────── */
function VolumeSlider({ volume, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {volume === 0 ? '🔇' : volume < 0.6 ? '🔈' : '🔊'}
      </span>
      <input
        type="range"
        min={0} max={2} step={0.05}
        value={volume}
        onChange={e => onChange(parseFloat(e.target.value))}
        onClick={e => e.stopPropagation()}
        style={{
          width: 72,
          accentColor: 'var(--clear)',
          cursor: 'pointer',
        }}
        title={`Volume: ${Math.round(volume * 100)}%`}
      />
    </div>
  )
}

/* ── Main AudioPlayer component ────────────────────────────────────────── */
export function AudioPlayer({ counterId, isRunning, compact = false }) {
  const { isListening, isConnected, volume, setVolume, error, start, stop } =
    useAudioStream(counterId)

  // Auto-stop if pipeline stops while listening
  useEffect(() => {
    if (!isRunning && isListening) {
      stop()
    }
  }, [isRunning, isListening, stop])

  const handleClick = useCallback(
    (e) => {
      e.stopPropagation()
      if (isListening) {
        stop()
      } else {
        start()
      }
    },
    [isListening, start, stop]
  )

  if (!isRunning) return null  // Hide entirely when pipeline is offline

  if (compact) {
    // Icon-only minimal button for tight layouts
    return (
      <button
        onClick={handleClick}
        title={isListening ? 'Stop listening' : 'Listen live'}
        style={{
          background: isListening
            ? 'rgba(46,204,113,0.15)'
            : 'rgba(255,255,255,0.05)',
          border: `1px solid ${isListening ? 'rgba(46,204,113,0.4)' : 'var(--border)'}`,
          borderRadius: 5,
          color: isListening ? 'var(--clear)' : 'var(--text-muted)',
          fontSize: 13,
          padding: '2px 6px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          transition: 'all 0.2s',
        }}
      >
        {isListening ? '🔊' : '🎙'}
        <WaveformBars active={isListening && isConnected} />
      </button>
    )
  }

  // Full expanded player
  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        background: isListening
          ? 'rgba(46,204,113,0.06)'
          : 'var(--bg-elevated)',
        border: `1px solid ${isListening ? 'rgba(46,204,113,0.25)' : 'var(--border)'}`,
        borderRadius: 8,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        transition: 'all 0.25s ease',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Live badge */}
          {isListening && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: isConnected ? 'var(--clear)' : 'var(--suspicious)',
                boxShadow: isConnected ? '0 0 6px var(--clear)' : 'none',
                animation: isConnected ? 'pulse 1.5s ease-in-out infinite' : 'none',
              }} />
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                color: isConnected ? 'var(--clear)' : 'var(--suspicious)',
                textTransform: 'uppercase',
              }}>
                {isConnected ? 'Live' : 'Connecting…'}
              </span>
            </div>
          )}
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
            {isListening ? 'Listening to mic…' : 'Audio Monitor'}
          </span>
        </div>

        {/* Waveform animation */}
        <WaveformBars active={isListening && isConnected} />
      </div>

      {/* Error message */}
      {error && (
        <div style={{ fontSize: 10, color: 'var(--fraud)', padding: '4px 8px', background: 'var(--fraud-bg)', borderRadius: 5 }}>
          ⚠ {error}
        </div>
      )}

      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {/* Volume slider — only show when listening */}
        {isListening ? (
          <VolumeSlider volume={volume} onChange={setVolume} />
        ) : (
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            Click to monitor mic in real-time
          </span>
        )}

        {/* Listen / Stop button */}
        <button
          onClick={handleClick}
          style={{
            background: isListening
              ? 'rgba(240,82,82,0.1)'
              : 'rgba(46,204,113,0.12)',
            border: `1px solid ${isListening ? 'rgba(240,82,82,0.35)' : 'rgba(46,204,113,0.35)'}`,
            borderRadius: 6,
            color: isListening ? 'var(--fraud)' : 'var(--clear)',
            fontSize: 11,
            fontWeight: 700,
            padding: '4px 12px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            transition: 'all 0.15s ease',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {isListening ? '⏹ Stop' : '🎙 Listen Live'}
        </button>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}
