import { useMemo, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import SeatingPlan from './SeatingPlan'
import TableSeatList from '../components/TableSeatList'
import { TableIcon } from '../components/icons'
import type { EventRec, Resource } from '../db/types'
import { List, Minus, MoveHorizontal, Plus, Printer } from 'lucide-react'
import { checkIn, setTableCapacity, undoCheckIn, type ScanOutcome } from '../lib/actions'
import { feedback } from '../lib/feedback'
import { nameOf } from '../lib/names'
import { normalize } from '../lib/util'
import { useDebounced, useEventData } from '../lib/hooks'
import type { GuestEntry } from '../lib/search'
import { TableArt } from '../illustrations'
import { GuestRow } from '../components/GuestRow'
import { ScanResult } from '../components/ScanResult'
import { ConfirmSheet, EmptyState, FilterChip, PageHeader, ProgressBar, SearchBar, SectionTitle, Sheet, toast } from '../components/ui'

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

// 圍席座位三個板塊：圓桌總覽 → 席位名單 → 座位分配（可拖拉）
export type TablesView = 'overview' | 'list' | 'plan'
export const TablesViewToggle = ({ eventId, view }: { eventId: string; view: TablesView; dinner?: boolean }) => {
  const tabs: [TablesView, string, React.ReactNode][] = [
    ['overview', '圓桌總覽', <TableIcon size={16} />],
    ['list', '席位名單', <List size={16} />],
    ['plan', '座位分配', <MoveHorizontal size={16} />],
  ]
  return (
    <div className="seg view-toggle" role="tablist">
      {tabs.map(([v, label, icon]) => (
        <Link
          key={v}
          to={`/e/${eventId}/tables${v === 'overview' ? '' : `?view=${v}`}`}
          replace
          role="tab"
          aria-selected={view === v}
          className={view === v ? 'active' : ''}
        >
          {icon} {label}
        </Link>
      ))}
    </div>
  )
}

export default function Tables() {
  const [params] = useSearchParams()
  const v = params.get('view')
  return v === 'plan' ? <SeatingPlan /> : v === 'list' ? <TablesList /> : <TablesOverview />
}

// 席位名單：每席用與單一席相同的清單（包括空位、同行），可上下拖拉調整座位；搜尋可找出某人坐在哪一席
// 未安排座位的嘉賓：與「未簽到」是兩回事，所以獨立列出，並分開顯示當中已簽到／未簽到的人數
function Unassigned({ ev, entries }: { ev: EventRec; entries: GuestEntry[] }) {
  const nav = useNavigate()
  const dinner = ev.mode === 'bus'
  const [undoP, setUndoP] = useState<GuestEntry | null>(null)
  if (!entries.length) return null
  const arrived = entries.filter((e) => e.p.attendance !== 'not_arrived').length
  const toggle = async (e: GuestEntry) => {
    if (e.p.attendance !== 'not_arrived') return setUndoP(e)
    await checkIn(e.p, 'SEARCH', 'checkin', '', e.tickets[0])
    feedback('valid')
    toast(`✓ ${nameOf(e.p)} 已簽到`)
  }
  return (
    <section className="unassigned">
      <SectionTitle zh={`${dinner ? '未安排餐席' : '未安排座位'} · ${entries.length} 位`} en="Not assigned" />
      {!dinner && (
        <p className="hint">
          這些嘉賓只是未有座位，不代表未簽到：已簽到 {arrived} 位 · 未簽到 {entries.length - arrived} 位。
        </p>
      )}
      <div className="list card">
        {entries.map((e) => (
          <GuestRow
            key={e.p.id}
            e={e}
            onClick={() => nav(`/e/${ev.id}/guests/${e.p.id}`)}
            onMarkClick={dinner ? undefined : () => toggle(e)}
            trailing={dinner ? <span className="muted">未安排</span> : <span />}
          />
        ))}
      </div>
      <Link to={`/e/${ev.id}/tables?view=plan`} className="btn btn-mode unassigned-go">
        <MoveHorizontal size={18} /> 到「座位分配」安排座位
      </Link>
      <ConfirmSheet
        open={!!undoP}
        onClose={() => setUndoP(null)}
        onConfirm={async () => {
          if (undoP) await undoCheckIn(undoP.p)
          toast('已取消簽到')
        }}
        title="取消簽到"
        message={<p>把 {undoP && nameOf(undoP.p)} 改回「未到」？此操作會記錄在操作紀錄。</p>}
        confirmText="取消簽到"
      />
    </section>
  )
}

const useUnassigned = (ev: EventRec) => {
  const { index } = useEventData(ev.id)
  // 中途離開行程的人不用再安排
  return useMemo(() => index.filter((e) => e.p.status === 'active' && !e.p.leftAt && !e.p.giftOnly && !e.seats.some((s) => s.resource.type === 'table')), [index])
}

function TablesList() {
  const ev = useOutletContext<EventRec>()
  const nav = useNavigate()
  const tables = useTables(ev)
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 150)
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null)
  const [printOpen, setPrintOpen] = useState(false)
  const dinner = ev.mode === 'bus'
  const unassigned = useUnassigned(ev)
  if (!tables) return <div className="page" />
  const nq = normalize(dq)
  const shown = nq ? tables.filter((x) => x.guests.some((g) => g.e.hay.includes(nq))) : tables
  return (
    <div className="page">
      <div className="tables-head">
        <TablesViewToggle eventId={ev.id} view="list" />
        <button className="btn btn-ghost btn-sm" onClick={() => setPrintOpen(true)}>
          <Printer size={16} /> 列印
        </button>
      </div>
      <div className="toolbar">
        <SearchBar value={q} onChange={setQ} placeholder="搜尋姓名／編號，看看坐在哪一席" />
      </div>
      <p className="hint">拖拉姓名可調整座位（手機：按住約半秒），目標有人會對調；點勾號簽到，點姓名看詳情。</p>
      {shown.length === 0 && !unassigned.some((e) => e.hay.includes(nq)) && <p className="muted pad center">找不到「{dq}」</p>}
      {shown.map(({ t, guests, arrived, seated }) => (
        <section key={t.id} className="table-list-card">
          <Link to={`/e/${ev.id}/tables/${t.id}`} className="table-list-head">
            <strong>
              {t.purpose === '晚餐' ? '晚餐 ' : ''}第 {t.label} 席
            </strong>
            <span className={arrived >= t.capacity ? 'full' : ''}>
              {dinner ? `${seated} / ${t.capacity} 已安排` : `${arrived} / ${t.capacity} 已到`} ›
            </span>
          </Link>
          <TableSeatList ev={ev} table={t} guests={guests} compact allowCheckIn={!dinner} onOpen={(e) => nav(`/e/${ev.id}/guests/${e.p.id}`)} />
        </section>
      ))}
      <Unassigned ev={ev} entries={nq ? unassigned.filter((e) => e.hay.includes(nq)) : unassigned} />
      <PrintSheet open={printOpen} onClose={() => setPrintOpen(false)} eventId={ev.id} />
      {outcome && <ScanResult outcome={outcome} purpose="checkin" onDone={() => setOutcome(null)} />}
    </div>
  )
}

