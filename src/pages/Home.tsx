import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus } from 'lucide-react'
import { db } from '../db/db'
import { useEventSummaries } from '../lib/hooks'
import { todayKey } from '../lib/util'
import { CalendarArt } from '../illustrations'
import { EmptyState, EventCard, EventRow, ModeCard, SectionTitle, SyncIndicator } from '../components/ui'

const logo = `${import.meta.env.BASE_URL}icons/logo-256.png`

export default function Home() {
  const events = useLiveQuery(() => db.events.toArray(), [])
  const today = todayKey()
  const todays = events?.filter((e) => e.date === today && e.status !== 'archived').sort((a, b) => a.startTime.localeCompare(b.startTime))
  const upcoming = events?.filter((e) => e.date > today && e.status === 'active').sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5)
  const recent = events?.filter((e) => e.date < today && e.status !== 'archived').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3)
  const summaries = useEventSummaries(todays)
  const counts = { event: 0, banquet: 0, bus: 0 }
  events?.forEach((e) => e.status !== 'archived' && counts[e.mode]++)

  if (!events) return <div className="page" />

  return (
    <div className="page home">
      <header className="home-head">
        <img src={logo} alt="" className="home-logo" width={48} height={48} />
        <div className="bi">
          <span className="bi-zh home-title">點名龍</span>
          <span className="bi-en">Check-In Dragon</span>
        </div>
        <SyncIndicator />
      </header>

      <SectionTitle
        zh="今日"
        en="Today"
        action={
          <Link to="/events/new" className="btn btn-sm btn-ghost">
            <Plus size={16} /> 建立活動
          </Link>
        }
      />
      {todays && todays.length > 0 ? (
        <div className="today-cards">
          {todays.map((e) => (
            <EventCard key={e.id} event={e} stats={summaries[e.id]} />
          ))}
        </div>
      ) : (
        <div className="card">
          <EmptyState
            art={<CalendarArt />}
            zh="今天沒有安排活動。"
            en="No events today."
            action={
              <Link to="/events/new" className="btn btn-primary">
                <Plus size={18} /> 建立活動
              </Link>
            }
          />
        </div>
      )}

      <SectionTitle zh="模式" en="Modes" />
      <div className="mode-cards">
        <ModeCard mode="event" count={counts.event} />
        <ModeCard mode="banquet" count={counts.banquet} />
        <ModeCard mode="bus" count={counts.bus} />
      </div>

      {upcoming && upcoming.length > 0 && (
        <>
          <SectionTitle zh="即將舉行" en="Upcoming" action={<Link to="/events?tab=upcoming" className="link">全部</Link>} />
          <div className="list card">
            {upcoming.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </div>
        </>
      )}

      {recent && recent.length > 0 && (
        <>
          <SectionTitle zh="最近活動" en="Recent" action={<Link to="/events?tab=past" className="link">全部</Link>} />
          <div className="list card">
            {recent.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
