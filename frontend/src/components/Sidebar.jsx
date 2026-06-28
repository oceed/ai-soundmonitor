import { NavLink } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.jsx'
import voiceguardLogo from '../assets/voiceguard.png'
import protectqubeLogo from '../assets/protectqube.png'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '⬡', exact: true },
  { to: '/analytics', label: 'Analytics', icon: '📊' },
  { to: '/alerts', label: 'Alert Events', icon: '◉' },
  { to: '/playback', label: 'Playback', icon: '▶' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
]

export function Sidebar({ pipelineRunning, wsStatus, theme, toggleTheme }) {
  const { user, logout } = useAuth()

  return (
    <aside className="sidebar">
      {/* Logo Area */}
      <div className="sidebar-logo-area">
        <div className="sidebar-brand">
          <img src={voiceguardLogo} alt="VoiceGuard Logo" className="sidebar-brand-logo" />
          <div>
            <div className="sidebar-brand-text-main">VoiceGuard</div>
            <div className="sidebar-brand-text-sub">by ProtectQube</div>
          </div>
        </div>

        {/* Pipeline status */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px',
          background: pipelineRunning ? 'var(--clear-bg)' : 'var(--bg-elevated)',
          border: `1px solid ${pipelineRunning ? 'var(--clear-border)' : 'var(--border)'}`,
          borderRadius: 6,
          fontSize: 11,
          marginTop: 8,
        }}>
          <div className={`status-dot ${pipelineRunning ? 'status-dot-green status-dot-pulse' : 'status-dot-gray'}`} />
          <span style={{ color: pipelineRunning ? 'var(--clear)' : 'var(--text-muted)', fontWeight: 600 }}>
            {pipelineRunning ? 'Pipeline Running' : 'Pipeline Stopped'}
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.exact}
            className="sidebar-nav-link"
          >
            <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Footer Area with WS, Theme Toggle, User, and Branding */}
      <div style={{
        padding: '12px 16px',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        background: 'var(--bg-surface)'
      }}>
        {/* WS and Theme Toggle Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
            <div className={`status-dot ${wsStatus === 'connected' ? 'status-dot-blue' : 'status-dot-gray'}`} style={{ width: 6, height: 6 }} />
            <span>WS: {wsStatus}</span>
          </div>
          
          <button 
            className="theme-toggle"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
            style={{ cursor: 'pointer' }}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>

        {/* User Info & Logout Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28,
              height: 28,
              background: 'var(--accent-glow)',
              border: '1px solid var(--accent)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--accent)',
            }}>
              {user?.username?.[0]?.toUpperCase() || 'A'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                {user?.username || 'admin'}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1 }}>
                System Op
              </span>
            </div>
          </div>

          <button 
            onClick={logout}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              fontSize: 16,
              padding: 4,
              borderRadius: 4,
              transition: 'all var(--t-fast)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Logout"
            onMouseEnter={e => e.currentTarget.style.color = 'var(--fraud)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            ⎋
          </button>
        </div>

        {/* Branding badge footer */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          paddingTop: 4,
          opacity: 0.75,
        }}>
          <img 
            src={protectqubeLogo} 
            alt="ProtectQube Logo" 
            style={{ 
              height: 12, 
              objectFit: 'contain',
              filter: theme === 'dark' ? 'brightness(0) invert(1) opacity(0.85)' : 'none'
            }} 
          />
          <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>
            Secured by ProtectQube
          </span>
        </div>
      </div>
    </aside>
  )
}
