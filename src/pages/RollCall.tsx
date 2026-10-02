import { useMemo, useRef, useState, type ReactNode } from 'react'
import { DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { busRows, defaultLayout } from '../lib/busLayout'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Clock, Flag, LogOut, MoreHorizontal, RotateCcw, Phone, Printer, Undo2, Plus, ScanLine, Trash2, TriangleAlert } from 'lucide-react'
import { db } from '../db/db'
import type { AttendanceSession, EventRec, RollStatus } from '../db/types'
import { ROLL_LABEL, clearSession, closeSession, createSession, deleteSession, moveBusSeat, reopenSession, setRollStatus, undoMoveSeat } from '../lib/actions'
import { feedback } from '../lib/feedback'
import { useEventData } from '../lib/hooks'
import type { GuestEntry } from '../lib/search'
import { cx, formatTime } from '../lib/util'
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
  const [selecting, setSelecting] = useState(false) // 選擇刪除
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [toDelete, setToDelete] = useState<AttendanceSession[]>([])
  const [swiped, setSwiped] = useState('') // 向左拉開了刪除按鈕的點名

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
          <>
            {sessions.length > 0 &&
              (selecting ? (
                <>
                  <button className="btn btn-ghost btn-sm" onClick={() => (setSelecting(false), setPicked(new Set()))}>
                    取消
                  </button>
                  <button className="btn btn-danger-ghost btn-sm" disabled={!picked.size} onClick={() => setToDelete(sessions.filter((x) => picked.has(x.id)))}>
                    <Trash2 size={16} /> 刪除（{picked.size}）
                  </button>
                </>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={() => (setSelecting(true), setSwiped(''))}>
                  選擇
                </button>
              ))}
            {!selecting && (
              <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
                <Plus size={18} /> 新點名
              </button>
            )}
          </>
        }
      />
      {sessions.length > 0 && !selecting && <p className="hint">向左拉可刪除點名，或按「選擇」一次刪除多個。</p>}
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
              <SwipeRow
                key={s.id}
                open={swiped === s.id}
                onOpen={(o) => setSwiped(o ? s.id : '')}
                onDelete={() => setToDelete([s])}
                selecting={selecting}
                checked={picked.has(s.id)}
                onToggle={() => setPicked((p) => {
                  const n = new Set(p)
                  if (n.has(s.id)) n.delete(s.id)
                  else n.add(s.id)
                  return n
                })}
                to={`/e/${ev.id}/rollcall/${s.id}`}
              >
                <span className="session-name">
                  <strong>{s.name}</strong>
                  <span className="muted">
                    {s.time} {s.location && `· ${s.location}`}
                  </span>
                </span>
                <span className={cx('session-count', present === total && 'done')}>
                  {present} / {total} 已上車
                  {present === total ? ' ✓' : s.closedAt ? ` · 已結束 · 未到 ${attendance.filter((a) => a.sessionId === s.id && a.status === 'no_show').length}` : ` · 待上車 ${total - present}`}
                </span>
                <ProgressBar value={present} max={total} tone={present === total ? 'ok' : 'mode'} />
              </SwipeRow>
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
      <ConfirmSheet
        open={toDelete.length > 0}
        onClose={() => setToDelete([])}
        onConfirm={async () => {
          for (const x of toDelete) await deleteSession(x.id, ev.id, x.name)
          toast(`已刪除 ${toDelete.length} 個點名`)
          setPicked(new Set())
          setSelecting(false)
          setSwiped('')
        }}
        title="刪除點名"
        message={
          <p>
            刪除{toDelete.length === 1 ? `「${toDelete[0].name}」` : ` ${toDelete.length} 個點名`}及其所有點名紀錄？刪除後不能復原。
          </p>
        }
        confirmText="刪除"
        danger
      />
    </div>
  )
}

