import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { login as apiLogin, getMe } from '../api/config'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('voiceguard_token')
    if (token) {
      getMe()
        .then(setUser)
        .catch(() => {
          localStorage.removeItem('voiceguard_token')
          setUser(null)
        })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const login = useCallback(async (username, password) => {
    const data = await apiLogin(username, password)
    localStorage.setItem('voiceguard_token', data.access_token)
    const me = await getMe()
    setUser(me)
    return me
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('voiceguard_token')
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
