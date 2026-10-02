import type { AttendanceRecord, AttendanceSession, Participant, RollStatus } from '../db/types'

// 點名的共用規則（點名頁、點名列表、統計頁都用同一套，數字才會一致）
// 要點名的人：未取消、不是只領禮品；中途離開的人只有在這次點名已有紀錄時才計算
export const rollPeople = <T extends { p: Participant }>(list: T[], recs: Map<string, AttendanceRecord>) =>
  list.filter((e) => e.p.status === 'active' && !e.p.giftOnly && (!e.p.leftAt || recs.has(e.p.id)))

// 每人狀態：沒有紀錄 = 進行中「待上車」；點名已結束 = 「未到」（例如結束後才加入名單的人）
export const rollStatus = (rec: AttendanceRecord | undefined, closed: boolean): RollStatus | 'pending' =>
  !rec || rec.status === 'absent' ? (closed ? 'no_show' : 'pending') : rec.status

export const rollCounts = (passengers: Participant[], session: AttendanceSession, recs: AttendanceRecord[]) => {
  const map = new Map(recs.filter((r) => r.sessionId === session.id).map((r) => [r.participantId, r]))
  const people = rollPeople(passengers.map((p) => ({ p })), map)
  const c = { total: people.length, present: 0, pending: 0, on_the_way: 0, excused: 0, no_show: 0 }
  for (const { p } of people) c[rollStatus(map.get(p.id), !!session.closedAt)]++
  // 應到 = 全部 − 請假；全部到齊 = 應到的人都已上車
  return { ...c, expected: c.total - c.excused, done: c.total > 0 && c.present === c.total - c.excused }
}

// 一行摘要：例如「已上車 73 / 應到 77 · 待上車 3 · 在途中 1」
export const rollSummary = (c: ReturnType<typeof rollCounts>, closed: boolean) =>
  [
    `已上車 ${c.present} / ${c.expected}${c.done ? ' ✓' : ''}`,
    c.done ? '' : closed ? `未到 ${c.no_show}` : c.pending ? `待上車 ${c.pending}` : '',
    c.on_the_way ? `在途中 ${c.on_the_way}` : '',
    c.excused ? `請假 ${c.excused}` : '',
    closed ? '已結束' : '',
  ]
    .filter(Boolean)
    .join(' · ')
