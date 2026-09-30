import { useMemo, useRef, useState } from 'react'
import { DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { busRows, defaultLayout } from '../lib/busLayout'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Eraser, LogOut, Phone, Printer, Undo2, Plus, ScanLine, Trash2, TriangleAlert } from 'lucide-react'
import { db } from '../db/db'
import type { EventRec } from '../db/types'
import { clearSession, createSession, deleteSession, moveBusSeat, setAttendance, undoMoveSeat } from '../lib/actions'
import { feedback } from '../lib/feedback'
import { useEventData } from '../lib/hooks'
import type { GuestEntry } from '../lib/search'
import { cx, pct } from '../lib/util'
import { StatusIcon } from '../components/StatusIcon'
import { BusArt } from '../illustrations'
import { ConfirmSheet, EmptyState, FilterChip, PageHeader, ProgressBar, Sheet, toast } from '../components/ui'
import { nameOf, names } from '../lib/names'

const TEMPLATES = [
  ['酒店出發 Hotel Departure', '08:00'],
  ['早上出發 Morning Departure', '09:00'],
  ['景點集合 Attraction Meeting', '11:30'],
  ['午餐後出發 Lunch Departure', '13:30'],
  ['傍晚出發 Evening Departure', '17:30'],
  ['回酒店 Hotel Return', '20:00'],
]

export default function RollCall() {
  const ev = useOutletContext<EventRec>()
  const nav = useNavigate()
  const sessions = useLiveQuery(() => db.sessions.where('eventId').equals(ev.id).sortBy('time'), [ev.id])
  const attendance = useLiveQuery(() => db.attendance.where('eventId').equals(ev.id).toArray(), [ev.id]) ?? []
  const active = useLiveQuery(() => db.participants.where('eventId').equals(ev.id).filter((p) => p.status === 'active' && !p.giftOnly).toArray(), [ev.id]) ?? []
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ name: '', time: '', location: '', notes: '' })

  const create = async () => {
    if (!f.name.trim()) return toast('請輸入點名名稱')
    const s = await createSession(ev.id, f.name.trim(), f.time, f.location, f.notes)
    setOpen(false)
    setF({ name: '', time: '', location: '', notes: '' })
    nav(`/e/${ev.id}/rollcall/${s.id}`)
  }

  if (!sessions) return <div className="page" />
  return (
    <div className="page">
      <PageHeader
        zh="點名"
        en="Roll Call"
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
            <Plus size={18} /> 新點名
          </button>
        }
      />
      {sessions.length === 0 ? (
        <EmptyState
          art={<BusArt />}
          zh="還沒有點名。"
          en="No roll calls yet."
          action={
            <button className="btn btn-primary" onClick={() => setOpen(true)}>
              <Plus size={18} /> 新點名
            </button>
          }
        />
      ) : (
        <div className="session-list card">
          {sessions.map((s) => {
            const hereIds = new Set(attendance.filter((a) => a.sessionId === s.id && a.status === 'present').map((a) => a.participantId))
            // 中途離開的人：只有在這次點名已點到才計算，否則不用點名
            const counted = active.filter((p) => !p.leftAt || hereIds.has(p.id))
            const total = counted.length
            const present = counted.filter((p) => hereIds.has(p.id)).length
            return (
              <Link key={s.id} to={`/e/${ev.id}/rollcall/${s.id}`} className="session-row">
                <span className="session-name">
                  <strong>{s.name}</strong>
                  <span className="muted">
                    {s.time} {s.location && `· ${s.location}`}
                  </span>
                </span>
                <span className={cx('session-count', present === total && 'done')}>
                  {present} / {total} {present === total ? '✓' : `· 缺 ${total - present}`}
                </span>
                <ProgressBar value={present} max={total} tone={present === total ? 'ok' : 'mode'} />
              </Link>
            )
          })}
        </div>
      )}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="新點名 New Roll Call"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>
              取消
            </button>
            <button className="btn btn-primary" onClick={create}>
              建立並開始
            </button>
          </>
        }
      >
        <p className="field-label">範本 Templates</p>
        <div className="chips">
          {TEMPLATES.map(([n, t]) => (
            <button key={n} className={cx('chip', f.name === n && 'active')} onClick={() => setF((x) => ({ ...x, name: n, time: t }))}>
              {n.split(' ')[0]}
            </button>
          ))}
        </div>
        <label className="field">
          <span>名稱 Session Name</span>
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <div className="field-row">
          <label className="field">
            <span>時間 Time</span>
            <input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
          </label>
          <label className="field">
            <span>地點 Location</span>
            <input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
          </label>
        </div>
        <label className="field">
          <span>備註 Notes</span>
          <input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </label>
      </Sheet>
    </div>
  )
}

