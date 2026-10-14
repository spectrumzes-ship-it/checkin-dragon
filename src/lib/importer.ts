// 匯入名單（Excel／CSV）：檔案只在本機讀取，不會上傳。
// 流程：讀檔 → 自動對應欄位（可修改）→ 逐行檢查（有問題的不匯入）→ 一次過寫入資料庫
import { db } from '../db/db'
import type { EventRec, Mode, Participant, Resource, SeatAssignment, Ticket } from '../db/types'
import { audit, idPrefixOf, syncResources } from './actions'
import { busRows, defaultLayout } from './busLayout'
import { getSettings, setSettings } from './settings'
import { normalize, randomCode, uid } from './util'
import { names } from './names'

// ---------- 讀檔 ----------

// CSV：支援引號、引號內換行、逗號／Tab／分號分隔；Excel 存出的 UTF-8（有 BOM）及香港常見的 Big5 都可讀
export const parseCsv = (text: string): string[][] => {
  const t = text.replace(/^﻿/, '')
  const first = t.split(/\r?\n/, 1)[0] ?? ''
  const count = (ch: string) => first.split(ch).length - 1
  const sep = count('\t') > count(',') && count('\t') >= count(';') ? '\t' : count(';') > count(',') ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (quoted) {
      if (c === '"') {
        if (t[i + 1] === '"') (cell += '"'), i++
        else quoted = false
      } else cell += c
    } else if (c === '"' && cell === '') quoted = true
    else if (c === sep) row.push(cell), (cell = '')
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) row.push(cell), rows.push(row)
  return rows
}

