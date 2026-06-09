import client from './client'

export const getConfig = () =>
  client.get('/api/config').then(r => r.data)

export const patchConfig = (updates) =>
  client.patch('/api/config', { updates }).then(r => r.data)

export const getPrompt = () =>
  client.get('/api/config/prompt').then(r => r.data)

export const updatePrompt = (system_prompt) =>
  client.patch('/api/config/prompt', { system_prompt }).then(r => r.data)

export const resetConfig = () =>
  client.post('/api/config/reset').then(r => r.data)

export const getAudioDevices = () =>
  client.get('/api/devices/audio').then(r => r.data)

export const getPipelineStatus = () =>
  client.get('/api/pipeline/status').then(r => r.data)

export const startPipeline = () =>
  client.post('/api/pipeline/start').then(r => r.data)

export const stopPipeline = () =>
  client.post('/api/pipeline/stop').then(r => r.data)

export const getSessions = (params = {}) =>
  client.get('/api/sessions', { params }).then(r => r.data)

export const getSegments = (params = {}) =>
  client.get('/api/segments', { params }).then(r => r.data)

export const login = (username, password) => {
  const form = new FormData()
  form.append('username', username)
  form.append('password', password)
  return client.post('/api/auth/login', form).then(r => r.data)
}

export const getMe = () =>
  client.get('/api/auth/me').then(r => r.data)

export const changePassword = (current_password, new_password) =>
  client.post('/api/auth/change-password', { current_password, new_password }).then(r => r.data)
