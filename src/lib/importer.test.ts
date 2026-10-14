import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, allTables } from '../db/db'
import { saveEvent, type EventInput } from './actions'
import { buildRows, guessMapping, importRows, parseCsv, parseDate } from './importer'

const kit = (f: string) => parseCsv(readFileSync(new URL(`../../test-kit/${f}`, import.meta.url), 'utf8')).filter((r) => r.some(Boolean))

const ev = (mode: EventInput['mode'], extra: Partial<EventInput> = {}): EventInput => ({
  name: 'T',
  mode,
  type: 'x',
  date: '2026-10-20',
  endDate: '',
  startTime: '18:30',
  endTime: '22:00',
  venue: '',
  notes: '',
  tableCount: 0,
  seatsPerTable: 10,
  buses: [],
  dinnerTables: 0,
  dinnerSeats: 12,
  anonymous: false,
  ...extra,
})

const ctxOf = async (eventId: string) => {
  const e = (await db.events.get(eventId))!
  const [participants, tickets, resources, seats] = await Promise.all([
    db.participants.where('eventId').equals(eventId).toArray(),
    db.tickets.where('eventId').equals(eventId).toArray(),
    db.resources.where('eventId').equals(eventId).toArray(),
    db.seats.where('eventId').equals(eventId).toArray(),
  ])
  return { ev: e, participants, tickets, resources, seats }
}

beforeEach(async () => {
  for (const t of allTables()) await t.clear()
})

describe('匯入名單', () => {
  it('CSV：引號、逗號、換行、BOM', () => {
    expect(parseCsv('﻿a,b\r\n1,"CHAN, TAI ""MAN"""\n2,"x\ny"')).toEqual([
      ['a', 'b'],
      ['1', 'CHAN, TAI "MAN"'],
      ['2', 'x\ny'],
    ])
  })
  it('日期：香港日／月／年及各種寫法', () => {
    expect(parseDate('31/1/1985')).toBe('1985-01-31')
    expect(parseDate('1985.01.01')).toBe('1985-01-01')
    expect(parseDate('2030-12-31')).toBe('2030-12-31')
    expect(parseDate('亂寫')).toBe(null)
  })
  it('宴會：自動對應欄位、同行人數、席號（不足自動加席）、飲食要求', async () => {
    const t = kit('2-宴會-周年晚宴.csv')
    const e = await saveEvent(ev('banquet', { tableCount: 2 }))
    const map = guessMapping(t[0], 'banquet')
    expect(map).toEqual(['code', 'name', 'englishName', 'phone', 'table', 'seat', 'companions', 'tags'])
    const rows = buildRows(t, map, await ctxOf(e.id))
    expect(rows).toHaveLength(40)
    expect(rows.every((r) => !r.errors.length)).toBe(true)
    expect(rows[0]).toMatchObject({ code: 'D001', name: '黃學霖', englishName: 'WONG HOK LAM', table: '01', seat: '1', guestCount: 1 })
    const res = await importRows(e, rows, 'update')
    expect(res.added).toBe(40)
    const after = await ctxOf(e.id)
    expect(after.ev.modeConfig.tableCount).toBeGreaterThan(2) // 名單有第 3 席以上 → 自動加席
    expect(after.participants.some((p) => p.tags.includes('素食'))).toBe(true)
    expect(after.participants.some((p) => p.guestCount === 2)).toBe(true)
    expect(await db.seats.where('eventId').equals(e.id).count()).toBe(40)
    expect(after.tickets.find((x) => x.invitationId === 'D001')!.qrCode).toBe('D001')
    // 再匯入同一個檔：全部「已在名單」，略過不會重複
    const again = buildRows(t, map, after)
    expect(again.every((r) => r.existingId)).toBe(true)
    expect((await importRows(after.ev, again, 'skip')).skipped).toBe(40)
    expect(await db.participants.where('eventId').equals(e.id).count()).toBe(40)
  })
  it('旅遊：車、座位「3C」、性別、同行人士互相連結、身份證只存頭 4 位', async () => {
    const t = kit('3-旅遊-東京團.csv')
    const e = await saveEvent(ev('bus', { buses: [{ label: 'A', capacity: 45 }, { label: 'B', capacity: 45 }] }))
    const map = guessMapping(t[0], 'bus')
    expect(map.slice(0, 11)).toEqual(['code', 'name', 'englishName', 'gender', 'phone', 'bus', 'seat', 'partner', 'idPrefix', 'permitNo', 'permitExpiry'])
    t[1][8] = 'Z101234(5)' // 完整身份證號碼也只保存頭 4 位
    const rows = buildRows(t, map, await ctxOf(e.id))
    expect(rows.filter((r) => r.errors.length)).toEqual([])
    expect(rows[0]).toMatchObject({ bus: 'A', busSeat: '1', gender: 'M', idPrefix: 'Z101' })
    expect(rows[2].busSeat).toBe('3') // 1C = 第 1 排第 3 個
    await importRows(e, rows, 'update')
    const ps = await db.participants.where('eventId').equals(e.id).toArray()
    const byName = (n: string) => ps.find((p) => p.name === n)!
    expect(byName('黃家豪').partnerId).toBe(byName('黃小芳').id)
    expect(byName('黃小芳').partnerId).toBe(byName('黃家豪').id)
    expect(ps.every((p) => !p.idPrefix || p.idPrefix.length <= 4)).toBe(true)
    // 另一份名單想坐已有人的位：提示，只分車不分座位
    const t2 = [t[0], ['X001', '新團員', '', '', '', 'A', '1A', '', '', '', '', '']]
    const r2 = buildRows(t2, map, await ctxOf(e.id))
    expect(r2[0].busSeat).toBe('')
    expect(r2[0].warnings.join()).toMatch(/已有黃家豪/)
  })
  it('禮品：會員編號就是會員卡 QR；可領禮品變成禮物組別；沒有姓名的行標紅', async () => {
    const t = kit('4-禮品-會員派發日.csv')
    t.push(['M9999', '', '', '', ''])
    const e = await saveEvent(ev('gift'))
    const map = guessMapping(t[0], 'gift')
    expect(map).toEqual(['memberId', 'name', 'englishName', 'phone', 'giftGroups'])
    const rows = buildRows(t, map, await ctxOf(e.id))
    expect(rows.at(-1)!.errors).toContain('沒有姓名')
    const res = await importRows(e, rows, 'update')
    expect(res).toMatchObject({ added: 40, failed: 1 })
    const tk = await db.tickets.where('eventId').equals(e.id).toArray()
    expect(tk.some((x) => x.qrCode === 'M0001')).toBe(true)
    const p = await db.participants.where('memberId').equals('M0001').first()
    expect(p!.giftGroups).toEqual(['會員紀念品'])
  })
  it('活動：沒有席號欄；檔案內編號重複 → 第二行標紅', async () => {
    const t = kit('1-活動-會員講座.csv')
    t.push([...t[1]])
    const e = await saveEvent(ev('event'))
    const map = guessMapping(t[0], 'event')
    expect(map).toEqual(['code', 'name', 'englishName', 'phone', 'company', 'vip', 'remarks'])
    const rows = buildRows(t, map, await ctxOf(e.id))
    expect(rows.at(-1)!.errors[0]).toMatch(/重複/)
  })
})
