import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, allTables } from '../db/db'
import {
  emptyGuest,
  generateTickets,
  mergeCompanion,
  registerAndRedeem,
  splitCompanion,
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
import { buildIndex, extractFields, fuzzyMatch, nameIdConflict, nameMismatch } from './search'
import { ageFromBirth, uid } from './util'
import { computeStats } from './hooks'
import { busRows } from './busLayout'

const ev = (name: string): EventInput => ({
  name,
  mode: 'banquet',
  type: 'Dinner',
  date: '2026-10-20',
  endDate: '',
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

  it('QR 掃描只接受 QR 編號，會員編號印成 QR 會被拒絕', async () => {
    const e = await saveEvent(ev('Q'))
    await guest(e.id, 'CHAN', '', { memberId: '5566' })
    const t = (await db.tickets.toArray())[0]
    expect(t.qrCode).toHaveLength(8)
    expect((await verifyCheckIn(e.id, '5566', 'QR')).result).toBe('invalid')
    expect((await verifyCheckIn(e.id, t.qrCode, 'QR')).result).toBe('valid')
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

describe('紀念品派發方式', () => {
  it('按人頭：每人 X 份，一票多人按人數', async () => {
    const e = await saveEvent(ev('A'))
    await guest(e.id, 'CHAN', 'P1', { guestCount: 2 })
    const it1 = { id: uid(), eventId: e.id, name: 'A', stock: null, perGuest: 0, logic: 'person' as const, perClaim: 2, eligibility: 'all', sortOrder: 1 }
    await saveSouvenir(it1)
    const r = await verifySouvenir(e.id, it1.id, 'P1', 'QR')
    expect(r.souvenir!.quantity).toBe(4)
    const again = await verifySouvenir(e.id, it1.id, 'P1', 'QR')
    expect(again.result).toBe('duplicate')
    expect(again.reason).toContain('已領取過禮品')
  })

  it('按請柬：同行者任何一位領了，其他人不可再領', async () => {
    const e = await saveEvent(ev('A'))
    const host = await guest(e.id, 'CHAN', 'I1', { guestCount: 3 })
    const c = (await splitCompanion(host))!
    const it1 = { id: uid(), eventId: e.id, name: 'A', stock: null, perGuest: 0, logic: 'invitation' as const, perClaim: 1, eligibility: 'all', sortOrder: 1 }
    await saveSouvenir(it1)
    const r = await verifySouvenir(e.id, it1.id, '', 'SEARCH', c.id)
    expect(r.result).toBe('valid')
    expect(r.souvenir!.quantity).toBe(1)
    const r2 = await verifySouvenir(e.id, it1.id, 'I1', 'QR')
    expect(r2.result).toBe('duplicate')
    expect(r2.reason).toContain('同組同行者')
  })

  it('限量先到先得：不認人、可重複、派完即止', async () => {
    const e = await saveEvent({ ...ev('G'), mode: 'gift' })
    await guest(e.id, 'CHAN', 'F9')
    const it1 = { id: uid(), eventId: e.id, name: 'A', stock: 3, perGuest: 0, logic: 'fcfs' as const, perClaim: 1, eligibility: 'all', sortOrder: 1 }
    await saveSouvenir(it1)
    expect((await verifySouvenir(e.id, it1.id, 'F9', 'QR')).result).toBe('valid')
    expect((await verifySouvenir(e.id, it1.id, 'F9', 'QR')).result).toBe('valid')
    expect((await verifySouvenir(e.id, it1.id, '', 'MANUAL')).result).toBe('valid')
    const out = await verifySouvenir(e.id, it1.id, 'UNKNOWN', 'QR')
    expect(out.result).toBe('out_of_stock')
    expect(out.reason).toContain('已派發完畢')
  })

  it('即場登記並派發：身份證只保存頭 4 位', async () => {
    const e = await saveEvent({ ...ev('G'), mode: 'gift' })
    const it1 = { id: uid(), eventId: e.id, name: 'A', stock: null, perGuest: 0, logic: 'person' as const, perClaim: 1, eligibility: 'all', sortOrder: 1 }
    await saveSouvenir(it1)
    const o = await registerAndRedeem(e.id, it1.id, { ...emptyGuest(), name: '陳小明', idPrefix: 'a123456(7)', age: '40' })
    expect(o.result).toBe('valid')
    expect(o.participant!.idPrefix).toBe('A123')
    expect((await db.redemptions.toArray())[0].method).toBe('MANUAL')
  })
})

describe('即場登記的邏輯', () => {
  it('同一位會員再次登記：沿用原有紀錄，按人頭不可重複領', async () => {
    const e = await saveEvent({ ...ev('G'), mode: 'gift' })
    const it1 = { id: uid(), eventId: e.id, name: 'A', stock: null, perGuest: 0, logic: 'person' as const, perClaim: 1, eligibility: 'all', sortOrder: 1 }
    await saveSouvenir(it1)
    expect((await registerAndRedeem(e.id, it1.id, { ...emptyGuest(), name: '陳小明', memberId: 'M001' })).result).toBe('valid')
    expect((await registerAndRedeem(e.id, it1.id, { ...emptyGuest(), name: '陳小明', memberId: 'm001' })).result).toBe('duplicate')
    expect(await db.participants.count()).toBe(1)
  })
  it('已派完：不會新增領取人', async () => {
    const e = await saveEvent({ ...ev('G'), mode: 'gift' })
    const it1 = { id: uid(), eventId: e.id, name: 'A', stock: 0, perGuest: 0, logic: 'person' as const, perClaim: 1, eligibility: 'all', sortOrder: 1 }
    await saveSouvenir(it1)
    expect((await registerAndRedeem(e.id, it1.id, { ...emptyGuest(), name: '陳小明' })).result).toBe('out_of_stock')
    expect(await db.participants.count()).toBe(0)
  })
})

describe('只領禮品與名單上的 QR', () => {
  it('即場登記「只領禮品」不計入出席人數；「參加活動」會計入', async () => {
    const e = await saveEvent(ev('A'))
    await guest(e.id, 'CHAN', 'K1')
    const it1 = { id: uid(), eventId: e.id, name: 'A', stock: null, perGuest: 0, logic: 'person' as const, perClaim: 1, eligibility: 'all', sortOrder: 1 }
    await saveSouvenir(it1)
    await registerAndRedeem(e.id, it1.id, { ...emptyGuest(), name: '只領' }, 'MANUAL', true)
    expect(computeStats(await db.participants.toArray()).total).toBe(1)
    await registerAndRedeem(e.id, it1.id, { ...emptyGuest(), name: '參加' }, 'MANUAL', false)
    expect(computeStats(await db.participants.toArray()).total).toBe(2)
  })
  it('先到先得：有名單時只接受名單上的 QR；沒有名單時任何 QR 都可以', async () => {
    const e = await saveEvent({ ...ev('G'), mode: 'gift' })
    const it1 = { id: uid(), eventId: e.id, name: 'A', stock: null, perGuest: 0, logic: 'fcfs' as const, perClaim: 1, eligibility: 'all', sortOrder: 1 }
    await saveSouvenir(it1)
    expect((await verifySouvenir(e.id, it1.id, 'ANYTHING', 'QR')).result).toBe('valid')
    await guest(e.id, 'CHAN', 'L1')
    const bad = await verifySouvenir(e.id, it1.id, 'ANYTHING', 'QR')
    expect(bad.result).toBe('invalid')
    expect(bad.reason).toContain('不在名單上')
    expect((await verifySouvenir(e.id, it1.id, 'L1', 'QR')).result).toBe('valid')
    expect((await verifySouvenir(e.id, it1.id, '', 'MANUAL')).result).toBe('valid')
  })
  it('宴會不跨日', async () => {
    const e = await saveEvent({ ...ev('A'), endDate: '2026-10-25' })
    expect(e.endDate).toBeUndefined()
    const g = await saveEvent({ ...ev('G'), mode: 'gift', endDate: '2026-10-25' })
    expect(g.endDate).toBe('2026-10-25')
  })
})

describe('巴士座位排列', () => {
  it('常見車型的排數及最後一排', () => {
    const r49 = busRows(49, '2+2')
    expect(r49.length).toBe(12)
    expect(r49[0]).toEqual([1, 2, null, 3, 4])
    expect(r49[11]).toEqual([45, 46, 47, 48, 49])
    const r61 = busRows(61, '3+2')
    expect(r61[0]).toEqual([1, 2, 3, null, 4, 5])
    expect(r61[r61.length - 1]).toEqual([56, 57, 58, 59, 60, 61])
    const r19 = busRows(19, '2+1')
    expect(r19[r19.length - 1]).toEqual([16, 17, 18, 19])
    expect(busRows(45, '2+2').flat().filter((n) => n).length).toBe(45)
    expect(busRows(30, '2+2').flat().filter((n) => n).length).toBe(30)
  })
})

describe('證件文字抽取', () => {
  it('抽出姓名、出生日期、身份證頭 4 位、會員編號', () => {
    const f = extractFields('姓名 陳大文\nCHAN TAI MAN\n出生日期 25-12-1990\nA123456(7)\n會員編號: M00123')
    expect(f.name).toBe('陳大文')
    expect(f.englishName).toBe('CHAN TAI MAN')
    expect(f.birthDate).toBe('1990-12-25')
    expect(f.idPrefix).toBe('A123')
    expect(f.memberId).toBe('M00123')
  })
  it('香港身份證版面：不把中文電碼當電話、不把簽發日期當出生日期', () => {
    const f = extractFields(
      '香港永久性居民身份證\nHONG KONG PERMANENT IDENTITY CARD\n李 智 能\nLEE, Chi Nan\n2621 2535 5174\n出生日期 Date of Birth\n01-01-1985  男 M\n***AZ\n簽發日期 Date of Issue\n(01-79) 26-11-18\nZ683365(5)',
    )
    expect(f.name).toBe('李智能')
    expect(f.englishName).toBe('LEE CHI NAN')
    expect(f.birthDate).toBe('1985-01-01')
    expect(f.idPrefix).toBe('Z683')
    expect(f.phone).toBe('')
    expect(f.memberId).toBe('')
  })
  it('回鄉證版面：取出生日期而不是有效期；證件號碼 H＋8 位', () => {
    const f = extractFields(
      '港澳居民來往內地通行證\n姓名 陳大文\nCHAN, TAI MAN\n出生日期 1980.01.01\n性別 男\n有效期限 2013.01.02-2023.01.01\n簽發機關 公安部出入境管理局\n證件號碼 H12345678 01',
    )
    expect(f.name).toBe('陳大文')
    expect(f.englishName).toBe('CHAN TAI MAN')
    expect(f.birthDate).toBe('1980-01-01')
    expect(f.permitNo).toBe('H12345678')
    expect(f.permitExpiry).toBe('2023-01-01')
    expect(f.idPrefix).toBe('')
    expect(f.phone).toBe('')
  })
  it('沒有「出生」標籤時取最早的日期；括號認錯仍讀到身份證號碼', () => {
    const f = extractFields('王小明\nWONG, SIU MING\n15-08-2019\n03-02-1972\nA123456 [7]')
    expect(f.birthDate).toBe('1972-02-03')
    expect(f.idPrefix).toBe('A123')
  })
  it('頂部證件名稱被認錯時，仍取英文姓名上方的中文姓名', () => {
    const f = extractFields('甘澳 居民 來往 內地 通行 讓\n陳大文\nCHAN, TAI MAN\n1980.01.01\nH12345678')
    expect(f.name).toBe('陳大文')
    expect(f.englishName).toBe('CHAN TAI MAN')
  })
  it('複姓的英文姓名（AU YEUNG, Wai Shan）', () => {
    const f = extractFields('歐陽慧珊\nAU YEUNG, Wai Shan\n2962 7122 1979 3790\n23-07-1992\nY123456(A)')
    expect(f.englishName).toBe('AU YEUNG WAI SHAN')
    expect(f.name).toBe('歐陽慧珊')
    expect(f.idPrefix).toBe('Y123')
  })
  it('只有會員證：姓名＋編號', () => {
    const f = extractFields('MEMBER NO. VIP-A0265\n何浩然')
    expect(f.name).toBe('何浩然')
    expect(f.memberId).toBe('VIPA0265')
    expect(f.birthDate).toBe('')
  })
})

describe('年齡計算', () => {
  it('由出生日期計算年齡（生日未到要減一歲）', () => {
    const now = new Date(2026, 8, 30)
    expect(ageFromBirth('1986-09-30', now)).toBe('40')
    expect(ageFromBirth('1986-10-01', now)).toBe('39')
    expect(ageFromBirth('', now)).toBe('')
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

    // QR 內容是隨機 8 位編號；把票號直接印成 QR（偽造）會被拒絕
    const t7 = (await db.tickets.where('ticketNumber').equals('ABC-0007').first())!
    expect(t7.qrCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/)
    expect((await verifyCheckIn(e.id, 'ABC-0007', 'QR')).result).toBe('invalid')
    const ok = await verifyCheckIn(e.id, t7.qrCode.toLowerCase(), 'QR')
    expect(ok.result).toBe('valid')
    expect(ok.participant!.ticketLabel).toBe('ABC-0007')
    // 工作人員手動輸入票號仍可找到（重複）
    expect((await verifyCheckIn(e.id, 'ABC-0007', 'MANUAL')).result).toBe('duplicate')
    const { names } = await import('./names')
    expect(names(ok.participant!).primary).toBe('門票 ABC-0007')
  })
})

describe('文字辨識：姓名與編號', () => {
  const setup = async () => {
    const e = await saveEvent(ev('D'))
    await guest(e.id, 'HO HO YIN', 'N1', { name: '何浩然', invitationId: 'INV-E0064', memberId: '1064' })
    await guest(e.id, 'LAM KIN WAI', 'N2', { name: '林健偉', invitationId: 'INV-E0016', memberId: '1016' })
    await guest(e.id, 'TSANG PUI YEE', 'N3', { name: '曾佩儀', invitationId: 'INV-E0046', memberId: '1046' })
    const [ps, ts] = await Promise.all([db.participants.toArray(), db.tickets.toArray()])
    return buildIndex(ps, ts, [], [])
  }

  it('連標籤一起辨識（例如「邀請編號 INV-E0064」）仍找到正確嘉賓', async () => {
    const idx = await setup()
    const m = fuzzyMatch(idx, '姓名 何浩然 · HO HO YIN 邀請編號 INV-E0064')
    expect(m[0].entry.p.name).toBe('何浩然')
    expect(m[0].field).toBe('姓名＋編號')
    expect(m[1]?.score ?? 0).toBeLessThan(0.9)
    expect(nameIdConflict(m)).toBe(false)
  })

  it('中文名連在標籤後面（沒有空格）亦可辨識', async () => {
    const idx = await setup()
    expect(fuzzyMatch(idx, '姓名何浩然')[0].entry.p.name).toBe('何浩然')
  })

  it('姓名與編號指向不同的人時提示核對', async () => {
    const idx = await setup()
    const m = fuzzyMatch(idx, '何浩然 HO HO YIN INV-E0016')
    expect(nameIdConflict(m)).toBe(true)
    const who = m.slice(0, 2).map((x) => x.entry.p.name).sort()
    expect(who).toEqual(['何浩然', '林健偉'].sort())
  })
  it('編號吻合但卡上姓名屬於名單以外的人：提示姓名不符', async () => {
    const idx = await setup()
    const text = '> 取消入場 Undo 何小明.HO SIU MING INV-E0016 1016 AD26-0016'
    const m = fuzzyMatch(idx, text)
    expect(m[0].entry.p.name).toBe('林健偉')
    expect(nameMismatch(m, text)).toBe(true)
    // 只有編號、沒有姓名的門票：不需提示
    expect(nameMismatch(fuzzyMatch(idx, 'INV-E0016'), 'INV-E0016')).toBe(false)
    // 姓名與編號都吻合：不需提示
    const ok = '取消簽到 林健偉 LAM KIN WAI INV-E0016'
    expect(nameMismatch(fuzzyMatch(idx, ok), ok)).toBe(false)
  })
  it('名字的一部分剛好是另一位嘉賓的名字時，完整吻合的人排第一', async () => {
    const e = await saveEvent(ev('E'))
    await guest(e.id, 'FUNG MAN', 'P1', { name: '馮敏' })
    await guest(e.id, 'FUNG MAN YEE', 'P2', { name: '馮敏儀' })
    const [ps, ts] = await Promise.all([db.participants.where('eventId').equals(e.id).toArray(), db.tickets.toArray()])
    const idx = buildIndex(ps, ts, [], [])
    const m = fuzzyMatch(idx, '姓名 馮敏儀')
    expect(m[0].entry.p.name).toBe('馮敏儀')
    expect(m[0].score).toBe(1)
    expect(m.find((x) => x.entry.p.name === '馮敏')!.score).toBeLessThan(1)
  })
})

describe('文字辨識：按類型嚴格比對', () => {
  it('編號只接受完全相同；姓名差一字須同姓；不會列出離譜的建議', async () => {
    const e = await saveEvent(ev('S'))
    await guest(e.id, 'HO SIU MING', 'S1', { name: '何小明', memberId: '1075', invitationId: 'INV-D0075' })
    await guest(e.id, 'WONG SIU MING', 'S2', { name: '黃小明', memberId: '1076', invitationId: 'INV-D0076' })
    await guest(e.id, 'LEE TAI', 'S3', { name: '李泰', memberId: '2001' })
    const [ps, ts] = await Promise.all([db.participants.where('eventId').equals(e.id).toArray(), db.tickets.toArray()])
    const idx = buildIndex(ps, ts, [], [])
    const names = (t: string) => fuzzyMatch(idx, t).map((m) => m.entry.p.name)

    expect(names('會員編號 1075')).toEqual(['何小明']) // 1076 不會出現
    expect(names('1077')).toEqual([]) // 相似但不同的編號：找不到
    expect(names('何小明')[0]).toBe('何小明')
    expect(names('何小明')).not.toContain('黃小明') // 不同姓
    expect(names('何小朋')).toEqual(['何小明']) // 同姓只差一字：作後備
    expect(names('WONG SIU MlNG')[0]).toBe('黃小明') // 英文名一個字母認錯
    expect(names('HO TAI MAN')).toEqual([]) // 英文名只有部分相同：不計
  })
})

describe('示範資料', () => {
  it('每次產生的名單完全相同（不同裝置重設後名單一致）', async () => {
    const { resetDemo } = await import('../db/seed')
    const snapshot = async () => {
      const [evs, ps, ts] = await Promise.all([db.events.toArray(), db.participants.toArray(), db.tickets.toArray()])
      const code = new Map(evs.map((e) => [e.id, e.code]))
      const tBy = new Map(ts.map((t) => [t.participantId, t]))
      return ps.map((p) => `${code.get(p.eventId)}|${p.name}|${p.englishName}|${p.memberId}|${tBy.get(p.id)?.qrCode}|${tBy.get(p.id)?.invitationId}`).sort()
    }
    await resetDemo()
    const a = await snapshot()
    await resetDemo()
    const b = await snapshot()
    expect(a.length).toBeGreaterThan(800)
    expect(b).toEqual(a)
  })
})


describe('文字掃描框', () => {
  it('只取主要的一組文字，背景零碎字不計', async () => {
    const { mainTextCluster } = await import('./textbox')
    const name = { x0: 100, y0: 200, x1: 500, y1: 250, conf: 90 }
    const id = { x0: 100, y0: 270, x1: 380, y1: 310, conf: 88 }
    const noise = { x0: 20, y0: 900, x1: 60, y1: 915, conf: 60 } // 遠處細小的字
    expect(mainTextCluster([noise, name, id])).toEqual({ x0: 100, y0: 200, x1: 500, y1: 310 })
  })
  it('細微差異不移動；明顯移動才平滑跟上；移到別處直接跳過去', async () => {
    const { smoothBox } = await import('./textbox')
    const a = { x0: 100, y0: 100, x1: 500, y1: 300 }
    expect(smoothBox(a, { x0: 104, y0: 98, x1: 503, y1: 302 })).toBe(a)
    const moved = smoothBox(a, { x0: 160, y0: 130, x1: 560, y1: 330 })
    expect(moved.x0).toBe(130)
    const far = { x0: 700, y0: 900, x1: 900, y1: 1000 }
    expect(smoothBox(a, far)).toBe(far)
  })
})

describe('分拆同行者', () => {
  it('分拆後留在原座位、原請柬人數減少；原請柬嘉賓簽到時同行者一同簽到；可合併回原請柬', async () => {
    const e = await saveEvent(ev('SP'))
    const [t1] = await db.resources.where('eventId').equals(e.id).sortBy('sortOrder')
    const host = await guest(e.id, 'CHAN PUI YEE', 'H1', { name: '陳佩儀', guestCount: 2, tableId: t1.id, tableSeat: '3' })
    const c = (await splitCompanion(host))!
    expect(c.name).toBe('陳佩儀（同行）')
    expect(c.companionOf).toBe(host.id)
    expect((await db.participants.get(host.id))!.guestCount).toBe(1)
    const cSeat = await db.seats.where('participantId').equals(c.id).first()
    expect(cSeat).toMatchObject({ resourceId: t1.id, seatLabel: '4' })
    const cTicket = (await db.tickets.where('participantId').equals(c.id).first())!
    expect(cTicket.qrCode).toHaveLength(8)

    // 掃描原請柬：同行者一同簽到
    const r = await verifyCheckIn(e.id, 'H1', 'QR')
    expect(r.result).toBe('valid')
    expect((await db.participants.get(c.id))!.attendance).toBe('arrived')

    // 合併回原請柬
    await mergeCompanion((await db.participants.get(c.id))!)
    const h = (await db.participants.get(host.id))!
    expect(h.guestCount).toBe(2)
    expect(h.arrivedCount).toBe(2)
    expect(await db.participants.get(c.id)).toBeUndefined()
  })
})
