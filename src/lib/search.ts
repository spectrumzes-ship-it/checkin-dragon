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
    if (k) nameCount.set(k, (nameCount.get(k) ?? 0) + 1) // 不記名門票沒有姓名，不計同名
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
    const nk = normalize(p.name) || normalize(p.englishName)
    const sameName = !!nk && (nameCount.get(nk) ?? 0) > 1
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

export const similarity = (a: string, b: string) => {
  if (!a || !b) return 0
  return 1 - lev(a, b) / Math.max(a.length, b.length)
}

export interface FuzzyMatch {
  entry: GuestEntry
  score: number // 0–1
  field: string // 吻合的部分：姓名／英文名／編號／姓名＋編號
  nameScore: number
  idScore: number
}

const CJK = /[\u3400-\u9fff]+/g

// 由辨識到的文字抽出可比對的片段：中文姓名、英文姓名（連續 1–4 個英文字）、編號（含數字）
// 「姓名」「邀請編號」等標籤字不會影響結果，因為只會逐段比對
const extract = (text: string) => {
  const t = (text || '').normalize('NFKC').toUpperCase()
  const ids = new Set<string>()
  for (const m of t.match(/[A-Z0-9][A-Z0-9\-_/.]{2,}/g) ?? []) {
    const c = m.replace(/[^A-Z0-9]/g, '')
    if (/\d/.test(c) && c.length >= 3) ids.add(c)
  }
  // 中文：先移除標籤字（例如「姓名何浩然」→「何浩然」），每段文字記下是否「完整一段」
  const cjk = new Map<string, boolean>()
  for (const run of t.match(CJK) ?? []) {
    let r = run.slice(0, 16)
    for (const l of [...LABELS].sort((a, b) => b.length - a.length)) r = r.split(l).join('|')
    for (const seg of r.split('|').filter((x) => x.length >= 2)) {
      for (let len = 2; len <= 4; len++)
        for (let i = 0; i + len <= seg.length; i++) {
          const sub = seg.slice(i, i + len)
          cjk.set(sub, cjk.get(sub) || sub === seg)
        }
    }
  }
  const words = t.match(/[A-Z]+/g) ?? []
  const en = new Set<string>()
  for (let len = 1; len <= 4; len++) for (let i = 0; i + len <= words.length; i++) en.add(words.slice(i, i + len).join(''))
  return { ids: [...ids], cjk: [...cjk.entries()], en: [...en], words }
}

// loose = 放寬門檻，用於列出「其他近似嘉賓」讓工作人員選擇
export const fuzzyMatch = (index: GuestEntry[], text: string, limit = 5, loose = false): FuzzyMatch[] => {
  const minId = loose ? 0.5 : 0.72
  const minZh = loose ? 0.4 : 0.6
  const minEn = loose ? 0.45 : 0.6
  const { ids, cjk, en, words } = extract(text)
  if (!ids.length && !cjk.length && !en.some((w) => w.length >= 3)) return []
  const out: FuzzyMatch[] = []
  for (const e of index) {
    // 編號：完全相同（包括常見認錯字）= 100%；長編號差一兩個字元給較低分
    let idScore = 0
    const gids = e.ids.map((x) => x.replace(/[^\p{L}\p{N}]/gu, ''))
    for (const q of ids)
      for (const g of gids) {
        if (!g) continue
        const sc = q === g || ocrFold(q) === ocrFold(g) ? 1 : g.length >= 5 ? Math.max(similarity(q, g), similarity(ocrFold(q), ocrFold(g))) * 0.9 : 0
        if (sc > idScore) idScore = sc
      }
    if (idScore < minId) idScore = 0

    // 中文姓名
    let zh = 0
    const gname = normalize(e.p.name)
    // 整段完全相同 = 100%；只是較長名字的一部分（例如「馮敏儀」中的「馮敏」）最多 85%
    if (gname) for (const [q, whole] of cjk) {
      const sc = q === gname ? (whole ? 1 : 0.85) : whole && q.length >= 2 && Math.abs(q.length - gname.length) <= 1 ? similarity(q, gname) * 0.9 : 0
      if (sc > zh) zh = sc
    }
    if (zh < minZh) zh = 0

    // 英文姓名（例如 CHAN TAl MAN 認錯字仍可吻合）；只打姓氏（例如 CHAN）列出多位
    let enS = 0
    const gen = normalize(e.p.englishName).replace(/[^A-Z]/g, '')
    if (gen) {
      for (const q of en) {
        if (q.length < 3) continue
        const sc = similarity(q, gen) * (q.length >= gen.length - 2 ? 1 : 0.9)
        if (sc > enS) enS = sc
      }
      const surname = e.p.englishName.normalize('NFKC').toUpperCase().trim().split(/\s+/)[0]
      if (words.length === 1 && words[0].length >= 2 && surname === words[0]) enS = Math.max(enS, 0.62)
    }
    if (enS < minEn) enS = 0

    const nameScore = Math.max(zh, enS)
    if (!nameScore && !idScore) continue
    // 姓名與編號都吻合同一人：最可信
    const both = nameScore >= 0.8 && idScore >= 0.9
    const score = both ? 1 : Math.max(nameScore, idScore)
    const field = both ? '姓名＋編號' : idScore >= nameScore ? '編號' : zh >= enS ? '姓名' : '英文名'
    out.push({ entry: e, score, field, nameScore, idScore })
  }
  // 同分時「姓名＋編號」優先
  out.sort((a, b) => b.score - a.score || Number(b.field === '姓名＋編號') - Number(a.field === '姓名＋編號'))
  return out.slice(0, limit)
}

