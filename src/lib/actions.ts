import { db } from '../db/db'
import type {
  BusConfig,
  CheckIn,
  Coupon,
  EventRec,
  Mode,
  Participant,
  Resource,
  ScanLog,
  ScanMethod,
  ScanPurpose,
  RollStatus,
  ScanResultType,
  SeatAssignment,
  SouvenirItem,
  SouvenirLogic,
  Ticket,
} from '../db/types'
import { getSettings } from './settings'
import { formatTime, normalize, randomCode, toDateKey, uid } from './util'
import { names } from './names'
import { NO_BUS, isBusClosed } from './rollcall'

// 所有會改動資料的操作都集中在這裏：每個操作同時寫入操作紀錄（Audit Log）。

const who = () => {
  const s = getSettings()
  return { operator: s.operator, deviceId: s.deviceId }
}

export const audit = (
  eventId: string | null,
  action: string,
  objectType: string,
  objectId: string,
  guestName = '',
  reason = '',
) => {
  const { operator, deviceId } = who()
  return db.auditLogs.add({
    id: uid(),
    eventId,
    action,
    objectType,
    objectId,
    guestName,
    user: operator,
    deviceId,
    time: Date.now(),
    reason,
  })
}

const logScan = (
  eventId: string,
  purpose: ScanPurpose,
  rawValue: string,
  type: ScanMethod,
  result: ScanResultType,
  reason: string,
  participantId: string | null,
) => {
  const { operator, deviceId } = who()
  const log: ScanLog = {
    id: uid(),
    eventId,
    purpose,
    rawValue,
    type,
    result,
    reason,
    participantId,
    time: Date.now(),
    deviceId,
    operator,
  }
  return db.scanLogs.add(log)
}

// ---------- 驗票 ----------

export interface ScanOutcome {
  result: ScanResultType
  reason?: string
  participant?: Participant
  seats?: { resource: Resource; seatLabel: string }[]
  time: number
  previousTime?: number
  otherEventName?: string
  souvenir?: { item: SouvenirItem; quantity: number }
  rawValue: string
}

export const seatsFor = async (participantId: string) => {
  const seats = await db.seats.where('participantId').equals(participantId).toArray()
  const res = await db.resources.bulkGet(seats.map((s) => s.resourceId))
  return seats
    .map((s, i) => ({ resource: res[i]!, seatLabel: s.seatLabel }))
    .filter((x) => x.resource)
    .sort((a, b) => (a.resource.type === b.resource.type ? 0 : a.resource.type === 'bus' ? -1 : 1))
}

// 尋找嘉賓。QR 掃描（qrOnly）只接受隨機 QR 編號，防止有人把會員編號、票號印成 QR 冒認；
// 文字辨識及手動輸入則可用 QR 編號／邀請號／票號／會員號（由工作人員親眼核對）
export const findByCode = async (raw: string, qrOnly = false) => {
  const v = normalize(raw)
  if (!v) return null
  // App 產生的 QR：CKD1|活動代號|門票編號
  const parts = v.split('|')
  const key = parts[0] === 'CKD1' && parts[2] ? parts[2] : v
  const ticket =
    (await db.tickets.where('qrCode').equals(key).first()) ??
    (qrOnly ? undefined : await db.tickets.where('invitationId').equals(key).first()) ??
    (qrOnly ? undefined : await db.tickets.where('ticketNumber').equals(key).first())
  if (!ticket && qrOnly) return null
  if (ticket) {
    const p = await db.participants.get(ticket.participantId)
    return p ? { participant: p, ticket } : null
  }
  const p = await db.participants.where('memberId').equals(key).first()
  if (p) {
    const t = await db.tickets.where('participantId').equals(p.id).first()
    return { participant: p, ticket: t ?? null }
  }
  return null
}

// 簽到驗證（QR／文字辨識／手動都經這裏）
export const verifyCheckIn = async (
  eventId: string,
  raw: string,
  method: ScanMethod,
  participantId?: string,
): Promise<ScanOutcome> => {
  const now = Date.now()
  let found: { participant: Participant; ticket: Ticket | null } | null = null
  if (participantId) {
    const p = await db.participants.get(participantId)
    if (p) found = { participant: p, ticket: (await db.tickets.where('participantId').equals(p.id).first()) ?? null }
  } else {
    found = await findByCode(raw, method === 'QR')
  }

  const fail = async (reason: string, p?: Participant, extra: Partial<ScanOutcome> = {}) => {
    await logScan(eventId, 'checkin', raw, method, 'invalid', reason, p?.id ?? null)
    return { result: 'invalid' as const, reason, participant: p, time: now, rawValue: raw, ...extra }
  }

  if (!found) return fail('找不到此邀請 Invitation Not Found')
  const { participant: p, ticket } = found
  if (p.eventId !== eventId) {
    const other = await db.events.get(p.eventId)
    return fail('此票屬於其他活動 Wrong Event', undefined, { otherEventName: other?.name ?? '' })
  }
  if (p.status === 'cancelled' || ticket?.status === 'cancelled')
    return fail('此票已取消 Cancelled Ticket', p)

  const seats = await seatsFor(p.id)
  if (p.attendance !== 'not_arrived') {
    await logScan(eventId, 'checkin', raw, method, 'duplicate', '', p.id)
    return {
      result: 'duplicate',
      participant: p,
      seats,
      time: now,
      previousTime: p.checkedInAt ?? undefined,
      rawValue: raw,
    }
  }

  const updated = await checkIn(p, method, 'checkin', '', ticket)
  await logScan(eventId, 'checkin', raw, method, 'valid', '', p.id)
  return { result: 'valid', participant: updated, seats, time: now, rawValue: raw }
}

export const checkIn = async (
  p: Participant,
  method: ScanMethod,
  kind: 'checkin' | 'reentry' | 'manual_override',
  reason = '',
  ticket?: Ticket | null,
  count?: number,
) => {
  const { operator, deviceId } = who()
  const now = Date.now()
  const arrivedCount = Math.min(count ?? p.guestCount, p.guestCount)
  const rec: CheckIn = {
    id: uid(),
    eventId: p.eventId,
    participantId: p.id,
    ticketId: ticket?.id ?? null,
    time: now,
    method,
    deviceId,
    operator,
    kind,
    reason,
    voided: false,
    count: arrivedCount,
  }
  const next: Participant = {
    ...p,
    attendance: arrivedCount >= p.guestCount ? 'arrived' : 'partial',
    arrivedCount,
    checkedInAt: kind === 'checkin' || !p.checkedInAt ? now : p.checkedInAt,
    checkInMethod: method,
    manual: p.manual || kind !== 'checkin' || method === 'MANUAL' || method === 'SEARCH',
    updatedAt: now,
  }
  await db.transaction('rw', db.checkins, db.participants, db.tickets, db.auditLogs, async () => {
    await db.checkins.add(rec)
    await db.participants.put(next)
    if (ticket && ticket.status === 'valid') await db.tickets.update(ticket.id, { status: 'used', usedAt: now })
    const label = kind === 'checkin' ? '簽到 Check-In' : kind === 'reentry' ? '再次簽到 Re-entry' : '手動確認 Manual Override'
    await audit(p.eventId, label, 'participant', p.id, names(p).full, reason)
    // 已分拆的同行者通常一同到場：請柬嘉賓簽到時一併簽到（之後可各自取消）
    if (kind === 'checkin') {
      const comps = await db.participants.where('eventId').equals(p.eventId).filter((c) => c.companionOf === p.id && c.status === 'active' && c.attendance === 'not_arrived').toArray()
      for (const c of comps) {
        await db.checkins.add({ ...rec, id: uid(), participantId: c.id, ticketId: null, count: c.guestCount, reason: `與${names(p).primary}一同簽到` })
        await db.participants.update(c.id, { attendance: 'arrived', arrivedCount: c.guestCount, checkedInAt: now, checkInMethod: method, updatedAt: now })
        await audit(p.eventId, `簽到 Check-In（與${names(p).primary}一同）`, 'participant', c.id, names(c).full)
      }
    }
  })
  return next
}

export const updateArrivedCount = async (p: Participant, count: number) => {
  const c = Math.max(1, Math.min(count, p.guestCount))
  await db.participants.update(p.id, {
    arrivedCount: c,
    attendance: c >= p.guestCount ? 'arrived' : 'partial',
    updatedAt: Date.now(),
  })
  await audit(p.eventId, `修改到達人數 ${c}/${p.guestCount}`, 'participant', p.id, names(p).full)
}

