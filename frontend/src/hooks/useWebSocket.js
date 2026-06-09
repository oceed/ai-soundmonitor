import { useCallback, useEffect, useRef, useState } from 'react'

const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const WS_URL = import.meta.env.VITE_WS_URL || `${wsProtocol}//${window.location.host}`
const RECONNECT_DELAY_MS = 3000
const MAX_RECONNECT = 10

export function useWebSocket(onMessage) {
  const wsRef = useRef(null)
  const reconnectCount = useRef(0)
  const reconnectTimer = useRef(null)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const [status, setStatus] = useState('disconnected') // connecting | connected | disconnected | error

  const connect = useCallback(() => {
    const token = localStorage.getItem('voiceguard_token')
    if (!token) {
      setStatus('error')
      return
    }

    setStatus('connecting')
    const url = `${WS_URL}/ws?token=${token}`
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setStatus('connected')
      reconnectCount.current = 0
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        onMessageRef.current?.(msg)
      } catch {
        // ignore parse errors
      }
    }

    ws.onerror = () => {
      setStatus('error')
    }

    ws.onclose = (e) => {
      setStatus('disconnected')
      wsRef.current = null
      if (e.code === 4001) return // auth failed, don't reconnect
      if (reconnectCount.current < MAX_RECONNECT) {
        reconnectCount.current++
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS)
      }
    }
  }, [])

  const disconnect = useCallback(() => {
    clearTimeout(reconnectTimer.current)
    wsRef.current?.close()
    wsRef.current = null
    setStatus('disconnected')
  }, [])

  useEffect(() => {
    connect()
    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  const send = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  return { status, send, reconnect: connect }
}
