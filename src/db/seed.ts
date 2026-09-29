import { db, allTables } from './db'
import type {
  AttendanceRecord,
  AttendanceSession,
  CheckIn,
  EventRec,
  Participant,
  Resource,
  SeatAssignment,
  SouvenirItem,
  SouvenirRedemption,
  Ticket,
} from './types'
import { addDays, todayKey, uid } from '../lib/util'
import { getSettings } from '../lib/settings'

// 示範資料：全部是虛構人物。用固定亂數種子，每次產生的資料都一樣，方便測試。
let seed = 20260929
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]

const SURNAMES: [string, string][] = [
  ['CHAN', '陳'], ['WONG', '黃'], ['LEE', '李'], ['CHEUNG', '張'], ['LAU', '劉'], ['HO', '何'],
  ['NG', '吳'], ['LAM', '林'], ['TSANG', '曾'], ['LEUNG', '梁'], ['YIP', '葉'], ['CHOW', '周'],
  ['KWOK', '郭'], ['TANG', '鄧'], ['MAK', '麥'], ['FUNG', '馮'], ['SO', '蘇'], ['LO', '盧'],
]
const GIVEN: [string, string][] = [
  ['TAI MAN', '大文'], ['SIU MING', '小明'], ['MEI LING', '美玲'], ['KA YAN', '嘉欣'], ['WING SZE', '詠詩'],
  ['CHI KEUNG', '志強'], ['HOI YAN', '凱欣'], ['KA HO', '家豪'], ['PUI SHAN', '佩珊'], ['WAI MAN', '偉文'],
  ['SUK FAN', '淑芬'], ['KIN WAI', '健偉'], ['YUEN TING', '婉婷'], ['CHUN HEI', '俊曦'], ['MAN', '敏'],
  ['TSZ CHING', '芷晴'], ['HOK LAM', '學霖'], ['LOK YIN', '樂賢'], ['SIU FONG', '小芳'], ['TAI', '泰'],
  ['WING KIN', '永健'], ['MEI KUEN', '美娟'], ['CHUN YIP', '俊業'], ['SZE WAN', '思韻'], ['KWOK WAI', '國偉'],
  ['YAN TING', '欣婷'], ['KA LOK', '家樂'], ['PUI YEE', '佩儀'], ['HO YIN', '浩然'], ['WAI LING', '慧玲'],
  ['CHI HO', '志豪'], ['MAN YEE', '敏儀'], ['TSZ HIN', '梓軒'], ['LAI KUEN', '麗娟'], ['KIN MAN', '健文'],
  ['HIU TUNG', '曉彤'], ['SHING', '成'], ['YUK LING', '玉玲'], ['WAI KIT', '偉傑'], ['CHING YI', '靜儀'],
]
const COMPANIES = ['ABC Holdings', '明日科技', 'Sunrise Trading', '海港物流', 'Kowloon Bank', '青山設計', 'Pacific Media', '']
const TAGS = ['輪椅', '素食', '需協助', '重要嘉賓', '傳譯']

// 同一個活動內不重複姓名（示範資料用；真實名單可以有同名，App 會以編號分辨）
const usedNames = new Set<string>()
const makePerson = (i: number, eventId: string, now: number): Participant => {
  let [se, sc] = pick(SURNAMES)
  let [ge, gc] = pick(GIVEN)
  for (let tries = 0; usedNames.has(sc + gc) && tries < 200; tries++) {
    ;[se, sc] = pick(SURNAMES)
    ;[ge, gc] = pick(GIVEN)
  }
  usedNames.add(sc + gc)
  const r = rand()
  return {
    id: uid(),
    eventId,
    name: sc + gc,
    englishName: `${se} ${ge}`,
    memberId: String(1000 + i).padStart(4, '0'),
    phone: `9${Math.floor(rand() * 9000000 + 1000000)}`,
    company: pick(COMPANIES),
    vip: r < 0.08,
    guestCount: rand() < 0.15 ? 2 : 1,
    tags: rand() < 0.1 ? [pick(TAGS)] : [],
    dietary: rand() < 0.07 ? '素食' : '',
    remarks: '',
    status: 'active',
    attendance: 'not_arrived',
    arrivedCount: 0,
    checkedInAt: null,
    checkInMethod: null,
    manual: false,
    createdAt: now,
    updatedAt: now,
  }
}

interface Build {
  event: EventRec
  people: Participant[]
  tickets: Ticket[]
  resources: Resource[]
  seats: SeatAssignment[]
  checkins: CheckIn[]
}