export const undoCheckIn = async (p: Participant) => {
  const { operator, deviceId } = who()
  const now = Date.now()
  await db.transaction('rw', db.checkins, db.participants, db.tickets, db.auditLogs, async () => {
    const recs = await db.checkins.where('participantId').equals(p.id).toArray()
    for (const r of recs) if (!r.voided && r.kind !== 'undo') await db.checkins.update(r.id, { voided: true })
    await db.checkins.add({
      id: uid(),
      eventId: p.eventId,
      participantId: p.id,
      ticketId: null,
      time: now,
      method: 'MANUAL',
      deviceId,
      operator,
      kind: 'undo',
      reason: '',
      voided: false,
      count: 0,
    })
    await db.participants.update(p.id, {
      attendance: 'not_arrived',
      arrivedCount: 0,
      checkedInAt: null,
      checkInMethod: null,
      manual: false,
      updatedAt: now,
    })
    const tickets = await db.tickets.where('participantId').equals(p.id).toArray()
    for (const t of tickets) if (t.status === 'used') await db.tickets.update(t.id, { status: 'valid', usedAt: null })
    await audit(p.eventId, '取消簽到 Undo Check-In', 'participant', p.id, names(p).full)
  })
}

// ---------- 嘉賓 ----------

// 產生活動內不重複的隨機 QR 編號
export const uniqueCode = async (eventId: string) => {
  for (;;) {
    const c = randomCode()
    if (!(await db.tickets.where('qrCode').equals(c).filter((t) => t.eventId === eventId).count())) return c
  }
}

export interface GuestInput {
  name: string
  englishName: string
  memberId: string
  invitationId: string
  qrCode: string
  phone: string
  company: string
  vip: boolean
  guestCount: number
  tags: string[]
  giftGroups: string[]
  age: string
  birthDate: string
  idPrefix: string
  permitNo?: string
  permitExpiry?: string
  partnerId?: string
  gender?: '' | 'M' | 'F'
  walkIn?: boolean
  giftOnly?: boolean
  dietary: string
  remarks: string
  tableId: string
  tableSeat: string
  busId: string
  busSeat: string
  dinnerTableId: string
  dinnerSeat: string
  ticketNumber: string
}

export const emptyGuest = (): GuestInput => ({
  name: '',
  englishName: '',
  memberId: '',
  invitationId: '',
  qrCode: '',
  phone: '',
  company: '',
  vip: false,
  guestCount: 1,
  tags: [],
  giftGroups: [],
  age: '',
  birthDate: '',
  idPrefix: '',
  dietary: '',
  remarks: '',
  tableId: '',
  tableSeat: '',
  busId: '',
  busSeat: '',
  dinnerTableId: '',
  dinnerSeat: '',
  ticketNumber: '',
})

const writeSeats = async (eventId: string, pid: string, g: GuestInput) => {
  await db.seats.where('participantId').equals(pid).delete()
  const rows: SeatAssignment[] = []
  if (g.tableId) rows.push({ id: uid(), eventId, participantId: pid, resourceId: g.tableId, seatLabel: g.tableSeat })
  if (g.dinnerTableId && g.dinnerTableId !== g.tableId)
    rows.push({ id: uid(), eventId, participantId: pid, resourceId: g.dinnerTableId, seatLabel: g.dinnerSeat })
  if (g.busId) rows.push({ id: uid(), eventId, participantId: pid, resourceId: g.busId, seatLabel: g.busSeat })
  if (rows.length) await db.seats.bulkAdd(rows)
}

// 身份證號碼只保留頭 4 位（英文字母＋數字），其餘不保存
export const idPrefixOf = (v: string) => normalize(v).replace(/[^A-Z0-9]/g, '').slice(0, 4)

