export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)

const pad = (n: number) => String(n).padStart(2, '0')

export const toDateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const todayKey = () => toDateKey(new Date())
export const addDays = (key: string, days: number) => {
  const d = new Date(key + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return toDateKey(d)
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
export const dateParts = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return { year: y, month: MONTHS[m - 1], day: pad(d) }
}
export const formatDate = (key: string) => {
  const { year, month, day } = dateParts(key)
  return `${day} ${month.charAt(0)}${month.slice(1).toLowerCase()} ${year}`
}
export const formatTime = (ts: number) => {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export const formatDateTime = (ts: number) => {
  const d = new Date(ts)
  return `${toDateKey(d)} ${formatTime(ts)}`
}

// 統一字串：全形轉半形、大寫、去除空格。用於比對 QR、編號、搜尋。
export const normalize = (s: string) =>
  (s || '').normalize('NFKC').toUpperCase().replace(/\s+/g, '')

// 搜尋用：保留空格分隔，方便部分字詞比對
export const searchNorm = (s: string) =>
  (s || '').normalize('NFKC').toUpperCase().replace(/\s+/g, ' ').trim()

export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0)

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ')

// 隨機 QR 編號：8 位數字＋英文字母，不含容易混淆的 0/O、1/I/L（約 8,500 億個組合，難以偽造）
export const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const randomCode = (len = 8, rng?: () => number) => {
  let out = ''
  if (!rng && typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(len)
    crypto.getRandomValues(buf)
    for (const n of buf) out += CODE_CHARS[n % CODE_CHARS.length]
    return out
  }
  for (let i = 0; i < len; i++) out += CODE_CHARS[Math.floor((rng ?? Math.random)() * CODE_CHARS.length)]
  return out
}


// ---- 活動日期（可跨日）----
type Dated = { date: string; endDate?: string }
export const endDateOf = (e: Dated) => (e.endDate && e.endDate > e.date ? e.endDate : e.date)
export const isOnDay = (e: Dated, day: string) => e.date <= day && day <= endDateOf(e)
export const isUpcoming = (e: Dated, day: string) => e.date > day
export const isPast = (e: Dated, day: string) => endDateOf(e) < day
export const formatDateRange = (e: Dated) => (endDateOf(e) === e.date ? formatDate(e.date) : `${formatDate(e.date)} – ${formatDate(endDateOf(e))}`)
