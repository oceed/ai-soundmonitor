import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { getSnapshotUrl, getVideoUrl } from '../api/alerts'

const VERDICT_CONFIG = {
  FRAUD:      { color: 'var(--fraud)',      bg: 'var(--fraud-bg)',      border: 'var(--fraud-border)',      icon: '🚨', label: 'FRAUD' },
  SUSPICIOUS: { color: 'var(--suspicious)', bg: 'var(--suspicious-bg)', border: 'var(--suspicious-border)', icon: '⚠️', label: 'SUSPICIOUS' },
  NORMAL:     { color: 'var(--clear)',      bg: 'var(--clear-bg)',      border: 'var(--clear-border)',       icon: '🛡️', label: 'NORMAL / COMPLIANT' },
  CLEAR:      { color: 'var(--clear)',      bg: 'var(--clear-bg)',      border: 'var(--clear-border)',       icon: '✓', label: 'CLEAR' },
  ERROR:      { color: 'var(--error)',      bg: 'rgba(240,82,82,0.08)', border: 'rgba(240,82,82,0.2)',      icon: '✕', label: 'ERROR' },
}

export function SnapshotModal({ item, onClose }) {
  const hasSnapshot = Boolean(item?.snapshot_path)
  const hasVideo = Boolean(item?.video_path)

  const [activeTab, setActiveTab] = useState(hasVideo && !hasSnapshot ? 'video' : 'photo')
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

  if (!item || (!hasSnapshot && !hasVideo)) return null

  const imageUrl = hasSnapshot ? getSnapshotUrl(item.snapshot_path) : null
  const videoUrl = hasVideo ? getVideoUrl(item.video_path) : null
  const cfg = VERDICT_CONFIG[item.verdict] || VERDICT_CONFIG.NORMAL
  const formattedTime = item.timestamp
    ? format(new Date(item.timestamp), 'EEEE, MMMM d, yyyy · HH:mm:ss')
    : '—'

  const customerPresent = item.customer_present !== undefined ? Boolean(item.customer_present) : null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.78)',
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
          maxWidth: isZoomed ? 960 : 700,
          maxHeight: '94vh',
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
              width: 34,
              height: 34,
              borderRadius: 8,
              background: cfg.bg,
              border: `1px solid ${cfg.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
            }}>
              {activeTab === 'video' ? '🎥' : '📷'}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Camera Media Evidence
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
                {customerPresent !== null && (
                  <span style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 20,
                    background: customerPresent ? 'rgba(50, 220, 50, 0.12)' : 'rgba(240, 150, 20, 0.14)',
                    color: customerPresent ? '#22c55e' : '#f59e0b',
                    border: `1px solid ${customerPresent ? 'rgba(50, 220, 50, 0.3)' : 'rgba(240, 150, 20, 0.3)'}`,
                  }}>
                    {customerPresent ? '👤 Customer Present' : '⚠️ No Customer in Zone'}
                  </span>
                )}
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

        {/* Tab Switcher (Foto vs Video) */}
        {hasSnapshot && hasVideo && (
          <div style={{
            display: 'flex',
            background: 'var(--bg-surface)',
            borderBottom: '1px solid var(--border)',
            padding: '4px 16px',
            gap: 6,
          }}>
            <button
              onClick={() => setActiveTab('photo')}
              style={{
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: activeTab === 'photo' ? 700 : 500,
                color: activeTab === 'photo' ? 'var(--text-primary)' : 'var(--text-muted)',
                background: activeTab === 'photo' ? 'var(--bg-elevated)' : 'transparent',
                border: activeTab === 'photo' ? '1px solid var(--border)' : '1px solid transparent',
                borderRadius: 6,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>📷 Foto Snapshot</span>
            </button>
            <button
              onClick={() => setActiveTab('video')}
              style={{
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: activeTab === 'video' ? 700 : 500,
                color: activeTab === 'video' ? 'var(--text-primary)' : 'var(--text-muted)',
                background: activeTab === 'video' ? 'var(--bg-elevated)' : 'transparent',
                border: activeTab === 'video' ? '1px solid var(--border)' : '1px solid transparent',
                borderRadius: 6,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>🎥 Video Clip MP4</span>
            </button>
          </div>
        )}

        {/* Media Display Area */}
        <div style={{
          position: 'relative',
          background: '#000000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 280,
          maxHeight: isZoomed ? '65vh' : '48vh',
          overflow: 'hidden',
          userSelect: 'none',
        }}>
          {activeTab === 'video' && videoUrl ? (
            <video
              src={videoUrl}
              controls
              autoPlay
              playsInline
              style={{
                maxWidth: '100%',
                maxHeight: isZoomed ? '65vh' : '48vh',
                objectFit: 'contain',
                outline: 'none',
              }}
            >
              Your browser does not support the video tag.
            </video>
          ) : activeTab === 'photo' && imageUrl ? (
            <>
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
            </>
          ) : (
            <div style={{ padding: 40, color: 'var(--text-muted)' }}>No media available</div>
          )}

          <div style={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(4px)',
            borderRadius: 4,
            padding: '3px 8px',
            fontSize: 10,
            color: '#e2e8f0',
            fontFamily: 'var(--font-mono)',
          }}>
            {activeTab === 'video'
              ? (item.video_path?.split('/').pop() || 'video.mp4')
              : (item.snapshot_path?.split('/').pop() || 'snapshot.jpg')}
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
              border: '1px solid var(--border)',
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
              {activeTab === 'photo' && imageUrl && (
                <>
                  <a
                    href={imageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: 11 }}
                  >
                    ↗ Open Full Image
                  </a>
                  <a
                    href={imageUrl}
                    download={item.snapshot_path?.split('/').pop() || 'snapshot.jpg'}
                    className="btn btn-primary btn-sm"
                    style={{ fontSize: 11 }}
                  >
                    ↓ Download Image
                  </a>
                </>
              )}

              {activeTab === 'video' && videoUrl && (
                <>
                  <a
                    href={videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: 11 }}
                  >
                    ↗ Open Video
                  </a>
                  <a
                    href={videoUrl}
                    download={item.video_path?.split('/').pop() || 'video.mp4'}
                    className="btn btn-primary btn-sm"
                    style={{ fontSize: 11 }}
                  >
                    ↓ Download Video
                  </a>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
