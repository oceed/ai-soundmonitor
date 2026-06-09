import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.jsx'
import voiceguardLogo from '../assets/voiceguard.png'
import protectqubeLogo from '../assets/protectqube.png'
import protectqubedLogo from '../assets/protectqubed.png'

export function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password)
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  const isDark = (localStorage.getItem('theme') || 'dark') === 'dark'
  const protectLogo = isDark ? protectqubedLogo : protectqubeLogo

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(ellipse at 50% 0%, rgba(255,140,0,0.08) 0%, var(--bg-base) 70%)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Decorative grid */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'linear-gradient(rgba(255,140,0,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,140,0,0.03) 1px, transparent 1px)',
        backgroundSize: '50px 50px',
        pointerEvents: 'none',
      }} />

      <div className="animate-in" style={{
        width: '100%',
        maxWidth: 420,
        padding: '0 20px',
        position: 'relative',
        zIndex: 1,
      }}>
        {/* Logo and Header */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img 
            src={voiceguardLogo} 
            alt="VoiceGuard Logo" 
            style={{ 
              width: 72, 
              height: 72, 
              objectFit: 'contain',
              margin: '0 auto 12px',
              filter: 'drop-shadow(0 4px 16px var(--accent-glow))' 
            }} 
          />
          <h1 style={{ fontSize: '1.65rem', fontWeight: 800, marginBottom: 4, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
            VoiceGuard
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500 }}>
            Real-time Voice Fraud Detection System
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: 32,
          boxShadow: 'var(--shadow-lg)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)'
        }}>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                id="login-username"
                type="text"
                className="form-input"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter username"
                autoComplete="username"
                autoFocus
                required
              />
            </div>

            <div className="form-group" style={{ marginBottom: 24 }}>
              <label className="form-label">Password</label>
              <input
                id="login-password"
                type="password"
                className="form-input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
                required
              />
            </div>

            {error && (
              <div style={{
                background: 'var(--fraud-bg)',
                border: '1px solid var(--fraud-border)',
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 13,
                color: 'var(--fraud)',
                marginBottom: 16,
              }}>
                ⚠ {error}
              </div>
            )}

            <button
              id="login-submit"
              type="submit"
              className="btn btn-primary btn-lg w-full"
              disabled={loading}
              style={{ justifyContent: 'center' }}
            >
              {loading ? (
                <>
                  <div className="spinner" style={{ width: 16, height: 16, borderTopColor: '#fff' }} />
                  Authenticating...
                </>
              ) : 'Sign In'}
            </button>
          </form>
        </div>

        {/* Branding Footer */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          marginTop: 24,
          opacity: 0.8
        }}>
          <img 
            src={protectLogo} 
            alt="ProtectQube Logo" 
            style={{ height: 13, objectFit: 'contain' }} 
          />
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>
            VoiceGuard by ProtectQube · {new Date().getFullYear()}
          </span>
        </div>
      </div>
    </div>
  )
}
