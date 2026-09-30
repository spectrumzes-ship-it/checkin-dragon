import { useEffect, useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown } from 'lucide-react'
import { db } from '../db/db'
import type { EventRec } from '../db/types'
import { ChartPie, ChevronLeft, ClipboardList, Gift, ListChecks, Armchair, ScanLine, Users } from 'lucide-react'
import { useEvent } from '../lib/hooks'
import { setSettings } from '../lib/settings'
import { todayKey, isOnDay, isUpcoming, isPast, formatDateRange } from '../lib/util'
import { ModeIcon, TableIcon, typeLabel } from '../components/icons'
import { EmptyState, Sheet, SyncIndicator } from '../components/ui'
import { CalendarArt } from '../illustrations'

// 活動內所有畫面共用：頂部模式色條 + 分頁
export default function EventLayout() {
  const { id } = useParams()
  const ev = useEvent(id)
  const [picker, setPicker] = useState(false)

  useEffect(() => {
    if (id && ev) setSettings({ currentEventId: id })
    // 活動已不存在：清除「目前活動」並自動返回首頁
    if (ev === null) setSettings({ currentEventId: null })
  }, [id, ev])

  if (ev === undefined) return <div className="page" />
  if (ev === null) return <Navigate to="/" replace />
  if (!ev)
    return (
      <div className="page">
        <EmptyState
          art={<CalendarArt />}
          zh="找不到此活動。"
          en="Event not found."
          action={
            <Link className="btn btn-primary" to="/events" onClick={() => setSettings({ currentEventId: null })}>
              返回活動列表
            </Link>
          }
        />
      </div>
    )

  const base = `/e/${ev.id}`
  const gift = ev.mode === 'gift'
  const tabs = [
    { to: base, icon: <ChartPie size={18} />, zh: gift ? '總覽' : '統計', en: 'Dashboard', end: true },
    ...(gift ? [{ to: `${base}/souvenirs`, icon: <Gift size={18} />, zh: '禮品', en: 'Gifts' }] : []),
    { to: `${base}/guests`, icon: <Users size={18} />, zh: gift ? '領取人' : '嘉賓', en: gift ? 'Recipients' : 'Guests' },
    ...(ev.mode === 'banquet' ? [{ to: `${base}/tables`, icon: <TableIcon size={18} />, zh: '圍席座位', en: 'Tables' }] : []),
    ...(ev.mode === 'bus'
      ? [
          { to: `${base}/rollcall`, icon: <ListChecks size={18} />, zh: '點名', en: 'Roll Call' },
          { to: `${base}/seats`, icon: <Armchair size={18} />, zh: '車位', en: 'Bus Seats' },
          { to: `${base}/tables`, icon: <TableIcon size={18} />, zh: '餐席', en: 'Dinner' },
        ]
      : []),
    ...(gift ? [] : [{ to: `${base}/souvenirs`, icon: <Gift size={18} />, zh: '紀念品', en: 'Souvenirs' }]),
    { to: `${base}/logs`, icon: <ClipboardList size={18} />, zh: '紀錄', en: 'Logs' },
  ]

  return (
    <div className="event-layout" data-mode={ev.mode}>
      <header className="event-head">
        <div className="event-head-inner">
          <Link to="/events" className="icon-btn" aria-label="返回活動列表">
            <ChevronLeft size={22} />
          </Link>
          <span className="event-head-icon">
            <ModeIcon mode={ev.mode} size={22} />
          </span>
          <button className="event-head-text" onClick={() => setPicker(true)} aria-label="切換活動">
            <strong>
              {ev.name} <ChevronDown size={16} className="switch-caret" />
            </strong>
            <span>
              {typeLabel(ev.type)} · {formatDateRange(ev)} · {ev.startTime}
              {ev.venue && ` · ${ev.venue}`}
              {ev.status === 'completed' && ' · 已完成'}
              {ev.status === 'archived' && ' · 已封存'}
            </span>
          </button>
          <SyncIndicator />
          <Link to={`${base}/scan`} className="btn btn-primary head-scan">
            <ScanLine size={20} /> 掃描
          </Link>
        </div>
        <nav className="event-tabs" aria-label="活動分頁">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              {t.icon}
              <span>{t.zh}</span>
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet context={ev} />
      <EventPicker open={picker} onClose={() => setPicker(false)} current={ev} />
    </div>
  )
}

// 切換活動：保留目前所在的分頁（例如由 A 活動的嘉賓名單直接跳到 B 活動的嘉賓名單）
function EventPicker({ open, onClose, current }: { open: boolean; onClose: () => void; current: EventRec }) {
  const nav = useNavigate()
  const loc = useLocation()
  const events = useLiveQuery(() => db.events.toArray(), []) ?? []
  const today = todayKey()
  const active = events.filter((e) => e.status !== 'archived')
  const groups: [string, EventRec[]][] = [
    ['今日 Today', active.filter((e) => isOnDay(e, today)).sort((a, b) => a.startTime.localeCompare(b.startTime))],
    ['即將舉行 Upcoming', active.filter((e) => isUpcoming(e, today)).sort((a, b) => a.date.localeCompare(b.date))],
    ['已完成 Past', active.filter((e) => isPast(e, today)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10)],
  ]
  const go = (e: EventRec) => {
    const sub = loc.pathname.split('/')[3] ?? ''
    const ok = sub === 'tables' ? e.mode === 'banquet' : sub === 'rollcall' || sub === 'seats' ? e.mode === 'bus' : true
    setSettings({ currentEventId: e.id })
    onClose()
    nav(`/e/${e.id}${ok && sub ? `/${sub}` : ''}`)
  }
  return (
    <Sheet open={open} onClose={onClose} title="切換活動 Switch Event">
      {groups.map(([title, list]) =>
        list.length ? (
          <div key={title} className="picker-group">
            <p className="field-label">{title}</p>
            <div className="list card">
              {list.map((e) => (
                <button key={e.id} className={`picker-row ${e.id === current.id ? 'current' : ''}`} data-mode={e.mode} onClick={() => go(e)}>
                  <span className="event-row-icon">
                    <ModeIcon mode={e.mode} size={18} />
                  </span>
                  <span className="event-row-main">
                    <strong>{e.name}</strong>
                    <span className="muted">
                      {formatDateRange(e)} · {e.startTime} · {typeLabel(e.type)}
                    </span>
                  </span>
                  {e.id === current.id && <span className="muted">目前</span>}
                </button>
              ))}
            </div>
          </div>
        ) : null,
      )}
    </Sheet>
  )
}
