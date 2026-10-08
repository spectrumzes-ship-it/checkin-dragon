import { useMemo, useRef, useState } from 'react'
import SwipeRow from '../components/SwipeRow'
import { DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { busRows, defaultLayout } from '../lib/busLayout'
import { setSettings, useSettings } from '../lib/settings'
import { NO_BUS, busClosedAt, isBusClosed, rollCounts, rollPeople, rollStatus, rollSummary } from '../lib/rollcall'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { LogOut, MoreHorizontal, RotateCcw, Phone, Printer, Undo2, Plus, ScanLine, Trash2, Armchair, List, CircleCheck, ChevronLeft } from 'lucide-react'
import { db } from '../db/db'
import type { AttendanceSession, EventRec, RollStatus } from '../db/types'
import { ROLL_LABEL, clearSession, closeSession, createSession, deleteSession, moveBusSeat, reopenSession, setRollStatus, undoMoveSeat } from '../lib/actions'
import { feedback } from '../lib/feedback'
import { useEventData } from '../lib/hooks'
import type { GuestEntry } from '../lib/search'
import { cx, formatTime } from '../lib/util'
import { StatusIcon } from '../components/StatusIcon'
import { BusArt } from '../illustrations'
import { ConfirmSheet, EmptyState, PageHeader, ProgressBar, Sheet, toast } from '../components/ui'
import { nameOf, names } from '../lib/names'

const TEMPLATES = [
  ['酒店出發 Hotel Departure', '08:00'],
  ['早上出發 Morning Departure', '09:00'],
  ['景點集合 Attraction Meeting', '11:30'],
  ['午餐後出發 Lunch Departure', '13:30'],
  ['傍晚出發 Evening Departure', '17:30'],
  ['回酒店 Hotel Return', '20:00'],
]

// 每人坐哪架車（點名按車分開計算）
export const useBusOf = (eventId: string) => {
  const map = useLiveQuery(async () => {
    const buses = new Set((await db.resources.where('eventId').equals(eventId).toArray()).filter((r) => r.type === 'bus').map((r) => r.id))
    return new Map((await db.seats.where('eventId').equals(eventId).toArray()).filter((x) => buses.has(x.resourceId)).map((x) => [x.participantId, x.resourceId]))
  }, [eventId])
  return (pid: string) => map?.get(pid) ?? NO_BUS
}

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
  const busOf = useBusOf(ev.id)

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
            const c = rollCounts(active, s, attendance, busOf)
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
              >
                <Link to={`/e/${ev.id}/rollcall/${s.id}`} className="session-row">
                <span className="session-name">
                  <strong>{s.name}</strong>
                  <span className="muted">
                    {s.time} {s.location && `· ${s.location}`}
                  </span>
                </span>
                <span className={cx('session-count', c.done && 'done')}>{rollSummary(c)}</span>
                <ProgressBar value={c.present} max={c.expected} tone={c.done ? 'ok' : 'mode'} />
                </Link>
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

const ICON = { present: 'arrived', pending: 'waiting', on_the_way: 'otw', excused: 'excused', no_show: 'warn' } as const

// 路線色：每架車一個顏色（像日本鐵路的路線標記），按車的次序分配
const LINE_COLORS = ['#1f4fa3', '#3d7a3a', '#8a4fa8', '#b5701b', '#1b7f8c', '#a8324a']
const lineColor = (i: number) => LINE_COLORS[i % LINE_COLORS.length]

type View = 'roll' | 'present' | 'pending' | 'on_the_way' | 'excused'
const EVERYONE = 'everyone'

export function RollCallSession() {
  const ev = useOutletContext<EventRec>()
  const { sid } = useParams()
  const session = useLiveQuery(() => (sid ? db.sessions.get(sid) : undefined), [sid])
  const recs = useLiveQuery(() => (sid ? db.attendance.where('sessionId').equals(sid).toArray() : []), [sid]) ?? []
  const { data, index } = useEventData(ev.id)
  const [confirmClear, setConfirmClear] = useState(false)
  const [closing, setClosing] = useState<string | null>(null) // 正在確認出發的車（巴士 id 或 'none'）
  const [reopening, setReopening] = useState<string | null>(null)
  const [menu, setMenu] = useState<GuestEntry | null>(null) // 單人狀態選單
  const [view, setView] = useState<View>('roll')
  const [flash, setFlash] = useState('') // 剛點選上車的人：綠色勾號效果
  const [pane, setPane] = useState('') // 點名頁顯示哪一組：巴士 id／'none'／'everyone'（全員名單）
  const swipe = useRef<{ x: number; y: number } | null>(null)
  // 所有裝置預設用座位表點名；可手動改為名單，選擇會記住在這部裝置
  const seatMode = useSettings().rollView !== 'list'

  const recOf = useMemo(() => new Map(recs.map((r) => [r.participantId, r])), [recs])
  const busKey = (e: GuestEntry) => e.seats.find((x) => x.resource.type === 'bus')?.resource.id ?? NO_BUS
  const seatNo = (e: GuestEntry) => Number(e.seats.find((x) => x.resource.type === 'bus')?.seatLabel || 999)
  const people = useMemo(() => rollPeople(index, recOf), [index, recOf])

  if (!session || !data) return <div className="page" />
  const buses = data.resources.filter((r) => r.type === 'bus').sort((a, b) => a.sortOrder - b.sortOrder)
  const statusOf = (e: GuestEntry) => rollStatus(recOf.get(e.p.id), isBusClosed(session, busKey(e)))
  const by = (...st: (RollStatus | 'pending')[]) => people.filter((e) => st.includes(statusOf(e)))
  const present = by('present')
  // 每架車一組（再加「未分車」）；組內按座位號
  const groups = [...buses.map((b) => ({ key: b.id, label: `${b.label} 車` })), { key: NO_BUS, label: '未分車' }]
    .map((g) => ({ ...g, list: people.filter((e) => busKey(e) === g.key).sort((a, b) => seatNo(a) - seatNo(b)) }))
    .filter((g) => g.list.length)
  const leftOut = index.filter((e) => e.p.status === 'active' && e.p.leftAt && !recOf.has(e.p.id))
  // 路線色標記：車 = 該車顏色及車號；未分車 = 灰色；全員 = 深色「全」
  const LineMark = ({ k }: { k: string }) => {
    const i = buses.findIndex((b) => b.id === k)
    const text = k === EVERYONE ? '全' : i >= 0 ? buses[i].label.slice(0, 2) : '–'
    const bg = k === EVERYONE ? 'var(--text)' : i >= 0 ? lineColor(i) : 'var(--text-3)'
    return (
      <span className="rc-mark-line" style={{ background: bg }} aria-hidden="true">
        {text}
      </span>
    )
  }
  const panes = [...groups.map((x) => ({ key: x.key, label: x.label })), { key: EVERYONE, label: '全員名單' }]
  const current = panes.some((p) => p.key === pane) ? pane : panes[0].key

  // 點一下名字：未上車 → 已上車；已上車 → 改回（已出發的車會變回未到）。已出發後補登記為遲到
  const toggle = async (e: GuestEntry) => {
    const toPresent = statusOf(e) !== 'present'
    feedback(toPresent ? 'valid' : 'tap')
    await setRollStatus(session.id, ev.id, e.p, toPresent ? 'present' : isBusClosed(session, busKey(e)) ? 'no_show' : 'pending')
    if (toPresent) {
      setFlash(e.p.id)
      window.setTimeout(() => setFlash((f) => (f === e.p.id ? '' : f)), 900)
    }
  }

  // colored：只有「全員名單」用狀態顏色及圖案；點名時只有白底圓圈（未點）及綠色勾號（已上車）
  const Row = ({ e, colored }: { e: GuestEntry; colored?: boolean }) => {
    const st = statusOf(e)
    const rec = recOf.get(e.p.id)
    const bs = e.seats.find((x) => x.resource.type === 'bus')
    const icon = st === 'present' ? 'arrived' : colored ? ICON[st] : 'not_arrived'
    return (
      <div
        className={cx(
          'rc-row',
          flash === e.p.id && 'just',
          st === 'present' && 'here',
          colored && st === 'pending' && 'waiting',
          colored && st === 'no_show' && 'noshow',
          colored && st === 'on_the_way' && 'otw',
          colored && st === 'excused' && 'excused',
        )}
      >
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

  // 點名時：未上車的人在前，已上車的人排在後面
  const rollOrder = (list: GuestEntry[]) => [...list.filter((e) => statusOf(e) !== 'present'), ...list.filter((e) => statusOf(e) === 'present')]
  const g = (key: string) => groups.find((x) => x.key === key)
  const closingGroup = closing ? g(closing) : undefined
  const reopenGroup = reopening ? g(reopening) : undefined
  const countIn = (list: GuestEntry[], ...st: (RollStatus | 'pending')[]) => list.filter((e) => st.includes(statusOf(e))).length

  const tabs: [View, string, number, string][] = [
    ['roll', '點名', people.length, ''],
    ['present', '已上車', present.length, 'tone-ok'],
    ['pending', '待上車', by('pending', 'no_show').length, by('pending', 'no_show').length ? 'tone-info' : 'tone-ok'],
    ['on_the_way', '在途中', by('on_the_way').length, by('on_the_way').length ? 'tone-warn' : ''],
    ['excused', '請假', by('excused').length, by('excused').length ? 'tone-grey' : ''],
  ]
  const filtered = view === 'pending' ? by('pending', 'no_show') : view === 'roll' ? [] : by(view)

  return (
    <div className="page narrow rollcall">
      {/* 站名牌式標題：活動名（小）、點名名稱（大）、英文名／地點／時間，下面是各車的路線色帶 */}
      <header className="rc-sign">
        <div className="rc-sign-top">
          <Link to={`/e/${ev.id}/rollcall`} className="icon-btn" aria-label="返回點名列表">
            <ChevronLeft size={22} />
          </Link>
          <span className="rc-sign-crumb">{ev.name}</span>
          {/* 一鍵重點：保留這個點名，所有人改回「待上車」 */}
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(true)} disabled={recs.length === 0 && !session.closedAt && !Object.keys(session.closedBuses ?? {}).length}>
            <RotateCcw size={16} /> 重新點名
          </button>
          <Link to={`/e/${ev.id}/scan?p=r:${session.id}`} className="btn btn-primary btn-sm">
            <ScanLine size={18} /> 掃描
          </Link>
        </div>
        <div className="rc-station">
          <h1>{session.name.split(' ')[0]}</h1>
          <div className="rc-roman">{[session.name.split(' ').slice(1).join(' '), session.location, session.time].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="rc-stripe" aria-hidden="true">
          {(buses.length ? buses : [null]).map((b, i) => (
            <i key={b?.id ?? i} style={{ background: b ? lineColor(i) : 'var(--text)' }} />
          ))}
        </div>
      </header>

      {/* 狀態分類：點名（按車點名＋全員名單）／已上車／待上車（含已出發未到）／在途中／請假 */}
      <div className="rc-stats">
        {tabs.map(([k, zh, n, tone]) => (
          <button key={k} className={cx(tone, view === k && 'active')} aria-pressed={view === k} onClick={() => setView(view === k ? 'roll' : k)}>
            <small>{zh}</small>
            <strong>{n}</strong>
          </button>
        ))}
      </div>
      {/* 車廂式進度：十格 = 0–100%（應到 = 全部 − 請假） */}
      {(() => {
        const exp = people.length - by('excused').length
        const pct = exp ? Math.round((present.length / exp) * 100) : 0
        return (
          <div className="rc-cars" aria-label={`上車進度 ${pct}%`}>
            <div className="rc-cars-row">
              {Array.from({ length: 10 }, (_, i) => (
                <i key={i} className={pct >= (i + 1) * 10 ? 'on' : pct > i * 10 + 4 ? 'half' : ''} />
              ))}
            </div>
            <b>{pct}%</b>
            <small>
              {present.length} / {exp} 人
            </small>
          </div>
        )
      })()}

      {view === 'roll' ? (
        <>
          {/* A 車／B 車／全員名單：按上面切換，或在名單上左右掃動 */}
          <div className="rc-panes" role="tablist">
            {panes.map((p) => (
              <button key={p.key} role="tab" aria-selected={current === p.key} className={cx('rc-line', current === p.key && 'active')} onClick={() => setPane(p.key)}>
                <LineMark k={p.key} />
                {p.label}
              </button>
            ))}
          </div>
          <div
            className="rc-pane"
            onTouchStart={(e) => (swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
            onTouchEnd={(e) => {
              const s0 = swipe.current
              swipe.current = null
              if (!s0) return
              const dx = e.changedTouches[0].clientX - s0.x
              const dy = e.changedTouches[0].clientY - s0.y
              if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return
              const i = panes.findIndex((p) => p.key === current)
              const next = panes[i + (dx < 0 ? 1 : -1)]
              if (next) setPane(next.key)
            }}
          >
          {groups.filter((x) => x.key === current).map((grp) => {
            const here = countIn(grp.list, 'present')
            const exp = grp.list.length - countIn(grp.list, 'excused')
            return (
              <section key={grp.key} className="rc-bus">
                <header className="rc-bus-head">
                  <LineMark k={grp.key} />
                  <strong>{grp.label}</strong>
                  <span className={cx('rc-bus-count', here === exp && 'done')}>
                    已上車 {here} / {exp}
                    {countIn(grp.list, 'on_the_way') ? ` · 在途中 ${countIn(grp.list, 'on_the_way')}` : ''}
                    {countIn(grp.list, 'excused') ? ` · 請假 ${countIn(grp.list, 'excused')}` : ''}
                  </span>
                </header>
                {grp.key !== NO_BUS && (
                  <div className="seg rc-viewmode" role="radiogroup" aria-label="點名方式">
                    <button role="radio" aria-checked={seatMode} className={seatMode ? 'active' : ''} onClick={() => setSettings({ rollView: 'seats' })}>
                      <Armchair size={16} /> 座位表
                    </button>
                    <button role="radio" aria-checked={!seatMode} className={!seatMode ? 'active' : ''} onClick={() => setSettings({ rollView: 'list' })}>
                      <List size={16} /> 名單
                    </button>
                  </div>
                )}
                {seatMode && grp.key !== NO_BUS ? (
                  (() => {
                    const bus = buses.find((b) => b.id === grp.key)!
                    const layout = ev.modeConfig.buses?.find((x) => x.label === bus.label)?.layout ?? defaultLayout(bus.capacity)
                    const bySeat = new Map(grp.list.map((e) => [String(seatNo(e)), e]))
                    const rows = busRows(Math.max(bus.capacity, ...grp.list.map(seatNo).filter((n) => n < 999)), layout)
                    const noSeat = grp.list.filter((e) => seatNo(e) === 999 || seatNo(e) > rows.flat().filter(Boolean).length)
                    return (
                      <>
                        <p className="hint">點座位即上車／取消；在途中、請假等其他狀態請用「名單」的「⋯」。</p>
                        <div className="rc-seatmap" style={{ maxWidth: (rows[0]?.length ?? 5) * 120 }}>
                          <div className="bus-front">車頭 Front</div>
                          {rows.map((row, r) => (
                            <div key={r} className="bus-row" style={{ gridTemplateColumns: row.map((n) => (n === null ? '14px' : 'minmax(0, 1fr)')).join(' ') }}>
                              {row.map((n, k) => {
                                if (n === null || n === 0) return <span key={k} />
                                const e = bySeat.get(String(n))
                                if (!e) return (
                                  <span key={k} className="rc-seat-cell empty">
                                    <small>{n}</small>
                                  </span>
                                )
                                const st = statusOf(e)
                                return (
                                  <button key={k} className={cx('rc-seat-cell', st === 'present' && 'here', flash === e.p.id && 'just')} onClick={() => toggle(e)} aria-pressed={st === 'present'}>
                                    <small>
                                      {n}
                                      {st === 'present' && <CircleCheck size={12} />}
                                    </small>
                                    <strong>{names(e.p).primary}</strong>
                                    {st !== 'pending' && st !== 'present' && <em>{ROLL_LABEL[st]}</em>}
                                  </button>
                                )
                              })}
                            </div>
                          ))}
                        </div>
                        {noSeat.length > 0 && (
                          <>
                            <h3 className="rc-noseat">未有座位號 · {noSeat.length}</h3>
                            {rollOrder(noSeat).map((e) => (
                              <Row key={e.p.id} e={e} />
                            ))}
                          </>
                        )}
                      </>
                    )
                  })()
                ) : (
                  rollOrder(grp.list).map((e) => <Row key={e.p.id} e={e} />)
                )}
              </section>
            )
          })}

          {current === EVERYONE && (
          <section className="rc-all rc-everyone">
            <h3>全員名單 · {people.length}（按狀態顏色顯示）</h3>
            {[...people]
              .sort((a, b) => seatNo(a) - seatNo(b))
              .sort((a, b) => Number(statusOf(a) === 'present') - Number(statusOf(b) === 'present'))
              .map((e) => (
                <Row key={e.p.id} e={e} colored />
              ))}
          </section>
          )}
          </div>

          {/* 發車表式「確認出發」：固定在畫面底部，按目前顯示的車 */}
          {current !== EVERYONE && g(current) && (() => {
            const grp = g(current)!
            const closedAt = busClosedAt(session, grp.key)
            const left = countIn(grp.list, 'pending', 'on_the_way')
            return (
              <div className="rc-dock">
                <div className="rc-depart">
                  <div className="rc-depart-info">
                    <div className="rc-led">
                      {closedAt ? formatTime(closedAt) : session.time || '--:--'}
                      <span>
                        {grp.label} {closedAt ? '已出發' : '出發'}
                      </span>
                    </div>
                    <small>
                      {closedAt ? (
                        <>
                          未到 <em>{countIn(grp.list, 'no_show')} 人</em> · 遲到的人點名字即可補登
                        </>
                      ) : left ? (
                        <>
                          還有 <em>{left} 人</em> 未上車
                        </>
                      ) : (
                        '全部到齊'
                      )}
                    </small>
                  </div>
                  {closedAt ? (
                    <button className="rc-go sec" onClick={() => setReopening(grp.key)}>
                      重新開放
                    </button>
                  ) : (
                    <button className="rc-go" onClick={() => setClosing(grp.key)}>
                      確認出發
                    </button>
                  )}
                </div>
              </div>
            )
          })()}

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
        </>
      ) : (
        <section className="rc-all">
          <h3>
            {tabs.find((t) => t[0] === view)?.[1]} · {filtered.length}
            <button className="btn btn-ghost btn-sm rc-showall" onClick={() => setView('roll')}>
              回到點名
            </button>
          </h3>
          {filtered.length ? filtered.map((e) => <Row key={e.p.id} e={e} />) : <p className="muted pad center">沒有人</p>}
        </section>
      )}

      <Sheet open={!!menu} onClose={() => setMenu(null)} title={menu ? `${nameOf(menu.p)} · 點名狀態` : ''}>
        {menu && (
          <div className="rc-menu">
            {(['present', 'on_the_way', 'excused', isBusClosed(session, busKey(menu)) ? 'no_show' : 'pending'] as const).map((st) => (
              <button
                key={st}
                className={cx('menu-item', statusOf(menu) === st && 'active')}
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
                      ? isBusClosed(session, busKey(menu))
                        ? '這架車已出發，會記為遲到'
                        : '已核實上車'
                      : st === 'on_the_way'
                        ? '已聯絡，正在趕來（避免重複催促）'
                        : st === 'excused'
                          ? '事前告知不來；座位保留，可釋出'
                          : st === 'no_show'
                            ? '出發時仍未到'
                            : '還未上車'}
                  </small>
                </span>
              </button>
            ))}
          </div>
        )}
      </Sheet>

      <ConfirmSheet
        open={!!closingGroup}
        onClose={() => setClosing(null)}
        onConfirm={async () => {
          if (!closingGroup) return
          const pend = closingGroup.list.filter((e) => statusOf(e) === 'pending')
          await closeSession(session.id, ev.id, pend.map((e) => e.p.id), closingGroup.key, closingGroup.label)
          feedback('depart')
          toast(pend.length ? `${closingGroup.label}已確認出發，${pend.length} 人記為未到` : `${closingGroup.label}已確認出發，全部到齊`)
        }}
        title={`確認出發 · ${closingGroup?.label ?? ''}`}
        message={
          closingGroup && (
            <p>
              {closingGroup.label}已上車 {countIn(closingGroup.list, 'present')} 人。仍「待上車」的 {countIn(closingGroup.list, 'pending')} 人會記為「未到」
              {countIn(closingGroup.list, 'on_the_way') ? `；在途中 ${countIn(closingGroup.list, 'on_the_way')} 人維持「在途中」` : ''}
              {countIn(closingGroup.list, 'excused') ? `；請假 ${countIn(closingGroup.list, 'excused')} 人不變` : ''}。其他車不受影響。之後仍可補登遲到的人，或重新開放。
            </p>
          )
        }
        confirmText="確認出發"
      />
      <ConfirmSheet
        open={!!reopenGroup}
        onClose={() => setReopening(null)}
        onConfirm={async () => {
          if (!reopenGroup) return
          await reopenSession(session.id, ev.id, reopenGroup.key, reopenGroup.list.map((e) => e.p.id), reopenGroup.label)
          toast(`${reopenGroup.label}已重新開放，「未到」的人改回待上車`)
        }}
        title={`重新開放 · ${reopenGroup?.label ?? ''}`}
        message={reopenGroup && <p>{reopenGroup.label}「未到」的 {countIn(reopenGroup.list, 'no_show')} 人會改回「待上車」，可以繼續點名。其他車不受影響。</p>}
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
            把「{session.name}」所有車的所有人（已上車 {present.length} 人，以及在途中、請假、未到的標記）全部改回「待上車」，並取消所有「確認出發」，重新點一次？點名環節會保留，此操作會記錄在操作紀錄。
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
