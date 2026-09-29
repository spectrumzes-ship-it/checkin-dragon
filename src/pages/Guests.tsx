import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus } from 'lucide-react'
import { db } from '../db/db'
import type { EventRec } from '../db/types'
import { useDebounced, useEventData, useMediaQuery } from '../lib/hooks'
import { searchGuests, type GuestEntry } from '../lib/search'
import { GuestsArt } from '../illustrations'
import { GuestRow } from '../components/GuestRow'
import { ConfirmSheet, EmptyState, FilterChip, SearchBar, toast } from '../components/ui'
import { checkIn, undoCheckIn } from '../lib/actions'
import { feedback } from '../lib/feedback'
import type { Participant } from '../db/types'
import GuestDetail from './GuestDetail'
import { nameOf } from '../lib/names'

type Filter = 'all' | 'arrived' | 'not_arrived' | 'vip' | 'cancelled' | 'manual' | 'souvenir' | 'no_souvenir'
type Sort = 'name' | 'seat' | 'time' | 'status'

const seatKey = (e: GuestEntry) => {
  const s = e.seats[0]
  return s ? `${s.resource.type}${s.resource.label.padStart(4, '0')}${s.seatLabel.padStart(4, '0')}` : 'zzz'
}

export default function Guests() {
  const ev = useOutletContext<EventRec>()
  const { gid } = useParams()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const filter = (params.get('filter') as Filter) || 'all'
  const [sort, setSort] = useState<Sort>('name')
  const [q, setQ] = useState('')
  const [undoP, setUndoP] = useState<Participant | null>(null)
  const dq = useDebounced(q, 150)
  const wide = useMediaQuery('(min-width: 1024px)')
  const { data, index } = useEventData(ev.id)
  const redemptions = useLiveQuery(() => db.redemptions.where('eventId').equals(ev.id).toArray(), [ev.id]) ?? []
  const hasSouvenirs = (useLiveQuery(() => db.souvenirs.where('eventId').equals(ev.id).count(), [ev.id]) ?? 0) > 0
  const collected = useMemo(() => new Set(redemptions.filter((r) => !r.voided).map((r) => r.participantId)), [redemptions])

  const counts = useMemo(() => {
    const c = { all: 0, arrived: 0, not_arrived: 0, vip: 0, cancelled: 0, manual: 0, souvenir: 0, no_souvenir: 0 }
    for (const e of index) {
      const p = e.p
      c.all++
      if (p.status === 'cancelled') {
        c.cancelled++
        continue
      }
      if (p.attendance !== 'not_arrived') c.arrived++
      else c.not_arrived++
      if (p.vip) c.vip++
      if (p.manual) c.manual++
      if (collected.has(p.id)) c.souvenir++
      else c.no_souvenir++
    }
    return c
  }, [index, collected])

  const list = useMemo(() => {
    const matched = searchGuests(index, dq)
    const f = matched.filter((e) => {
      const p = e.p
      switch (filter) {
        case 'arrived':
          return p.status === 'active' && p.attendance !== 'not_arrived'
        case 'not_arrived':
          return p.status === 'active' && p.attendance === 'not_arrived'
        case 'vip':
          return p.status === 'active' && p.vip
        case 'cancelled':
          return p.status === 'cancelled'
        case 'manual':
          return p.status === 'active' && p.manual
        case 'souvenir':
          return p.status === 'active' && collected.has(p.id)
        case 'no_souvenir':
          return p.status === 'active' && !collected.has(p.id)
        default:
          return true
      }
    })
    if (dq) return f // 搜尋時按吻合度排序
    const byName = (a: GuestEntry, b: GuestEntry) => nameOf(a.p).localeCompare(nameOf(b.p), 'zh-Hant')
    const cmp: Record<Sort, (a: GuestEntry, b: GuestEntry) => number> = {
      name: byName,
      seat: (a, b) => seatKey(a).localeCompare(seatKey(b)) || byName(a, b),
      time: (a, b) => (b.p.checkedInAt ?? 0) - (a.p.checkedInAt ?? 0) || byName(a, b),
      status: (a, b) => Number(a.p.attendance !== 'not_arrived') - Number(b.p.attendance !== 'not_arrived') || byName(a, b),
    }
    return [...f].sort(cmp[sort])
  }, [index, dq, filter, sort, collected])

  const listRef = useRef<HTMLDivElement>(null)
  const [margin, setMargin] = useState(0)
  useLayoutEffect(() => {
    setMargin(listRef.current?.offsetTop ?? 0)
  })
  const virt = useWindowVirtualizer({ count: list.length, estimateSize: () => 72, overscan: 10, scrollMargin: margin })

  const setFilter = (f: Filter) => {
    const next = new URLSearchParams(params)
    if (f === 'all') next.delete('filter')
    else next.set('filter', f)
    setParams(next, { replace: true })
  }

  const focus = params.get('focus') === '1'
  useEffect(() => {
    if (focus) window.scrollTo(0, 0)
  }, [focus])

  if (!data) return <div className="page" />

  const chips: [Filter, string][] = [
    ['all', '全部'],
    ['arrived', '已到'],
    ['not_arrived', '未到'],
    ['vip', 'VIP'],
    ['cancelled', '已取消'],
    ['manual', '手動'],
    ...(hasSouvenirs ? ([['souvenir', '已領紀念品'], ['no_souvenir', '未領紀念品']] as [Filter, string][]) : []),
  ]

  const showList = wide || !gid

  return (
    <div className={`page guests-page ${gid ? 'has-detail' : ''}`}>
      {showList && (
        <div className="guests-list">
          <div className="toolbar sticky-toolbar">
            <div className="toolbar-row">
              <SearchBar value={q} onChange={setQ} placeholder="搜尋姓名／編號／電話／公司／座位" autoFocus={focus} />
              <Link to={`/e/${ev.id}/guests/new`} className="btn btn-primary">
                <Plus size={18} /> <span className="hide-sm">嘉賓</span>
              </Link>
            </div>
            <div className="chips scroll-x">
              {chips.map(([f, label]) => (
                <FilterChip key={f} active={filter === f} onClick={() => setFilter(f)} count={counts[f]}>
                  {label}
                </FilterChip>
              ))}
            </div>
            <div className="toolbar-row small">
              <span className="muted">
                顯示 {list.length} 張邀請
              </span>
              <label className="sort">
                排序
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} disabled={!!dq}>
                  <option value="name">姓名</option>
                  <option value="seat">座位／席號</option>
                  <option value="time">入場時間</option>
                  <option value="status">未到優先</option>
                </select>
              </label>
            </div>
          </div>

          {index.length === 0 ? (
            <div className="card">
              <EmptyState
                art={<GuestsArt />}
                zh="還沒有嘉賓。"
                en="No guests yet."
                action={
                  <Link to={`/e/${ev.id}/guests/new`} className="btn btn-primary">
                    <Plus size={18} /> 新增嘉賓
                  </Link>
                }
              />
            </div>
          ) : list.length === 0 ? (
            <p className="muted pad center">沒有符合的嘉賓</p>
          ) : (
            <div ref={listRef} className="vlist card" style={{ height: virt.getTotalSize() }}>
              {virt.getVirtualItems().map((v) => {
                const e = list[v.index]
                return (
                  <div
                    key={e.p.id}
                    className="vlist-item"
                    data-index={v.index}
                    ref={virt.measureElement}
                    style={{ transform: `translateY(${v.start - virt.options.scrollMargin}px)` }}
                  >
                    <GuestRow
                      e={e}
                      selected={e.p.id === gid}
                      souvenir={collected.has(e.p.id)}
                      onClick={() => nav(`/e/${ev.id}/guests/${e.p.id}${params.size ? `?${params}` : ''}`)}
                      onMarkClick={async () => {
                        if (e.p.attendance !== 'not_arrived') return setUndoP(e.p)
                        await checkIn(e.p, 'SEARCH', 'checkin', '', e.tickets[0])
                        feedback('valid')
                        toast(`✓ ${nameOf(e.p)} 已入場`)
                      }}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
      {gid && (
        <aside className="guests-detail">
          <GuestDetail ev={ev} gid={gid} entry={index.find((e) => e.p.id === gid)} onClose={() => nav(`/e/${ev.id}/guests${params.size ? `?${params}` : ''}`)} />
        </aside>
      )}
      <ConfirmSheet
        open={!!undoP}
        onClose={() => setUndoP(null)}
        onConfirm={async () => {
          if (undoP) await undoCheckIn(undoP)
          toast('已取消入場')
        }}
        title="取消入場"
        message={<p>把 {undoP && nameOf(undoP)} 改回「未到」？此操作會記錄在操作紀錄。</p>}
        confirmText="取消入場"
      />
      {!gid && wide && index.length > 0 && (
        <aside className="guests-detail placeholder">
          <p className="muted center">點選左邊嘉賓查看詳情</p>
        </aside>
      )}
    </div>
  )
}