// 常見標籤／按鈕字眼，不當作姓名
const LABELS = new Set(
  ['姓名', '英文姓名', '中文姓名', '邀請編號', '會員編號', '門票', '票號', '取消簽到', '取消入場', '簽到', '入場', '電話', '公司', '座位', '席號', '晚餐', '巴士', '紀念品', '內容', '編號', '嘉賓', '貴賓', '已到', '未到', '修改', '備註'].map((x) => x),
)
const EN_LABELS = new Set(['VIP', 'QR', 'UNDO', 'CHECK', 'IN', 'TABLE', 'SEAT', 'BUS', 'NO', 'ID', 'INV', 'MEMBER', 'NAME', 'TICKET', 'CODE', 'THE', 'AND', 'MR', 'MS', 'MRS', 'DR'])

// 卡上是否看到「像姓名」的文字（中文 2–4 字，或兩個以上英文字），用來核實編號配對到的嘉賓
const nameEvidence = (text: string) => {
  const t = (text || '').normalize('NFKC').toUpperCase()
  const zh = (t.match(CJK) ?? []).filter((r) => r.length >= 2 && r.length <= 4 && !LABELS.has(r) && ![...LABELS].some((l) => r.includes(l)))
  const words = (t.match(/[A-Z]+/g) ?? []).filter((w) => w.length >= 2 && !EN_LABELS.has(w))
  return zh.length > 0 || words.length >= 2
}

// 由辨識文字估計卡上的姓名（用於預先填入手動搜尋）
export const guessName = (text: string) => {
  const t = (text || '').normalize('NFKC').toUpperCase()
  const zh = (t.match(CJK) ?? []).find((r) => r.length >= 2 && r.length <= 4 && !LABELS.has(r) && ![...LABELS].some((l) => r.includes(l)))
  if (zh) return zh
  const words = (t.match(/[A-Z]+/g) ?? []).filter((w) => w.length >= 2 && !EN_LABELS.has(w))
  return words.slice(0, 3).join(' ')
}

// 只靠編號配對、但卡上看到的姓名與這位嘉賓不符（例如資料不同步、名牌印錯）
export const nameMismatch = (ms: FuzzyMatch[], text: string) => {
  const top = ms[0]
  return !!top && top.idScore >= 0.95 && top.nameScore < 0.6 && nameEvidence(text)
}

// 姓名與編號指向不同的人（例如名牌印錯或資料不同步）：需要工作人員核對
export const nameIdConflict = (ms: FuzzyMatch[]) => {
  const byName = ms.find((m) => m.nameScore >= 0.9)
  const byId = ms.find((m) => m.idScore >= 0.95)
  return !!byName && !!byId && byName.entry.p.id !== byId.entry.p.id
}

export { searchNorm }
