import { db } from '../db/db'
import type {
  CheckIn,
  EventRec,
  Mode,
  Participant,
  Resource,
  ScanLog,
  ScanMethod,
  ScanPurpose,
  ScanResultType,
  SeatAssignment,
  SouvenirItem,
  Ticket,
} from '../db/types'
import { getSettings } from './settings'
import { normalize, uid } from './util'

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

// 用 QR 內容／邀請號／票號／會員號尋找嘉賓
export const findByCode = async (raw: string) => {
  const v = normalize(raw)
  if (!v) return null
  // App 產生的 QR：CKD1|活動代號|門票編號
  const parts = v.split('|')
  const key = parts[0] === 'CKD1' && parts[2] ? parts[2] : v
  const ticket =
    (await db.tickets.where('qrCode').equals(key).first()) ??
    (await db.tickets.where('invitationId').equals(key).first()) ??
    (await db.tickets.where('ticketNumber').equals(key).first())
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

// 入場驗證（QR／文字辨識／手動都經這裏）
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
    found = await findByCode(raw)
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
    const label = kind === 'checkin' ? '入場 Check-In' : kind === 'reentry' ? '再入場 Re-entry' : '手動確認 Manual Override'
    await audit(p.eventId, label, 'participant', p.id, p.englishName || p.name, reason)
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
  await audit(p.eventId, `修改到達人數 ${c}/${p.guestCount}`, 'participant', p.id, p.englishName || p.name)
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
    await audit(p.eventId, '取消入場 Undo Check-In', 'participant', p.id, p.englishName || p.name)
  })
}

// ---------- 嘉賓 ----------

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
  dietary: string
  remarks: string
  tableId: string
  tableSeat: string
  busId: string
  busSeat: string
  dinnerTableId: string
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
  dietary: '',
  remarks: '',
  tableId: '',
  tableSeat: '',
  busId: '',
  busSeat: '',
  dinnerTableId: '',
})

const writeSeats = async (eventId: string, pid: string, g: GuestInput) => {
  await db.seats.where('participantId').equals(pid).delete()
  const rows: SeatAssignment[] = []
  if (g.tableId) rows.push({ id: uid(), eventId, participantId: pid, resourceId: g.tableId, seatLabel: g.tableSeat })
  if (g.dinnerTableId && g.dinnerTableId !== g.tableId)
    rows.push({ id: uid(), eventId, participantId: pid, resourceId: g.dinnerTableId, seatLabel: '' })
  if (g.busId) rows.push({ id: uid(), eventId, participantId: pid, resourceId: g.busId, seatLabel: g.busSeat })
  if (rows.length) await db.seats.bulkAdd(rows)
}

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
    dietary: g.dietary,
    remarks: g.remarks,
    status: existing?.status ?? 'active',
    attendance: existing?.attendance ?? 'not_arrived',
    arrivedCount: existing?.arrivedCount ?? 0,
    checkedInAt: existing?.checkedInAt ?? null,
    checkInMethod: existing?.checkInMethod ?? null,
    manual: existing?.manual ?? false,
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
      qrCode: normalize(g.qrCode) || t?.qrCode || normalize(`Q-${pid.slice(0, 8)}`),
      invitationId: normalize(g.invitationId),
      ticketNumber: t?.ticketNumber ?? '',
      status: t?.status ?? 'valid',
      usedAt: t?.usedAt ?? null,
    }
    await db.tickets.put(ticket)
    await writeSeats(eventId, pid, g)
    await audit(eventId, existing ? '修改嘉賓 Edit Guest' : '新增嘉賓 Add Guest', 'participant', pid, p.englishName || p.name)
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
    tags: p.tags,
    dietary: p.dietary,
    remarks: p.remarks,
    tableId: mainTable?.resource.id ?? '',
    tableSeat: mainTable?.seatLabel ?? '',
    busId: bus?.resource.id ?? '',
    busSeat: bus?.seatLabel ?? '',
    dinnerTableId: dinner?.resource.id ?? '',
  }
}

export const setGuestCancelled = async (p: Participant, cancelled: boolean) => {
  await db.participants.update(p.id, { status: cancelled ? 'cancelled' : 'active', updatedAt: Date.now() })
  const tickets = await db.tickets.where('participantId').equals(p.id).toArray()
  for (const t of tickets)
    await db.tickets.update(t.id, { status: cancelled ? 'cancelled' : t.usedAt ? 'used' : 'valid' })
  await audit(p.eventId, cancelled ? '取消嘉賓 Cancel Guest' : '恢復嘉賓 Restore Guest', 'participant', p.id, p.englishName || p.name)
}