// 點名列表的一行：向左拉露出「刪除」；選擇模式下變成剔選框
function SwipeRow({ to, children, open, onOpen, onDelete, selecting, checked, onToggle }: { to: string; children: ReactNode; open: boolean; onOpen: (o: boolean) => void; onDelete: () => void; selecting: boolean; checked: boolean; onToggle: () => void }) {
  const nav = useNavigate()
  const start = useRef<{ x: number; y: number; dx: number; moved: boolean } | null>(null)
  const [dx, setDx] = useState(0)
  const W = 88
  const offset = selecting ? 0 : start.current?.moved ? dx : open ? -W : 0
  return (
    <div className="swipe-row">
      <button className="swipe-del" onClick={onDelete} tabIndex={open ? 0 : -1} aria-hidden={!open}>
        <Trash2 size={18} /> 刪除
      </button>
      <div
        className={cx('session-row', 'swipe-front', selecting && 'selecting')}
        style={{ transform: `translateX(${offset}px)`, transition: start.current?.moved ? 'none' : undefined }}
        role="link"
        tabIndex={0}
        onPointerDown={(e) => {
          if (selecting) return
          start.current = { x: e.clientX, y: e.clientY, dx: open ? -W : 0, moved: false }
          e.currentTarget.setPointerCapture?.(e.pointerId)
        }}
        onPointerMove={(e) => {
          const s = start.current
          if (!s) return
          const mx = e.clientX - s.x
          if (!s.moved && Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(e.clientY - s.y)) s.moved = true
          if (s.moved) setDx(Math.max(-W - 20, Math.min(0, s.dx + mx)))
        }}
        onPointerUp={() => {
          const s = start.current
          start.current = null
          if (s?.moved) onOpen(dx < -W / 2)
          else if (selecting) onToggle()
          else if (open) onOpen(false)
          else nav(to)
          setDx(0)
        }}
        onPointerCancel={() => ((start.current = null), setDx(0))}
        onKeyDown={(e) => e.key === 'Enter' && (selecting ? onToggle() : nav(to))}
      >
        {selecting && <span className={cx('swipe-check', checked && 'on')} aria-checked={checked} role="checkbox" />}
        {children}
      </div>
    </div>
  )
}

const ICON = { present: 'arrived', pending: 'waiting', on_the_way: 'otw', excused: 'excused', no_show: 'warn' } as const

