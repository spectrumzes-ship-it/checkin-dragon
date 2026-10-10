import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ChartPie, FolderOpen, House, ScanQrCode, Settings, Users, FileText } from 'lucide-react'
import { useSettings } from '../lib/settings'
import { cx, pickScanEvent } from '../lib/util'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { ToastHost } from './ui'


// 整體版面：手機 = 底部選單；平板 = 窄側欄；電腦 = 完整側欄
export const AppShell = () => {
  const { currentEventId } = useSettings()
  const loc = useLocation()
  const ev = currentEventId ? `/e/${currentEventId}` : null
  const guests = ev ? `${ev}/guests` : '/events?pick=guests'
  // 掃描：按時間自動揀今日的活動；今日沒有活動才用上次的活動
  const events = useLiveQuery(() => db.events.toArray(), []) ?? []
  const pathId = loc.pathname.match(/^\/e\/([^/]+)/)?.[1]
  const navMode = pathId ? events.find((e) => e.id === pathId)?.mode : undefined
  const auto = pickScanEvent(events)
  const scan = auto ? `/e/${auto.id}/scan` : ev ? `${ev}/scan` : '/events?pick=scan'
  const stats = ev ? ev : '/events?pick=stats'

  const path = loc.pathname
  const inEvent = path.startsWith('/e/')
  const isGuests = /\/guests/.test(path)
  const pick = new URLSearchParams(loc.search).get('pick')
  // 自行判斷哪一項亮起：嘉賓／掃描未選活動時會連到活動列表，不能單靠網址比對，否則會同時亮起
  const side = [
    { to: '/', icon: House, zh: '首頁', en: 'Home', active: path === '/' },
    { to: '/events', icon: FolderOpen, zh: '活動', en: 'Events', active: (path.startsWith('/events') && !pick) || (inEvent && !isGuests) },
    { to: guests, icon: Users, zh: '嘉賓', en: 'Guests', active: isGuests || pick === 'guests' },
    { to: scan, icon: ScanQrCode, zh: '掃描', en: 'Scan', active: pick === 'scan' },
    { to: '/reports', icon: FileText, zh: '報告', en: 'Reports', active: path.startsWith('/reports') },
    { to: '/settings', icon: Settings, zh: '設定', en: 'Settings', active: path.startsWith('/settings') },
  ]

  return (
    <div className="shell">
      <aside className="sidebar">
        <nav>
          {side.map((i) => (
            <Link key={i.zh} to={i.to} className={cx('side-item', i.active && 'active')} aria-current={i.active ? 'page' : undefined}>
              <i.icon size={22} strokeWidth={1.9} />
              <span className="bi">
                <span className="bi-zh">{i.zh}</span>
                <span className="bi-en">{i.en}</span>
              </span>
            </Link>
          ))}
        </nav>
      </aside>

      <main className="main">
        <Outlet />
      </main>

      {/* 在活動內：底部導覽帶該活動的模式（掃描鍵用代表色） */}
      <nav className="bottom-nav" aria-label="主選單" data-mode={navMode}>
        <NavLink to="/" end className={() => cx('bn-item', path === '/' && 'active')}>
          <House size={22} strokeWidth={1.9} />
          <span>首頁</span>
        </NavLink>
        <NavLink to={guests} className={() => cx('bn-item', (isGuests || pick === 'guests') && 'active')}>
          <Users size={22} strokeWidth={1.9} />
          <span>嘉賓</span>
        </NavLink>
        <NavLink to={scan} className={() => 'bn-scan'} aria-label="掃描 Scan">
          <span className="bn-scan-btn">
            <ScanQrCode size={28} strokeWidth={2} />
          </span>
          <span>掃描</span>
        </NavLink>
        <NavLink to={stats} end className={() => cx('bn-item', ((inEvent && !isGuests) || pick === 'stats') && 'active')}>
          <ChartPie size={22} strokeWidth={1.9} />
          <span>統計</span>
        </NavLink>
        <NavLink to="/settings" className={() => cx('bn-item', path.startsWith('/settings') && 'active')}>
          <Settings size={22} strokeWidth={1.9} />
          <span>設定</span>
        </NavLink>
      </nav>
      <ToastHost />
    </div>
  )
}