export const saveGuest = async (eventId: string, g: GuestInput, existing?: Participant) => {
  const now = Date.now()
  const pid = existing?.id ?? uid()
  const p: Participant = {
    id: pid,
    eventId,
    name: g.name.trim(),
    englishName: g.englishName.trim().toUpperCase(),
    memberId: normalize(g.memberId),
    phone: g.phone.trim(),
    company: g.company.trim(),
    vip: g.vip,
    guestCount: Math.max(1, g.guestCount || 1),
    tags: g.tags,
    giftGroups: g.giftGroups,
    age: g.age.trim() || undefined,
    birthDate: g.birthDate || undefined,
    idPrefix: idPrefixOf(g.idPrefix) || undefined,
    permitNo: g.permitNo !== undefined ? normalize(g.permitNo).replace(/[^A-Z0-9]/g, '') || undefined : existing?.permitNo,
    permitExpiry: g.permitExpiry !== undefined ? g.permitExpiry || undefined : existing?.permitExpiry,
    gender: g.gender !== undefined ? g.gender || undefined : existing?.gender,
    partnerId: g.partnerId !== undefined ? g.partnerId || undefined : existing?.partnerId,
    leftAt: existing?.leftAt,
    walkIn: g.walkIn ?? existing?.walkIn,
    giftOnly: g.giftOnly ?? existing?.giftOnly,
    companionOf: existing?.companionOf,
    dietary: g.dietary,
    remarks: g.remarks,
    status: existing?.status ?? 'active',
    attendance: existing?.attendance ?? 'not_arrived',
    arrivedCount: existing?.arrivedCount ?? 0,
    checkedInAt: existing?.checkedInAt ?? null,
    checkInMethod: existing?.checkInMethod ?? null,
    manual: existing?.manual ?? false,
    ticketLabel: normalize(g.ticketNumber) || existing?.ticketLabel || undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await db.transaction('rw', [db.participants, db.tickets, db.seats, db.auditLogs], async () => {
    await db.participants.put(p)
    const t = await db.tickets.where('participantId').equals(pid).first()
    const ticket: Ticket = {
      id: t?.id ?? uid(),
      eventId,
      participantId: pid,
      qrCode: normalize(g.qrCode) || t?.qrCode || (await uniqueCode(eventId)),
      invitationId: normalize(g.invitationId),
      ticketNumber: normalize(g.ticketNumber) || t?.ticketNumber || '',
      status: t?.status ?? 'valid',
      usedAt: t?.usedAt ?? null,
    }
    await db.tickets.put(ticket)
    await writeSeats(eventId, pid, g)
    await audit(eventId, existing ? '修改嘉賓 Edit Guest' : '新增嘉賓 Add Guest', 'participant', pid, names(p).full)
  })
  return p
}

export const guestToInput = async (p: Participant): Promise<GuestInput> => {
  const t = await db.tickets.where('participantId').equals(p.id).first()
  const seats = await seatsFor(p.id)
  const tables = seats.filter((s) => s.resource.type === 'table')
  const bus = seats.find((s) => s.resource.type === 'bus')
  const mainTable = tables.find((s) => s.resource.purpose !== '晚餐') ?? null
  const dinner = tables.find((s) => s.resource.purpose === '晚餐') ?? null
  return {
    name: p.name,
    englishName: p.englishName,
    memberId: p.memberId,
    invitationId: t?.invitationId ?? '',
    qrCode: t?.qrCode ?? '',
    phone: p.phone,
    company: p.company,
    vip: p.vip,
    guestCount: p.guestCount,
    // 舊的「飲食需要」併入「特別需要」
    tags: p.dietary && !p.tags.includes(p.dietary) ? [...p.tags, p.dietary] : p.tags,
    giftGroups: p.giftGroups ?? [],
    age: p.age ?? '',
    birthDate: p.birthDate ?? '',
    idPrefix: p.idPrefix ?? '',
    permitNo: p.permitNo ?? '',
    permitExpiry: p.permitExpiry ?? '',
    partnerId: p.partnerId ?? '',
    gender: p.gender ?? '',
    dietary: '',
    remarks: p.remarks,
    tableId: mainTable?.resource.id ?? '',
    tableSeat: mainTable?.seatLabel ?? '',
    busId: bus?.resource.id ?? '',
    busSeat: bus?.seatLabel ?? '',
    dinnerTableId: dinner?.resource.id ?? '',
    dinnerSeat: dinner?.seatLabel ?? '',
    ticketNumber: t?.ticketNumber ?? '',
  }
}

export const setGuestCancelled = async (p: Participant, cancelled: boolean) => {
  await db.participants.update(p.id, { status: cancelled ? 'cancelled' : 'active', updatedAt: Date.now() })
  const tickets = await db.tickets.where('participantId').equals(p.id).toArray()
  for (const t of tickets)
    await db.tickets.update(t.id, { status: cancelled ? 'cancelled' : t.usedAt ? 'used' : 'valid' })
  await audit(p.eventId, cancelled ? '取消嘉賓 Cancel Guest' : '恢復嘉賓 Restore Guest', 'participant', p.id, names(p).full)
}

// 「只領禮品」與「參加活動」互相轉換
export const setGiftOnly = async (p: Participant, giftOnly: boolean) => {
  await db.participants.update(p.id, { giftOnly: giftOnly || undefined, updatedAt: Date.now() })
  await audit(p.eventId, giftOnly ? '改為只領禮品' : '改為參加活動', 'participant', p.id, names(p).full)
}

// 巴士行程：中途離開／恢復行程。離開後，未點到的點名不再計算此人，亦不再列入「未安排餐席」
export const setLeftTrip = async (p: Participant, left: boolean) => {
  await db.participants.update(p.id, { leftAt: left ? Date.now() : undefined, updatedAt: Date.now() })
  await audit(p.eventId, left ? '中途離開行程' : '恢復行程', 'participant', p.id, names(p).full)
}

export const deleteGuestPermanently = async (p: Participant) => {
  await db.transaction('rw', [db.participants, db.tickets, db.seats, db.attendance, db.auditLogs], async () => {
    await db.participants.delete(p.id)
    await db.tickets.where('participantId').equals(p.id).delete()
    await db.seats.where('participantId').equals(p.id).delete()
    await db.attendance.where('participantId').equals(p.id).delete()
    await audit(p.eventId, '永久刪除嘉賓 Delete Guest', 'participant', p.id, names(p).full)
  })
}

// ---------- 活動 ----------

export interface EventInput {
  name: string
  mode: Mode
  type: string
  date: string
  endDate: string // 跨日活動的結束日期；空白 = 單日
  startTime: string
  endTime: string
  venue: string
  notes: string
  tableCount: number
  seatsPerTable: number
  buses: BusConfig[]
  dinnerTables: number
  dinnerSeats: number
  anonymous: boolean
}

const makeCode = (name: string) =>
  (name.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'EV') + Math.floor(Math.random() * 90 + 10)

// prev = 修改前的活動；只更新仍然使用舊預設人數的席，逐席改過的人數會保留
export const syncResources = async (ev: EventRec, prev?: EventRec) => {
  // 房間由「房間」頁自行管理，不在這裏增刪
  const existing = (await db.resources.where('eventId').equals(ev.id).toArray()).filter((r) => r.type !== 'room')
  const want: Omit<Resource, 'id'>[] = []
  if (ev.mode === 'banquet') {
    for (let i = 1; i <= (ev.modeConfig.tableCount ?? 0); i++)
      want.push({ eventId: ev.id, type: 'table', label: String(i).padStart(2, '0'), capacity: ev.modeConfig.seatsPerTable ?? 12, purpose: '', sortOrder: i })
  }
  if (ev.mode === 'bus') {
    ;(ev.modeConfig.buses ?? []).forEach((b, i) =>
      want.push({ eventId: ev.id, type: 'bus', label: b.label, capacity: b.capacity, purpose: '', sortOrder: i }),
    )
    for (let i = 1; i <= (ev.modeConfig.dinnerTables ?? 0); i++)
      want.push({ eventId: ev.id, type: 'table', label: String(i), capacity: ev.modeConfig.dinnerSeats ?? 12, purpose: '晚餐', sortOrder: 100 + i })
  }
  const key = (r: { type: string; label: string; purpose: string }) => `${r.type}|${r.purpose}|${r.label}`
  const have = new Map(existing.map((r) => [key(r), r]))
  for (const w of want) {
    const h = have.get(key(w))
    if (h) {
      const oldDefault = h.type === 'bus' ? h.capacity : h.purpose === '晚餐' ? prev?.modeConfig.dinnerSeats ?? 12 : prev?.modeConfig.seatsPerTable ?? 12
      const keepCustom = h.type === 'table' && prev && h.capacity !== oldDefault
      await db.resources.update(h.id, { capacity: keepCustom ? h.capacity : w.capacity, sortOrder: w.sortOrder })
      have.delete(key(w))
    } else await db.resources.add({ ...w, id: uid() })
  }
  // 多出來而又沒有人坐的資源才移除，避免誤刪座位資料
  for (const r of have.values()) {
    const used = await db.seats.where('resourceId').equals(r.id).count()
    if (!used) await db.resources.delete(r.id)
  }
}

export const saveEvent = async (input: EventInput, existing?: EventRec) => {
  const now = Date.now()
  const ev: EventRec = {
    id: existing?.id ?? uid(),
    name: input.name.trim(),
    mode: input.mode,
    type: input.type,
    date: input.date,
    endDate: input.mode !== 'banquet' && input.endDate > input.date ? input.endDate : undefined, // 宴會不跨日
    startTime: input.startTime,
    endTime: input.endTime,
    venue: input.venue.trim(),
    notes: input.notes,
    status: existing?.status ?? 'active',
    code: existing?.code ?? makeCode(input.name),
    modeConfig:
      input.mode === 'banquet'
        ? { tableCount: input.tableCount, seatsPerTable: input.seatsPerTable, anonymous: input.anonymous }
        : input.mode === 'bus'
          ? { buses: input.buses.filter((b) => b.label.trim()), dinnerTables: input.dinnerTables, dinnerSeats: input.dinnerSeats }
          : { anonymous: input.anonymous },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await db.events.put(ev)
  await syncResources(ev, existing)
  await audit(ev.id, existing ? '修改活動 Edit Event' : '建立活動 New Event', 'event', ev.id)
  return ev
}

export const duplicateEvent = async (src: EventRec) => {
  const now = Date.now()
  const ev: EventRec = { ...src, id: uid(), name: `${src.name}（副本）`, status: 'active', code: makeCode(src.name), createdAt: now, updatedAt: now }
  await db.events.add(ev)
  await syncResources(ev)
  const items = await db.souvenirs.where('eventId').equals(src.id).toArray()
  await db.souvenirs.bulkAdd(items.map((i) => ({ ...i, id: uid(), eventId: ev.id })))
  await audit(ev.id, '複製活動 Duplicate Event', 'event', ev.id, '', `來自 ${src.name}`)
  return ev
}

export const setEventStatus = async (ev: EventRec, status: EventRec['status']) => {
  await db.events.update(ev.id, { status, updatedAt: Date.now() })
  const label = { active: '重新開啟活動', completed: '完成活動 Complete Event', archived: '封存活動 Archive Event' }[status]
  await audit(ev.id, label, 'event', ev.id)
}

export const deleteEventPermanently = async (ev: EventRec) => {
  await db.transaction(
    'rw',
    [db.events, db.participants, db.tickets, db.resources, db.seats, db.checkins, db.sessions, db.attendance, db.souvenirs, db.redemptions, db.scanLogs, db.auditLogs, db.conflicts],
    async () => {
      for (const t of [db.participants, db.tickets, db.resources, db.seats, db.checkins, db.sessions, db.attendance, db.souvenirs, db.redemptions, db.scanLogs, db.auditLogs, db.conflicts])
        await t.where('eventId').equals(ev.id).delete()
      await db.events.delete(ev.id)
    },
  )
  await audit(null, '永久刪除活動 Delete Event', 'event', ev.id, '', ev.name)
}

// ---------- 巴士點名 ----------

export const createSession = async (eventId: string, name: string, time: string, location: string, notes: string) => {
  const s = { id: uid(), eventId, name, time, location, notes, createdAt: Date.now() }
  await db.sessions.add(s)
  await audit(eventId, `建立點名 ${name}`, 'session', s.id)
  return s
}

// 點名狀態的中文（旅遊）
export const ROLL_LABEL: Record<RollStatus | 'pending', string> = { pending: '待上車', present: '已上車', on_the_way: '在途中', excused: '請假', no_show: '未到' }

// 設定某人在某次點名的狀態；pending = 改回待上車（刪除紀錄）。點名已結束後補登上車會記為「遲到」
export const setRollStatus = async (sessionId: string, eventId: string, p: Participant, status: RollStatus | 'pending') => {
  const id = `${sessionId}:${p.id}`
  if (status === 'pending') await db.attendance.delete(id)
  else {
    const { operator, deviceId } = who()
    const session = await db.sessions.get(sessionId)
    const closed = !!session && isBusClosed(session, await busKeyOf(p.id))
    await db.attendance.put({ id, sessionId, eventId, participantId: p.id, status, late: status === 'present' && closed, checkedAt: Date.now(), deviceId, operator })
  }
  await audit(eventId, `點名：${ROLL_LABEL[status]}`, 'attendance', sessionId, names(p).full)
}

export const setAttendance = (sessionId: string, eventId: string, p: Participant, present: boolean) => setRollStatus(sessionId, eventId, p, present ? 'present' : 'pending')

// 這個人坐哪架車（點名按車分開）；沒有安排巴士 = 'none'
export const busKeyOf = async (pid: string) => {
  for (const seat of await db.seats.where('participantId').equals(pid).toArray()) {
    const r = await db.resources.get(seat.resourceId)
    if (r?.type === 'bus') return r.id
  }
  return NO_BUS
}

// 確認出發（每架車分開）：這架車仍「待上車」的人批次記為「未到」（在途中、請假的人不變）
export const closeSession = async (sessionId: string, eventId: string, pendingIds: string[], busKey: string, busLabel = '') => {
  const { operator, deviceId } = who()
  const now = Date.now()
  await db.transaction('rw', [db.attendance, db.sessions, db.auditLogs], async () => {
    await db.attendance.bulkPut(pendingIds.map((pid) => ({ id: `${sessionId}:${pid}`, sessionId, eventId, participantId: pid, status: 'no_show' as const, checkedAt: now, deviceId, operator })))
    const s = await db.sessions.get(sessionId)
    await db.sessions.update(sessionId, { closedBuses: { ...(s?.closedBuses ?? {}), [busKey]: now }, closedBy: operator })
    await audit(eventId, `確認出發${busLabel ? ` ${busLabel}` : ''}（未到 ${pendingIds.length} 人）`, 'session', sessionId)
  })
}

// 重新開放某架車的點名：這架車「未到」的人變回「待上車」
export const reopenSession = async (sessionId: string, eventId: string, busKey: string, pids: string[], busLabel = '') => {
  const ids = new Set(pids)
  const n = await db.attendance.where('sessionId').equals(sessionId).filter((r) => r.status === 'no_show' && ids.has(r.participantId)).delete()
  const s = await db.sessions.get(sessionId)
  const closedBuses = { ...(s?.closedBuses ?? {}) }
  delete closedBuses[busKey]
  // 舊資料（整個點名一起結束）：重新開放其中一架車時，其他車保持已出發
  const legacy = s?.closedAt
  if (legacy) for (const r of await db.resources.where('eventId').equals(eventId).filter((x) => x.type === 'bus').toArray()) if (r.id !== busKey && !(r.id in closedBuses)) closedBuses[r.id] = legacy
  if (legacy && busKey !== NO_BUS && !(NO_BUS in closedBuses)) closedBuses[NO_BUS] = legacy
  await db.sessions.update(sessionId, { closedAt: undefined, closedBuses })
  await audit(eventId, `重新開放點名${busLabel ? ` ${busLabel}` : ''}（${n} 人改回待上車）`, 'session', sessionId)
}

// 重新點名：保留這個點名環節，所有人改回「待上車」
export const clearSession = async (sessionId: string, eventId: string, name: string) => {
  const n = await db.attendance.where('sessionId').equals(sessionId).delete()
  await db.sessions.update(sessionId, { closedAt: undefined, closedBy: undefined, closedBuses: {} })
  await audit(eventId, `重新點名 ${name}（清除 ${n} 筆紀錄）`, 'session', sessionId)
  return n
}

export const deleteSession = async (sessionId: string, eventId: string, name: string) => {
  await db.attendance.where('sessionId').equals(sessionId).delete()
  await db.sessions.delete(sessionId)
  await audit(eventId, `刪除點名 ${name}`, 'session', sessionId)
}

// 在點名中掃描
export const verifyRollCall = async (eventId: string, sessionId: string, raw: string, method: ScanMethod, participantId?: string): Promise<ScanOutcome> => {
  const now = Date.now()
  const found = participantId ? { participant: (await db.participants.get(participantId))! } : await findByCode(raw, method === 'QR')
  if (!found?.participant || found.participant.eventId !== eventId) {
    await logScan(eventId, 'rollcall', raw, method, 'invalid', '找不到乘客', null)
    return { result: 'invalid', reason: '找不到此乘客 Passenger Not Found', time: now, rawValue: raw }
  }
  const p = found.participant
  const seats = await seatsFor(p.id)
  // 已取消／只領禮品的人不在點名名單內
  if (p.status === 'cancelled' || p.giftOnly) {
    const reason = p.status === 'cancelled' ? '此乘客已取消 Cancelled' : '只領禮品，不需點名'
    await logScan(eventId, 'rollcall', raw, method, 'invalid', reason, p.id)
    return { result: 'invalid', reason, participant: p, seats, time: now, rawValue: raw }
  }
  const rec = await db.attendance.get(`${sessionId}:${p.id}`)
  if (rec?.status === 'present') {
    await logScan(eventId, 'rollcall', raw, method, 'duplicate', '', p.id)
    return { result: 'duplicate', participant: p, seats, time: now, previousTime: rec.checkedAt, rawValue: raw }
  }
  await setRollStatus(sessionId, eventId, p, 'present')
  const late = !!(await db.attendance.get(`${sessionId}:${p.id}`))?.late
  await logScan(eventId, 'rollcall', raw, method, 'valid', late ? '遲到補登' : '', p.id)
  return { result: 'valid', reason: late ? '點名已結束，已補登為「已上車（遲到）」' : undefined, participant: p, seats, time: now, rawValue: raw }
}

// ---------- 紀念品 ----------

export const saveSouvenir = async (item: SouvenirItem) => {
  await db.souvenirs.put(item)
  await audit(item.eventId, `設定紀念品 ${item.name}`, 'souvenir', item.id)
}

// 舊資料沒有 logic／perClaim：perGuest 0 = 按人數每位 1 份；N = 每張請柬 N 份
export const logicOf = (item: SouvenirItem): SouvenirLogic => item.logic ?? (item.perGuest > 0 ? 'invitation' : 'person')
export const perClaimOf = (item: SouvenirItem) => Math.max(1, item.perClaim ?? (item.perGuest > 0 ? item.perGuest : 1))

// 這位嘉賓可領多少份：按人頭 = 每位 X 份（一票多人按人數）；按請柬／先到先得 = 每次 X 份
export const entitlement = (item: SouvenirItem, p: Participant) => (logicOf(item) === 'person' ? perClaimOf(item) * p.guestCount : perClaimOf(item))

export const logicLabel = (item: SouvenirItem) => {
  const l = logicOf(item)
  return l === 'fcfs' ? '限量先到先得' : l === 'coupon' ? '憑券換領' : eligibilityLabel(item.eligibility)
}
export const quantityLabel = (item: SouvenirItem, left: number | null) => {
  const x = perClaimOf(item)
  const l = logicOf(item)
  if (l === 'person') return `每人 ${x} 份`
  if (l === 'invitation') return `每張請柬 ${x} 份`
  if (l === 'coupon') return `每券 ${x} 份${left === null ? '' : ` · 剩餘 ${Math.max(0, left)} 份`}`
  return left === null ? `每次 ${x} 份 · 不限數量` : `剩餘 ${Math.max(0, left)} 份`
}

// 同一張請柬的所有人：原嘉賓＋分拆出來的同行者
const invitationGroup = async (p: Participant) => {
  const rootId = p.companionOf ?? p.id
  const others = await db.participants.where('eventId').equals(p.eventId).filter((x) => x.companionOf === rootId).toArray()
  const root = p.id === rootId ? p : await db.participants.get(rootId)
  return [...(root ? [root] : []), ...others]
}

export const eligible = (item: SouvenirItem, p: Participant) => {
  if (item.eligibility === 'all') return true
  if (item.eligibility === 'vip') return p.vip
  if (item.eligibility.startsWith('group:')) return !!p.giftGroups?.includes(item.eligibility.slice(6))
  if (item.eligibility.startsWith('tag:')) return p.tags.includes(item.eligibility.slice(4)) // 舊資料
  return true
}

export const eligibilityLabel = (e: string) =>
  e === 'all' ? '所有人' : e === 'vip' ? '只限 VIP' : e.startsWith('group:') ? `只限「${e.slice(6)}」` : e.startsWith('tag:') ? `只限「${e.slice(4)}」` : e

export const redeemedQty = async (itemId: string, participantId?: string) => {
  const rows = participantId
    ? await db.redemptions.where('participantId').equals(participantId).filter((r) => r.itemId === itemId).toArray()
    : await db.redemptions.where('itemId').equals(itemId).toArray()
  return rows.filter((r) => !r.voided && r.kind === 'redeem').reduce((a, r) => a + r.quantity, 0)
}

export const verifySouvenir = async (
  eventId: string,
  itemId: string,
  raw: string,
  method: ScanMethod,
  participantId?: string,
  opts: { proxyBy?: string } = {},
): Promise<ScanOutcome> => {
  const now = Date.now()
  const item = await db.souvenirs.get(itemId)
  const found = participantId ? { participant: (await db.participants.get(participantId))! } : raw ? await findByCode(raw, method === 'QR') : undefined
  const log = (r: ScanResultType, reason: string, pid: string | null) => logScan(eventId, 'souvenir', raw, method, r, reason, pid)
  if (!item) return { result: 'invalid', reason: '請先設定紀念品', time: now, rawValue: raw }
  const logic = logicOf(item)
  const mine = found?.participant && found.participant.eventId === eventId ? found.participant : undefined
  const { operator, deviceId } = who()
  const left = async () => (item.stock === null ? Infinity : item.stock - (await redeemedQty(item.id)))
  const give = async (pid: string, qty: number, who_: string, couponId?: string) => {
    await db.redemptions.add({
      id: uid(),
      eventId,
      itemId: item.id,
      participantId: pid,
      quantity: qty,
      method,
      time: now,
      deviceId,
      operator,
      kind: 'redeem',
      voided: false,
      ...(couponId ? { couponId } : {}),
      ...(opts.proxyBy ? { proxyBy: opts.proxyBy } : {}),
    })
    await audit(eventId, `領取紀念品 ${item.name} ×${qty}${opts.proxyBy ? `（${opts.proxyBy} 代領）` : ''}`, 'souvenir', item.id, who_)
    await log('valid', '', pid || null)
  }

  // 憑券換領：掃描券上的 QR（或輸入編號）；一券只可換領一次，作廢的券不可用
  if (logic === 'coupon') {
    // 尾券（貼在禮品上，QR 為「編號-T」）：只核對配對，不會派發
    const tail = /-T$/i.test(raw.trim())
    const code = raw.trim().toUpperCase().replace(/-T$/, '')
    const c = code ? await db.coupons.where('code').equals(code).filter((x) => x.eventId === eventId).first() : undefined
    if (!c) {
      await log('invalid', '不是換領券', null)
      return { result: 'invalid', reason: '找不到此換領券 Coupon Not Found', time: now, rawValue: raw }
    }
    if (c.itemId !== item.id) {
      const other = await db.souvenirs.get(c.itemId)
      await log('invalid', '其他禮品的券', null)
      return { result: 'invalid', reason: `這是「${other?.name ?? '其他禮品'}」的換領券`, time: now, rawValue: raw }
    }
    const p = c.participantId ? await db.participants.get(c.participantId) : undefined
    if (c.voided) {
      await log('invalid', '換領券已作廢', p?.id ?? null)
      return { result: 'invalid', reason: '此換領券已作廢 Voided', participant: p, time: now, rawValue: raw }
    }
    const used = await db.redemptions.where('itemId').equals(item.id).filter((r) => r.couponId === c.id && !r.voided).first()
    if (tail) {
      // 尾券：告訴工作人員這件禮品屬於哪一張券／哪一位，以及是否已換領
      const no = c.seq ? `No. ${String(c.seq).padStart(4, '0')}` : `編號 ${c.code}`
      const owner = c.name || (p ? names(p).full : '')
      await log('manual', '尾券核對', p?.id ?? null)
      return {
        result: 'manual',
        reason: `此禮品屬 ${no}${owner ? `（${owner}）` : ''}：${used ? `已於 ${formatTime(used.time)} 換領` : c.voided ? '換領券已作廢' : '尚未換領'}`,
        participant: p,
        time: now,
        souvenir: { item, quantity: used?.quantity ?? perClaimOf(item) },
        rawValue: raw,
      }
    }
    if (used) {
      await log('duplicate', '換領券已用', p?.id ?? null)
      return { result: 'duplicate', reason: `此換領券已於 ${formatTime(used.time)} 換領`, participant: p, time: now, previousTime: used.time, souvenir: { item, quantity: used.quantity }, rawValue: raw }
    }
    const remain = await left()
    if (remain <= 0) {
      await log('out_of_stock', '', p?.id ?? null)
      return { result: 'out_of_stock', reason: '禮物已派發完畢（已售罄）', participant: p, time: now, souvenir: { item, quantity: 0 }, rawValue: raw }
    }
    const qty = Math.min(perClaimOf(item), remain)
    await give(p?.id ?? '', qty, p ? names(p).full : `換領券 ${c.code}`, c.id)
    return { result: 'valid', participant: p, time: now, souvenir: { item, quantity: qty }, rawValue: raw }
  }

  // 限量先到先得：不認人、不查重複，到場核銷即扣庫存，扣完即止
  if (logic === 'fcfs') {
    const remain = await left()
    const p = mine?.status === 'active' ? mine : undefined
    // 有名單（預先輸入／匯入的會員資料）時，掃描只接受名單上的 QR，避免掃到不相關的 QR 也扣庫存
    if (remain > 0 && raw && !participantId && !p) {
      const hasList = (await db.participants.where('eventId').equals(eventId).filter((x) => x.status === 'active' && !x.walkIn).count()) > 0
      if (hasList) {
        await log('invalid', '不在名單上', null)
        return { result: 'invalid', reason: mine ? '此票已取消 Cancelled Ticket' : '此 QR 不在名單上 Not on the list', time: now, rawValue: raw }
      }
    }
    if (remain <= 0) {
      await log('out_of_stock', '', p?.id ?? null)
      return { result: 'out_of_stock', reason: '禮物已派發完畢（已售罄）', participant: p, time: now, souvenir: { item, quantity: 0 }, rawValue: raw }
    }
    // 每日配額：今日已派滿就停（明日再派）
    const todayLeft = item.dailyQuota ? item.dailyQuota - (await givenToday(item.id)) : Infinity
    if (todayLeft <= 0) {
      await log('out_of_stock', '今日配額已滿', p?.id ?? null)
      return { result: 'out_of_stock', reason: `今日配額（${item.dailyQuota} 份）已派完，請明日再來`, participant: p, time: now, souvenir: { item, quantity: 0 }, rawValue: raw }
    }
    const qty = Math.min(perClaimOf(item), remain, todayLeft)
    await give(p?.id ?? '', qty, p ? names(p).full : '')
    return { result: 'valid', participant: p, seats: p ? await seatsFor(p.id) : undefined, time: now, souvenir: { item, quantity: qty }, rawValue: raw }
  }

  if (!mine) {
    await log('invalid', '找不到嘉賓', null)
    return { result: 'invalid', reason: '找不到此邀請 Invitation Not Found', time: now, rawValue: raw }
  }
  const p = mine
  const seats = await seatsFor(p.id)
  if (p.status === 'cancelled') {
    await log('invalid', '已取消', p.id)
    return { result: 'invalid', reason: '此票已取消 Cancelled Ticket', participant: p, time: now, rawValue: raw }
  }
  if (!eligible(item, p)) {
    await log('not_eligible', eligibilityLabel(item.eligibility), p.id)
    return { result: 'not_eligible', reason: `不符合領取資格：${eligibilityLabel(item.eligibility)}`, participant: p, seats, time: now, rawValue: raw }
  }
  const quota = entitlement(item, p)
  let already = await redeemedQty(item.id, p.id)
  // 按請柬派發：同一張請柬任何一位領了，其他同行者不可再領
  if (logic === 'invitation' && already < quota) {
    for (const m of await invitationGroup(p)) {
      if (m.id === p.id) continue
      const last = await db.redemptions.where('participantId').equals(m.id).filter((r) => r.itemId === item.id && !r.voided).last()
      if (last) {
        await log('duplicate', '同組同行者已領取', p.id)
        return {
          result: 'duplicate',
          reason: `同組同行者（${names(m).primary}）已於 ${formatTime(last.time)} 領取，不可重複領取`,
          participant: p,
          seats,
          time: now,
          souvenir: { item, quantity: last.quantity },
          rawValue: raw,
        }
      }
    }
  }
  if (already >= quota) {
    const last = await db.redemptions.where('participantId').equals(p.id).filter((r) => r.itemId === item.id && !r.voided).last()
    await log('duplicate', '', p.id)
    return { result: 'duplicate', reason: '此門票／身分已領取過禮品', participant: p, seats, time: now, previousTime: last?.time, souvenir: { item, quantity: already }, rawValue: raw }
  }
  const qty = quota - already
  const remain = await left()
  if (qty > remain) {
    await log('out_of_stock', '', p.id)
    return { result: 'out_of_stock', reason: remain <= 0 ? '禮物已派發完畢（已售罄）' : `庫存不足（剩 ${remain}）`, participant: p, seats, time: now, souvenir: { item, quantity: qty }, rawValue: raw }
  }
  await give(p.id, qty, names(p).full)
  return { result: 'valid', participant: p, seats, time: now, souvenir: { item, quantity: qty }, rawValue: raw }
}

// 取消某一筆領取紀錄（限量先到先得沒有領取人時使用）
export const undoRedemptionById = async (id: string) => {
  const r = await db.redemptions.get(id)
  if (!r || r.voided) return
  await db.redemptions.update(id, { voided: true })
  const item = await db.souvenirs.get(r.itemId)
  await audit(r.eventId, `取消領取紀念品 ${item?.name ?? ''} ×${r.quantity}`, 'souvenir', r.itemId)
}

// 即場登記領取人並派發：名單上沒有的人，登記後立即領取
// giftOnly：只領禮品（不計入出席、座位及點名）；false = 同時加入嘉賓名單參加活動
export const registerAndRedeem = async (eventId: string, itemId: string, g: GuestInput, method: ScanMethod = 'MANUAL', giftOnly = false): Promise<ScanOutcome> => {
  const now = Date.now()
  const item = await db.souvenirs.get(itemId)
  if (!item) return { result: 'invalid', reason: '請先設定紀念品', time: now, rawValue: '' }
  // 先檢查，避免登記了卻派不到
  if (item.stock !== null && item.stock - (await redeemedQty(item.id)) <= 0)
    return { result: 'out_of_stock', reason: '禮物已派發完畢（已售罄）', time: now, souvenir: { item, quantity: 0 }, rawValue: '' }
  if (logicOf(item) !== 'fcfs' && item.eligibility === 'vip')
    return { result: 'not_eligible', reason: '此禮品只限 VIP，即場登記的人不符合資格（請先在名單把該嘉賓設為 VIP）', time: now, rawValue: '' }
  // 同一個人再次登記（會員編號相同；或姓名＋電話／出生日期相同）：沿用原有紀錄，這樣「已領取」才查得到
  const same = (a: string, b: string) => !!a && !!b && normalize(a) === normalize(b)
  const sameName = (p: Participant) => same(p.name, g.name) || same(p.englishName, g.englishName)
  const all = await db.participants.where('eventId').equals(eventId).filter((p) => p.status === 'active').toArray()
  const existing =
    all.find((p) => same(p.memberId, g.memberId)) ??
    all.find((p) => sameName(p) && (same(p.phone, g.phone) || (!!g.birthDate && p.birthDate === g.birthDate)))
  const p = existing ?? (await saveGuest(eventId, { ...g, walkIn: true, giftOnly: giftOnly || undefined }))
  return verifySouvenir(eventId, itemId, '', method, p.id)
}

export const undoRedemption = async (itemId: string, p: Participant) => {
  const rows = await db.redemptions.where('participantId').equals(p.id).filter((r) => r.itemId === itemId && !r.voided).toArray()
  for (const r of rows) await db.redemptions.update(r.id, { voided: true })
  const item = await db.souvenirs.get(itemId)
  await audit(p.eventId, `取消領取紀念品 ${item?.name ?? ''}`, 'souvenir', itemId, names(p).full)
}

// 今日已派份數（每日配額用；按本機日期）
export const givenToday = async (itemId: string) => {
  const today = toDateKey(new Date())
  const rows = await db.redemptions.where('itemId').equals(itemId).filter((r) => !r.voided && r.kind === 'redeem' && toDateKey(new Date(r.time)) === today).toArray()
  return rows.reduce((a, r) => a + r.quantity, 0)
}

// 先到先得的輕度查重：同一電話是否已領過這款禮品（回傳上次時間）
export const phoneRedeemedAt = async (eventId: string, itemId: string, phone: string) => {
  const ph = phone.replace(/\D/g, '')
  if (ph.length < 6) return null
  const rows = await db.redemptions.where('itemId').equals(itemId).filter((r) => !r.voided && !!r.participantId).toArray()
  for (const r of rows.sort((a, b) => b.time - a.time)) {
    const p = await db.participants.get(r.participantId)
    if (p && p.eventId === eventId && p.phone.replace(/\D/g, '') === ph) return r.time
  }
  return null
}

// 一次派齊：同一位會員把所有按名單派發、符合資格而未領的禮品一次派完
export const verifyAllSouvenirs = async (eventId: string, raw: string, method: ScanMethod, participantId?: string, opts: { proxyBy?: string } = {}): Promise<ScanOutcome> => {
  const now = Date.now()
  const items = (await db.souvenirs.where('eventId').equals(eventId).sortBy('sortOrder')).filter((i) => ['person', 'invitation'].includes(logicOf(i)))
  const found = participantId ? { participant: await db.participants.get(participantId) } : raw ? await findByCode(raw, method === 'QR') : undefined
  const p = found?.participant && found.participant.eventId === eventId ? found.participant : undefined
  if (!p || !items.length) return verifySouvenir(eventId, items[0]?.id ?? '', raw, method, participantId, opts)
  const got: string[] = []
  let qty = 0
  let last: ScanOutcome | null = null
  for (const it of items) {
    if (!eligible(it, p)) continue
    const o = await verifySouvenir(eventId, it.id, raw, method, p.id, opts)
    last = o
    if (o.result === 'valid') {
      got.push(`${it.name} ×${o.souvenir?.quantity ?? 1}`)
      qty += o.souvenir?.quantity ?? 1
    }
  }
  if (!got.length) return last ?? { result: 'not_eligible', reason: '沒有可以領取的禮品', participant: p, time: now, rawValue: raw }
  const pseudo = { ...items[0], name: got.join('、') }
  return { result: 'valid', participant: p, time: now, souvenir: { item: pseudo, quantity: qty }, rawValue: raw }
}

// ---------- 換領券 ----------

// 生成換領券：count = 不記名張數；或 people = 記名（每人一張，印上名字）
export const generateCoupons = async (eventId: string, itemId: string, opt: { count?: number; people?: Participant[] }) => {
  const existing = await db.coupons.where('itemId').equals(itemId).toArray()
  const batch = existing.reduce((m, c) => Math.max(m, c.batch), 0) + 1
  let seq = existing.reduce((m, c) => Math.max(m, c.seq ?? 0), existing.length)
  const taken = new Set((await db.coupons.where('eventId').equals(eventId).toArray()).map((c) => c.code))
  const now = Date.now()
  const make = (p?: Participant): Coupon => {
    let code = randomCode(10)
    while (taken.has(code)) code = randomCode(10)
    taken.add(code)
    return { id: uid(), eventId, itemId, code, batch, seq: ++seq, createdAt: now, ...(p ? { participantId: p.id, name: names(p).full } : {}) }
  }
  const rows = opt.people ? opt.people.map((p) => make(p)) : Array.from({ length: Math.max(0, Math.min(2000, opt.count ?? 0)) }, () => make())
  await db.coupons.bulkAdd(rows)
  const item = await db.souvenirs.get(itemId)
  await audit(eventId, `生成換領券 ${item?.name ?? ''} 第 ${batch} 批 ${rows.length} 張${opt.people ? '（記名）' : ''}`, 'souvenir', itemId)
  return { batch, count: rows.length }
}

export const voidCoupons = async (ids: string[], voided = true) => {
  if (!ids.length) return
  const first = await db.coupons.get(ids[0])
  await db.coupons.bulkUpdate(ids.map((key) => ({ key, changes: { voided } })))
  if (first) await audit(first.eventId, `${voided ? '作廢' : '恢復'}換領券 ${ids.length} 張`, 'souvenir', first.itemId)
}

// ---------- 席 ----------

export const setTableCapacity = async (r: Resource, capacity: number) => {
  const c = Math.max(1, Math.min(30, capacity))
  await db.resources.update(r.id, { capacity: c })
  await audit(r.eventId, `修改第 ${r.label} 席人數為 ${c}`, 'resource', r.id)
}

// ---------- 座位編排（拖拉換位） ----------

export interface SeatTarget {
  resourceId: string
  seatLabel: string
}

// 整理一席的座位號：一票多人佔連續座位；座位衝突的嘉賓讓到第一個空位。priority 的嘉賓優先保留原座位。
const normalizeTable = async (table: Resource, priority: string[]) => {
  const rows = await db.seats.where('resourceId').equals(table.id).toArray()
  const ps = await db.participants.bulkGet(rows.map((r) => r.participantId))
  const items = rows
    .map((r, i) => ({ r, p: ps[i]! }))
    .filter((x) => x.p && x.p.status === 'active')
    .sort((a, b) => Number(priority.includes(b.p.id)) - Number(priority.includes(a.p.id)) || (Number(a.r.seatLabel) || 999) - (Number(b.r.seatLabel) || 999))
  const size = Math.max(table.capacity, items.reduce((n, x) => n + x.p.guestCount, 0))
  const taken = new Array<boolean>(size + 1).fill(false)
  const fits = (start: number, n: number) => start >= 1 && start + n - 1 <= size && Array.from({ length: n }, (_, k) => !taken[start + k]).every(Boolean)
  for (const { r, p } of items) {
    const n = Math.min(p.guestCount, size)
    let start = Number(r.seatLabel)
    if (!fits(start, n)) start = Array.from({ length: size }, (_, k) => k + 1).find((k) => fits(k, n)) ?? Array.from({ length: size }, (_, k) => k + 1).find((k) => !taken[k]) ?? 1
    for (let k = 0; k < n; k++) taken[start + k] = true
    if (String(start) !== r.seatLabel) await db.seats.update(r.id, { seatLabel: String(start) })
  }
}

// 把嘉賓移到某一席的某個座位；目標座位已有人就互相對調。target = null 代表移出（未安排）。
// purpose：'' = 宴會席、'晚餐' = 巴士行程聚餐席。回傳移動前的狀態，用於「復原」。
export const moveSeat = async (eventId: string, pid: string, purpose: string, target: SeatTarget | null) => {
  const tables = await db.resources.where('eventId').equals(eventId).filter((r) => r.type === 'table' && r.purpose === purpose).toArray()
  const ids = new Set(tables.map((t) => t.id))
  const label = (id: string) => tables.find((t) => t.id === id)?.label ?? ''
  const mine = await db.seats.where('participantId').equals(pid).filter((s) => ids.has(s.resourceId)).first()
  const occupant = target
    ? await db.seats
        .where('resourceId')
        .equals(target.resourceId)
        .filter((s) => s.seatLabel === target.seatLabel && s.participantId !== pid)
        .first()
    : undefined
  const affected = [...new Set([mine?.resourceId, target?.resourceId].filter(Boolean) as string[])]
  const before = (await db.seats.where('resourceId').anyOf(affected).toArray()).map((s) => ({ ...s }))
  const pids = [pid, occupant?.participantId].filter(Boolean) as string[]
  const [p, q] = await db.participants.bulkGet(pids)
  const nameOf = (x?: Participant) => (x ? x.englishName || x.name : '')

  await db.transaction('rw', db.seats, db.participants, db.auditLogs, async () => {
    if (occupant) {
      if (mine) await db.seats.update(occupant.id, { resourceId: mine.resourceId, seatLabel: mine.seatLabel })
      else await db.seats.delete(occupant.id)
    }
    if (target) {
      if (mine) await db.seats.update(mine.id, { resourceId: target.resourceId, seatLabel: target.seatLabel })
      else await db.seats.add({ id: uid(), eventId, participantId: pid, resourceId: target.resourceId, seatLabel: target.seatLabel })
    } else if (mine) await db.seats.delete(mine.id)
    for (const tid of affected) await normalizeTable(tables.find((t) => t.id === tid)!, pids)

    const to = target ? `第 ${label(target.resourceId)} 席 ${target.seatLabel} 號` : '未安排'
    const from = mine ? `第 ${label(mine.resourceId)} 席 ${mine.seatLabel} 號` : '未安排'
    await audit(eventId, `調位：${from} → ${to}`, 'participant', pid, nameOf(p))
    if (occupant) await audit(eventId, `調位（對調）：→ ${from}`, 'participant', occupant.participantId, nameOf(q))
  })
  return { pid, affected, before }
}

// ---------- 旅遊模式：房間 ----------

const roomsOf = (eventId: string) => db.resources.where('eventId').equals(eventId).filter((r) => r.type === 'room').toArray()

// 新增房間：預設雙人房；之後人數跟隨實際入住人數
export const addRoom = async (eventId: string, capacity = 2, label = '') => {
  const rooms = await roomsOf(eventId)
  const n = rooms.length + 1
  const room: Resource = { id: uid(), eventId, type: 'room', label: label.trim() || String(n), capacity, purpose: label.trim() ? 'custom' : '', sortOrder: n }
  await db.resources.add(room)
  return room
}

// 房號按次序 1、2、3…；刪除後後面的房間自動補上。用戶自己改過的房號（purpose = 'custom'）不會被改動
const renumberRooms = async (eventId: string) => {
  const rooms = (await roomsOf(eventId)).sort((a, b) => a.sortOrder - b.sortOrder)
  for (const [i, r] of rooms.entries()) {
    const patch = { sortOrder: i + 1, ...(r.purpose === 'custom' ? {} : { label: String(i + 1) }) }
    if (r.sortOrder !== patch.sortOrder || (patch.label && patch.label !== r.label)) await db.resources.update(r.id, patch)
  }
}

// 改房號：改成自訂名稱後不再跟隨次序；清空名稱 = 變回按次序的房號
export const updateRoom = async (room: Resource, patch: { label?: string }) => {
  const label = patch.label?.trim() ?? ''
  await db.resources.update(room.id, label ? { label, purpose: label === String(room.sortOrder) ? '' : 'custom' } : { purpose: '' })
  if (!label) await renumberRooms(room.eventId)
}

export const deleteRoom = async (room: Resource) => {
  await db.seats.where('resourceId').equals(room.id).delete()
  await db.resources.delete(room.id)
  await renumberRooms(room.eventId)
  await audit(room.eventId, `刪除房間 ${room.label}`, 'resource', room.id)
}

// 房間人數跟隨實際入住人數：1 人 = 單人房、2 人 = 雙人房…；空房預設為雙人房
const ROOM_MAX = 6
const fitRoom = async (roomId: string) => {
  const n = await db.seats.where('resourceId').equals(roomId).count()
  await db.resources.update(roomId, { capacity: n || 2 })
}

// 安排某人入住某房間（roomId = null 代表移出）。房間人數會自動調整；超過 6 人會回傳 false
export const assignRoom = async (eventId: string, pid: string, roomId: string | null) => {
  const rooms = await roomsOf(eventId)
  const ids = new Set(rooms.map((r) => r.id))
  const room = rooms.find((r) => r.id === roomId)
  if (roomId && !room) return false
  if (room && (await db.seats.where('resourceId').equals(room.id).filter((s) => s.participantId !== pid).count()) >= ROOM_MAX) return false
  const mine = await db.seats.where('participantId').equals(pid).filter((s) => ids.has(s.resourceId)).toArray()
  if (room && mine.length === 1 && mine[0].resourceId === room.id) return true // 已在這間房
  await db.seats.bulkDelete(mine.map((s) => s.id))
  if (room) await db.seats.add({ id: uid(), eventId, participantId: pid, resourceId: room.id, seatLabel: '' })
  for (const id of new Set([...mine.map((s) => s.resourceId), ...(room ? [room.id] : [])])) await fitRoom(id)
  const p = await db.participants.get(pid)
  await audit(eventId, room ? `安排房間 ${room.label}` : '移出房間', 'participant', pid, p ? names(p).full : '')
  return true
}

// 清空房間：所有人移出（keepRooms = true 保留空房；false = 連房間一併刪除，用於重新安排）
export const clearRooms = async (eventId: string, keepRooms: boolean) => {
  const rooms = await roomsOf(eventId)
  const ids = rooms.map((r) => r.id)
  await db.seats.where('resourceId').anyOf(ids).delete()
  if (keepRooms) for (const id of ids) await db.resources.update(id, { capacity: 2 })
  else await db.resources.bulkDelete(ids)
  await audit(eventId, keepRooms ? `清空房間（${ids.length} 間）` : `刪除全部房間（${ids.length} 間）`, 'event', eventId)
}

// 自動分房：先把「同行人士」安排在同一間房（互相連結的人算一組，最多 4 人一間），優先填滿現有的空房，
// 其餘的人按傳入的次序每兩人一間（最後剩一人就單人一間）。回傳新增的房間數
export const autoAssignRooms = async (eventId: string, pids: string[]) => {
  const want = new Set(pids)
  const all = await db.participants.where('eventId').equals(eventId).toArray()
  // 同行連結（任何一方填了都算）；只考慮這次要分房的人
  const parent = new Map(pids.map((id) => [id, id]))
  const find = (x: string): string => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!))
  for (const p of all) if (p.partnerId && want.has(p.id) && want.has(p.partnerId)) parent.set(find(p.id), find(p.partnerId))
  const groups = new Map<string, string[]>()
  for (const id of pids) groups.set(find(id), [...(groups.get(find(id)) ?? []), id])
  const rooms: string[][] = []
  const singles: string[] = []
  for (const g of groups.values()) {
    if (g.length === 1) singles.push(g[0])
    else for (let i = 0; i < g.length; i += 4) rooms.push(g.slice(i, i + 4))
  }
  // 沒有同行人士的人：同性別的兩人一間（次序不變）；未填性別的另外配對；剩下的單人一間
  const genderOf = new Map(all.map((p) => [p.id, p.gender ?? '']))
  for (const g of ['M', 'F', '']) {
    const same = singles.filter((id) => genderOf.get(id) === g)
    for (let i = 0; i < same.length; i += 2) rooms.push(same.slice(i, i + 2))
  }
  // 先用現有的空房（按房號次序）；已有人入住的房間不會再加人；空房用完才新增房間
  const existing = (await roomsOf(eventId)).sort((a, b) => a.sortOrder - b.sortOrder)
  const empty: Resource[] = []
  for (const r of existing) if ((await db.seats.where('resourceId').equals(r.id).count()) === 0) empty.push(r)
  let created = 0
  for (const members of rooms) {
    let room = empty.shift()
    if (room) await db.resources.update(room.id, { capacity: members.length })
    else {
      room = await addRoom(eventId, members.length)
      created++
    }
    for (const pid of members) await db.seats.add({ id: uid(), eventId, participantId: pid, resourceId: room.id, seatLabel: '' })
  }
  if (rooms.length) await audit(eventId, `自動分房：安排 ${rooms.length} 間房（新增 ${created} 間）`, 'event', eventId)
  return rooms.length
}

