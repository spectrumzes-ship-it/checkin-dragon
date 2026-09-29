import type { Participant, Resource, SeatAssignment, Ticket } from '../db/types'
import { normalize, searchNorm } from './util'

// 嘉賓搜尋索引：預先把每位嘉賓可被搜尋的內容整理好，搜尋時只做簡單比對，5,000 人亦很快。
export interface GuestEntry {
  p: Participant
  tickets: Ticket[]
  seats: { resource: Resource; seatLabel: string }[]
  hay: string // 已整理、無空格
  ids: string[] // 已整理的各種編號
  sameName: boolean // 同一活動內有同名的人（顯示編號分辨）
}

export const buildIndex = (
  participants: Participant[],
  tickets: Ticket[],
  seats: SeatAssignment[],
  resources: Resource[],
): GuestEntry[] => {
  const tByP = new Map<string, Ticket[]>()
  for (const t of tickets) {
    const arr = tByP.get(t.participantId) ?? []
    arr.push(t)
    tByP.set(t.participantId, arr)
  }
  const rById = new Map(resources.map((r) => [r.id, r]))
  const sByP = new Map<string, { resource: Resource; seatLabel: string }[]>()
  for (const s of seats) {
    const r = rById.get(s.resourceId)
    if (!r) continue
    const arr = sByP.get(s.participantId) ?? []
    arr.push({ resource: r, seatLabel: s.seatLabel })
    sByP.set(s.participantId, arr)
  }
  const nameCount = new Map<string, number>()
  for (const p of participants) {
    const k = normalize(p.name) || normalize(p.englishName)
    nameCount.set(k, (nameCount.get(k) ?? 0) + 1)
  }
  return participants.map((p) => {
    const ts = tByP.get(p.id) ?? []
    // 顯示次序固定：車位 → 席號 → 聚餐餐席
    const rank = (x: { resource: Resource }) => (x.resource.type === 'bus' ? 0 : x.resource.purpose ? 2 : 1)
    const ss = (sByP.get(p.id) ?? []).sort((a, b) => rank(a) - rank(b))
    const ids = [p.memberId, ...ts.flatMap((t) => [t.qrCode, t.invitationId, t.ticketNumber])]
      .filter(Boolean)
      .map(normalize)
    const seatWords = ss.flatMap((s) =>
      s.resource.type === 'table'
        ? [`T${s.resource.label}`, `TABLE${s.resource.label}`, `第${s.resource.label}席`, `第${s.resource.label}桌`]
        : [`${s.resource.label}${s.seatLabel}`, `BUS${s.resource.label}`],
    )
    const hay = normalize(
      [p.name, p.englishName, p.phone, p.company, ...ids, ...seatWords].join('|'),
    )
    const sameName = (nameCount.get(normalize(p.name) || normalize(p.englishName)) ?? 0) > 1
    return { p, tickets: ts, seats: ss, hay, ids, sameName }
  })
}

export const searchGuests = (index: GuestEntry[], query: string): GuestEntry[] => {
  const q = normalize(query)
  if (!q) return index
  const scored: { e: GuestEntry; s: number }[] = []
  for (const e of index) {
    const i = e.hay.indexOf(q)
    if (i < 0) continue
    // 由開頭吻合（例如姓氏）排得較前
    const name = normalize(e.p.englishName) || normalize(e.p.name)
    const s = name.startsWith(q) || normalize(e.p.name).startsWith(q) ? 0 : i === 0 ? 1 : 2
    scored.push({ e, s })
  }
  scored.sort((a, b) => a.s - b.s)
  return scored.map((x) => x.e)
}

// ---- 近似比對（文字辨識用）----

const lev = (a: string, b: string) => {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

// 文字辨識常見認錯字：O↔0、I/L↔1、S↔5、B↔8、Z↔2
const ocrFold = (s: string) =>
  s.replace(/O/g, '0').replace(/[IL|]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2')

const similarity = (a: string, b: string) => {
  if (!a || !b) return 0
  return 1 - lev(a, b) / Math.max(a.length, b.length)
}

export interface FuzzyMatch {
  entry: GuestEntry
  score: number // 0–1
  field: string
}

export const fuzzyMatch = (index: GuestEntry[], text: string, limit = 5): FuzzyMatch[] => {
  const q = normalize(text).replace(/[^\p{L}\p{N}]/gu, '')
  if (q.length < 2) return []
  const qFold = ocrFold(q)
  const out: FuzzyMatch[] = []
  for (const e of index) {
    let best = 0
    let field = ''
    const names: [string, string][] = [
      [normalize(e.p.englishName).replace(/[^\p{L}\p{N}]/gu, ''), '英文名'],
      [normalize(e.p.name), '姓名'],
    ]
    for (const [n, f] of names) {
      if (!n) continue
      let s = similarity(q, n)
      if (n.includes(q) && q.length >= 3) s = Math.max(s, 0.6 + 0.3 * (q.length / n.length))
      if (s > best) [best, field] = [s, f]
    }
    for (const id of e.ids) {
      const clean = id.replace(/[^\p{L}\p{N}]/gu, '')
      const s = Math.max(similarity(q, clean), similarity(qFold, ocrFold(clean)))
      if (s > best) [best, field] = [s, '編號']
    }
    if (best >= 0.6) out.push({ entry: e, score: best, field })
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, limit)
}

export { searchNorm }
