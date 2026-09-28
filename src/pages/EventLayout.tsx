import { useEffect } from 'react'
import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { ChartPie, ChevronLeft, ClipboardList, Gift, ListChecks, Armchair, ScanLine, Users } from 'lucide-react'
import { useEvent } from '../lib/hooks'
import { setSettings } from '../lib/settings'
import { formatDate } from '../lib/util'
import { MODE_META, ModeIcon, TableIcon } from '../components/icons'
import { EmptyState, SyncIndicator } from '../components/ui'
import { CalendarArt } from '../illustrations'

// 活動內所有畫面共用：頂部模式色條 + 分頁
export default function EventLayout() {
  const { id } = useParams()
  const ev = useEvent(id)

  useEffect(() => {
    if (id) setSettings({ currentEventId: id })
  }, [id])

  if (ev === undefined) return <div className="page" />
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
  const tabs = [
    { to: base, icon: <ChartPie size={18} />, zh: '統計', en: 'Dashboard', end: true },
    { to: `${base}/guests`, icon: <Users size={18} />, zh: '嘉賓', en: 'Guests' },
    ...(ev.mode === 'banquet' ? [{ to: `${base}/tables`, icon: <TableIcon size={18} />, zh: '桌號', en: 'Tables' }] : []),
    ...(ev.mode === 'bus'
      ? [
          { to: `${base}/rollcall`, icon: <ListChecks size={18} />, zh: '點名', en: 'Roll Call' },
          { to: `${base}/seats`, icon: <Armchair size={18} />, zh: '座位', en: 'Seats' },
        ]
      : []),
    { to: `${base}/souvenirs`, icon: <Gift size={18} />, zh: '紀念品', en: 'Souvenirs' },
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
          <div className="event-head-text">
            <strong>{ev.name}</strong>
            <span>
              {MODE_META[ev.mode].zh} · {formatDate(ev.date)} · {ev.startTime}
              {ev.venue && ` · ${ev.venue}`}
              {ev.status === 'completed' && ' · 已完成'}
              {ev.status === 'archived' && ' · 已封存'}
            </span>
          </div>
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
    </div>
  )
}