// 巴士車位：把乘客移到某架車的某個座位；目標座位有人就對調。回傳移動前的狀態，可用 undoMoveSeat 復原。
export const moveBusSeat = async (eventId: string, pid: string, target: SeatTarget) => {
  const buses = await db.resources.where('eventId').equals(eventId).filter((r) => r.type === 'bus').toArray()
  const ids = new Set(buses.map((b) => b.id))
  const label = (id: string) => buses.find((b) => b.id === id)?.label ?? ''
  const mine = await db.seats.where('participantId').equals(pid).filter((s) => ids.has(s.resourceId)).first()
  const occupant = await db.seats.where('resourceId').equals(target.resourceId).filter((s) => s.seatLabel === target.seatLabel && s.participantId !== pid).first()
  const affected = [...new Set([mine?.resourceId, target.resourceId].filter(Boolean) as string[])]
  const before = (await db.seats.where('resourceId').anyOf(affected).toArray()).map((s) => ({ ...s }))
  const [p, q] = await db.participants.bulkGet([pid, occupant?.participantId].filter(Boolean) as string[])
  await db.transaction('rw', db.seats, db.auditLogs, async () => {
    if (occupant) {
      if (mine) await db.seats.update(occupant.id, { resourceId: mine.resourceId, seatLabel: mine.seatLabel })
      else await db.seats.delete(occupant.id)
    }
    if (mine) await db.seats.update(mine.id, { resourceId: target.resourceId, seatLabel: target.seatLabel })
    else await db.seats.add({ id: uid(), eventId, participantId: pid, resourceId: target.resourceId, seatLabel: target.seatLabel })
    const from = mine ? `${label(mine.resourceId)} 車 ${mine.seatLabel} 號` : '未安排'
    await audit(eventId, `調座位：${from} → ${label(target.resourceId)} 車 ${target.seatLabel} 號`, 'participant', pid, p ? names(p).full : '')
    if (occupant) await audit(eventId, `調座位（對調）：→ ${from}`, 'participant', occupant.participantId, q ? names(q).full : '')
  })
  return { pid, affected, before }
}

