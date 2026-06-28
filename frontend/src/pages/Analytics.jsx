import { useEffect, useState } from 'react'
import { getAnalytics } from '../api/alerts'
import { getConfig } from '../api/config'
import { useToast } from '../components/NotificationToast'
import { format, subDays } from 'date-fns'

export function Analytics() {
  const [data, setData] = useState(null)
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [timeFilter, setTimeFilter] = useState('LAST_7_DAYS')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const { addToast } = useToast()

  // Fetch Category definitions
  useEffect(() => {
    getConfig()
      .then(cfg => {
        if (cfg?.fraud_categories) {
          setCategories(cfg.fraud_categories)
        }
      })
      .catch(err => console.error('Failed to load categories in Analytics:', err))
  }, [])

  const loadData = async () => {
    setLoading(true)
    let dateFrom = null
    let dateTo = null

    const now = new Date()
    if (timeFilter === 'TODAY') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
      dateFrom = start.toISOString()
    } else if (timeFilter === 'YESTERDAY') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0)
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999)
      dateFrom = start.toISOString()
      dateTo = end.toISOString()
    } else if (timeFilter === 'LAST_7_DAYS') {
      const start = subDays(now, 7)
      dateFrom = start.toISOString()
    } else if (timeFilter === 'LAST_30_DAYS') {
      const start = subDays(now, 30)
      dateFrom = start.toISOString()
    } else if (timeFilter === 'CUSTOM') {
      if (customStartDate) dateFrom = new Date(customStartDate + 'T00:00:00').toISOString()
      if (customEndDate) dateTo = new Date(customEndDate + 'T23:59:59').toISOString()
    }

    try {
      const res = await getAnalytics({ date_from: dateFrom, date_to: dateTo })
      setData(res)
    } catch (err) {
      addToast({
        type: 'warning',
        title: 'Error loading analytics',
        body: err.message,
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [timeFilter, customStartDate, customEndDate])

  const getFriendlyCategory = (key) => {
    const cat = categories.find(c => c.key === key)
    return {
      label: cat?.label || key.replace(/_/g, ' '),
      classification: cat?.classification || 'FRAUD',
    }
  }

  const getSopColor = (score) => {
    if (score >= 90) return 'var(--clear)'
    if (score >= 75) return 'var(--suspicious)'
    return 'var(--fraud)'
  }

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 24, overflowY: 'auto', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div className="page-title">Executive Analytics</div>
          <div className="page-subtitle">Persistent operational insight, compliance trends, and category distribution</div>
        </div>

        {/* Filter controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <select
            className="form-input"
            value={timeFilter}
            onChange={e => setTimeFilter(e.target.value)}
            style={{ width: 160 }}
          >
            <option value="TODAY">Today</option>
            <option value="YESTERDAY">Yesterday</option>
            <option value="LAST_7_DAYS">Last 7 Days</option>
            <option value="LAST_30_DAYS">Last 30 Days</option>
            <option value="CUSTOM">Custom Range</option>
          </select>

          {timeFilter === 'CUSTOM' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="date"
                className="form-input"
                value={customStartDate}
                onChange={e => setCustomStartDate(e.target.value)}
                style={{ width: 140 }}
              />
              <span style={{ color: 'var(--text-muted)' }}>to</span>
              <input
                type="date"
                className="form-input"
                value={customEndDate}
                onChange={e => setCustomEndDate(e.target.value)}
                style={{ width: 140 }}
              />
            </div>
          )}

          <button className="btn btn-ghost" onClick={loadData} disabled={loading} title="Refresh">
            {loading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : '↻'}
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '100px 0', flex: 1 }}>
          <div className="spinner" style={{ width: 48, height: 48 }} />
        </div>
      ) : (
        <>
          {/* Overview Cards */}
          <div className="grid-4" style={{ gap: 16 }}>
            <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 18 }}>
              <div style={{
                width: 42, height: 42, borderRadius: 10,
                background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
              }}>
                ◎
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Total Segments</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>{data?.total_segments || 0}</div>
              </div>
            </div>

            <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 18 }}>
              <div style={{
                width: 42, height: 42, borderRadius: 10,
                background: `color-mix(in srgb, ${getSopColor(data?.sop_score || 100)} 12%, transparent)`,
                border: `1px solid color-mix(in srgb, ${getSopColor(data?.sop_score || 100)} 25%, transparent)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
              }}>
                🛡️
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>SOP Compliance</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: getSopColor(data?.sop_score || 100), marginTop: 2 }}>
                  {data?.sop_score ?? 100}%
                </div>
              </div>
            </div>

            <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 18 }}>
              <div style={{
                width: 42, height: 42, borderRadius: 10,
                background: 'color-mix(in srgb, var(--fraud) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--fraud) 25%, transparent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
              }}>
                🚨
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Fraud Incidents</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--fraud)', marginTop: 2 }}>{data?.by_verdict?.FRAUD || 0}</div>
              </div>
            </div>

            <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 18 }}>
              <div style={{
                width: 42, height: 42, borderRadius: 10,
                background: 'color-mix(in srgb, var(--suspicious) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--suspicious) 25%, transparent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
              }}>
                ⚠️
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Suspicious Events</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--suspicious)', marginTop: 2 }}>{data?.by_verdict?.SUSPICIOUS || 0}</div>
              </div>
            </div>
          </div>

          <div className="grid-2" style={{ gap: 20, alignItems: 'start' }}>
            {/* Category breakdown */}
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>
                Category & Indicator Frequency
              </div>
              {!data?.by_category || Object.keys(data.by_category).length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No category hits recorded in this range.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {Object.entries(data.by_category).map(([key, count]) => {
                    const { label, classification } = getFriendlyCategory(key)
                    const color = classification === 'NORMAL' ? 'var(--clear)' : classification === 'SUSPICIOUS' ? 'var(--suspicious)' : 'var(--fraud)'
                    const maxCount = Math.max(...Object.values(data.by_category)) || 1
                    const pct = (count / maxCount) * 100

                    return (
                      <div key={key}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{
                              width: 8, height: 8, borderRadius: '50%',
                              background: color
                            }} />
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
                            {count} hit{count > 1 ? 's' : ''}
                          </span>
                        </div>
                        <div style={{ width: '100%', height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Verdict distribution card */}
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>
                Verdict Distribution Overview
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[
                  { label: 'Normal / Compliant', count: data?.by_verdict?.NORMAL || 0, color: 'var(--clear)', desc: 'Adhering to standard SOP guidelines' },
                  { label: 'Suspicious / Quality Risk', count: data?.by_verdict?.SUSPICIOUS || 0, color: 'var(--suspicious)', desc: 'Minor policy violations or service concerns' },
                  { label: 'Fraud / Compliance Risk', count: data?.by_verdict?.FRAUD || 0, color: 'var(--fraud)', desc: 'High-risk redirection or outside process violations' },
                ].map(item => {
                  const total = data?.total_segments || 1
                  const pct = ((item.count / total) * 100).toFixed(1)

                  return (
                    <div key={item.label} style={{
                      padding: 12, background: 'var(--bg-elevated)', borderRadius: 8,
                      border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                    }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{item.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{item.desc}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: item.color }}>{item.count}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{pct}%</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Daily Trends Table */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>
              Historical Performance Trend (Daily)
            </div>
            {!data?.daily_trend || data.daily_trend.length === 0 ? (
              <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                No trend logs available for the selected range.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="settings-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '10px 8px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Date</th>
                      <th style={{ padding: '10px 8px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Total Segments</th>
                      <th style={{ padding: '10px 8px', fontSize: 11, textTransform: 'uppercase', color: 'var(--clear)' }}>Normal</th>
                      <th style={{ padding: '10px 8px', fontSize: 11, textTransform: 'uppercase', color: 'var(--suspicious)' }}>Suspicious</th>
                      <th style={{ padding: '10px 8px', fontSize: 11, textTransform: 'uppercase', color: 'var(--fraud)' }}>Fraud</th>
                      <th style={{ padding: '10px 8px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', textAlign: 'right' }}>Compliance Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.daily_trend.map(row => (
                      <tr key={row.date} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '12px 8px', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{row.date}</td>
                        <td style={{ padding: '12px 8px', fontSize: 13, color: 'var(--text-secondary)' }}>{row.total}</td>
                        <td style={{ padding: '12px 8px', fontSize: 13, color: 'var(--text-secondary)' }}>{row.normal}</td>
                        <td style={{ padding: '12px 8px', fontSize: 13, color: 'var(--text-secondary)' }}>{row.suspicious}</td>
                        <td style={{ padding: '12px 8px', fontSize: 13, color: 'var(--text-secondary)' }}>{row.fraud}</td>
                        <td style={{ padding: '12px 8px', fontSize: 14, fontWeight: 700, color: getSopColor(row.sop_score), textAlign: 'right' }}>
                          {row.sop_score}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
