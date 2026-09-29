import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, allTables } from '../db/db'
import {
  emptyGuest,
  generateTickets,
  moveSeat,
  saveEvent,
  undoMoveSeat,
  saveGuest,
  saveSouvenir,
  setGuestCancelled,
  undoCheckIn,
  verifyCheckIn,
  verifySouvenir,
  type EventInput,
} from './actions'
import { buildIndex, fuzzyMatch } from './search'
import { uid } from './util'

const ev = (name: string): EventInput => ({
  name,
  mode: 'banquet',
  type: 'Dinner',
  date: '2026-10-20',
  startTime: '18:30',
  endTime: '22:00',
  venue: 'Hall',
  notes: '',
  tableCount: 2,
  seatsPerTable: 10,
  buses: [],
  dinnerTables: 0,
  dinnerSeats: 12,
  anonymous: false,
})

const guest = (eventId: string, name: string, qr: string, extra: Partial<ReturnType<typeof emptyGuest>> = {}) =>
  saveGuest(eventId, { ...emptyGuest(), englishName: name, qrCode: qr, ...extra })

beforeEach(async () => {
  for (const t of allTables()) await t.clear()
})

describe('簽到驗證', () => {
  it('有效 → 重複 → 取消簽到後再有效', async () => {
    const e = await saveEvent(ev('A'))
    await guest(e.id, 'CHAN TAI MAN', 'A-001')
    expect((await verifyCheckIn(e.id, 'a-001', 'QR')).result).toBe('valid')
    const dup = await verifyCheckIn(e.id, 'A-001', 'QR')
    expect(dup.result).toBe('duplicate')
    expect(dup.previousTime).toBeTypeOf('number')
    await undoCheckIn(dup.participant!)
    expect((await verifyCheckIn(e.id, 'A-001', 'QR')).result).toBe('valid')
  })

  it('找不到、其他活動、已取消都是無效', async () => {
    const a = await saveEvent(ev('A'))
    const b = await saveEvent(ev('B'))
    await guest(b.id, 'WONG MAN', 'B-001')
    const c = await guest(a.id, 'LEE SIU MING', 'A-002')
    expect((await verifyCheckIn(a.id, 'NOPE', 'QR')).result).toBe('invalid')
    const wrong = await verifyCheckIn(a.id, 'B-001', 'QR')
    expect(wrong.result).toBe('invalid')
    expect(wrong.otherEventName).toBe('B')
    await setGuestCancelled(c, true)
    const cancelled = await verifyCheckIn(a.id, 'A-002', 'QR')
    expect(cancelled.result).toBe('invalid')
    expect(cancelled.reason).toContain('取消')
  })

  it('可用邀請編號和會員編號簽到（全形、大小寫、空格都可以）', async () => {
    const e = await saveEvent(ev('A'))
    await guest(e.id, 'CHAN TAI MAN', 'Q1', { invitationId: 'VIP-A0265', memberId: '0265' })
    expect((await verifyCheckIn(e.id, ' vip-ａ0265 ', 'OCR')).result).toBe('valid')
    expect((await verifyCheckIn(e.id, '0265', 'MANUAL')).result).toBe('duplicate')
  })

  it('一票多人：簽到時預設全數到齊', async () => {
    const e = await saveEvent(ev('A'))
    await guest(e.id, 'CHAN', 'Q2', { guestCount: 2 })
    const r = await verifyCheckIn(e.id, 'Q2', 'QR')
    expect(r.participant!.arrivedCount).toBe(2)
    expect(r.participant!.attendance).toBe('arrived')
  })

  it('每次簽到都寫入操作紀錄和掃描紀錄', async () => {
    const e = await saveEvent(ev('A'))
    await guest(e.id, 'CHAN', 'Q3')
    await verifyCheckIn(e.id, 'Q3', 'QR')
    await verifyCheckIn(e.id, 'Q3', 'QR')
    expect(await db.scanLogs.count()).toBe(2)
    expect((await db.auditLogs.toArray()).some((l) => l.action.startsWith('簽到'))).toBe(true)
  })
})

describe('紀念品', () => {
  it('跟嘉賓人數領取、重複、資格、庫存', async () => {
    const e = await saveEvent(ev('A'))
    await guest(e.id, 'CHAN', 'S1', { guestCount: 2 })
    await guest(e.id, 'WONG', 'S2')
    await guest(e.id, 'LEE', 'S3', { vip: true })
    const bag = { id: uid(), eventId: e.id, name: 'Bag', stock: 3, perGuest: 0, eligibility: 'all', sortOrder: 1 }
    const gift = { id: uid(), eventId: e.id, name: 'Gift', stock: null, perGuest: 1, eligibility: 'vip', sortOrder: 2 }
    await saveSouvenir(bag)
    await saveSouvenir(gift)

    const r1 = await verifySouvenir(e.id, bag.id, 'S1', 'QR')
    expect(r1.result).toBe('valid')
    expect(r1.souvenir!.quantity).toBe(2)
    expect((await verifySouvenir(e.id, bag.id, 'S1', 'QR')).result).toBe('duplicate')
    expect((await verifySouvenir(e.id, bag.id, 'S2', 'QR')).result).toBe('valid')
    expect((await verifySouvenir(e.id, bag.id, 'S3', 'QR')).result).toBe('out_of_stock')

    expect((await verifySouvenir(e.id, gift.id, 'S2', 'QR')).result).toBe('not_eligible')
    expect((await verifySouvenir(e.id, gift.id, 'S3', 'QR')).result).toBe('valid')
  })

  it('領取紀念品不會改變簽到狀態', async () => {
    const e = await saveEvent(ev('A'))
    const p = await guest(e.id, 'CHAN', 'S9')
    const bag = { id: uid(), eventId: e.id, name: 'Bag', stock: null, perGuest: 1, eligibility: 'all', sortOrder: 1 }
    await saveSouvenir(bag)
    await verifySouvenir(e.id, bag.id, 'S9', 'QR')
    expect((await db.participants.get(p.id))!.attendance).toBe('not_arrived')
  })
})

