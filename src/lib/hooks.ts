import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { EventRec, Participant } from '../db/types'
import { buildIndex } from './search'
import { pct } from './util'

// 資料一改動，所有使用這些 hook 的畫面會自動更新（即時統計的基礎）

// undefined = 載入中；null = 找不到（例如活動已刪除，或示範資料已重新產生）
export const useEvent = (id: string | undefined) =>
  useLiveQuery(async () => (id ? ((await db.events.get(id)) ?? null) : null), [id])

export const useEventData = (eventId: string | undefined) => {
  const data = useLiveQuery(async () => {
    if (!eventId) return null
    const [participants, tickets, seats, resources] = await Promise.all([
      db.participants.where('eventId').equals(eventId).toArray(),
      db.tickets.where('eventId').equals(eventId).toArray(),
      db.seats.where('eventId').equals(eventId).toArray(),
      db.resources.where('eventId').equals(eventId).toArray(),
    ])
    resources.sort((a, b) => a.sortOrder - b.sortOrder)
    return { participants, tickets, seats, resources }
  }, [eventId])
  const index = useMemo(
    () => (data ? buildIndex(data.participants, data.tickets, data.seats, data.resources) : []),
    [data],
  )
  return { data, index }
}

export interface Stats {
  total: number // 人數（計算一票多人）
  arrived: number
  notArrived: number
  vipTotal: number
  vipArrived: number
  rate: number
  invitations: number
  cancelled: number
}

export const computeStats = (ps: Participant[]): Stats => {
  let total = 0,
    arrived = 0,
    vipTotal = 0,
    vipArrived = 0,
    invitations = 0,
    cancelled = 0
  for (const p of ps) {
    if (p.status === 'cancelled') {
      cancelled++
      continue
    }
    invitations++
    total += p.guestCount
    arrived += p.arrivedCount
    if (p.vip) {
      vipTotal += p.guestCount
      vipArrived += p.arrivedCount
    }
  }
  return { total, arrived, notArrived: total - arrived, vipTotal, vipArrived, rate: pct(arrived, total), invitations, cancelled }
}

// 首頁用：每個活動的簡單統計
export const useEventSummaries = (events: EventRec[] | undefined) =>
  useLiveQuery(async () => {
    if (!events) return {}
    const out: Record<string, Stats> = {}
    for (const e of events) {
      const ps = await db.participants.where('eventId').equals(e.id).toArray()
      out[e.id] = computeStats(ps)
    }
    return out
  }, [events]) ?? {}

export const useDebounced = <T,>(value: T, ms = 150) => {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export const useMediaQuery = (q: string) => {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}

export const useOnline = () => {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}