const decodeText = (buf: ArrayBuffer) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('big5').decode(buf) // 舊版 Excel（繁體中文 Windows）存的 CSV
  }
}

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`
  }
  return String(v).trim()
}

export class ImportFileError extends Error {}

// 讀出整張表（每行一個陣列）；去掉完全空白的行
export const readTable = async (file: File): Promise<string[][]> => {
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  let rows: string[][]
  if (ext === 'xlsx') {
    const { readSheet } = await import('read-excel-file/universal')
    rows = ((await readSheet(file)) as unknown[][]).map((r) => r.map(cellText))
  } else if (ext === 'xls') {
    throw new ImportFileError('不支援舊版 Excel（.xls）。請在 Excel 選「另存新檔」→ Excel 活頁簿（.xlsx）或 CSV，再匯入。')
  } else if (ext === 'numbers') {
    throw new ImportFileError('不支援 Numbers 檔。請在 Numbers 選「檔案 → 輸出至 → Excel 或 CSV」，再匯入。')
  } else {
    rows = parseCsv(decodeText(await file.arrayBuffer())).map((r) => r.map((c) => c.trim()))
  }
  return rows.filter((r) => r.some((c) => c !== ''))
}

// ---------- 欄位 ----------

export type FieldKey =
  | 'code'
  | 'memberId'
  | 'name'
  | 'englishName'
  | 'phone'
  | 'company'
  | 'vip'
  | 'companions'
  | 'guestCount'
  | 'tags'
  | 'remarks'
  | 'table'
  | 'seat'
  | 'bus'
  | 'gender'
  | 'partner'
  | 'idPrefix'
  | 'permitNo'
  | 'permitExpiry'
  | 'birthDate'
  | 'age'
  | 'giftGroups'

export interface FieldDef {
  key: FieldKey
  label: string
  modes?: Mode[] // 沒有 = 所有模式
  words: string[] // 標題常見寫法（已整理：小寫、無空格、全形轉半形）
}

export const FIELDS: FieldDef[] = [
  { key: 'code', label: '編號（QR 內容）', words: ['編號', '邀請編號', '請柬編號', '票號', '門票編號', '門票號碼', '入場券編號', '團員編號', 'qr', 'qrcode', 'qr內容', '二維碼', 'ticket', 'ticketno', 'invitation', 'code', 'id', 'no', 'no.'] },
  { key: 'memberId', label: '會員編號', words: ['會員編號', '會員號碼', '會員號', '會員卡號', 'member', 'memberid', 'memberno', 'membership'] },
  { key: 'name', label: '中文姓名', words: ['中文姓名', '中文名', '姓名', '名字', '嘉賓姓名', '嘉賓', '團員', '會員姓名', 'chinesename', 'name'] },
  { key: 'englishName', label: '英文姓名', words: ['英文姓名', '英文名', '英文名稱', 'englishname', 'nameinenglish'] },
  { key: 'phone', label: '電話', words: ['電話', '電話號碼', '聯絡電話', '手提電話', '手機', '手機號碼', '流動電話', 'phone', 'mobile', 'tel', 'telephone'] },
  { key: 'company', label: '公司／機構', words: ['公司', '機構', '公司名稱', '單位', '所屬機構', 'company', 'organisation', 'organization'] },
  { key: 'vip', label: 'VIP', words: ['vip', '貴賓'] },
  { key: 'companions', label: '同行人數（不計本人）', words: ['同行人數', '同行者人數', '隨行人數', '同行者', '攜眷', 'companions', '+1'] },
  { key: 'guestCount', label: '總人數（連本人）', words: ['人數', '總人數', '出席人數', '請柬人數', 'pax', 'guests', 'guestcount'] },
  { key: 'tags', label: '特別需要', words: ['特別需要', '特殊需要', '飲食要求', '飲食', '膳食', '餐飲要求', 'dietary', 'specialneeds'] },
  { key: 'remarks', label: '備註', words: ['備註', '備注', '附註', '註', 'remarks', 'remark', 'notes', 'note'] },
  { key: 'table', label: '席號', modes: ['banquet'], words: ['席號', '席', '枱號', '檯號', '桌號', '桌', 'table', 'tableno'] },
  { key: 'seat', label: '座位', modes: ['banquet', 'bus'], words: ['座位', '座號', '座位號', '座位號碼', '位', 'seat', 'seatno'] },
  { key: 'bus', label: '車', modes: ['bus'], words: ['車', '車號', '車次', '巴士', '車輛', 'bus', 'coach'] },
  { key: 'gender', label: '性別', words: ['性別', 'gender', 'sex'] },
  { key: 'partner', label: '同行人士（對方編號）', modes: ['bus'], words: ['同行(編號)', '同行編號', '同行人士', '同行', '同房', '同房編號', 'partner'] },
  { key: 'idPrefix', label: '身份證（只存頭 4 位）', words: ['身份證頭4位', '身份證', '身份證號碼', '身分證', '身分證號碼', 'hkid', 'idcard', 'idno'] },
  { key: 'permitNo', label: '回鄉證號碼', words: ['回鄉證號碼', '回鄉證', '回鄉證編號', '通行證號碼', '通行證', 'permit', 'permitno'] },
  { key: 'permitExpiry', label: '回鄉證有效期', words: ['回鄉證有效期', '有效期', '有效期至', '證件有效期', '有效日期', 'expiry', 'expirydate'] },
  { key: 'birthDate', label: '出生日期', words: ['出生日期', '出生', '生日', 'dob', 'birthday', 'dateofbirth', 'birthdate'] },
  { key: 'age', label: '年齡', words: ['年齡', '歲', 'age'] },
  { key: 'giftGroups', label: '禮物組別', words: ['禮物組別', '組別', '可領禮品', '禮品組別', '類別', 'group', 'giftgroup'] },
]

export const fieldsFor = (mode: Mode) => FIELDS.filter((f) => !f.modes || f.modes.includes(mode))

const headNorm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s_\-–—:：]/g, '')

// 自動估算每一欄對應哪個欄位：完全相同最優先，其次是包含最長的常見寫法；每個欄位只用一次
export const guessMapping = (headers: string[], mode: Mode): (FieldKey | '')[] => {
  const fs = fieldsFor(mode)
  const cand: { col: number; key: FieldKey; score: number }[] = []
  headers.forEach((h, col) => {
    const n = headNorm(h)
    if (!n) return
    for (const f of fs)
      for (const w of f.words) {
        if (n === w) cand.push({ col, key: f.key, score: 100 + w.length })
        else if (w.length >= 2 && n.includes(w)) cand.push({ col, key: f.key, score: w.length })
      }
  })
  cand.sort((a, b) => b.score - a.score)
  const out: (FieldKey | '')[] = headers.map(() => '')
  const used = new Set<FieldKey>()
  for (const c of cand) {
    if (out[c.col] || used.has(c.key)) continue
    out[c.col] = c.key
    used.add(c.key)
  }
  // 禮品領取：只有「編號」沒有「會員編號」時，編號就是會員編號（會員卡 QR）
  if (mode === 'gift' && used.has('code') && !used.has('memberId')) out[out.indexOf('code')] = 'memberId'
  return out
}

// ---------- 逐行檢查 ----------

export interface ImportRow {
  line: number // 原檔第幾行（方便對照 Excel）
  name: string
  englishName: string
  code: string // QR 內容
  memberId: string
  phone: string
  company: string
  vip?: boolean
  guestCount?: number
  tags: string[]
  remarks: string
  table: string // 已對應到的席號標籤
  seat: string
  bus: string
  busSeat: string
  gender?: 'M' | 'F'
  partner: string
  idPrefix: string
  permitNo: string
  permitExpiry: string
  birthDate: string
  age: string
  giftGroups: string[]
  errors: string[] // 有錯誤 = 不會匯入
  warnings: string[]
  existingId?: string // 名單已有此人
}

export interface ImportContext {
  ev: EventRec
  participants: Participant[]
  tickets: Ticket[]
  resources: Resource[]
  seats?: SeatAssignment[]
}

const YES = new Set(['Y', 'YES', '是', '有', 'V', '✓', '✔', '1', 'TRUE', 'VIP', '貴賓', 'O', '○'])

// 日期：2026-01-31、2026/1/31、31/1/2026、31-01-2026、1985.01.01、19850101 → YYYY-MM-DD
export const parseDate = (s: string): string | null => {
  const t = s.normalize('NFKC').trim()
  if (!t) return ''
  const pad = (n: string) => n.padStart(2, '0')
  const ok = (y: number, m: number, d: number) => y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31
  let m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(t)
  if (m && ok(+m[1], +m[2], +m[3])) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t) // 香港習慣：日/月/年
  if (m && ok(+m[3], +m[2], +m[1])) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(t)
  if (m && ok(+m[1], +m[2], +m[3])) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

const splitList = (s: string) =>
  s
    .split(/[、,，/;；|]/)
    .map((x) => x.trim())
    .filter(Boolean)

// 席號比對：「1」「01」「第1席」都對應同一張枱
const tableKey = (s: string) => {
  const t = s.normalize('NFKC').replace(/^第|[席枱檯桌號]$/g, '').trim().toUpperCase()
  return /^\d+$/.test(t) ? String(Number(t)) : t
}

// 巴士座位：「12」或「3C」（第 3 排第 3 個）→ 座位號
const busSeatNo = (s: string, bus: Resource | undefined, layout: string | undefined) => {
  const t = s.normalize('NFKC').trim().toUpperCase()
  if (/^\d+$/.test(t)) return String(Number(t))
  const m = /^(\d+)\s*([A-E])$/.exec(t)
  if (!m || !bus) return null
  const rows = busRows(bus.capacity, (layout as never) ?? defaultLayout(bus.capacity))
  const row = rows[Number(m[1]) - 1]
  const seats = row?.filter((x): x is number => !!x)
  const n = seats?.[m[2].charCodeAt(0) - 65]
  return n ? String(n) : null
}

export const buildRows = (table: string[][], mapping: (FieldKey | '')[], ctx: ImportContext): ImportRow[] => {
  const { ev } = ctx
  const col = (k: FieldKey) => mapping.indexOf(k)
  const get = (r: string[], k: FieldKey) => (col(k) >= 0 ? (r[col(k)] ?? '').trim() : '')

  // 已有名單：用 QR／邀請編號／會員編號，或「姓名＋電話」找出同一人
  const tByP = new Map(ctx.tickets.map((t) => [t.participantId, t]))
  const byCode = new Map<string, string>()
  for (const p of ctx.participants) {
    const t = tByP.get(p.id)
    for (const c of [t?.qrCode, t?.invitationId, t?.ticketNumber, p.memberId]) if (c) byCode.set(normalize(c), p.id)
  }
  const byNamePhone = new Map(ctx.participants.filter((p) => p.phone).map((p) => [`${normalize(p.name || p.englishName)}|${normalize(p.phone)}`, p.id]))

  const tables = ctx.resources.filter((r) => r.type === 'table' && !r.purpose)
  const tableByKey = new Map(tables.map((r) => [tableKey(r.label), r]))
  const buses = ctx.resources.filter((r) => r.type === 'bus')
  const busByKey = new Map(buses.map((r) => [normalize(r.label), r]))
  const layoutOf = (label: string) => ev.modeConfig.buses?.find((b) => b.label === label)?.layout

  const seenCode = new Map<string, number>()
  const seenSeat = new Map<string, number>()
  // 名單上已有人坐的座位（同一人更新時不計）
  const pName = new Map(ctx.participants.map((p) => [p.id, names(p).full]))
  const rById = new Map(ctx.resources.map((r) => [r.id, r]))
  const taken = new Map<string, string>()
  for (const st of ctx.seats ?? []) {
    const r = rById.get(st.resourceId)
    if (!r || !st.seatLabel || r.purpose || r.type === 'room') continue
    taken.set(`${r.type === 'bus' ? 'B' : 'T'}${r.type === 'bus' ? r.label : tableKey(r.label)}|${st.seatLabel}`, st.participantId)
  }
  const out: ImportRow[] = []

  table.slice(1).forEach((r, i) => {
    const line = i + 2
    const errors: string[] = []
    const warnings: string[] = []
    const name = get(r, 'name')
    const englishName = get(r, 'englishName').replace(/\s*,\s*/g, ' ').replace(/\s+/g, ' ').toUpperCase()
    const memberId = normalize(get(r, 'memberId'))
    let code = normalize(get(r, 'code'))
    if (ev.mode === 'gift' && !code) code = memberId // 會員卡 QR = 會員編號

    const phone = get(r, 'phone')
    const existingOf = () => (code && byCode.get(code)) || (memberId && byCode.get(memberId)) || (phone && byNamePhone.get(`${normalize(name || englishName)}|${normalize(phone)}`)) || undefined
    if (!name && !englishName) errors.push('沒有姓名')
    if (code) {
      const prev = seenCode.get(code)
      if (prev) errors.push(`編號與第 ${prev} 行重複`)
      else seenCode.set(code, line)
    }

    // 人數：「同行人數」不計本人；「總人數」連本人
    let guestCount: number | undefined
    const comp = get(r, 'companions')
    const total = get(r, 'guestCount')
    if (total) {
      const n = Number(total.normalize('NFKC'))
      if (Number.isInteger(n) && n >= 1) guestCount = n
      else warnings.push(`人數「${total}」看不明白，當作 1 位`)
    } else if (comp) {
      const n = Number(comp.normalize('NFKC'))
      if (Number.isInteger(n) && n >= 0) guestCount = n + 1
      else warnings.push(`同行人數「${comp}」看不明白，當作沒有同行者`)
    }

    // 席號／座位
    let tableLabel = ''
    let seat = ''
    let bus = ''
    let busSeat = ''
    const rawTable = get(r, 'table')
    const rawSeat = get(r, 'seat')
    if (ev.mode === 'banquet' && rawTable) {
      const hit = tableByKey.get(tableKey(rawTable))
      tableLabel = hit?.label ?? tableKey(rawTable)
      if (!hit) warnings.push(`第 ${tableLabel} 席未設定，匯入時會自動加上`)
      seat = rawSeat.normalize('NFKC').replace(/號$/, '')
      if (seat) {
        const k = `T${tableKey(tableLabel)}|${seat}`
        const prev = seenSeat.get(k)
        if (prev) warnings.push(`與第 ${prev} 行同一個座位`)
        else seenSeat.set(k, line)
        const who = taken.get(k)
        if (who && who !== existingOf()) warnings.push(`第 ${tableLabel} 席 ${seat} 號已有${pName.get(who) ?? '人'}，只分席不分座位`), (seat = '')
      }
    } else if (ev.mode === 'banquet' && rawSeat) warnings.push('有座位但沒有席號，座位不會匯入')
    const rawBus = get(r, 'bus')
    if (ev.mode === 'bus' && rawBus) {
      const b = busByKey.get(normalize(rawBus.replace(/車$/, '')))
      if (!b) warnings.push(`沒有「${rawBus}」車，不會分配車位（可先在活動設定加車）`)
      else {
        bus = b.label
        if (rawSeat) {
          const n = busSeatNo(rawSeat, b, layoutOf(b.label))
          if (!n) warnings.push(`座位「${rawSeat}」看不明白，只分車不分座位`)
          else if (Number(n) > b.capacity) warnings.push(`${b.label} 車只有 ${b.capacity} 個座位，座位 ${n} 不會匯入`)
          else {
            busSeat = n
            const k = `B${b.label}|${n}`
            const prev = seenSeat.get(k)
            if (prev) warnings.push(`與第 ${prev} 行同一個車位`)
            else seenSeat.set(k, line)
            const who = taken.get(k)
            if (who && who !== existingOf()) warnings.push(`${b.label} 車 ${n} 號已有${pName.get(who) ?? '人'}，只分車不分座位`), (busSeat = '')
          }
        }
      }
    } else if (ev.mode === 'bus' && rawSeat) warnings.push('有座位但沒有車號，座位不會匯入')

    // 性別、VIP、日期
    const g = get(r, 'gender').normalize('NFKC').toUpperCase()
    const gender = /^(男|M|MALE|先生)$/.test(g) ? 'M' : /^(女|F|FEMALE|女士|小姐)$/.test(g) ? 'F' : undefined
    if (g && !gender) warnings.push(`性別「${g}」看不明白，留空`)
    const vipRaw = get(r, 'vip')
    const dates: Record<'birthDate' | 'permitExpiry', string> = { birthDate: '', permitExpiry: '' }
    for (const k of ['birthDate', 'permitExpiry'] as const) {
      const raw = get(r, k)
      const d = parseDate(raw)
      if (d === null) warnings.push(`${k === 'birthDate' ? '出生日期' : '有效期'}「${raw}」看不明白，留空`)
      else dates[k] = d
    }
    const permitNo = normalize(get(r, 'permitNo')).replace(/[^A-Z0-9]/g, '').slice(0, 9)

    const row: ImportRow = {
      line,
      name,
      englishName,
      code,
      memberId,
      phone,
      company: get(r, 'company'),
      vip: col('vip') >= 0 ? YES.has(vipRaw.normalize('NFKC').toUpperCase()) : undefined,
      guestCount,
      tags: splitList(get(r, 'tags')),
      remarks: get(r, 'remarks'),
      table: tableLabel,
      seat,
      bus,
      busSeat,
      gender,
      partner: normalize(get(r, 'partner')),
      idPrefix: idPrefixOf(get(r, 'idPrefix')), // 私隱：只保存身份證頭 4 位
      permitNo,
      permitExpiry: dates.permitExpiry,
      birthDate: dates.birthDate,
      age: get(r, 'age'),
      giftGroups: splitList(get(r, 'giftGroups')),
      errors,
      warnings,
    }
    row.existingId = existingOf()
    out.push(row)
  })
  // 同行人士：對方編號要在名單或檔案內找到
  const codes = new Set([...seenCode.keys(), ...byCode.keys()])
  for (const r of out) if (r.partner && !codes.has(r.partner)) r.warnings.push(`找不到同行人士「${r.partner}」`)
  return out
}

// ---------- 寫入 ----------

export interface ImportResult {
  added: number
  updated: number
  skipped: number
  failed: number
}

export const importRows = async (ev: EventRec, rows: ImportRow[], onExisting: 'skip' | 'update'): Promise<ImportResult> => {
  const now = Date.now()
  const res: ImportResult = { added: 0, updated: 0, skipped: 0, failed: 0 }
  const ok = rows.filter((r) => {
    if (r.errors.length) return res.failed++, false
    if (r.existingId && onExisting === 'skip') return res.skipped++, false
    return true
  })

  // 新的席號先加上（數字席號直接加大席數；其他名稱另外加一張枱）
  if (ev.mode === 'banquet') {
    const have = new Set((await db.resources.where('eventId').equals(ev.id).toArray()).filter((r) => r.type === 'table' && !r.purpose).map((r) => tableKey(r.label)))
    const missing = [...new Set(ok.map((r) => r.table).filter((t) => t && !have.has(tableKey(t))))]
    const maxNum = Math.max(0, ...missing.filter((t) => /^\d+$/.test(t)).map(Number))
    if (maxNum > (ev.modeConfig.tableCount ?? 0)) {
      const next = { ...ev, modeConfig: { ...ev.modeConfig, tableCount: maxNum }, updatedAt: now }
      await db.events.put(next)
      await syncResources(next, ev)
      ev = next
    }
    let order = 1000
    for (const t of missing.filter((x) => !/^\d+$/.test(x)))
      await db.resources.add({ id: uid(), eventId: ev.id, type: 'table', label: t, capacity: ev.modeConfig.seatsPerTable ?? 12, purpose: '', sortOrder: order++ })
  }

  const [resources, oldPs, oldTs] = await Promise.all([
    db.resources.where('eventId').equals(ev.id).toArray(),
    db.participants.where('eventId').equals(ev.id).toArray(),
    db.tickets.where('eventId').equals(ev.id).toArray(),
  ])
  const tableId = new Map(resources.filter((r) => r.type === 'table' && !r.purpose).map((r) => [tableKey(r.label), r.id]))
  const busId = new Map(resources.filter((r) => r.type === 'bus').map((r) => [r.label, r.id]))
  const pById = new Map(oldPs.map((p) => [p.id, p]))
  const tByP = new Map(oldTs.map((t) => [t.participantId, t]))
  const usedCodes = new Set(oldTs.map((t) => t.qrCode))
  const newCode = () => {
    for (;;) {
      const c = randomCode()
      if (!usedCodes.has(c)) return usedCodes.add(c), c
    }
  }

  const ps: Participant[] = []
  const ts: Ticket[] = []
  const seats: SeatAssignment[] = []
  const clearSeatsFor: { pid: string; type: 'table' | 'bus' }[] = []
  const codeToPid = new Map<string, string>()
  for (const p of oldPs) {
    const t = tByP.get(p.id)
    for (const c of [t?.qrCode, t?.invitationId, p.memberId]) if (c) codeToPid.set(c, p.id)
  }

  for (const r of ok) {
    const old = r.existingId ? pById.get(r.existingId) : undefined
    const pid = old?.id ?? uid()
    // 更新時只覆蓋檔案中有填的資料，其他保留
    const pick = <T,>(v: T | undefined | '', prev: T | undefined, fallback: T): T => (v !== undefined && v !== '' ? (v as T) : prev ?? fallback)
    const p: Participant = {
      ...(old ?? {
        id: pid,
        eventId: ev.id,
        dietary: '',
        status: 'active' as const,
        attendance: 'not_arrived' as const,
        arrivedCount: 0,
        checkedInAt: null,
        checkInMethod: null,
        manual: false,
        createdAt: now,
      }),
      name: pick(r.name, old?.name, ''),
      englishName: pick(r.englishName, old?.englishName, ''),
      memberId: pick(r.memberId, old?.memberId, ''),
      phone: pick(r.phone, old?.phone, ''),
      company: pick(r.company, old?.company, ''),
      vip: r.vip ?? old?.vip ?? false,
      guestCount: r.guestCount ?? old?.guestCount ?? 1,
      tags: r.tags.length ? [...new Set([...(old?.tags ?? []), ...r.tags])] : old?.tags ?? [],
      giftGroups: r.giftGroups.length ? [...new Set([...(old?.giftGroups ?? []), ...r.giftGroups])] : old?.giftGroups ?? [],
      remarks: pick(r.remarks, old?.remarks, ''),
      gender: r.gender ?? old?.gender,
      idPrefix: r.idPrefix || old?.idPrefix,
      permitNo: r.permitNo || old?.permitNo,
      permitExpiry: r.permitExpiry || old?.permitExpiry,
      birthDate: r.birthDate || old?.birthDate,
      age: r.age || old?.age,
      updatedAt: now,
    }
    ps.push(p)
    const t = old ? tByP.get(old.id) : undefined
    const qr = ev.mode === 'gift' ? r.memberId || r.code : r.code
    if (qr && t?.qrCode !== qr) usedCodes.add(qr)
    ts.push({
      id: t?.id ?? uid(),
      eventId: ev.id,
      participantId: pid,
      qrCode: qr || t?.qrCode || newCode(),
      invitationId: ev.mode === 'gift' ? t?.invitationId ?? '' : r.code || t?.invitationId || '',
      ticketNumber: t?.ticketNumber ?? '',
      status: t?.status ?? 'valid',
      usedAt: t?.usedAt ?? null,
    })
    for (const c of [qr, r.code, r.memberId]) if (c) codeToPid.set(c, pid)
    if (r.table) {
      const id = tableId.get(tableKey(r.table))
      if (id) clearSeatsFor.push({ pid, type: 'table' }), seats.push({ id: uid(), eventId: ev.id, participantId: pid, resourceId: id, seatLabel: r.seat })
    }
    if (r.bus) {
      const id = busId.get(r.bus)
      if (id) clearSeatsFor.push({ pid, type: 'bus' }), seats.push({ id: uid(), eventId: ev.id, participantId: pid, resourceId: id, seatLabel: r.busSeat })
    }
    if (old) res.updated++
    else res.added++
  }

  // 同行人士：雙方互相連結（對方已有同行人士就不改）
  const psById = new Map(ps.map((p) => [p.id, p]))
  ok.forEach((r, i) => {
    if (!r.partner) return
    const other = codeToPid.get(r.partner)
    if (!other || other === ps[i].id) return
    ps[i].partnerId = other
    const o = psById.get(other) ?? pById.get(other)
    if (o && !o.partnerId) {
      const copy = psById.get(other) ?? { ...o, updatedAt: now }
      copy.partnerId = ps[i].id
      if (!psById.has(other)) ps.push(copy), psById.set(other, copy)
    }
  })

  // 新的「特別需要」及「禮物組別」加入設定選項
  const s = getSettings()
  const notes = [...new Set([...s.specialNotes, ...ps.flatMap((p) => p.tags)])]
  const groups = [...new Set([...s.giftGroups, ...ps.flatMap((p) => p.giftGroups ?? [])])]
  if (notes.length !== s.specialNotes.length || groups.length !== s.giftGroups.length) setSettings({ specialNotes: notes, giftGroups: groups })

  const typeOf = new Map(resources.map((r) => [r.id, r.type]))
  await db.transaction('rw', [db.participants, db.tickets, db.seats, db.auditLogs], async () => {
    for (const c of clearSeatsFor) {
      const mine = await db.seats.where('participantId').equals(c.pid).toArray()
      await db.seats.bulkDelete(mine.filter((x) => typeOf.get(x.resourceId) === c.type).map((x) => x.id))
    }
    await db.participants.bulkPut(ps)
    await db.tickets.bulkPut(ts)
    await db.seats.bulkAdd(seats)
    await audit(ev.id, '匯入名單 Import', 'event', ev.id, '', `新增 ${res.added} 位、更新 ${res.updated} 位${res.skipped ? `、略過 ${res.skipped} 位` : ''}${res.failed ? `、${res.failed} 行有問題未匯入` : ''}`)
  })
  return res
}

// ---------- 範本 ----------

const TEMPLATE: Record<Mode, string[][]> = {
  event: [
    ['編號', '中文姓名', '英文姓名', '電話', '公司', 'VIP', '同行人數', '備註'],
    ['T001', '陳大文', 'CHAN TAI MAN', '6000 0001', 'ABC 公司', '是', '1', ''],
  ],
  banquet: [
    ['編號', '中文姓名', '英文姓名', '電話', '席號', '座位', '同行人數', '特別需要', '備註'],
    ['D001', '陳大文', 'CHAN TAI MAN', '6000 0001', '1', '1', '1', '素食', ''],
  ],
  bus: [
    ['編號', '中文姓名', '英文姓名', '性別', '電話', '車', '座位', '同行（編號）', '身份證頭4位', '回鄉證號碼', '回鄉證有效期', '備註'],
    ['R001', '陳大文', 'CHAN TAI MAN', '男', '6000 0001', 'A', '1A', 'R002', 'A123', 'H12345678', '2030-12-31', ''],
    ['R002', '陳太', 'CHAN WONG MEI', '女', '6000 0002', 'A', '1B', 'R001', 'B456', '', '', ''],
  ],
  gift: [
    ['會員編號', '中文姓名', '英文姓名', '電話', '出生日期', '禮物組別'],
    ['M0001', '陳大文', 'CHAN TAI MAN', '6000 0001', '1960-01-01', ''],
  ],
}

export const templateCsv = (mode: Mode) =>
  '﻿' + TEMPLATE[mode].map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n') + '\r\n'

export const rowTitle = (r: ImportRow) => names({ name: r.name, englishName: r.englishName } as Participant).full || r.code || `第 ${r.line} 行`