// 列印選項
export const PrintSheet = ({ open, onClose, eventId, tableId }: { open: boolean; onClose: () => void; eventId: string; tableId?: string }) => {
  const nav = useNavigate()
  const go = (q: string) => {
    onClose()
    nav(`/e/${eventId}/print?${q}`)
  }
  return (
    <Sheet open={open} onClose={onClose} title="列印 Print">
      <div className="menu-list">
        {tableId && (
          <button className="menu-item" onClick={() => go(`type=table&tid=${tableId}`)}>
            <Printer size={20} /> 只列印此席 <small>This table</small>
          </button>
        )}
        <button className="menu-item" onClick={() => go('type=tables')}>
          <Printer size={20} /> 每席名單（每席一頁） <small>放在檯上或交給帶位同事</small>
        </button>
        <button className="menu-item" onClick={() => go('type=tables&cont=1')}>
          <Printer size={20} /> 每席名單（連續列印） <small>較省紙</small>
        </button>
        <button className="menu-item" onClick={() => go('type=all')}>
          <Printer size={20} /> 總名單（按姓名排列） <small>入口查閱用</small>
        </button>
      </div>
      <p className="hint">列印時可選擇「儲存為 PDF」。</p>
    </Sheet>
  )
}

function TablesOverview() {
  const ev = useOutletContext<EventRec>()
  const tables = useTables(ev)
  const unassigned = useUnassigned(ev)
  const [filter, setFilter] = useState<'all' | 'open' | 'full'>('all')
  // 巴士模式：這裏是聚餐的餐席，顯示「已安排」人數（上車與否不代表已到餐廳）
  const dinner = ev.mode === 'bus'
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
        <TablesViewToggle eventId={ev.id} view="overview" />
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
      <Unassigned ev={ev} entries={unassigned} />
    </div>
  )
}

export function TableDetail() {
  const ev = useOutletContext<EventRec>()
  const { tid } = useParams()
  const nav = useNavigate()
  const tables = useTables(ev)
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null)
  const [printOpen, setPrintOpen] = useState(false)
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
        back={`/e/${ev.id}/tables`}
        actions={
          <>
            <button className="btn btn-sm btn-ghost" onClick={() => setPrintOpen(true)}>
              <Printer size={16} /> 列印
            </button>
            <Link to={`/e/${ev.id}/tables?view=plan`} className="btn btn-sm btn-plan">
              <MoveHorizontal size={16} /> 調位
            </Link>
          </>
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
      <TableSeatList ev={ev} table={t} guests={guests} allowCheckIn={!dinner} onOpen={(e) => nav(`/e/${ev.id}/guests/${e.p.id}`)} />
      <PrintSheet open={printOpen} onClose={() => setPrintOpen(false)} eventId={ev.id} tableId={t.id} />
      {outcome && <ScanResult outcome={outcome} purpose="checkin" onDone={() => setOutcome(null)} />}
    </div>
  )
}
