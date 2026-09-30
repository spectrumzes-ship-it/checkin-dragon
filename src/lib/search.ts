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

// 按類型嚴格比對：編號只接受完全相同；中文名完全相同（或同姓只差一字作後備）；英文名高度相似
export const fuzzyMatch = (index: GuestEntry[], text: string, limit = 5): FuzzyMatch[] => {
  const { ids, cjk, en, words } = extract(text)
  if (!ids.length && !cjk.length && !en.some((w) => w.length >= 3)) return []
  const out: FuzzyMatch[] = []
  for (const e of index) {
    // 編號：只接受完全相同（只容許 O↔0、I↔1 等常見認錯字）；相似但不同的編號不計
    let idScore = 0
    const gids = e.ids.map((x) => x.replace(/[^\p{L}\p{N}]/gu, ''))
    for (const q of ids) for (const g of gids) if (g && (q === g || ocrFold(q) === ocrFold(g))) idScore = 1

    // 中文姓名
    let zh = 0
    const gname = normalize(e.p.name)
    // 整段完全相同 = 100%；只是較長名字的一部分（例如「馮敏儀」中的「馮敏」）最多 85%
    if (gname) for (const [q, whole] of cjk) {
      // 只差一個字：必須同一姓氏、字數相同，才作為後備（例如 何小明／何小朋）
      const oneOff = whole && q.length === gname.length && q.length >= 3 && q[0] === gname[0] && lev(q, gname) === 1
      const sc = q === gname ? (whole ? 1 : 0.85) : oneOff ? 0.7 : 0
      if (sc > zh) zh = sc
    }

    // 英文姓名（例如 CHAN TAl MAN 認錯字仍可吻合）；只打姓氏（例如 CHAN）列出多位
    let enS = 0
    const gen = normalize(e.p.englishName).replace(/[^A-Z]/g, '')
    if (gen) {
      for (const q of en) {
        if (q.length < 3) continue
        const sim = similarity(q, gen)
        if (sim >= 0.85 && sim > enS) enS = sim // 高度相似（容許一兩個字母認錯）才計
      }
      const surname = e.p.englishName.normalize('NFKC').toUpperCase().trim().split(/\s+/)[0]
      if (words.length === 1 && words[0].length >= 2 && surname === words[0]) enS = Math.max(enS, 0.62)
    }

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

// ---- 由證件／會員證的辨識文字抽出登記欄位 ----
// 參考版面：
// 1. 香港身份證：頂部「香港永久性居民身份證 HONG KONG PERMANENT IDENTITY CARD」→ 中文姓名 → 英文姓名「LEE, Chi Nan」
//    → 中文電碼（多組 4 位數字，例如 2621 2535 5174）→ 出生日期「01-01-1985」→ 簽發日期「(01-79) 26-11-18」→ 右下角號碼「Z683365(5)」
// 2. 回鄉證（港澳居民來往內地通行證）：姓名＋拼音「CHAN, TAI MAN」→ 出生日期「1980.01.01」→ 有效期限「2013.01.02-2023.01.01」
//    → 簽發機關 → 證件號碼「H12345678」（H／M＋8 位數字）
export interface CardFields {
  name: string
  englishName: string
  birthDate: string // YYYY-MM-DD
  idPrefix: string // 香港身份證號碼頭 4 位
  permitNo: string // 回鄉證號碼（H／M＋8 位數字）
  permitExpiry: string // 回鄉證有效期至 YYYY-MM-DD
  memberId: string
  phone: string
}

const pad2 = (n: string) => n.padStart(2, '0')
const validDate = (y: number, m: number, d: number) => y >= 1900 && y <= new Date().getFullYear() + 15 && m >= 1 && m <= 12 && d >= 1 && d <= 31 // 有效期可以是未來日期

// 證件上的固定字眼，不是姓名
const DOC_ZH = [
  '香港永久性居民身份證', '香港永久性居民身分證', '香港居民身份證', '香港居民身分證', '香港身份證', '港澳居民來往內地通行證', '港澳居民来往内地通行证', '來往內地通行證',
  '中華人民共和國', '中华人民共和国', '公安部出入境管理局', '出入境管理局', '出入境管理', '公安部', '簽發機關', '签发机关', '簽發日期', '签发日期', '有效期限', '有效期',
  '證件號碼', '证件号码', '換證次數', '换证次数', '首次登記', '出生日期', '出生', '日期', '身份證', '身分證', '通行證', '通行证', '號碼', '香港', '永久性居民', '居民',
  '會員證', '會員', '性別', '性别', '年齡', '姓名', '樣本', '样本',
]
const DOC_EN = new Set([
  'HONG', 'KONG', 'PERMANENT', 'IDENTITY', 'CARD', 'RESIDENT', 'RESIDENTS', 'SPECIAL', 'ADMINISTRATIVE', 'REGION', 'PEOPLE', 'PEOPLES', 'REPUBLIC', 'CHINA', 'DATE', 'OF', 'BIRTH', 'DOB',
  'ISSUE', 'SEX', 'MALE', 'FEMALE', 'AGE', 'PHONE', 'TEL', 'MEMBERSHIP', 'NUMBER', 'ENGLISH', 'CHINESE', 'MAINLAND', 'TRAVEL', 'PERMIT', 'MACAO', 'MACAU', 'VALID', 'UNTIL', 'SAMPLE', 'HKSAR',
])

export const extractFields = (text: string): CardFields => {
  const out: CardFields = { name: '', englishName: '', birthDate: '', idPrefix: '', permitNo: '', permitExpiry: '', memberId: '', phone: '' }
  // 文字辨識常在中文字之間加空格（「李 智 能」）：只合併「逐個字分開」的情況，不會把姓名和旁邊的字詞黏在一起
  let t = (text || '').normalize('NFKC').toUpperCase().replace(/(?<![\u3400-\u9fff])[\u3400-\u9fff](?:[ \t][\u3400-\u9fff](?![\u3400-\u9fff]))+/g, (x) => x.replace(/[ \t]/g, ''))
  const isDoc = /身[份分]證|IDENTITY|通行[證证]|PERMIT/.test(t)

  // ---- 證件號碼 ----
  // 回鄉證：H／M＋8 位數字（其後可能有 2 位換證次數）；要先於身份證判斷，否則會被當成身份證
  const hrp = /(?<![A-Z0-9])([HM])\s?(\d{8})(?:\s?\d{2})?(?!\d)/.exec(t)
  // 香港身份證：1–2 個英文字母＋6 位數字＋括號內 1 位（括號常被認錯或漏掉）
  const hkid = hrp ? null : /(?<![A-Z0-9])([A-Z]{1,2})\s?(\d{6})\s?[(\[{<]?\s?([0-9A])\s?[)\]}>]?(?![0-9])/.exec(t)
  const idm = hrp ?? hkid
  if (hrp) out.permitNo = hrp[1] + hrp[2]
  else if (hkid) out.idPrefix = (hkid[1] + hkid[2]).slice(0, 4)
  if (idm) t = t.replace(idm[0], ' ')
  const doc = isDoc || !!idm

  // ---- 出生日期 ----
  // 卡上可能有幾個日期（出生、簽發、有效期）：優先取「出生」標籤後的；否則取年份最早的一個
  const dates: { iso: string; index: number }[] = []
  const YMD = /(\d{4})\s?[-/.年]\s?(\d{1,2})\s?[-/.月]\s?(\d{1,2})/g
  for (const m of t.matchAll(YMD))
    if (validDate(+m[1], +m[2], +m[3])) dates.push({ iso: `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`, index: m.index })
  // 已認出的「年.月.日」先遮住（長度不變），以免「2013.01.02-2023.01.01」中間被誤讀成「日-月-年」
  const noYmd = t.replace(YMD, (x) => ' '.repeat(x.length))
  for (const m of noYmd.matchAll(/(?<!\d)(\d{1,2})\s?[-/.]\s?(\d{1,2})\s?[-/.]\s?(\d{4})(?!\d)/g))
    if (validDate(+m[3], +m[2], +m[1])) dates.push({ iso: `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`, index: m.index })
  const label = /出生|BIRTH|DOB/.exec(t)
  const afterLabel = label ? dates.filter((d) => d.index > label.index).sort((a, b) => a.index - b.index)[0] : undefined
  const sorted = [...dates].sort((a, b) => a.iso.localeCompare(b.iso))
  const today = new Date().toISOString().slice(0, 10)
  out.birthDate = (afterLabel ?? sorted.filter((d) => d.iso <= today)[0])?.iso ?? ''
  // 回鄉證有效期：卡上最遲的一個日期（有效期限的結束日）
  if (hrp && sorted.length >= 2 && sorted[sorted.length - 1].iso !== out.birthDate) out.permitExpiry = sorted[sorted.length - 1].iso
  // 所有日期（包括兩位年份的簽發日期）都不再用於其他欄位
  let rest = t
    .replace(/\d{4}\s?[-/.年]\s?\d{1,2}\s?[-/.月]\s?\d{1,2}日?/g, ' ')
    .replace(/\d{1,2}\s?[-/.]\s?\d{1,2}\s?[-/.]\s?\d{2,4}/g, ' ')
    .replace(/\(\s?\d{2}\s?-\s?\d{2}\s?\)/g, ' ')

  // 身份證的中文電碼：連續 3 組或以上的 4 位數字，不是電話也不是編號
  rest = rest.replace(/(?<!\d)\d{4}(?:\s+\d{4}){2,}(?!\d)/g, ' ')

  // 電話：8 位數字（香港）。身份證／回鄉證上沒有電話，不抽取以免誤認
  const phone = doc ? null : /(?<!\d)([2-9]\d{3})\s?(\d{4})(?!\d)/.exec(rest)
  if (phone) {
    out.phone = phone[1] + phone[2]
    rest = rest.replace(phone[0], ' ')
  }
  // 會員編號：優先取「會員編號／MEMBER／NO.」後面的一段；否則取第一個含數字的編號（證件上只接受有標籤的）
  const labelled = /(?:會員(?:編號|號碼|證號)?|MEMBER(?:SHIP)?(?:\s*(?:NO|ID|NUMBER))?|(?<!證件)編號|(?<![A-Z])NO)\s*[.:：#]?\s*([A-Z0-9][A-Z0-9\-]{2,})/.exec(rest)
  const anyId = doc ? undefined : (rest.match(/[A-Z0-9][A-Z0-9\-]{3,}/g) ?? []).find((x) => /\d/.test(x))
  const mid = (labelled && /\d/.test(labelled[1]) ? labelled[1] : anyId) ?? ''
  out.memberId = mid.replace(/[^A-Z0-9]/g, '')
  if (mid) rest = rest.replace(mid, ' ')

  // ---- 英文姓名 ----
  // 證件格式「姓, 名」（LEE, CHI NAN）最可靠；否則取同一行內連續 2–4 個英文字
  const isWord = (w: string) => w.length >= 2 && !EN_LABELS.has(w) && !DOC_EN.has(w)
  let enAt = -1 // 英文姓名在文字中的位置，用來找緊貼在它前面的中文姓名
  const comma = /([A-Z]{2,})\s?,\s?([A-Z]{2,}(?:[ \t]+[A-Z]{2,}){0,3})/.exec(rest)
  if (comma && isWord(comma[1]) && comma[2].split(/\s+/).every(isWord)) {
    out.englishName = `${comma[1]} ${comma[2].replace(/\s+/g, ' ')}`.trim()
    enAt = comma.index
  } else {
    let pos = 0
    for (const line of rest.split(/\n/)) {
      const words = (line.match(/[A-Z]+/g) ?? []).filter(isWord)
      if (words.length >= 2) {
        out.englishName = words.slice(0, 4).join(' ')
        enAt = pos + line.indexOf(words[0])
        break
      }
      pos += line.length + 1
    }
  }

  // ---- 中文姓名 ----
  // 1. 有「姓名」標籤（回鄉證／會員證）：取標籤後的 2–4 個中文字
  // 2. 否則取緊貼在英文姓名前面的一段中文字（身份證及回鄉證的中文姓名都印在英文姓名上方），
  //    這樣即使頂部的證件名稱被認錯，也不會被當成姓名
  // 3. 再否則取去掉固定字眼後的第一段 2–4 個中文字
  const candidates = (part: string) => {
    let cleaned = part
    for (const l of [...new Set([...LABELS, ...DOC_ZH])].sort((a, b) => b.length - a.length)) cleaned = cleaned.split(l).join(' ')
    return (cleaned.match(CJK) ?? []).filter((r) => r.length >= 2 && r.length <= 4)
  }
  const byLabel = /姓\s?名\s*[:：]?\s*([\u3400-\u9fff]{2,4})(?![\u3400-\u9fff])/.exec(rest)
  if (byLabel && !DOC_ZH.includes(byLabel[1])) out.name = byLabel[1]
  else {
    const before = enAt > 0 ? candidates(rest.slice(0, enAt)) : []
    out.name = before[before.length - 1] ?? candidates(rest)[0] ?? ''
  }
  return out
}