export const undoMoveSeat = async (eventId: string, snap: Awaited<ReturnType<typeof moveSeat>>) => {
  await db.transaction('rw', db.seats, db.auditLogs, async () => {
    // 還原受影響的席，並移除被移入的嘉賓在其他席的新位置
    await db.seats.where('resourceId').anyOf(snap.affected).delete()
    const moved = new Set(snap.before.map((s) => s.participantId).concat(snap.pid))
    const stray = await db.seats.where('participantId').anyOf([...moved]).filter((s) => snap.affected.includes(s.resourceId)).toArray()
    await db.seats.bulkDelete(stray.map((s) => s.id))
    await db.seats.bulkPut(snap.before)
    await audit(eventId, '復原調位 Undo', 'participant', snap.pid)
  })
}

export const setVip = async (p: Participant, vip: boolean) => {
  await db.participants.update(p.id, { vip, updatedAt: Date.now() })
  await audit(p.eventId, vip ? '設為 VIP' : '取消 VIP', 'participant', p.id, names(p).full)
}

// ---------- 不記名門票：批量產生 ----------

export const generateTickets = async (eventId: string, opts: { prefix: string; start: number; count: number; guestCount: number }) => {
  const prefix = normalize(opts.prefix)
  const count = Math.max(1, Math.min(5000, Math.floor(opts.count)))
  const width = Math.max(4, String(opts.start + count - 1).length)
  const existing = new Set((await db.tickets.where('eventId').equals(eventId).toArray()).flatMap((t) => [t.qrCode, t.ticketNumber]))
  const takenQr = new Set(existing)
  const now = Date.now()
  const people: Participant[] = []
  const tickets: Ticket[] = []
  let skipped = 0
  for (let n = opts.start; n < opts.start + count; n++) {
    const code = `${prefix ? prefix + '-' : ''}${String(n).padStart(width, '0')}`
    if (existing.has(code)) {
      skipped++
      continue
    }
    const pid = uid()
    people.push({
      id: pid, eventId, name: '', englishName: '', memberId: '', phone: '', company: '', vip: false,
      guestCount: Math.max(1, opts.guestCount || 1), tags: [], dietary: '', remarks: '', status: 'active',
      attendance: 'not_arrived', arrivedCount: 0, checkedInAt: null, checkInMethod: null, manual: false,
      ticketLabel: code, createdAt: now, updatedAt: now,
    })
    // 票號順序易讀（印在門票上）；QR 內容是隨機編號，防止偽造
    let qr = randomCode()
    while (takenQr.has(qr)) qr = randomCode()
    takenQr.add(qr)
    tickets.push({ id: uid(), eventId, participantId: pid, qrCode: qr, invitationId: '', ticketNumber: code, status: 'valid', usedAt: null })
  }
  await db.transaction('rw', db.participants, db.tickets, db.auditLogs, async () => {
    await db.participants.bulkAdd(people)
    await db.tickets.bulkAdd(tickets)
    await audit(eventId, `產生不記名門票 ${people.length} 張`, 'event', eventId, '', people.length ? `${tickets[0].ticketNumber} – ${tickets[tickets.length - 1].ticketNumber}` : '')
  })
  return { created: people.length, skipped, first: tickets[0]?.ticketNumber, last: tickets[tickets.length - 1]?.ticketNumber }
}

