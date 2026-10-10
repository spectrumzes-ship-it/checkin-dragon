import SwipeRow from '../components/SwipeRow'
import Seal from '../components/Seal'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Ticket, Printer, Download } from 'lucide-react'
import { db } from '../db/db'
import type { EventRec, SouvenirItem } from '../db/types'
import { useDebounced, useEventData, useMediaQuery } from '../lib/hooks'
import { searchGuests, type GuestEntry } from '../lib/search'
import { GuestsArt } from '../illustrations'
import { GuestRow } from '../components/GuestRow'
import { CarsBar, ConfirmSheet, EmptyState, FilterChip, SearchBar, Sheet, toast } from '../components/ui'
import { checkIn, generateTickets, undoCheckIn, deleteGuestPermanently, logicOf, verifyAllSouvenirs, verifySouvenir, type ScanOutcome } from '../lib/actions'
import { feedback } from '../lib/feedback'
import type { Participant } from '../db/types'
import GuestDetail from './GuestDetail'
import { nameOf } from '../lib/names'

type Filter = 'all' | 'left' | 'gift_only' | 'arrived' | 'not_arrived' | 'vip' | 'cancelled' | 'manual' | 'souvenir' | 'no_souvenir'
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
  const [swiped, setSwiped] = useState('') // 向左拉開了刪除按鈕的嘉賓
  const [delGuest, setDelGuest] = useState<Participant | null>(null)
  const anonymous = !!ev.modeConfig.anonymous
  const [gen, setGen] = useState<null | { prefix: string; start: number; count: number; guestCount: number }>(null)
  // 預設由現有最大票號的下一號開始，避免重複
  const openGen = () => {
    const nums = index.map((e) => Number(/(\d+)$/.exec(e.p.ticketLabel ?? '')?.[1] ?? 0))
    setGen({ prefix: ev.code, start: Math.max(0, ...nums) + 1, count: 100, guestCount: 1 })
  }
  const dq = useDebounced(q, 150)
  const wide = useMediaQuery('(min-width: 1024px)')
  const { data, index } = useEventData(ev.id)
  const hasSeating = (data?.resources.length ?? 0) > 0
  const redemptions = useLiveQuery(() => db.redemptions.where('eventId').equals(ev.id).toArray(), [ev.id]) ?? []
  const souvenirList = useLiveQuery(() => db.souvenirs.where('eventId').equals(ev.id).sortBy('sortOrder'), [ev.id]) ?? []
  const hasSouvenirs = souvenirList.length > 0
  // 禮品領取模式：按名單派發的禮品（不包括限量先到先得）
  const listItems = souvenirList.filter((x) => logicOf(x) === 'person' || logicOf(x) === 'invitation')
  const [giftFor, setGiftFor] = useState<GuestEntry | null>(null)
  const giveItem = async (item: SouvenirItem, e: GuestEntry) => {
    setGiftFor(null)
    const o: ScanOutcome = await verifySouvenir(ev.id, item.id, '', 'SEARCH', e.p.id)
    if (o.result === 'valid') {
      feedback('valid')
      toast(`✓ ${nameOf(e.p)} 已領取 ${item.name}${o.souvenir && o.souvenir.quantity > 1 ? ` × ${o.souvenir.quantity}` : ''}`)
    } else {
      feedback(o.result === 'duplicate' || o.result === 'out_of_stock' ? 'duplicate' : 'invalid')
      toast(o.result === 'duplicate' ? `${nameOf(e.p)} 已領取過 ${item.name}` : o.reason ?? '未能派發')
    }
  }
  // 點左邊圓圈：只有一款按名單派發的禮品就直接派發；多款就先揀
  const giveFromList = (e: GuestEntry) => {
    if (!listItems.length) return toast('這個活動沒有按名單派發的禮品')
    if (listItems.length === 1) return giveItem(listItems[0], e)
    setGiftFor(e)
  }
  const collected = useMemo(() => new Set(redemptions.filter((r) => !r.voided).map((r) => r.participantId)), [redemptions])

  const counts = useMemo(() => {
    const c = { all: 0, left: 0, gift_only: 0, arrived: 0, not_arrived: 0, vip: 0, cancelled: 0, manual: 0, souvenir: 0, no_souvenir: 0 }
    for (const e of index) {
      const p = e.p
      c.all++
      if (p.status === 'cancelled') {
        c.cancelled++
        continue
      }
      if (p.leftAt) c.left++
      if (p.giftOnly) c.gift_only++
      else if (p.attendance !== 'not_arrived') c.arrived++
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
          return p.status === 'active' && !p.giftOnly && p.attendance !== 'not_arrived'
        case 'not_arrived':
          return p.status === 'active' && !p.giftOnly && p.attendance === 'not_arrived'
        case 'left':
          return p.status === 'active' && !!p.leftAt
        case 'gift_only':
          return p.status === 'active' && !!p.giftOnly
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

  // 禮品領取模式沒有簽到：不顯示「已到／未到」，圓圈改為顯示是否已領取
  const gift = ev.mode === 'gift'
  const chips: [Filter, string][] = [
    ['all', '全部'],
    ...(gift ? [] : ([['arrived', '已到'], ['not_arrived', '未到']] as [Filter, string][])),
    ['vip', 'VIP'],
    ['cancelled', '已取消'],
    ...(gift ? [] : ([['manual', '手動']] as [Filter, string][])),
    ...(counts.left ? ([['left', '中途離開']] as [Filter, string][]) : []),
    ...(counts.gift_only ? ([['gift_only', '只領禮品']] as [Filter, string][]) : []),
    ...(hasSouvenirs ? ([['souvenir', gift ? '已領取' : '已領紀念品'], ['no_souvenir', gift ? '未領取' : '未領紀念品']] as [Filter, string][]) : []),
  ]

  const showList = wide || !gid

  return (
    <div className={`page guests-page ${gid ? 'has-detail' : ''}`}>
      {showList && (
        <div className="guests-list">
          {/* 代表色摘要：已到（禮品領取模式為已領取）＋十格進度 */}
          {(() => {
            const active = index.filter((e) => e.p.status === 'active' && !e.p.giftOnly)
            const done = gift ? index.filter((e) => e.p.status === 'active' && collected.has(e.p.id)).length : active.filter((e) => e.p.attendance !== 'not_arrived').length
            const total = gift ? index.filter((e) => e.p.status === 'active').length : active.length
            return (
              <div className="guests-hero card">
                <span className="dash-hero-label">{gift ? '已領取' : ev.mode === 'bus' ? '已報到' : ev.mode === 'banquet' ? '已入席' : '已入場'}</span>
                <span className="guests-hero-num">
                  <b>{done}</b> / {total} {anonymous ? '張' : '人'}
                </span>
                <CarsBar value={done} max={total} />
              </div>
            )
          })()}
          <div className="toolbar sticky-toolbar">
            <div className="toolbar-row">
              <SearchBar value={q} onChange={setQ} placeholder="搜尋姓名／編號／電話／公司／座位" autoFocus={focus} />
              {anonymous && (
                <button className="btn btn-ghost" onClick={openGen}>
                  <Ticket size={18} /> <span className="hide-sm">產生門票</span>
                </button>
              )}
              <Link to={`/e/${ev.id}/print?type=all`} className="icon-btn" aria-label="列印名單" title="列印名單（可存成 PDF）">
                <Printer size={18} />
              </Link>
              <button className="icon-btn" aria-label="匯出名單" title="匯出 Excel／CSV" onClick={() => toast('匯出 Excel／CSV 將在第 4 階段加入；現在可按「列印」存成 PDF')}>
                <Download size={18} />
              </button>
              <Link to={`/e/${ev.id}/guests/new`} className="btn btn-primary">
                <Plus size={18} /> <span className="hide-sm">{anonymous ? '門票' : '嘉賓'}</span>
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
                  <option value="time">簽到時間</option>
                  <option value="status">未到優先</option>
                </select>
              </label>
            </div>
          </div>

          {index.length === 0 ? (
            <div className="card">
              <EmptyState
                art={<GuestsArt />}
                zh={anonymous ? '還沒有門票。' : '還沒有嘉賓。'}
                en={anonymous ? 'No tickets yet.' : 'No guests yet.'}
                action={
                  anonymous ? (
                    <button className="btn btn-primary" onClick={openGen}>
                      <Ticket size={18} /> 產生門票
                    </button>
                  ) : (
                    <Link to={`/e/${ev.id}/guests/new`} className="btn btn-primary">
                      <Plus size={18} /> 新增嘉賓
                    </Link>
                  )
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
                    <SwipeRow open={swiped === e.p.id} onOpen={(o) => setSwiped(o ? e.p.id : '')} onDelete={() => (setDelGuest(e.p), setSwiped(''))}>
                    <GuestRow
                      e={e}
                      selected={e.p.id === gid}
                      souvenir={!gift && collected.has(e.p.id)}
                      seating={hasSeating}
                      mark={
                        gift ? (
                          collected.has(e.p.id) ? <Seal className="gift-seal" text="領" /> : <span className="gift-seal empty" aria-label="未領取" />
                        ) : undefined
                      }
                      onClick={() => nav(`/e/${ev.id}/guests/${e.p.id}${params.size ? `?${params}` : ''}`)}
                      onMarkClick={gift ? () => giveFromList(e) : async () => {
                        if (e.p.attendance !== 'not_arrived') return setUndoP(e.p)
                        await checkIn(e.p, 'SEARCH', 'checkin', '', e.tickets[0])
                        feedback('valid')
                        toast(`✓ ${nameOf(e.p)} 已簽到`)
                      }}
                    />
                    </SwipeRow>
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
      <Sheet open={!!giftFor} onClose={() => setGiftFor(null)} title={`派發給 ${giftFor ? nameOf(giftFor.p) : ''}`}>
        <div className="menu-list">
          <button
            className="menu-item"
            onClick={async () => {
              if (!giftFor) return
              const e = giftFor
              setGiftFor(null)
              const o = await verifyAllSouvenirs(ev.id, '', 'SEARCH', e.p.id)
              feedback(o.result === 'valid' ? 'valid' : 'invalid')
              toast(o.result === 'valid' ? `✓ ${nameOf(e.p)} 已領取 ${o.souvenir?.item.name ?? ''}` : o.reason ?? '未能派發')
            }}
          >
            <strong>全部禮品（一次派齊）</strong>
          </button>
          {listItems.map((item) => (
            <button key={item.id} className="menu-item" onClick={() => giftFor && giveItem(item, giftFor)}>
              {item.name}
            </button>
          ))}
        </div>
      </Sheet>
      <Sheet
        open={!!gen}
        onClose={() => setGen(null)}
        title="產生不記名門票"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setGen(null)}>
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={async () => {
                if (!gen) return
                const r = await generateTickets(ev.id, gen)
                setGen(null)
                toast(r.created ? `已產生 ${r.created} 張門票（${r.first} – ${r.last}）${r.skipped ? `，略過 ${r.skipped} 張重複票號` : ''}` : '全部票號已存在，未有新增')
              }}
            >
              產生
            </button>
          </>
        }
      >
        {gen && (
          <>
            <div className="field-row">
              <label className="field">
                <span>票號前綴 Prefix</span>
                <input value={gen.prefix} onChange={(e) => setGen({ ...gen, prefix: e.target.value })} autoCapitalize="characters" />
              </label>
              <label className="field">
                <span>由幾號開始 Start</span>
                <input type="number" min={1} value={gen.start} onChange={(e) => setGen({ ...gen, start: Number(e.target.value) })} />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>數量 Quantity（最多 5000）</span>
                <input type="number" min={1} max={5000} value={gen.count} onChange={(e) => setGen({ ...gen, count: Number(e.target.value) })} />
              </label>
              <label className="field">
                <span>每張票人數 Persons / Ticket</span>
                <input type="number" min={1} max={20} value={gen.guestCount} onChange={(e) => setGen({ ...gen, guestCount: Number(e.target.value) })} />
              </label>
            </div>
            <p className="hint">
              票號示例：
              <code>
                {gen.prefix ? `${gen.prefix.toUpperCase()}-` : ''}
                {String(gen.start).padStart(Math.max(4, String(gen.start + gen.count - 1).length), '0')}
              </code>{' '}
              至{' '}
              <code>
                {gen.prefix ? `${gen.prefix.toUpperCase()}-` : ''}
                {String(gen.start + gen.count - 1).padStart(Math.max(4, String(gen.start + gen.count - 1).length), '0')}
              </code>
              。票號會印在門票上方便核對；QR Code 內容則是 8 位隨機編號，防止偽造。列印 QR 門票將在第 4 階段加入。
            </p>
          </>
        )}
      </Sheet>
      <ConfirmSheet
        open={!!delGuest}
        onClose={() => setDelGuest(null)}
        onConfirm={async () => {
          if (!delGuest) return
          await deleteGuestPermanently(delGuest)
          toast(`已刪除 ${nameOf(delGuest)}`)
          if (gid === delGuest.id) nav(`/e/${ev.id}/guests`)
        }}
        title="刪除嘉賓"
        message={<p>永久刪除「{delGuest && nameOf(delGuest)}」及其門票、座位、簽到及點名紀錄？<strong>無法復原</strong>。只是不來的話，可在詳情按「取消嘉賓」。</p>}
        confirmText="刪除"
        danger
      />
      <ConfirmSheet
        open={!!undoP}
        onClose={() => setUndoP(null)}
        onConfirm={async () => {
          if (undoP) await undoCheckIn(undoP)
          toast('已取消簽到')
        }}
        title="取消簽到"
        message={<p>把 {undoP && nameOf(undoP)} 改回「未到」？此操作會記錄在操作紀錄。</p>}
        confirmText="取消簽到"
      />
      {!gid && wide && index.length > 0 && (
        <aside className="guests-detail placeholder">
          <p className="muted center">點選左邊嘉賓查看詳情</p>
        </aside>
      )}
    </div>
  )
}
