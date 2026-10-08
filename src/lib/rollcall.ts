import type { AttendanceRecord, AttendanceSession, Participant, RollStatus } from '../db/types'

// 點名的共用規則（點名頁、點名列表、統計頁都用同一套，數字才會一致）
// 每架車分開點名、分開「確認出發」；沒有安排巴士的人歸入「未分車」（key = 'none'）

export const NO_BUS = 'none'

// 這架車（或未分車）是否已確認出發；舊資料的 closedAt = 所有車一起結束
export const busClosedAt = (s: AttendanceSession, busKey: string) => s.closedBuses?.[busKey] ?? s.closedAt
export const isBusClosed = (s: AttendanceSession, busKey: string) => !!busClosedAt(s, busKey)

// 要點名的人：未取消、不是只領禮品；中途離開的人只有在這次點名已有紀錄時才計算
export const rollPeople = <T extends { p: Participant }>(list: T[], recs: Map<string, AttendanceRecord>) =>
  list.filter((e) => e.p.status === 'active' && !e.p.giftOnly && (!e.p.leftAt || recs.has(e.p.id)))

// 每人狀態：沒有紀錄 = 點名中「待上車」；所屬車已出發 = 「未到」
export const rollStatus = (rec: AttendanceRecord | undefined, closed: boolean): RollStatus | 'pending' =>
  !rec || rec.status === 'absent' ? (closed ? 'no_show' : 'pending') : rec.status

export const rollCounts = (passengers: Participant[], session: AttendanceSession, recs: AttendanceRecord[], busOf: (pid: string) => string = () => NO_BUS) => {
  const map = new Map(recs.filter((r) => r.sessionId === session.id).map((r) => [r.participantId, r]))
  const people = rollPeople(passengers.map((p) => ({ p })), map)
  const c = { total: people.length, present: 0, pending: 0, on_the_way: 0, excused: 0, no_show: 0 }
  const groups = new Set<string>()
  for (const { p } of people) {
    const b = busOf(p.id)
    groups.add(b)
    c[rollStatus(map.get(p.id), isBusClosed(session, b))]++
  }
  const closedGroups = [...groups].filter((b) => isBusClosed(session, b)).length
  // 應到 = 全部 − 請假；全部到齊 = 應到的人都已上車
  return {
    ...c,
    expected: c.total - c.excused,
    done: c.total > 0 && c.present === c.total - c.excused,
    closed: groups.size > 0 && closedGroups === groups.size,
    partlyClosed: closedGroups > 0 && closedGroups < groups.size,
  }
}

// 一行摘要：例如「已上車 73 / 77 · 待上車 3 · 在途中 1 · 請假 1」
export const rollSummary = (c: ReturnType<typeof rollCounts>) =>
  [
    `已上車 ${c.present} / ${c.expected}${c.done ? ' ✓' : ''}`,
    !c.done && c.pending ? `待上車 ${c.pending}` : '',
    !c.done && c.no_show ? `未到 ${c.no_show}` : '',
    c.on_the_way ? `在途中 ${c.on_the_way}` : '',
    c.excused ? `請假 ${c.excused}` : '',
    c.closed ? '全部已出發' : c.partlyClosed ? '部分已出發' : '',
  ]
    .filter(Boolean)
    .join(' · ')
