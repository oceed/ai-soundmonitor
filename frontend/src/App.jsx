import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AuthProvider } from './hooks/useAuth.jsx'
import { ToastProvider } from './components/NotificationToast'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Sidebar } from './components/Sidebar'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Alerts } from './pages/Alerts'
import { Playback } from './pages/Playback'
import { Settings } from './pages/Settings'
import { useWebSocket } from './hooks/useWebSocket.js'
import { getPipelineStatus } from './api/config'

const MAX_EVENTS = 200

function AppLayout() {
  const [liveEvents, setLiveEvents] = useState([])
  const [pipelineStatus, setPipelineStatus] = useState(null)
  const [liveDevices, setLiveDevices] = useState(null) // null = not yet received via WS
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark')
  }, [])

  const handleMessage = useCallback((msg) => {
    setLiveEvents(prev => [...prev, msg].slice(-MAX_EVENTS))

    if (msg.type === 'pipeline_status') {
      setPipelineStatus(prev => ({ ...(prev || {}), running: msg.running, stats: msg.stats }))
    }
    if (msg.type === 'audio_devices_changed') {
      setLiveDevices(msg.devices || [])
    }
  }, [])

  const { status: wsStatus } = useWebSocket(handleMessage)

  // Poll pipeline status on mount
  useEffect(() => {
    getPipelineStatus()
      .then(data => setPipelineStatus(data))
      .catch(() => {})
  }, [])

  return (
    <div className="app-layout">
      <Sidebar
        pipelineRunning={pipelineStatus?.running ?? false}
        wsStatus={wsStatus}
        theme={theme}
        toggleTheme={toggleTheme}
      />
      <div className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard liveEvents={liveEvents} pipelineStatus={pipelineStatus} />} />
          <Route path="/alerts" element={<Alerts liveEvents={liveEvents} />} />
          <Route path="/playback" element={<Playback />} />
          <Route path="/settings" element={<Settings liveDevices={liveDevices} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  )
}

export default function App() {
  useEffect(() => {
    const activeTheme = localStorage.getItem('theme') || 'dark'
    document.documentElement.setAttribute('data-theme', activeTheme)
  }, [])

  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
