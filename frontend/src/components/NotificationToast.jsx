import { createContext, useCallback, useContext, useState } from 'react'

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((toast) => {
    const id = Date.now() + Math.random()
    const entry = { id, ...toast }
    setToasts(prev => [entry, ...prev].slice(0, 6))
    const duration = toast.duration ?? (toast.type === 'fraud' ? 8000 : 4000)
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, duration)
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="toast-container">
        {toasts.map(toast => (
          <Toast key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

function Toast({ toast, onClose }) {
  const typeClass = {
    fraud: 'toast-fraud',
    warning: 'toast-warning',
    success: 'toast-success',
    info: 'toast-info',
  }[toast.type] || 'toast-info'

  const icon = {
    fraud: '🚨',
    warning: '⚠️',
    success: '✅',
    info: 'ℹ️',
  }[toast.type] || 'ℹ️'

  return (
    <div className={`toast ${typeClass}`}>
      <span style={{ fontSize: 18, lineHeight: 1.2 }}>{icon}</span>
      <div className="toast-content">
        {toast.title && <div className="toast-title">{toast.title}</div>}
        {toast.body && <div className="toast-body">{toast.body}</div>}
      </div>
      <button
        onClick={onClose}
        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
      >
        ×
      </button>
    </div>
  )
}