export const setRemarks = async (p: Participant, remarks: string) => {
  const r = remarks.trim()
  if (r === (p.remarks || '').trim()) return
  await db.participants.update(p.id, { remarks: r, updatedAt: Date.now() })
  await audit(p.eventId, r ? '修改備註' : '刪除備註', 'participant', p.id, names(p).full, r.slice(0, 60))
}

// ---------- 分拆／合併同行者 ----------

// 由一張多人請柬分拆出一位同行者，成為獨立嘉賓（可獨立安排座位）；留在原本同行的座位上
export const splitCompanion = async (host: Participant) => {
  if (host.guestCount < 2) return null
  const now = Date.now()
  const allArrived = host.arrivedCount >= host.guestCount
  const hostCount = host.guestCount - 1
  const c: Participant = {
    id: uid(),
    eventId: host.eventId,
    name: host.name ? `${host.name}（同行）` : '',
    englishName: host.englishName ? `${host.englishName} (GUEST)` : '',
    memberId: '',
    phone: '',
    company: host.company,
    vip: host.vip,
    guestCount: 1,
    tags: [],
    dietary: '',
    remarks: '',
    status: 'active',
    attendance: allArrived ? 'arrived' : 'not_arrived',
    arrivedCount: allArrived ? 1 : 0,
    checkedInAt: allArrived ? host.checkedInAt : null,
    checkInMethod: allArrived ? host.checkInMethod : null,
    manual: false,
    ticketLabel: !host.name && !host.englishName && host.ticketLabel ? `${host.ticketLabel} 同行` : undefined,
    companionOf: host.id,
    createdAt: now,
    updatedAt: now,
  }
  const hostArrived = Math.min(host.arrivedCount, hostCount)
  await db.transaction('rw', [db.participants, db.tickets, db.seats, db.resources, db.auditLogs], async () => {
    await db.participants.update(host.id, {
      guestCount: hostCount,
      arrivedCount: hostArrived,
      attendance: hostArrived === 0 ? 'not_arrived' : hostArrived >= hostCount ? 'arrived' : 'partial',
      updatedAt: now,
    })
    await db.participants.add(c)
    await db.tickets.add({ id: uid(), eventId: host.eventId, participantId: c.id, qrCode: await uniqueCode(host.eventId), invitationId: '', ticketNumber: '', status: 'valid', usedAt: null })
    // 圍席：同行者留在原請柬座位組的最後一個位置（原本已是同行的座位）
    const seats = await db.seats.where('participantId').equals(host.id).toArray()
    for (const s of seats) {
      const r = await db.resources.get(s.resourceId)
      if (r?.type !== 'table') continue
      const start = Number(s.seatLabel)
      await db.seats.add({ id: uid(), eventId: host.eventId, participantId: c.id, resourceId: s.resourceId, seatLabel: start ? String(start + hostCount) : '' })
    }
    await audit(host.eventId, `分拆同行者（剩 ${hostCount} 位）`, 'participant', host.id, names(host).full)
  })
  return c
}