export const deleteGuestPermanently = async (p: Participant) => {
  await db.transaction('rw', [db.participants, db.tickets, db.seats, db.attendance, db.auditLogs], async () => {
    await db.participants.delete(p.id)
    await db.tickets.where('participantId').equals(p.id).delete()
    await db.seats.where('participantId').equals(p.id).delete()
    await db.attendance.where('participantId').equals(p.id).delete()
    await audit(p.eventId, '永久刪除嘉賓 Delete Guest', 'participant', p.id, p.englishName || p.name)
  })
}

// ---------- 活動 ----------

export interface EventInput {
  name: string
  mode: Mode
  type: string
  date: string
  startTime: string
  endTime: string
  venue: string
  notes: string
  tableCount: number
  seatsPerTable: number
  buses: { label: string; capacity: number }[]
  dinnerTables: number
}

const makeCode = (name: string) =>
  (name.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'EV') + Math.floor(Math.random() * 90 + 10)

export const syncResources = async (ev: EventRec) => {
  const existing = await db.resources.where('eventId').equals(ev.id).toArray()
  const want: Omit<Resource, 'id'>[] = []
  if (ev.mode === 'banquet') {
    for (let i = 1; i <= (ev.modeConfig.tableCount ?? 0); i++)
      want.push({ eventId: ev.id, type: 'table', label: String(i).padStart(2, '0'), capacity: ev.modeConfig.seatsPerTable ?? 10, purpose: '', sortOrder: i })
  }
  if (ev.mode === 'bus') {
    ;(ev.modeConfig.buses ?? []).forEach((b, i) =>
      want.push({ eventId: ev.id, type: 'bus', label: b.label, capacity: b.capacity, purpose: '', sortOrder: i }),
    )
    for (let i = 1; i <= (ev.modeConfig.dinnerTables ?? 0); i++)
      want.push({ eventId: ev.id, type: 'table', label: String(i), capacity: 10, purpose: '晚餐', sortOrder: 100 + i })
  }
  const key = (r: { type: string; label: string; purpose: string }) => `${r.type}|${r.purpose}|${r.label}`
  const have = new Map(existing.map((r) => [key(r), r]))
  for (const w of want) {
    const h = have.get(key(w))
    if (h) {
      await db.resources.update(h.id, { capacity: w.capacity, sortOrder: w.sortOrder })
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
    startTime: input.startTime,
    endTime: input.endTime,
    venue: input.venue.trim(),
    notes: input.notes,
    status: existing?.status ?? 'active',
    code: existing?.code ?? makeCode(input.name),
    modeConfig:
      input.mode === 'banquet'
        ? { tableCount: input.tableCount, seatsPerTable: input.seatsPerTable }
        : input.mode === 'bus'
          ? { buses: input.buses.filter((b) => b.label.trim()), dinnerTables: input.dinnerTables }
          : {},
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await db.events.put(ev)
  await syncResources(ev)
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

export const setAttendance = async (sessionId: string, eventId: string, p: Participant, present: boolean) => {
  const { operator, deviceId } = who()
  await db.attendance.put({
    id: `${sessionId}:${p.id}`,
    sessionId,
    eventId,
    participantId: p.id,
    status: present ? 'present' : 'absent',
    checkedAt: Date.now(),
    deviceId,
    operator,
  })
  await audit(eventId, present ? '點名：已到' : '點名：取消', 'attendance', sessionId, p.englishName || p.name)
}

export const deleteSession = async (sessionId: string, eventId: string, name: string) => {
  await db.attendance.where('sessionId').equals(sessionId).delete()
  await db.sessions.delete(sessionId)
  await audit(eventId, `刪除點名 ${name}`, 'session', sessionId)
}

// 在點名中掃描
export const verifyRollCall = async (eventId: string, sessionId: string, raw: string, method: ScanMethod, participantId?: string): Promise<ScanOutcome> => {
  const now = Date.now()
  const found = participantId ? { participant: (await db.participants.get(participantId))! } : await findByCode(raw)
  if (!found?.participant || found.participant.eventId !== eventId) {
    await logScan(eventId, 'rollcall', raw, method, 'invalid', '找不到乘客', null)
    return { result: 'invalid', reason: '找不到此乘客 Passenger Not Found', time: now, rawValue: raw }
  }
  const p = found.participant
  const seats = await seatsFor(p.id)
  const rec = await db.attendance.get(`${sessionId}:${p.id}`)
  if (rec?.status === 'present') {
    await logScan(eventId, 'rollcall', raw, method, 'duplicate', '', p.id)
    return { result: 'duplicate', participant: p, seats, time: now, previousTime: rec.checkedAt, rawValue: raw }
  }
  await setAttendance(sessionId, eventId, p, true)
  await logScan(eventId, 'rollcall', raw, method, 'valid', '', p.id)
  return { result: 'valid', participant: p, seats, time: now, rawValue: raw }
}

// ---------- 紀念品 ----------

export const saveSouvenir = async (item: SouvenirItem) => {
  await db.souvenirs.put(item)
  await audit(item.eventId, `設定紀念品 ${item.name}`, 'souvenir', item.id)
}

export const entitlement = (item: SouvenirItem, p: Participant) => (item.perGuest > 0 ? item.perGuest : p.guestCount)

export const eligible = (item: SouvenirItem, p: Participant) => {
  if (item.eligibility === 'all') return true
  if (item.eligibility === 'vip') return p.vip
  if (item.eligibility.startsWith('tag:')) return p.tags.includes(item.eligibility.slice(4))
  return true
}

export const eligibilityLabel = (e: string) =>
  e === 'all' ? '所有人' : e === 'vip' ? '只限 VIP' : e.startsWith('tag:') ? `只限「${e.slice(4)}」` : e

export const redeemedQty = async (itemId: string, participantId?: string) => {
  const rows = participantId
    ? await db.redemptions.where('participantId').equals(participantId).filter((r) => r.itemId === itemId).toArray()
    : await db.redemptions.where('itemId').equals(itemId).toArray()
  return rows.filter((r) => !r.voided && r.kind === 'redeem').reduce((a, r) => a + r.quantity, 0)
}

export const verifySouvenir = async (eventId: string, itemId: string, raw: string, method: ScanMethod, participantId?: string): Promise<ScanOutcome> => {
  const now = Date.now()
  const item = await db.souvenirs.get(itemId)
  const found = participantId ? { participant: (await db.participants.get(participantId))! } : await findByCode(raw)
  const log = (r: ScanResultType, reason: string, pid: string | null) => logScan(eventId, 'souvenir', raw, method, r, reason, pid)
  if (!item) return { result: 'invalid', reason: '請先設定紀念品', time: now, rawValue: raw }
  if (!found?.participant || found.participant.eventId !== eventId) {
    await log('invalid', '找不到嘉賓', null)
    return { result: 'invalid', reason: '找不到此邀請 Invitation Not Found', time: now, rawValue: raw }
  }
  const p = found.participant
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
  const already = await redeemedQty(item.id, p.id)
  if (already >= quota) {
    const last = await db.redemptions.where('participantId').equals(p.id).filter((r) => r.itemId === item.id && !r.voided).last()
    await log('duplicate', '', p.id)
    return { result: 'duplicate', participant: p, seats, time: now, previousTime: last?.time, souvenir: { item, quantity: already }, rawValue: raw }
  }
  const qty = quota - already
  if (item.stock !== null) {
    const used = await redeemedQty(item.id)
    if (used + qty > item.stock) {
      await log('out_of_stock', '', p.id)
      return { result: 'out_of_stock', reason: `庫存已用完（剩 ${Math.max(0, item.stock - used)}）`, participant: p, seats, time: now, souvenir: { item, quantity: qty }, rawValue: raw }
    }
  }
  const { operator, deviceId } = who()
  await db.redemptions.add({ id: uid(), eventId, itemId: item.id, participantId: p.id, quantity: qty, time: now, deviceId, operator, kind: 'redeem', voided: false })
  await audit(eventId, `領取紀念品 ${item.name} ×${qty}`, 'souvenir', item.id, p.englishName || p.name)
  await log('valid', '', p.id)
  return { result: 'valid', participant: p, seats, time: now, souvenir: { item, quantity: qty }, rawValue: raw }
}

export const undoRedemption = async (itemId: string, p: Participant) => {
  const rows = await db.redemptions.where('participantId').equals(p.id).filter((r) => r.itemId === itemId && !r.voided).toArray()
  for (const r of rows) await db.redemptions.update(r.id, { voided: true })
  const item = await db.souvenirs.get(itemId)
  await audit(p.eventId, `取消領取紀念品 ${item?.name ?? ''}`, 'souvenir', itemId, p.englishName || p.name)
}
