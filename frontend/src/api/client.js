import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || ''

const client = axios.create({
  baseURL: API_URL,
  timeout: 30000,
})

// Inject auth token on every request
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('bfi_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Handle 401 globally
client.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('bfi_token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default client
