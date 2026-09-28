import { useMemo, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import type { EventRec, Resource } from '../db/types'
import { verifyCheckIn, type ScanOutcome } from '../lib/actions'
import { useEventData } from '../lib/hooks'
import type { GuestEntry } from '../lib/search'
import { TableArt } from '../illustrations'
import { GuestRow } from '../components/GuestRow'
import { ScanResult } from '../components/ScanResult'
import { EmptyState, FilterChip, PageHeader, ProgressBar } from '../components/ui'

// 圓桌圖形：中間是桌號，外圍小圓點 = 座位（實心 = 已到）
const RoundTable = ({ capacity, arrived, seated }: { capacity: number; arrived: number; seated: number }) => {
  const n = Math.max(capacity, seated)
  return (
    <svg viewBox="0 0 100 100" className="round-table" aria-hidden>
      <circle cx="50" cy="50" r="26" fill="var(--mode-bg)" stroke="var(--border)" strokeWidth="1.5" />
      {Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2
        const x = 50 + Math.cos(a) * 40
        const y = 50 + Math.sin(a) * 40
        const filled = i < arrived
        const assigned = i < seated
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r="6"
            fill={filled ? 'var(--ok-ink)' : 'var(--surface)'}
            stroke={assigned ? (filled ? 'var(--ok-ink)' : 'var(--text-3)') : 'var(--border)'}
            strokeWidth="1.5"
            strokeDasharray={assigned ? undefined : '2 2'}
          />
        )
      })}
    </svg>
  )
}

const useTables = (ev: EventRec) => {
  const { data, index } = useEventData(ev.id)
  return useMemo(() => {
    if (!data) return null
    const byId = new Map(index.map((e) => [e.p.id, e]))
    const tables = data.resources.filter((r) => r.type === 'table')
    return tables.map((t) => {
      const guests = data.seats
        .filter((s) => s.resourceId === t.id)
        .map((s) => ({ seat: s.seatLabel, e: byId.get(s.participantId)! }))
        .filter((x) => x.e && x.e.p.status === 'active')
        .sort((a, b) => Number(a.seat || 99) - Number(b.seat || 99))
      const seated = guests.reduce((a, g) => a + g.e.p.guestCount, 0)
      const arrived = guests.reduce((a, g) => a + g.e.p.arrivedCount, 0)
      return { t, guests, seated, arrived }
    })
  }, [data, index])
}

export default function Tables() {
  const ev = useOutletContext<EventRec>()
  const tables = useTables(ev)
  const [filter, setFilter] = useState<'all' | 'open' | 'full'>('all')
  if (!tables) return <div className="page" />
  if (!tables.length)
    return (
      <div className="page">
        <EmptyState
          art={<TableArt />}
          zh="還沒有設定桌號。"
          en="No tables yet."
          action={
            <Link to={`/e/${ev.id}/edit`} className="btn btn-primary">
              設定桌數
            </Link>
          }
        />
      </div>
    )
  const shown = tables.filter((x) => (filter === 'all' ? true : filter === 'full' ? x.arrived >= x.t.capacity : x.arrived < x.t.capacity))
  return (
    <div className="page">
      <div className="chips">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} count={tables.length}>
          全部
        </FilterChip>
        <FilterChip active={filter === 'open'} onClick={() => setFilter('open')}>
          未滿
        </FilterChip>
        <FilterChip active={filter === 'full'} onClick={() => setFilter('full')}>
          滿座
        </FilterChip>
      </div>
      <div className="table-grid">
        {shown.map(({ t, seated, arrived }) => (
          <Link key={t.id} to={`/e/${ev.id}/tables/${t.id}`} className={`table-card ${arrived >= t.capacity ? 'full' : ''}`}>
            <RoundTable capacity={t.capacity} arrived={arrived} seated={seated} />
            <div className="table-card-label">
              <small>{t.purpose === '晚餐' ? 'DINNER' : 'TABLE'}</small>
              <strong>{t.label}</strong>
            </div>
            <div className="table-card-count">
              {arrived} / {t.capacity}
              {arrived >= t.capacity && <span className="full-tag">FULL 滿座</span>}
              {seated > t.capacity && <span className="over-tag">超額 {seated - t.capacity}</span>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

export function TableDetail() {
  const ev = useOutletContext<EventRec>()
  const { tid } = useParams()
  const nav = useNavigate()
  const tables = useTables(ev)
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null)
  const x = tables?.find((y) => y.t.id === tid)
  if (!tables) return <div className="page" />
  if (!x) return <div className="page muted">找不到此桌</div>
  const { t, guests, arrived, seated } = x as { t: Resource; guests: { seat: string; e: GuestEntry }[]; arrived: number; seated: number }
  const i = tables.indexOf(x)
  const prev = tables[i - 1]
  const next = tables[i + 1]

  return (
    <div className="page narrow">
      <PageHeader
        zh={`${t.purpose === '晚餐' ? '晚餐 ' : ''}第 ${t.label} 桌`}
        en={`Table ${t.label}`}
        back={`/e/${ev.id}/tables`}
        actions={
          <div className="pager">
            <button className="btn btn-sm btn-ghost" disabled={!prev} onClick={() => nav(`/e/${ev.id}/tables/${prev.t.id}`, { replace: true })}>
              ‹ 上一桌
            </button>
            <button className="btn btn-sm btn-ghost" disabled={!next} onClick={() => nav(`/e/${ev.id}/tables/${next.t.id}`, { replace: true })}>
              下一桌 ›
            </button>
          </div>
        }
      />
      <div className="card table-summary">
        <RoundTable capacity={t.capacity} arrived={arrived} seated={seated} />
        <div>
          <p className="big-num">
            {arrived} <small>/ {t.capacity} 已到</small>
          </p>
          <ProgressBar value={arrived} max={t.capacity} tone={arrived >= t.capacity ? 'ok' : 'mode'} />
          <p className="muted">已安排 {seated} 位 · 點未到嘉賓即可入場</p>
        </div>
      </div>
      {guests.length === 0 ? (
        <p className="muted pad center">此桌未安排嘉賓</p>
      ) : (
        <div className="list card">
          {guests.map(({ seat, e }) => (
            <GuestRow
              key={e.p.id}
              e={e}
              onClick={async () => {
                if (e.p.attendance === 'not_arrived') setOutcome(await verifyCheckIn(ev.id, '', 'SEARCH', e.p.id))
                else nav(`/e/${ev.id}/guests/${e.p.id}`)
              }}
              trailing={<span className="seat-no">{seat ? `${seat} 號` : '—'}</span>}
            />
          ))}
        </div>
      )}
      {outcome && <ScanResult outcome={outcome} purpose="checkin" onDone={() => setOutcome(null)} />}
    </div>
  )
}
