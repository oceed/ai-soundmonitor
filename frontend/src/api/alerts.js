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
  let clean = snapshotPath.replace(/\\/g, '/')
  if (clean.includes('snapshots/')) {
    clean = 'snapshots/' + clean.split('snapshots/').pop()
  } else if (clean.includes('storage/snapshots/')) {
    clean = 'snapshots/' + clean.split('storage/snapshots/').pop()
  } else {
    clean = clean.replace(/^\/+/, '')
  }
  const base = import.meta.env.VITE_API_URL || ''
  if (base) {
    return `${base.replace(/\/+$/, '')}/${clean}`
  }
  return `http://${window.location.hostname}:8013/${clean}`
}

export const getVideoUrl = (videoPath) => {
  if (!videoPath) return null
  if (videoPath.startsWith('http://') || videoPath.startsWith('https://')) {
    return videoPath
  }
  let clean = videoPath.replace(/\\/g, '/')
  if (clean.includes('videos/')) {
    clean = 'videos/' + clean.split('videos/').pop()
  } else if (clean.includes('storage/videos/')) {
    clean = 'videos/' + clean.split('storage/videos/').pop()
  } else {
    clean = clean.replace(/^\/+/, '')
  }
  const base = import.meta.env.VITE_API_URL || ''
  if (base) {
    return `${base.replace(/\/+$/, '')}/${clean}`
  }
  return `http://${window.location.hostname}:8013/${clean}`
}