describe('文字辨識近似搜尋', () => {
  it('認錯字仍能找到正確嘉賓', async () => {
    const e = await saveEvent(ev('A'))
    await guest(e.id, 'CHAN TAI MAN', 'F1', { invitationId: 'VIP-A0265' })
    await guest(e.id, 'CHAN MEI LING', 'F2')
    await guest(e.id, 'WONG MAN', 'F3')
    const [ps, ts, ss, rs] = await Promise.all([db.participants.toArray(), db.tickets.toArray(), db.seats.toArray(), db.resources.toArray()])
    const index = buildIndex(ps, ts, ss, rs)

    const m1 = fuzzyMatch(index, 'CHAN TAl MAN')
    expect(m1[0].entry.p.englishName).toBe('CHAN TAI MAN')
    expect(m1[0].score).toBeGreaterThanOrEqual(0.9)

    const m2 = fuzzyMatch(index, 'VIP-AO265') // O 當成 0
    expect(m2[0].entry.p.englishName).toBe('CHAN TAI MAN')

    expect(fuzzyMatch(index, 'CHAN').length).toBeGreaterThanOrEqual(2)
    expect(fuzzyMatch(index, 'HELLO WORLD')).toHaveLength(0)
  })
})

describe('座位編排', () => {
  it('移到空位、對調、移出、復原', async () => {
    const e = await saveEvent(ev('A'))
    const [t1, t2] = (await db.resources.where('eventId').equals(e.id).sortBy('sortOrder'))
    const a = await guest(e.id, 'A', 'M1', { tableId: t1.id, tableSeat: '1' })
    const b = await guest(e.id, 'B', 'M2', { tableId: t2.id, tableSeat: '5' })
    const seatOf = async (pid: string) => {
      const s = await db.seats.where('participantId').equals(pid).first()
      return s ? `${s.resourceId === t1.id ? 1 : 2}-${s.seatLabel}` : 'none'
    }
    await moveSeat(e.id, a.id, '', { resourceId: t1.id, seatLabel: '3' })
    expect(await seatOf(a.id)).toBe('1-3')

    const snap = await moveSeat(e.id, a.id, '', { resourceId: t2.id, seatLabel: '5' })
    expect(await seatOf(a.id)).toBe('2-5')
    expect(await seatOf(b.id)).toBe('1-3') // 對調

    await undoMoveSeat(e.id, snap)
    expect(await seatOf(a.id)).toBe('1-3')
    expect(await seatOf(b.id)).toBe('2-5')

    await moveSeat(e.id, b.id, '', null)
    expect(await seatOf(b.id)).toBe('none')
    expect((await db.auditLogs.toArray()).some((l) => l.action.startsWith('調位'))).toBe(true)
  })
  it('一票兩位移入時，旁邊的嘉賓自動讓位並保存；復原後全部還原', async () => {
    const e = await saveEvent(ev('A'))
    const [t1, t2] = await db.resources.where('eventId').equals(e.id).sortBy('sortOrder')
    const pair = await guest(e.id, 'PAIR', 'P1', { tableId: t2.id, tableSeat: '1', guestCount: 2 })
    const c = await guest(e.id, 'C', 'P2', { tableId: t1.id, tableSeat: '3' })
    const seat = async (pid: string) => (await db.seats.where('participantId').equals(pid).first())!.seatLabel
    const snap = await moveSeat(e.id, pair.id, '', { resourceId: t1.id, seatLabel: '2' })
    expect(await seat(pair.id)).toBe('2')
    expect(await seat(c.id)).not.toBe('3') // 3 號由同行者佔用，C 讓位
    await undoMoveSeat(e.id, snap)
    expect(await seat(c.id)).toBe('3')
    const back = await db.seats.where('participantId').equals(pair.id).first()
    expect(back!.resourceId).toBe(t2.id)
  })
})

describe('不記名門票', () => {
  it('批量產生、以票號簽到、重複票號會略過', async () => {
    const e = await saveEvent({ ...ev('C'), mode: 'event', anonymous: true })
    const r = await generateTickets(e.id, { prefix: 'abc', start: 1, count: 50, guestCount: 1 })
    expect(r).toMatchObject({ created: 50, skipped: 0, first: 'ABC-0001', last: 'ABC-0050' })
    const again = await generateTickets(e.id, { prefix: 'ABC', start: 45, count: 10, guestCount: 1 })
    expect(again).toMatchObject({ created: 4, skipped: 6 })

    const ok = await verifyCheckIn(e.id, 'abc-0007', 'QR')
    expect(ok.result).toBe('valid')
    expect(ok.participant!.ticketLabel).toBe('ABC-0007')
    expect((await verifyCheckIn(e.id, 'ABC-0007', 'QR')).result).toBe('duplicate')
    const { names } = await import('./names')
    expect(names(ok.participant!).primary).toBe('門票 ABC-0007')
  })
})
