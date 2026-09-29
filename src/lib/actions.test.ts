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
import { buildIndex, fuzzyMatch, nameIdConflict, nameMismatch } from './search'
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
