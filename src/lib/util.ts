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

// 由出生日期（YYYY-MM-DD）計算現在的年齡；日期無效則回傳空字串
export const ageFromBirth = (birth: string, now = new Date()) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birth)
  if (!m) return ''
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  let age = now.getFullYear() - y
  if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age--
  return age >= 0 && age < 150 ? String(age) : ''
}

// 主選單「掃描」按時間揀活動：今日正在進行的活動優先，其次是今日開始時間最接近現在的；今日沒有活動就回傳 null（用上次的活動）
export const pickScanEvent = <T extends Dated & { id: string; startTime: string; endTime: string; status: string }>(events: T[], now = new Date()) => {
  const today = toDateKey(now)
  const mins = now.getHours() * 60 + now.getMinutes()
  const toMin = (t: string) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : NaN)
  const todays = events.filter((e) => e.status !== 'archived' && isOnDay(e, today))
  if (!todays.length) return null
  const ongoing = todays.filter((e) => {
    const s = toMin(e.startTime)
    const end = toMin(e.endTime)
    return !(s > mins) && !(end < mins) // 未填時間當作全日進行
  })
  const pool = ongoing.length ? ongoing : todays
  const dist = (e: T) => {
    const s = toMin(e.startTime)
    return Number.isNaN(s) ? 9999 : Math.abs(s - mins)
  }
  return [...pool].sort((a, b) => dist(a) - dist(b))[0]
}

// 房間顯示：已填酒店房號 →「房號 1203」；未填（到埗才知道）→「房 #3」
export const roomText = (r: { label: string; purpose?: string }) => (r.purpose === 'custom' ? `房號 ${r.label}` : `房 #${r.label}`)
