import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.jsx'
import logo from '../assets/logo.png'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '⬡', exact: true },
  { to: '/alerts', label: 'Alert Events', icon: '◉' },
  { to: '/playback', label: 'Playback', icon: '▶' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
]

export function Sidebar({ pipelineRunning, wsStatus }) {
  const { user, logout } = useAuth()

  return (
    <aside style={{
      position: 'fixed',
      left: 0, top: 0, bottom: 0,
      width: 'var(--sidebar-width)',
      background: 'var(--bg-surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 100,
    }}>
      {/* Logo */}
      <div style={{
        padding: '20px 20px 16px',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <img src={logo} alt="BFI Logo" style={{ width: 32, height: 32, objectFit: 'contain' }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>BFI Fraud</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>DETECTION v1.0</div>
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
      <nav style={{ flex: 1, padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.exact}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 12px',
              borderRadius: 8,
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: isActive ? 600 : 500,
              color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
              background: isActive ? 'var(--accent-glow)' : 'transparent',
              border: `1px solid ${isActive ? 'rgba(79, 141, 255, 0.2)' : 'transparent'}`,
              transition: 'all var(--t-fast)',
            })}
          >
            <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* WS Status */}
      <div style={{
        padding: '10px 16px',
        borderTop: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 11, color: 'var(--text-muted)',
      }}>
        <div className={`status-dot ${wsStatus === 'connected' ? 'status-dot-blue' : 'status-dot-gray'}`} style={{ width: 6, height: 6 }} />
        WebSocket: {wsStatus}
      </div>

      {/* User */}
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28,
            background: 'var(--accent-glow)',
            border: '1px solid var(--accent)',
            borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: 'var(--accent)',
          }}>
            {user?.username?.[0]?.toUpperCase() || 'A'}
          </div>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>
            {user?.username || 'admin'}
          </span>
        </div>
        <button onClick={logout} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-muted)', fontSize: 13, padding: 4,
          borderRadius: 4, transition: 'color var(--t-fast)',
        }}
          title="Logout"
          onMouseEnter={e => e.target.style.color = 'var(--fraud)'}
          onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}
        >
          ⎋
        </button>
      </div>
    </aside>
  )
}
