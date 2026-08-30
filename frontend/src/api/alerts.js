import client from './client'

export const getAlerts = (params = {}) =>
  client.get('/api/alerts', { params }).then(r => r.data)

export const getAlert = (id) =>
  client.get(`/api/alerts/${id}`).then(r => r.data)

export const deleteAlert = (id) =>
  client.delete(`/api/alerts/${id}`).then(r => r.data)

export const getAlertStats = (params = {}) =>
  client.get('/api/alerts/stats', { params }).then(r => r.data)

export const getAnalytics = (params = {}) =>
  client.get('/api/analytics', { params }).then(r => r.data)

export const getTimeline = (date) => {
  const tzOffset = new Date().getTimezoneOffset()
  return client.get('/api/recordings/timeline', { params: { date, tz_offset: tzOffset } }).then(r => r.data)
}

export const getRecordingStreamUrl = (alertId) => {
  const token = localStorage.getItem('voiceguard_token')
  const base = import.meta.env.VITE_API_URL || ''
  return `${base}/api/recordings/${alertId}/stream?token=${token}`
}

export const getRecordingDownloadUrl = (alertId) => {
  const base = import.meta.env.VITE_API_URL || ''
  return `${base}/api/recordings/${alertId}/download`
}

export const getContinuousStreamUrl = (recId) => {
  const token = localStorage.getItem('voiceguard_token')
  const base = import.meta.env.VITE_API_URL || ''
  return `${base}/api/recordings/continuous/${recId}/stream?token=${token}`
}

export const getSnapshotUrl = (snapshotPath) => {
  if (!snapshotPath) return null
  if (snapshotPath.startsWith('http://') || snapshotPath.startsWith('https://')) {
    return snapshotPath
  }
  const clean = snapshotPath.replace(/^\/+/, '')
  const base = import.meta.env.VITE_API_URL || ''
  if (base) {
    return `${base.replace(/\/+$/, '')}/${clean}`
  }
  return `http://${window.location.hostname}:8013/${clean}`
}