export function RollCallSession() {
  const ev = useOutletContext<EventRec>()
  const { sid } = useParams()
  const session = useLiveQuery(() => (sid ? db.sessions.get(sid) : undefined), [sid])
  const recs = useLiveQuery(() => (sid ? db.attendance.where('sessionId').equals(sid).toArray() : []), [sid]) ?? []
  const { data, index } = useEventData(ev.id)
  const [bus, setBus] = useState<string>('all')
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [confirmReopen, setConfirmReopen] = useState(false)
  const [menu, setMenu] = useState<GuestEntry | null>(null) // 單人狀態選單
  const [view, setView] = useState<'all' | RollStatus | 'pending'>('all') // 按頂部數字只看某一類
  const [flash, setFlash] = useState('') // 剛點選上車的人：綠色勾號效果

  // 每人狀態：沒有紀錄（或舊資料 absent）= 待上車
  const recOf = useMemo(() => new Map(recs.map((r) => [r.participantId, r])), [recs])
  const statusOf = (pid: string): RollStatus | 'pending' => {
    const st = recOf.get(pid)?.status
    return !st || st === 'absent' ? 'pending' : st
  }
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
  const closed = !!session.closedAt
  const by = (st: RollStatus | 'pending') => people.filter((e) => statusOf(e.p.id) === st)
  const total = people.length
  const here = by('present')
  const waiting = [...by('on_the_way'), ...by('pending')] // 點名進行中：在途中排先
  const excused = by('excused')
  const noShow = by('no_show')
  const leftOut = index.filter((e) => e.p.status === 'active' && e.p.leftAt && !present.has(e.p.id) && (bus === 'all' || e.seats.some((s) => s.resource.id === bus)))
  const pendingAll = index.filter((e) => e.p.status === 'active' && !e.p.giftOnly && !e.p.leftAt && statusOf(e.p.id) === 'pending')

  // 點一下名字：未上車 → 已上車；已上車 → 待上車（點名結束後補登會記為遲到）
  const toggle = async (e: GuestEntry) => {
    const toPresent = statusOf(e.p.id) !== 'present'
    feedback(toPresent ? 'valid' : 'tap')
    await setRollStatus(session.id, ev.id, e.p, toPresent ? 'present' : closed ? 'no_show' : 'pending')
    if (toPresent) {
      setFlash(e.p.id)
      window.setTimeout(() => setFlash((f) => (f === e.p.id ? '' : f)), 900)
    }
  }

  const Row = ({ e }: { e: GuestEntry }) => {
    const st = statusOf(e.p.id)
    const rec = recOf.get(e.p.id)
    const bs = e.seats.find((s) => s.resource.type === 'bus')
    const icon = ICON[st]
    return (
      <div className={cx('rc-row', flash === e.p.id && 'just', st === 'present' && 'here', st === 'pending' && 'waiting', st === 'no_show' && 'noshow', st === 'on_the_way' && 'otw', st === 'excused' && 'excused')}>
        <button className="rc-main" onClick={() => toggle(e)} aria-pressed={st === 'present'}>
          <span className="rc-mark">
            <StatusIcon kind={icon} size={36} />
          </span>
          <span className="rc-name">
            <strong>{names(e.p).primary}</strong>
            <span className="muted">
              {names(e.p).secondary}
              {e.sameName && ` · 同名 #${e.p.memberId}`}
            </span>
          </span>
          {st !== 'pending' && (
            <span className={cx('rc-status', `st-${st}`)}>
              {ROLL_LABEL[st]}
              {rec?.late && '（遲到）'}
              {st === 'present' && rec && <small>{formatTime(rec.checkedAt)}</small>}
            </span>
          )}
          <span className="rc-seat">{bs ? `${bs.resource.label}-${bs.seatLabel}` : ''}</span>
        </button>
        {st !== 'present' && e.p.phone && (
          <a className="icon-btn" href={`tel:${e.p.phone.replace(/\s+/g, '')}`} aria-label={`致電 ${nameOf(e.p)}`}>
            <Phone size={18} />
          </a>
        )}
        <button className="icon-btn" aria-label={`更改 ${nameOf(e.p)} 的狀態`} onClick={() => setMenu(e)}>
          <MoreHorizontal size={18} />
        </button>
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
          <>
            {/* 一鍵重點：保留這個點名，所有人改回「待上車」 */}
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(true)} disabled={recs.length === 0}>
              <RotateCcw size={16} /> 重新點名
            </button>
            <Link to={`/e/${ev.id}/scan?p=r:${session.id}`} className="btn btn-primary btn-sm">
              <ScanLine size={18} /> 掃描
            </Link>
          </>
        }
      />

      {/* 頂部數字可以按：只看該類名單；再按一次回到全部 */}
      <div className="rc-stats">
        {(
          [
            ['present', '已上車', here.length, 'tone-ok'] as const,
            closed ? ['no_show', '未到', noShow.length, noShow.length ? 'tone-bad' : 'tone-ok'] : ['pending', '待上車', by('pending').length, by('pending').length ? 'tone-warn' : 'tone-ok'],
            ['on_the_way', '在途中', by('on_the_way').length, by('on_the_way').length ? 'tone-info' : ''],
            ['excused', '請假', excused.length, ''],
          ] as [RollStatus | 'pending', string, number, string][]
        ).map(([k, zh, n, tone]) => (
          <button key={k} className={cx(tone, view === k && 'active')} aria-pressed={view === k} onClick={() => setView(view === k ? 'all' : k)}>
            <small>{zh}</small>
            <strong>
              {n}
              {k === 'present' && <span className="rc-of">/{total}</span>}
            </strong>
          </button>
        ))}
      </div>

      {closed && (
        <div className="rc-closed">
          <span>
            <Flag size={16} /> 已於 {formatTime(session.closedAt!)} 結束點名{session.closedBy ? `（${session.closedBy}）` : ''}。遲到的人點名字即可補登上車。
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmReopen(true)}>
            重新開放
          </button>
        </div>
      )}

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

      {view !== 'all' ? (
        <section className="rc-all">
          <h3>
            {ROLL_LABEL[view]} · {by(view).length}
            <button className="btn btn-ghost btn-sm rc-showall" onClick={() => setView('all')}>
              顯示全部
            </button>
          </h3>
          {by(view).length ? by(view).map((e) => <Row key={e.p.id} e={e} />) : <p className="muted pad center">沒有{ROLL_LABEL[view]}的人</p>}
        </section>
      ) : (
        <>
      {!closed && waiting.length > 0 && waiting.length < total && (
        <section className="rc-missing rc-waiting">
          <h3>
            <Clock size={18} /> 待上車 · {waiting.length}
          </h3>
          {waiting.map((e) => (
            <Row key={e.p.id} e={e} />
          ))}
        </section>
      )}
      {closed && noShow.length > 0 && (
        <section className="rc-missing">
          <h3>
            <TriangleAlert size={18} /> 未到 · {noShow.length}
          </h3>
          {noShow.map((e) => (
            <Row key={e.p.id} e={e} />
          ))}
        </section>
      )}
      {waiting.length === 0 && noShow.length === 0 && total > 0 && (
        <div className="checked-box tone-ok center">
          <StatusIcon kind="arrived" size={20} /> 全部到齊{excused.length ? `（請假 ${excused.length} 人）` : ''}
        </div>
      )}
      {excused.length > 0 && (
        <section className="rc-all">
          <h3>請假 · {excused.length}（座位保留，可釋出）</h3>
          {excused.map((e) => (
            <Row key={e.p.id} e={e} />
          ))}
        </section>
      )}

      <section className="rc-all">
        <h3>全部乘客 All Passengers</h3>
        {/* 已上車的人移到最底，未處理的人留在上面 */}
        {[...people.filter((e) => statusOf(e.p.id) !== 'present'), ...here].map((e) => (
          <Row key={e.p.id} e={e} />
        ))}
      </section>

        </>
      )}

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

      {!closed && (
        <button className="btn btn-primary btn-lg btn-block rc-close" onClick={() => setConfirmClose(true)}>
          <Flag size={20} /> 結束點名／確認發車
        </button>
      )}


      <Sheet open={!!menu} onClose={() => setMenu(null)} title={menu ? `${nameOf(menu.p)} · 點名狀態` : ''}>
        {menu && (
          <div className="rc-menu">
            {(['present', 'on_the_way', 'excused', closed ? 'no_show' : 'pending'] as const).map((st) => (
              <button
                key={st}
                className={cx('menu-item', statusOf(menu.p.id) === st && 'active')}
                onClick={async () => {
                  await setRollStatus(session.id, ev.id, menu.p, st)
                  setMenu(null)
                  toast(`${nameOf(menu.p)}：${ROLL_LABEL[st]}`)
                }}
              >
                <StatusIcon kind={ICON[st]} size={22} />
                <span>
                  <strong>{ROLL_LABEL[st]}</strong>
                  <small>
                    {st === 'present'
                      ? closed
                        ? '點名已結束，會記為遲到'
                        : '已核實上車'
                      : st === 'on_the_way'
                        ? '已聯絡，正在趕來（避免重複催促）'
                        : st === 'excused'
                          ? '事前告知不來；座位保留，可釋出'
                          : st === 'no_show'
                            ? '點名結束時仍未到'
                            : '還未上車'}
                  </small>
                </span>
              </button>
            ))}
          </div>
        )}
      </Sheet>

      <ConfirmSheet
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={async () => {
          await closeSession(session.id, ev.id, pendingAll.map((e) => e.p.id))
          toast(pendingAll.length ? `已結束點名，${pendingAll.length} 人記為未到` : '已結束點名，全部到齊')
        }}
        title="結束點名／確認發車"
        message={
          <p>
            已上車 {by('present').length} 人。仍「待上車」的 {pendingAll.length} 人會記為「未到」
            {by('on_the_way').length ? `；在途中 ${by('on_the_way').length} 人維持「在途中」` : ''}
            {excused.length ? `；請假 ${excused.length} 人不變` : ''}。之後仍可補登遲到的人，或重新開放點名。
          </p>
        }
        confirmText="結束點名"
      />
      <ConfirmSheet
        open={confirmReopen}
        onClose={() => setConfirmReopen(false)}
        onConfirm={async () => {
          await reopenSession(session.id, ev.id)
          toast('已重新開放，「未到」的人改回待上車')
        }}
        title="重新開放點名"
        message={<p>「未到」的 {noShow.length} 人會改回「待上車」，可以繼續點名。已上車、在途中、請假的紀錄不變。</p>}
        confirmText="重新開放"
      />
      <ConfirmSheet
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={async () => {
          await clearSession(session.id, ev.id, session.name)
          toast('已重設，可以重新點名')
        }}
        title="重新點名"
        message={
          <p>
            把「{session.name}」所有人（已上車 {present.size} 人，以及在途中、請假、未到的標記）全部改回「待上車」，重新點一次？點名環節會保留，此操作會記錄在操作紀錄。
          </p>
        }
        confirmText="重新點名"
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
  // 最近一次點名中「請假」的人：座位保留，但在座位圖上變淡並寫「請假」，方便釋出
  const excusedIds = useLiveQuery(async () => {
    const last = (await db.sessions.where('eventId').equals(ev.id).toArray()).sort((a, b) => b.createdAt - a.createdAt)[0]
    if (!last) return new Set<string>()
    return new Set((await db.attendance.where('sessionId').equals(last.id).toArray()).filter((r) => r.status === 'excused').map((r) => r.participantId))
  }, [ev.id]) ?? new Set<string>()
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
                          excused={excusedIds.has(bySeat.get(String(n))?.p.id ?? '')}
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

function BusSeat({ id, n, e, excused, onOpen }: { id: string; n: number; e?: GuestEntry; excused?: boolean; onOpen: (e: GuestEntry) => void }) {
  const drop = useDroppable({ id })
  const drag = useDraggable({ id: `g:${e?.p.id ?? 'none-' + id}`, disabled: !e })
  return (
    <div ref={drop.setNodeRef} className={cx('bus-cell', drop.isOver && 'drop')}>
      <button
        ref={drag.setNodeRef}
        {...drag.listeners}
        {...drag.attributes}
        className={cx('bus-seat', e && 'taken', e && e.p.attendance !== 'not_arrived' && 'arrived', !!e?.p.leftAt && 'left', excused && 'excused', drag.isDragging && 'ghost')}
        onClick={() => e && onOpen(e)}
        title={e ? `${names(e.p).full}${e.p.leftAt ? '（已中途離開）' : ''}` : `${n} 號空位`}
      >
        <small>{n}{excused && ' · 請假'}</small>
        <span>{e ? nameOf(e.p) : ''}</span>
      </button>
    </div>
  )
}