// 把分拆出來的同行者合併回原請柬
export const mergeCompanion = async (c: Participant) => {
  if (!c.companionOf) return null
  const host = await db.participants.get(c.companionOf)
  if (!host) return null
  const now = Date.now()
  const guestCount = host.guestCount + c.guestCount
  const arrivedCount = host.arrivedCount + c.arrivedCount
  await db.transaction('rw', [db.participants, db.tickets, db.seats, db.attendance, db.redemptions, db.auditLogs], async () => {
    await db.participants.update(host.id, {
      guestCount,
      arrivedCount,
      attendance: arrivedCount === 0 ? 'not_arrived' : arrivedCount >= guestCount ? 'arrived' : 'partial',
      checkedInAt: host.checkedInAt ?? c.checkedInAt,
      updatedAt: now,
    })
    // 紀念品領取紀錄轉回原請柬名下
    const reds = await db.redemptions.where('participantId').equals(c.id).toArray()
    for (const r of reds) await db.redemptions.update(r.id, { participantId: host.id })
    await db.participants.delete(c.id)
    await db.tickets.where('participantId').equals(c.id).delete()
    await db.seats.where('participantId').equals(c.id).delete()
    await db.attendance.where('participantId').equals(c.id).delete()
    await audit(host.eventId, `合併同行者回原請柬（共 ${guestCount} 位）`, 'participant', host.id, names(host).full)
  })
  return host
}

// 換領券券面預設文字（用戶可在禮品設定修改）
export function defaultCouponText(item: SouvenirItem, venue?: string): string {
  const qty = Math.max(1, item.perClaim ?? 1)
  return `憑本券可於${venue || '活動服務台'}領取「${item.name || '禮品'}」${qty} 份。${item.stock !== null ? '數量有限，換完即止。' : ''}`
}
export function defaultCouponNote(eventName: string): string {
  return `※ 每券換領一次，影印無效。${eventName}`
}
