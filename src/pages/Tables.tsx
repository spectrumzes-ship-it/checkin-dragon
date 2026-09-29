import { useMemo, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import SeatingPlan from './SeatingPlan'
import TableSeatList from '../components/TableSeatList'
import { TableIcon } from '../components/icons'
import type { EventRec, Resource } from '../db/types'
import { Minus, MoveHorizontal, Plus } from 'lucide-react'
import { setTableCapacity, verifyCheckIn, type ScanOutcome } from '../lib/actions'
import { useEventData } from '../lib/hooks'
import type { GuestEntry } from '../lib/search'
import { TableArt } from '../illustrations'
import { GuestRow } from '../components/GuestRow'
import { ScanResult } from '../components/ScanResult'
import { EmptyState, FilterChip, PageHeader, ProgressBar, SectionTitle } from '../components/ui'

// 圓桌圖形：中間是席號，外圍小圓點 = 座位（實心 = 已到）
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

// 切換「座位表（可拖拉）」與「圓桌總覽」
export const TablesViewToggle = ({ eventId, view, dinner }: { eventId: string; view: 'plan' | 'overview'; dinner: boolean }) => (
  <div className="seg view-toggle" role="tablist">
    <Link to={`/e/${eventId}/tables`} replace role="tab" aria-selected={view === 'plan'} className={view === 'plan' ? 'active' : ''}>
      <MoveHorizontal size={16} /> {dinner ? '餐席表' : '座位表'}（可拖拉）
    </Link>
    <Link to={`/e/${eventId}/tables?view=overview`} replace role="tab" aria-selected={view === 'overview'} className={view === 'overview' ? 'active' : ''}>
      <TableIcon size={16} /> 圓桌總覽
    </Link>
  </div>
)

// 圍席座位：預設直接顯示可拖拉的座位表；「圓桌總覽」為第二種顯示
export default function Tables() {
  const [params] = useSearchParams()
  return params.get('view') === 'overview' ? <TablesOverview /> : <SeatingPlan />
}

function TablesOverview() {
  const ev = useOutletContext<EventRec>()
  const nav = useNavigate()
  const tables = useTables(ev)
  const { index } = useEventData(ev.id)
  const [filter, setFilter] = useState<'all' | 'open' | 'full'>('all')
  // 巴士模式：這裏是聚餐的餐席，顯示「已安排」人數（上車與否不代表已到餐廳）
  const dinner = ev.mode === 'bus'
  const unassigned = dinner ? index.filter((e) => e.p.status === 'active' && !e.seats.some((s) => s.resource.type === 'table')) : []
  if (!tables) return <div className="page" />
  if (!tables.length)
    return (
      <div className="page">
        <EmptyState
          art={<TableArt />}
          zh={dinner ? '這個行程未設定聚餐餐席。' : '還沒有設定圍席座位。'}
          en={dinner ? 'No dinner tables yet.' : 'No tables yet.'}
          action={
            <Link to={`/e/${ev.id}/edit`} className="btn btn-primary">
              {dinner ? '設定聚餐席數' : '設定席數'}
            </Link>
          }
        />
      </div>
    )
  const count = (x: (typeof tables)[number]) => (dinner ? x.seated : x.arrived)
  const shown = tables.filter((x) => (filter === 'all' ? true : filter === 'full' ? count(x) >= x.t.capacity : count(x) < x.t.capacity))
  return (
    <div className="page">
      <div className="tables-head">
        <TablesViewToggle eventId={ev.id} view="overview" dinner={dinner} />
      </div>
      {dinner && (
        <p className="hint">
          聚餐餐席安排 · 每張卡顯示已安排人數／每席人數。晚餐集合點名可在「點名」建立一次「晚餐」點名。
        </p>
      )}
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
        {shown.map(({ t, seated, arrived: a }) => {
          const arrived = dinner ? seated : a
          return (
          <Link key={t.id} to={`/e/${ev.id}/tables/${t.id}`} className={`table-card ${arrived >= t.capacity ? 'full' : ''}`}>
            <RoundTable capacity={t.capacity} arrived={arrived} seated={seated} />
            <div className="table-card-label">
              <small>{t.purpose === '晚餐' ? 'DINNER' : 'TABLE'}</small>
              <strong>{t.label}</strong>
            </div>
            <div className="table-card-count">
              {arrived} / {t.capacity}
              {dinner && <small className="muted">已安排</small>}
              {arrived >= t.capacity && <span className="full-tag">FULL 滿座</span>}
              {seated > t.capacity && <span className="over-tag">超額 {seated - t.capacity}</span>}
            </div>
          </Link>
          )
        })}
      </div>
      {dinner && unassigned.length > 0 && (
        <section className="unassigned">
          <SectionTitle zh={`未安排餐席 · ${unassigned.length} 位`} en="Not assigned" />
          <div className="list card">
            {unassigned.map((e) => (
              <GuestRow key={e.p.id} e={e} onClick={() => nav(`/e/${ev.id}/guests/${e.p.id}/edit`)} trailing={<span className="btn btn-sm btn-mode">安排</span>} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

export function TableDetail() {
  const ev = useOutletContext<EventRec>()
  const { tid } = useParams()
  const nav = useNavigate()
  const tables = useTables(ev)
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null)
  const dinner = ev.mode === 'bus'
  const x = tables?.find((y) => y.t.id === tid)
  if (!tables) return <div className="page" />
  if (!x) return <div className="page muted">找不到此席</div>
  const { t, guests, arrived, seated } = x as { t: Resource; guests: { seat: string; e: GuestEntry }[]; arrived: number; seated: number }
  const i = tables.indexOf(x)
  const prev = tables[i - 1]
  const next = tables[i + 1]

  return (
    <div className="page narrow">
      <PageHeader
        zh={`${t.purpose === '晚餐' ? '晚餐 ' : ''}第 ${t.label} 席`}
        en={`Table ${t.label}`}
        back={`/e/${ev.id}/tables?view=overview`}
        actions={
          <Link to={`/e/${ev.id}/tables`} className="btn btn-sm btn-plan">
            <MoveHorizontal size={16} /> 調位
          </Link>
        }
      />
      <div className="pager">
        <button className="btn btn-sm btn-ghost" disabled={!prev} onClick={() => nav(`/e/${ev.id}/tables/${prev.t.id}`, { replace: true })}>
          ‹ 上一席
        </button>
        <button className="btn btn-sm btn-ghost" disabled={!next} onClick={() => nav(`/e/${ev.id}/tables/${next.t.id}`, { replace: true })}>
          下一席 ›
        </button>
      </div>
      <div className="card table-summary">
        <RoundTable capacity={t.capacity} arrived={arrived} seated={seated} />
        <div>
          {dinner ? (
            <>
              <p className="big-num">
                {seated} <small>/ {t.capacity} 已安排</small>
              </p>
              <ProgressBar value={seated} max={t.capacity} tone={seated >= t.capacity ? 'ok' : 'mode'} />
              <p className="muted">點乘客可查看或修改餐席</p>
            </>
          ) : (
            <>
              <p className="big-num">
                {arrived} <small>/ {t.capacity} 已到</small>
              </p>
              <ProgressBar value={arrived} max={t.capacity} tone={arrived >= t.capacity ? 'ok' : 'mode'} />
              <p className="muted">已安排 {seated} 位 · 點未到嘉賓即可簽到</p>
            </>
          )}
        </div>
        <div className="stepper compact">
            <span>每圍人數</span>
            <button className="icon-btn" aria-label="減少一位" onClick={() => setTableCapacity(t, t.capacity - 1)} disabled={t.capacity <= 1}>
              <Minus size={18} />
            </button>
            <strong>{t.capacity}</strong>
            <button className="icon-btn" aria-label="增加一位" onClick={() => setTableCapacity(t, t.capacity + 1)} disabled={t.capacity >= 30}>
              <Plus size={18} />
            </button>
          </div>
      </div>
      <TableSeatList
        ev={ev}
        table={t}
        guests={guests}
        onTap={async (e) => {
          if (!dinner && e.p.attendance === 'not_arrived') setOutcome(await verifyCheckIn(ev.id, '', 'SEARCH', e.p.id))
          else nav(`/e/${ev.id}/guests/${e.p.id}`)
        }}
      />
      {outcome && <ScanResult outcome={outcome} purpose="checkin" onDone={() => setOutcome(null)} />}
    </div>
  )
}
