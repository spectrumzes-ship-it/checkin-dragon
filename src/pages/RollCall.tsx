import { useMemo, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Phone, Plus, ScanLine, Trash2, TriangleAlert } from 'lucide-react'
import { db } from '../db/db'
import type { EventRec } from '../db/types'
import { createSession, deleteSession, setAttendance } from '../lib/actions'
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
  const total = useLiveQuery(() => db.participants.where('eventId').equals(ev.id).filter((p) => p.status === 'active').count(), [ev.id]) ?? 0
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
            const present = attendance.filter((a) => a.sessionId === s.id && a.status === 'present').length
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

  const present = useMemo(() => new Set(recs.filter((r) => r.status === 'present').map((r) => r.participantId)), [recs])
  const buses = data?.resources.filter((r) => r.type === 'bus') ?? []
  const people = useMemo(() => {
    const active = index.filter((e) => e.p.status === 'active')
    const inBus = bus === 'all' ? active : active.filter((e) => e.seats.some((s) => s.resource.id === bus))
    const busSeat = (e: GuestEntry) => e.seats.find((s) => s.resource.type === 'bus')
    return inBus.sort((a, b) => {
      const sa = busSeat(a),
        sb = busSeat(b)
      return (sa?.resource.label ?? '').localeCompare(sb?.resource.label ?? '') || Number(sa?.seatLabel || 999) - Number(sb?.seatLabel || 999)
    })
  }, [index, bus])

  if (!session || !data) return <div className="page" />
  const total = people.length
  const here = people.filter((e) => present.has(e.p.id)).length
  const missing = people.filter((e) => !present.has(e.p.id))

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
          <>
            <Link to={`/e/${ev.id}/scan?p=r:${session.id}`} className="btn btn-primary btn-sm">
              <ScanLine size={18} /> 掃描
            </Link>
            <button className="icon-btn" aria-label="刪除點名" onClick={() => setConfirmDel(true)}>
              <Trash2 size={18} />
            </button>
          </>
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

      <ConfirmSheet
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        onConfirm={async () => {
          await deleteSession(session.id, ev.id, session.name)
          toast('已刪除點名')
          nav(`/e/${ev.id}/rollcall`)
        }}
        title="刪除點名"
        message={<p>刪除「{session.name}」及其所有點名紀錄？</p>}
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
  if (!data) return <div className="page" />
  const buses = data.resources.filter((r) => r.type === 'bus')
  if (!buses.length)
    return (
      <div className="page">
        <EmptyState art={<BusArt />} zh="還沒有設定巴士。" en="No buses yet." action={<Link className="btn btn-primary" to={`/e/${ev.id}/edit`}>設定巴士</Link>} />
      </div>
    )
  return (
    <div className="page">
      {buses.map((b) => {
        const bySeat = new Map<string, GuestEntry>()
        index.forEach((e) => e.seats.forEach((s) => s.resource.id === b.id && e.p.status === 'active' && bySeat.set(s.seatLabel, e)))
        const rows = Math.ceil(b.capacity / 4)
        return (
          <section key={b.id} className="card bus-block">
            <h2 className="bus-title">
              {b.label} 車 <small>Bus {b.label} · {bySeat.size} / {b.capacity}</small>
            </h2>
            <div className="bus-grid">
              {Array.from({ length: rows }, (_, r) => (
                <div className="bus-row" key={r}>
                  {[1, 2, 0, 3, 4].map((c, k) => {
                    if (c === 0) return <span key={k} className="bus-aisle" />
                    const n = r * 4 + c
                    if (n > b.capacity) return <span key={k} />
                    const e = bySeat.get(String(n))
                    return (
                      <button
                        key={k}
                        className={cx('bus-seat', e && 'taken', e && e.p.attendance !== 'not_arrived' && 'arrived')}
                        onClick={() => e && nav(`/e/${ev.id}/guests/${e.p.id}`)}
                        title={e ? names(e.p).full : `${n} 號空位`}
                      >
                        <small>{n}</small>
                        <span>{e ? nameOf(e.p) : ''}</span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
