/**
 * useAudioStream.js — React hook for real-time audio monitoring via Web Audio API.
 *
 * Connects to the VoiceGuard local backend WebSocket endpoint that relays raw
 * PCM audio chunks from the counter microphone to the browser.
 *
 * Binary format received: raw PCM 16kHz 16-bit signed integer mono.
 * Decoded via AudioContext → scheduled for gapless playback.
 *
 * Usage:
 *   const { isListening, isConnected, start, stop, volume, setVolume, error } =
 *     useAudioStream('counter_1')
 */

import { useCallback, useEffect, useRef, useState } from 'react'

const SAMPLE_RATE = 16000  // Must match backend config
const CHANNELS = 1

export function useAudioStream(counterId) {
  const [isListening, setIsListening] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [volume, setVolumeState] = useState(1.0)
  const [error, setError] = useState(null)

  const wsRef = useRef(null)
  const audioCtxRef = useRef(null)
  const gainNodeRef = useRef(null)
  const nextPlayTimeRef = useRef(0)
  const volumeRef = useRef(1.0)

  // Keep volume ref in sync
  useEffect(() => {
    volumeRef.current = volume
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.setTargetAtTime(volume, audioCtxRef.current.currentTime, 0.02)
    }
  }, [volume])

  const setVolume = useCallback((v) => {
    setVolumeState(Math.max(0, Math.min(2, v)))
  }, [])

  /**
   * Decode a raw PCM ArrayBuffer (16-bit signed integer, 16kHz, mono)
   * and schedule it for gapless playback via Web Audio API.
   */
  const schedulePcmChunk = useCallback((arrayBuffer) => {
    if (!audioCtxRef.current || !gainNodeRef.current) return

    const ctx = audioCtxRef.current
    const int16 = new Int16Array(arrayBuffer)
    const float32 = new Float32Array(int16.length)

    // Convert Int16 → Float32 normalized [-1, 1]
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0
    }

    const audioBuffer = ctx.createBuffer(CHANNELS, float32.length, SAMPLE_RATE)
    audioBuffer.copyToChannel(float32, 0)

    const source = ctx.createBufferSource()
    source.buffer = audioBuffer
    source.connect(gainNodeRef.current)

    // Schedule for gapless playback: play right after the previous chunk ends
    const now = ctx.currentTime
    const startAt = Math.max(now, nextPlayTimeRef.current)
    source.start(startAt)
    nextPlayTimeRef.current = startAt + audioBuffer.duration
  }, [])

  const stop = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.close()
      wsRef.current = null
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
      gainNodeRef.current = null
    }
    nextPlayTimeRef.current = 0
    setIsListening(false)
    setIsConnected(false)
    setError(null)
  }, [])

  const start = useCallback(() => {
    if (isListening || !counterId) return
    setError(null)

    // Build WebSocket URL — connects to the local VoiceGuard backend
    const token = localStorage.getItem('voiceguard_token') || ''
    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const wsHost = window.location.host
    const url = `${wsProtocol}://${wsHost}/ws/audio-listen/${encodeURIComponent(counterId)}?token=${encodeURIComponent(token)}`

    // Initialize Web Audio API
    const ctx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: SAMPLE_RATE,
      latencyHint: 'playback',
    })
    const gainNode = ctx.createGain()
    gainNode.gain.value = volumeRef.current
    gainNode.connect(ctx.destination)

    audioCtxRef.current = ctx
    gainNodeRef.current = gainNode
    nextPlayTimeRef.current = ctx.currentTime + 0.1  // small startup buffer

    // Resume AudioContext if suspended (browser policy)
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {})
    }

    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => {
      setIsListening(true)
      setIsConnected(true)
      setError(null)
    }

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer && event.data.byteLength > 0) {
        schedulePcmChunk(event.data)
      }
    }

    ws.onerror = () => {
      setError('Connection error — check that the pipeline is running')
    }

    ws.onclose = (evt) => {
      setIsConnected(false)
      setIsListening(false)
      if (evt.code !== 1000 && evt.code !== 1005) {
        setError(`Stream closed (code ${evt.code})`)
      }
      // Cleanup audio context
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {})
        audioCtxRef.current = null
        gainNodeRef.current = null
      }
    }
  }, [counterId, isListening, schedulePcmChunk])

  // Cleanup on unmount
  useEffect(() => {
    return () => stop()
  }, [stop])

  return {
    isListening,
    isConnected,
    volume,
    setVolume,
    error,
    start,
    stop,
  }
}