const buildEvent = (
  base: Omit<EventRec, 'id' | 'createdAt' | 'updatedAt'>,
  count: number,
  arriveRate: number,
  arriveWindowMin: number,
): Build => {
  const now = Date.now()
  const event: EventRec = { ...base, id: uid(), createdAt: now, updatedAt: now }
  const { deviceId } = getSettings()
  usedNames.clear()
  const people: Participant[] = []
  const tickets: Ticket[] = []
  const checkins: CheckIn[] = []
  for (let i = 1; i <= count; i++) {
    const p = makePerson(i, event.id, now)
    if (rand() < 0.02) p.status = 'cancelled'
    const code = `${event.code}-${String(i).padStart(4, '0')}`
    const t: Ticket = {
      id: uid(),
      eventId: event.id,
      participantId: p.id,
      qrCode: code,
      invitationId: `${p.vip ? 'VIP' : 'INV'}-${String.fromCharCode(65 + (i % 6))}${String(i).padStart(4, '0')}`,
      ticketNumber: `T${String(i).padStart(5, '0')}`,
      status: p.status === 'cancelled' ? 'cancelled' : 'valid',
      usedAt: null,
    }
    if (p.status === 'active' && rand() < arriveRate) {
      const time = now - Math.floor(rand() * arriveWindowMin * 60000)
      p.attendance = 'arrived'
      p.arrivedCount = p.guestCount
      p.checkedInAt = time
      p.checkInMethod = rand() < 0.85 ? 'QR' : rand() < 0.5 ? 'OCR' : 'SEARCH'
      p.manual = p.checkInMethod === 'SEARCH'
      t.status = 'used'
      t.usedAt = time
      checkins.push({
        id: uid(), eventId: event.id, participantId: p.id, ticketId: t.id, time, method: p.checkInMethod,
        deviceId, operator: pick(['Kevin', 'Amy', 'Ben']), kind: 'checkin', reason: '', voided: false, count: p.guestCount,
      })
    }
    people.push(p)
    tickets.push(t)
  }
  return { event, people, tickets, resources: [], seats: [], checkins }
}

const save = async (b: Build) => {
  await db.events.add(b.event)
  await db.participants.bulkAdd(b.people)
  await db.tickets.bulkAdd(b.tickets)
  await db.resources.bulkAdd(b.resources)
  await db.seats.bulkAdd(b.seats)
  await db.checkins.bulkAdd(b.checkins)
}

