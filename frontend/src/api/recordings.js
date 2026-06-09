import client from './client'

export const getRecordings = (params = {}) =>
  client.get('/api/recordings', { params }).then(r => r.data)