export function RollCallSession() {
  const ev = useOutletContext<EventRec>()
  const { sid } = useParams()
  const nav = useNavigate()
  const session = useLiveQuery(() => (sid ? db.sessions.get(sid) : undefined), [sid])
  const recs = useLiveQuery(() => (sid ? db.attendance.where('sessionId').equals(sid).toArray() : []), [sid]) ?? []
  const { data, index } = useEventData(ev.id)
  const [bus, setBus] = useState<string>('all')
  const [confirmDel, setConfirmDel] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const present = useMemo(() => new Set(recs.filter((r) => r.status === 'present').map((r) => r.participantId)), [recs])
  const buses = data?.resources.filter((r) => r.type === 'bus') ?? []
  const people = useMemo(() => {
    // 中途離開的人不用再點名（這次點名已點到的仍然保留）
    const active = index.filter((e) => e.p.status === 'active' && !e.p.giftOnly && (!e.p.leftAt || present.has(e.p.id)))
    const inBus = bus === 'all' ? active : active.filter((e) => e.seats.some((s) => s.resource.id === bus))
    const busSeat = (e: GuestEntry) => e.seats.find((s) => s.resource.type === 'bus')
    return inBus.sort((a, b) => {
      const sa = busSeat(a),
        sb = busSeat(b)
      return (sa?.resource.label ?? '').localeCompare(sb?.resource.label ?? '') || Number(sa?.seatLabel || 999) - Number(sb?.seatLabel || 999)
    })
  }, [index, bus, present])

  if (!session || !data) return <div className="page" />
  const total = people.length
  const here = people.filter((e) => present.has(e.p.id)).length
  const missing = people.filter((e) => !present.has(e.p.id))
  const leftOut = index.filter((e) => e.p.status === 'active' && e.p.leftAt && !present.has(e.p.id) && (bus === 'all' || e.seats.some((s) => s.resource.id === bus)))

  const toggle = async (e: GuestEntry) => {
    const isHere = present.has(e.p.id)
    feedback('tap')
    await setAttendance(session.id, ev.id, e.p, !isHere)
  }

  const Row = ({ e, warn }: { e: GuestEntry; warn?: boolean }) => {
    const isHere = present.has(e.p.id)
    const bs = e.seats.find((s) => s.resource.type === 'bus')
    return (
      <div className={cx('rc-row', isHere && 'here', warn && 'warn')}>
        <button className="rc-main" onClick={() => toggle(e)} aria-pressed={isHere}>
          <span className="rc-mark">
            <StatusIcon kind={isHere ? 'arrived' : warn ? 'warn' : 'not_arrived'} size={36} />
          </span>
          <span className="rc-name">
            <strong>{names(e.p).primary}</strong>
            <span className="muted">
              {names(e.p).secondary}
              {e.sameName && ` · 同名 #${e.p.memberId}`}
            </span>
          </span>
          <span className="rc-seat">{bs ? `${bs.resource.label}-${bs.seatLabel}` : ''}</span>
        </button>
        {warn && e.p.phone && (
          <a className="icon-btn" href={`tel:${e.p.phone.replace(/\s+/g, '')}`} aria-label={`致電 ${nameOf(e.p)}`}>
            <Phone size={18} />
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="page narrow rollcall">
      <PageHeader
        zh={session.name.split(' ')[0]}
        en={`${session.time}${session.location ? ` · ${session.location}` : ''}`}
        back={`/e/${ev.id}/rollcall`}
        actions={
          <Link to={`/e/${ev.id}/scan?p=r:${session.id}`} className="btn btn-primary btn-sm">
            <ScanLine size={18} /> 掃描
          </Link>
        }
      />

      <div className="rc-stats">
        <div>
          <small>總數 TOTAL</small>
          <strong>{total}</strong>
        </div>
        <div className="tone-ok">
          <small>已到 PRESENT</small>
          <strong>{here}</strong>
        </div>
        <div className={missing.length ? 'tone-warn' : 'tone-ok'}>
          <small>缺席 MISSING</small>
          <strong>{missing.length}</strong>
        </div>
        <div>
          <small>出席率</small>
          <strong>{pct(here, total)}%</strong>
        </div>
      </div>

      {buses.length > 1 && (
        <div className="chips">
          <FilterChip active={bus === 'all'} onClick={() => setBus('all')}>
            全部
          </FilterChip>
          {buses.map((b) => (
            <FilterChip key={b.id} active={bus === b.id} onClick={() => setBus(b.id)}>
              {b.label} 車
            </FilterChip>
          ))}
        </div>
      )}

      {missing.length > 0 && missing.length < total && (
        <section className="rc-missing">
          <h3>
            <TriangleAlert size={18} /> 缺席 Missing · {missing.length}
          </h3>
          {missing.map((e) => (
            <Row key={e.p.id} e={e} warn />
          ))}
        </section>
      )}
      {missing.length === 0 && total > 0 && <div className="checked-box tone-ok center">
          <StatusIcon kind="arrived" size={20} /> 全部到齊 All present
        </div>}

      <section className="rc-all">
        <h3>全部乘客 All Passengers</h3>
        {people.map((e) => (
          <Row key={e.p.id} e={e} />
        ))}
      </section>

      {leftOut.length > 0 && (
        <section className="rc-all rc-left">
          <h3>
            <LogOut size={18} /> 已中途離開（不用點名）· {leftOut.length}
          </h3>
          <div className="list card">
            {leftOut.map((e) => (
              <Link key={e.p.id} to={`/e/${ev.id}/guests/${e.p.id}`} className="rc-left-row">
                <strong>{names(e.p).primary}</strong>
                <span className="muted">{names(e.p).secondary}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="rc-manage card">
        <div>
          <button className="btn btn-ghost" onClick={() => setConfirmClear(true)} disabled={recs.length === 0}>
            <Eraser size={18} /> 清空
          </button>
          <span className="muted">保留這個點名，所有人改回「未到」，重新點名</span>
        </div>
        <div>
          <button className="btn btn-danger-ghost" onClick={() => setConfirmDel(true)}>
            <Trash2 size={18} /> 刪除
          </button>
          <span className="muted">整個點名環節連同紀錄一併刪除</span>
        </div>
      </section>

      <ConfirmSheet
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={async () => {
          await clearSession(session.id, ev.id, session.name)
          toast('已清空，可以重新點名')
        }}
        title="清空點名"
        message={
          <p>
            把「{session.name}」已點的 {present.size} 人全部改回「未到」？點名環節會保留，可以重新點名。
          </p>
        }
        confirmText="清空"
        danger
      />
      <ConfirmSheet
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        onConfirm={async () => {
          await deleteSession(session.id, ev.id, session.name)
          toast('已刪除點名')
          nav(`/e/${ev.id}/rollcall`)
        }}
        title="刪除點名"
        message={<p>刪除「{session.name}」這個點名環節及其所有點名紀錄？刪除後不能復原。</p>}
        confirmText="刪除"
        danger
      />
    </div>
  )
}

export function BusSeats() {
  const ev = useOutletContext<EventRec>()
  const nav = useNavigate()
  const { data, index } = useEventData(ev.id)
  // 拖拉乘客到另一個座位（可跨車）：電腦按住移動即拖；手機按住約 0.3 秒才開始
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }))
  const history = useRef<Awaited<ReturnType<typeof moveBusSeat>>[]>([])
  const lastDrag = useRef(0)
  const [dragging, setDragging] = useState<GuestEntry | null>(null)
  const [, force] = useState(0)
  if (!data) return <div className="page" />
  const buses = data.resources.filter((r) => r.type === 'bus')
  if (!buses.length)
    return (
      <div className="page">
        <EmptyState art={<BusArt />} zh="還沒有設定巴士。" en="No buses yet." action={<Link className="btn btn-primary" to={`/e/${ev.id}/edit`}>設定巴士</Link>} />
      </div>
    )
  const byId = new Map(index.map((e) => [e.p.id, e]))
  const onDragEnd = async (evt: DragEndEvent) => {
    setDragging(null)
    lastDrag.current = Date.now()
    if (!evt.over) return
    const pid = String(evt.active.id).slice(2)
    const [, busId, seat] = String(evt.over.id).split('|')
    const e = byId.get(pid)
    if (!e || e.seats.some((s) => s.resource.id === busId && s.seatLabel === seat)) return
    history.current.push(await moveBusSeat(ev.id, pid, { resourceId: busId, seatLabel: seat }))
    force((n) => n + 1)
    toast(`${nameOf(e.p)} → ${buses.find((b) => b.id === busId)?.label} 車 ${seat} 號`)
  }
  const undo = async () => {
    const snap = history.current.pop()
    if (!snap) return
    await undoMoveSeat(ev.id, snap)
    force((n) => n + 1)
    toast('已復原上一次調位')
  }
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(e) => setDragging(byId.get(String(e.active.id).slice(2)) ?? null)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
      autoScroll
    >
      <div className="page">
        <div className="seatlist-head">
          <span className="muted">拖拉名字可調整座位（手機：按住約半秒），目標有人會對調，亦可拖到另一架車；點名字看詳情。座位排列可在「修改活動」更改。</span>
          <span className="seatlist-tools">
            <Link className="btn btn-ghost btn-sm" to={`/e/${ev.id}/print?type=bus`}>
              <Printer size={16} /> 列印
            </Link>
            <button className="btn btn-ghost btn-sm" onClick={undo} disabled={!history.current.length}>
              <Undo2 size={16} /> 復原
            </button>
          </span>
        </div>
        {buses.map((b) => {
          const bySeat = new Map<string, GuestEntry>()
          index.forEach((e) => e.seats.forEach((s) => s.resource.id === b.id && e.p.status === 'active' && bySeat.set(s.seatLabel, e)))
          const layout = ev.modeConfig.buses?.find((x) => x.label === b.label)?.layout ?? defaultLayout(b.capacity)
          const rows = busRows(b.capacity, layout)
          const cols = rows[0]?.length ?? 5
          return (
            <section key={b.id} className="card bus-block">
              <h2 className="bus-title">
                {b.label} 車{' '}
                <small>
                  Bus {b.label} · {bySeat.size} / {b.capacity} · {layout.replace('+', '＋')} 排列
                </small>
              </h2>
              <div className="bus-grid" style={{ maxWidth: cols * 100 }}>
                <div className="bus-front">車頭 Front</div>
                {rows.map((row, r) => (
                  <div className="bus-row" key={r} style={{ gridTemplateColumns: row.map((n) => (n === null ? '18px' : 'minmax(0, 1fr)')).join(' ') }}>
                    {row.map((n, k) =>
                      n === null ? (
                        <span key={k} className="bus-aisle" />
                      ) : n === 0 ? (
                        <span key={k} />
                      ) : (
                        <BusSeat
                          key={k}
                          id={`seat|${b.id}|${n}`}
                          n={n}
                          e={bySeat.get(String(n))}
                          onOpen={(e) => Date.now() - lastDrag.current > 400 && nav(`/e/${ev.id}/guests/${e.p.id}`)}
                        />
                      ),
                    )}
                  </div>
                ))}
              </div>
            </section>
          )
        })}
      </div>
      <DragOverlay dropAnimation={null}>{dragging ? <div className="guest-chip dragging">{nameOf(dragging.p)}</div> : null}</DragOverlay>
    </DndContext>
  )
}

function BusSeat({ id, n, e, onOpen }: { id: string; n: number; e?: GuestEntry; onOpen: (e: GuestEntry) => void }) {
  const drop = useDroppable({ id })
  const drag = useDraggable({ id: `g:${e?.p.id ?? 'none-' + id}`, disabled: !e })
  return (
    <div ref={drop.setNodeRef} className={cx('bus-cell', drop.isOver && 'drop')}>
      <button
        ref={drag.setNodeRef}
        {...drag.listeners}
        {...drag.attributes}
        className={cx('bus-seat', e && 'taken', e && e.p.attendance !== 'not_arrived' && 'arrived', !!e?.p.leftAt && 'left', drag.isDragging && 'ghost')}
        onClick={() => e && onOpen(e)}
        title={e ? `${names(e.p).full}${e.p.leftAt ? '（已中途離開）' : ''}` : `${n} 號空位`}
      >
        <small>{n}</small>
        <span>{e ? nameOf(e.p) : ''}</span>
      </button>
    </div>
  )
}