export const seedDemo = async () => {
  seed = 20260929
  const today = todayKey()
  const now = Date.now()
  const { deviceId } = getSettings()

  await db.transaction('rw', allTables(), async () => {
    // 🍽 今日宴會
    const dinner = buildEvent(
      { name: 'Annual Dinner 2026', mode: 'banquet', type: 'Annual Dinner', date: today, startTime: '18:30', endTime: '22:30',
        venue: 'Grand Ballroom', notes: '示範資料', status: 'active', code: 'AD26', modeConfig: { tableCount: 20, seatsPerTable: 12 } },
      170, 0.62, 80,
    )
    // 固定測試嘉賓：CHAN TAI MAN · VIP-A0265（如隨機名單已有同名，先改走）
    const star = dinner.people[0]
    const clash = dinner.people.find((p, i) => i > 0 && p.name === '陳大文')
    if (clash) Object.assign(clash, { name: '陳大明', englishName: 'CHAN TAI MING' })
    Object.assign(star, { name: '陳大文', englishName: 'CHAN TAI MAN', memberId: '0265', vip: true, guestCount: 1, status: 'active',
      attendance: 'not_arrived', arrivedCount: 0, checkedInAt: null, checkInMethod: null, manual: false, tags: ['重要嘉賓'] })
    Object.assign(dinner.tickets[0], { invitationId: 'VIP-A0265', status: 'valid', usedAt: null })
    dinner.checkins = dinner.checkins.filter((c) => c.participantId !== star.id)
    for (let t = 1; t <= 20; t++)
      dinner.resources.push({ id: uid(), eventId: dinner.event.id, type: 'table', label: String(t).padStart(2, '0'), capacity: 12, purpose: '', sortOrder: t })
    let seatCursor = 0
    for (const p of dinner.people) {
      if ((seatCursor % 12) + p.guestCount > 12) seatCursor += 12 - (seatCursor % 12) // 一票多人不跨席
      const table = dinner.resources[Math.floor(seatCursor / 12) % 20]
      dinner.seats.push({ id: uid(), eventId: dinner.event.id, participantId: p.id, resourceId: table.id, seatLabel: String((seatCursor % 12) + 1) })
      seatCursor += p.guestCount
    }
    await save(dinner)
    const bag: SouvenirItem = { id: uid(), eventId: dinner.event.id, name: '帆布袋 Tote Bag', stock: 250, perGuest: 0, eligibility: 'all', sortOrder: 1 }
    const vipGift: SouvenirItem = { id: uid(), eventId: dinner.event.id, name: 'VIP 禮盒 Gift Box', stock: 20, perGuest: 1, eligibility: 'vip', sortOrder: 2 }
    await db.souvenirs.bulkAdd([bag, vipGift])
    const reds: SouvenirRedemption[] = dinner.people
      .filter((p) => p.attendance === 'arrived' && rand() < 0.5)
      .map((p) => ({ id: uid(), eventId: dinner.event.id, itemId: bag.id, participantId: p.id, quantity: p.guestCount, time: (p.checkedInAt ?? now) + 60000, deviceId, operator: 'Amy', kind: 'redeem', voided: false }))
    await db.redemptions.bulkAdd(reds)

    // 🚌 今日巴士
    const tour = buildEvent(
      { name: 'Tokyo Tour · Day 3', mode: 'bus', type: 'Tour', date: today, startTime: '08:00', endTime: '20:00',
        venue: 'Hotel Gracery Lobby', notes: '示範資料', status: 'active', code: 'TKY3',
        modeConfig: { buses: [{ label: 'A', capacity: 45 }, { label: 'B', capacity: 45 }], dinnerTables: 8, dinnerSeats: 12 } },
      80, 0.95, 600,
    )
    const busA: Resource = { id: uid(), eventId: tour.event.id, type: 'bus', label: 'A', capacity: 45, purpose: '', sortOrder: 0 }
    const busB: Resource = { id: uid(), eventId: tour.event.id, type: 'bus', label: 'B', capacity: 45, purpose: '', sortOrder: 1 }
    tour.resources.push(busA, busB)
    for (let t = 1; t <= 8; t++)
      tour.resources.push({ id: uid(), eventId: tour.event.id, type: 'table', label: String(t), capacity: 12, purpose: '晚餐', sortOrder: 100 + t })
    tour.people.forEach((p, i) => {
      p.guestCount = 1
      if (p.arrivedCount) p.arrivedCount = 1
      const bus = i < 42 ? busA : busB
      tour.seats.push({ id: uid(), eventId: tour.event.id, participantId: p.id, resourceId: bus.id, seatLabel: String((i % 42) + 1) })
      tour.seats.push({ id: uid(), eventId: tour.event.id, participantId: p.id, resourceId: tour.resources[2 + (i % 8)].id, seatLabel: String(Math.floor(i / 8) + 1) })
    })
    tour.checkins.forEach((c) => (c.count = 1))
    await save(tour)
    const active = tour.people.filter((p) => p.status === 'active')
    const sessions: [string, string, string, number][] = [
      ['酒店出發 Hotel Departure', '08:00', 'Hotel Gracery', 1],
      ['淺草寺集合 Asakusa Meeting', '11:30', '雷門', 0.99],
      ['午餐後出發 Lunch Departure', '13:30', '淺草', 0.92],
    ]
    for (const [name, time, location, rate] of sessions) {
      const s: AttendanceSession = { id: uid(), eventId: tour.event.id, name, time, location, notes: '', createdAt: now }
      await db.sessions.add(s)
      const recs: AttendanceRecord[] = active
        .filter(() => rand() < rate)
        .map((p) => ({ id: `${s.id}:${p.id}`, sessionId: s.id, eventId: tour.event.id, participantId: p.id, status: 'present', checkedAt: now - Math.floor(rand() * 3600000), deviceId, operator: 'Kevin' }))
      await db.attendance.bulkAdd(recs)
    }

    // 🎭 下星期活動（未開始）
    const concert = buildEvent(
      { name: 'ABC Concert 2026', mode: 'event', type: 'Concert', date: addDays(today, 13), startTime: '19:30', endTime: '22:00',
        venue: 'Star Hall', notes: '示範資料（不記名門票）', status: 'active', code: 'ABC26', modeConfig: { anonymous: true } },
      500, 0, 0,
    )
    // 不記名門票：只有頭 8 張（VIP）記名，其餘只顯示票號
    concert.people.forEach((p, i) => {
      if (i < 8) return Object.assign(p, { vip: true })
      Object.assign(p, { name: '', englishName: '', memberId: '', phone: '', company: '', vip: false, tags: [], dietary: '', ticketLabel: concert.tickets[i].qrCode })
      concert.tickets[i].invitationId = ''
    })
    await save(concert)

    // 🍽 已完成活動
    const gala = buildEvent(
      { name: 'Spring Gala 2026', mode: 'banquet', type: 'Gala', date: addDays(today, -30), startTime: '19:00', endTime: '23:00',
        venue: 'Harbour Hotel', notes: '示範資料', status: 'completed', code: 'SG26', modeConfig: { tableCount: 12, seatsPerTable: 12 } },
      110, 0.9, 120,
    )
    for (let t = 1; t <= 12; t++)
      gala.resources.push({ id: uid(), eventId: gala.event.id, type: 'table', label: String(t).padStart(2, '0'), capacity: 12, purpose: '', sortOrder: t })
    await save(gala)

    // 📦 已封存
    const old = buildEvent(
      { name: 'Staff Training Day', mode: 'event', type: 'Company Event', date: addDays(today, -75), startTime: '09:30', endTime: '17:00',
        venue: 'Office 12/F', notes: '示範資料', status: 'archived', code: 'STD', modeConfig: {} },
      40, 0.85, 60,
    )
    await save(old)
  })
}

export const ensureSeeded = async () => {
  try {
    if (localStorage.getItem('ckd-seeded')) return
  } catch {
    /* ignore */
  }
  if ((await db.events.count()) === 0) await seedDemo()
  try {
    localStorage.setItem('ckd-seeded', '1')
  } catch {
    /* ignore */
  }
}

export const resetDemo = async () => {
  await db.transaction('rw', allTables(), async () => {
    for (const t of allTables()) await t.clear()
  })
  await seedDemo()
}

export const clearAll = async () => {
  await db.transaction('rw', allTables(), async () => {
    for (const t of allTables()) await t.clear()
  })
}
