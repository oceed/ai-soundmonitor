import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { getSnapshotUrl } from '../api/alerts'

const VERDICT_CONFIG = {
  FRAUD:      { color: 'var(--fraud)',      bg: 'var(--fraud-bg)',      border: 'var(--fraud-border)',      icon: '🚨', label: 'FRAUD' },
  SUSPICIOUS: { color: 'var(--suspicious)', bg: 'var(--suspicious-bg)', border: 'var(--suspicious-border)', icon: '⚠️', label: 'SUSPICIOUS' },
  NORMAL:     { color: 'var(--clear)',      bg: 'var(--clear-bg)',      border: 'var(--clear-border)',       icon: '🛡️', label: 'NORMAL / COMPLIANT' },
  CLEAR:      { color: 'var(--clear)',      bg: 'var(--clear-bg)',      border: 'var(--clear-border)',       icon: '✓', label: 'CLEAR' },
  ERROR:      { color: 'var(--error)',      bg: 'rgba(240,82,82,0.08)', border: 'rgba(240,82,82,0.2)',      icon: '✕', label: 'ERROR' },
}

export function SnapshotModal({ item, onClose }) {
  const [isZoomed, setIsZoomed] = useState(false)
  const [imgLoading, setImgLoading] = useState(true)
  const [imgError, setImgError] = useState(false)

  // Listen to Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (!item || !item.snapshot_path) return null

  const imageUrl = getSnapshotUrl(item.snapshot_path)
  const cfg = VERDICT_CONFIG[item.verdict] || VERDICT_CONFIG.NORMAL
  const formattedTime = item.timestamp
    ? format(new Date(item.timestamp), 'EEEE, MMMM d, yyyy · HH:mm:ss')
    : '—'

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
        padding: 24,
        animation: 'fadeIn 0.2s ease',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="card animate-in"
        style={{
          width: '100%',
          maxWidth: isZoomed ? 960 : 680,
          maxHeight: '92vh',
          background: 'var(--bg-card)',
          border: `1px solid ${cfg.border || 'var(--border-active)'}`,
          borderRadius: 14,
          padding: 0,
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transition: 'max-width 0.25s ease',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: cfg.bg,
              border: `1px solid ${cfg.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
            }}>
              📷
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Camera Snapshot Evidence
                </span>
                <span style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 20,
                  background: cfg.bg,
                  color: cfg.color,
                  border: `1px solid ${cfg.border}`,
                }}>
                  {cfg.icon} {item.verdict || 'EVENT'}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                {item.counterName || (item.counter_id ? `Counter: ${item.counter_id}` : 'Counter Desk')} · {formattedTime}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setIsZoomed(!isZoomed)}
              className="btn btn-ghost btn-sm"
              title={isZoomed ? 'Shrink preview' : 'Expand preview'}
              style={{ fontSize: 11, padding: '4px 8px' }}
            >
              {isZoomed ? '⊖ Standard' : '⊕ Expand'}
            </button>
            <button
              onClick={onClose}
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
                fontSize: 14,
                cursor: 'pointer',
                width: 28,
                height: 28,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Close (Esc)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Image Display Area */}
        <div style={{
          position: 'relative',
          background: '#000000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 260,
          maxHeight: isZoomed ? '65vh' : '48vh',
          overflow: 'hidden',
          userSelect: 'none',
        }}>
          {imgLoading && !imgError && (
            <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div className="spinner" style={{ width: 28, height: 28 }} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Loading snapshot…</span>
            </div>
          )}

          {imgError ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.5 }}>⚠️</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Snapshot image not found</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                {item.snapshot_path}
              </div>
            </div>
          ) : (
            <img
              src={imageUrl}
              alt="Camera Snapshot Evidence"
              onLoad={() => setImgLoading(false)}
              onError={() => { setImgLoading(false); setImgError(true); }}
              onClick={() => setIsZoomed(!isZoomed)}
              style={{
                maxWidth: '100%',
                maxHeight: isZoomed ? '65vh' : '48vh',
                objectFit: 'contain',
                display: 'block',
                cursor: isZoomed ? 'zoom-out' : 'zoom-in',
                transition: 'transform 0.2s ease',
              }}
            />
          )}

          <div style={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            background: 'rgba(0,0,0,0.65)',
            backdropFilter: 'blur(4px)',
            borderRadius: 4,
            padding: '2px 8px',
            fontSize: 10,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
          }}>
            {item.snapshot_path.split('/').pop()}
          </div>
        </div>

        {/* Metadata & Transcript Details */}
        <div style={{
          padding: '16px 20px',
          background: 'var(--bg-card)',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          overflowY: 'auto',
          maxHeight: 220,
        }}>
          {item.transcript && (
            <div style={{
              background: 'var(--bg-elevated)',
              padding: '10px 14px',
              borderRadius: 8,
              borderLeft: `3px solid ${cfg.color}`,
              border: `1px solid var(--border)`,
              borderLeftWidth: 3,
              borderLeftColor: cfg.color,
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>
                Segment Transcript
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-primary)', fontStyle: 'italic', lineHeight: 1.5 }}>
                "{item.transcript}"
              </div>
            </div>
          )}

          {item.reason && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
              <strong style={{ color: 'var(--text-primary)' }}>Analysis:</strong> {item.reason}
            </div>
          )}

          {/* Action Row */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 4,
            paddingTop: 10,
            borderTop: '1px solid var(--border)',
            flexWrap: 'wrap',
            gap: 10,
          }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {item.flags?.map(f => (
                <span key={f} className="badge badge-info" style={{ fontSize: 9 }}>
                  {f.replace(/_/g, ' ')}
                </span>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <a
                href={imageUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11 }}
              >
                ↗ Open Full Size
              </a>
              <a
                href={imageUrl}
                download={item.snapshot_path.split('/').pop() || 'snapshot.jpg'}
                className="btn btn-primary btn-sm"
                style={{ fontSize: 11 }}
              >
                ↓ Download Image
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
