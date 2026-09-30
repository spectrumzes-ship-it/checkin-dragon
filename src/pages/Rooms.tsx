import { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { BedDouble, BedSingle, Plus, Trash2, UserPlus, Wand2, X } from 'lucide-react'
import type { EventRec, Resource } from '../db/types'
import { addRoom, assignRoom, autoAssignRooms, deleteRoom, updateRoom } from '../lib/actions'
import { useDebounced, useEventData } from '../lib/hooks'
import { searchGuests, type GuestEntry } from '../lib/search'
import { nameOf, names } from '../lib/names'
import { ConfirmSheet, EmptyState, PageHeader, SearchBar, SectionTitle, Sheet, SoftTag, toast } from '../components/ui'
import { BusArt } from '../illustrations'

// 旅遊模式：酒店房間分配。預設兩人一間，可改為單人房（或三、四人房）
export default function Rooms() {
  const ev = useOutletContext<EventRec>()
  const { data, index } = useEventData(ev.id)
  const [pick, setPick] = useState<Resource | null>(null) // 正在為哪間房加入住客
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 150)
  const [del, setDel] = useState<Resource | null>(null)
  const [auto, setAuto] = useState(false)

  const rooms = useMemo(() => (data?.resources ?? []).filter((r) => r.type === 'room').sort((a, b) => a.sortOrder - b.sortOrder), [data])
  // 需要安排房間的人：未取消、不是只領禮品；中途離開的人不用再安排
  const people = useMemo(() => index.filter((e) => e.p.status === 'active' && !e.p.giftOnly), [index])
  const unassigned = useMemo(() => people.filter((e) => !e.room && !e.p.leftAt), [people])
  const byRoom = useMemo(() => {
    const m = new Map<string, GuestEntry[]>()
    for (const e of people) if (e.room) m.set(e.room.id, [...(m.get(e.room.id) ?? []), e])
    return m
  }, [people])

  if (!data) return <div className="page" />
  const housed = people.filter((e) => e.room).length
  const busOrder = (e: GuestEntry) => {
    const s = e.seats.find((x) => x.resource.type === 'bus')
    return `${s?.resource.label ?? 'zz'}${(s?.seatLabel ?? '').padStart(3, '0')}`
  }
  const choices = pick ? searchGuests(unassigned, dq) : []

  const add = async (capacity: number) => {
    const r = await addRoom(ev.id, capacity)
    toast(`已新增${capacity === 1 ? '單人房' : '雙人房'} ${r.label}`)
  }

  return (
    <div className="page">
      <PageHeader
        zh="房間"
        en="Rooms"
        actions={
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => add(1)}>
              <BedSingle size={18} /> 單人房
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => add(2)}>
              <Plus size={18} /> 雙人房
            </button>
          </>
        }
      />
      <p className="hint">
        共 {rooms.length} 間房 · 已安排 {housed} 人 · 未安排 {unassigned.length} 人。預設兩人一間；每間房可改為單人房或加人。
      </p>
      {unassigned.length > 0 && (
        <button className="btn btn-mode btn-block" style={{ marginBottom: 12 }} onClick={() => setAuto(true)}>
          <Wand2 size={18} /> 自動分房：未安排的 {unassigned.length} 人每兩人一間
        </button>
      )}

      {rooms.length === 0 ? (
        <EmptyState art={<BusArt />} zh="還沒有房間。" en="No rooms yet." />
      ) : (
        <div className="room-grid">
          {rooms.map((r) => {
            const who = byRoom.get(r.id) ?? []
            return (
              <section key={r.id} className="card room-card">
                <header>
                  {r.capacity === 1 ? <BedSingle size={20} /> : <BedDouble size={20} />}
                  <input
                    className="room-label"
                    defaultValue={r.label}
                    aria-label="房號"
                    onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== r.label && updateRoom(r, { label: e.target.value })}
                  />
                  <SoftTag tone={who.length > r.capacity ? 'warn' : who.length === r.capacity ? 'mode' : undefined}>
                    {who.length} / {r.capacity}
                  </SoftTag>
                  <button className="icon-btn" aria-label={`刪除房間 ${r.label}`} onClick={() => setDel(r)}>
                    <Trash2 size={16} />
                  </button>
                </header>
                <div className="room-people">
                  {who.map((e) => (
                    <span key={e.p.id} className="room-person">
                      <span>
                        <strong>{names(e.p).primary}</strong>
                        {e.p.leftAt && <SoftTag tone="warn">中途離開</SoftTag>}
                      </span>
                      <button className="chip-x" aria-label={`把 ${nameOf(e.p)} 移出房間`} onClick={() => assignRoom(ev.id, e.p.id, null)}>
                        <X size={16} />
                      </button>
                    </span>
                  ))}
                  {who.length < r.capacity && (
                    <button className="room-add" onClick={() => (setQ(''), setPick(r))}>
                      <UserPlus size={16} /> 加入住客
                    </button>
                  )}
                </div>
                <div className="seg room-size" role="radiogroup" aria-label="房間人數">
                  {[1, 2, 3, 4].map((n) => (
                    <button key={n} role="radio" aria-checked={r.capacity === n} className={r.capacity === n ? 'active' : ''} onClick={() => updateRoom(r, { capacity: n })}>
                      {n === 1 ? '單人' : n === 2 ? '雙人' : `${n} 人`}
                    </button>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {unassigned.length > 0 && (
        <section className="unassigned">
          <SectionTitle zh={`未安排房間 · ${unassigned.length} 人`} en="No room yet" />
          <div className="chips">
            {unassigned.map((e) => (
              <span key={e.p.id} className="chip">
                {nameOf(e.p)}
              </span>
            ))}
          </div>
        </section>
      )}

      <Sheet open={!!pick} onClose={() => setPick(null)} title={`房間 ${pick?.label ?? ''} · 加入住客`}>
        <SearchBar value={q} onChange={setQ} placeholder="搜尋未安排房間的人" autoFocus />
        <div className="list" style={{ marginTop: 8 }}>
          {choices.length ? (
            choices.map((e) => (
              <button
                key={e.p.id}
                className="fcfs-row"
                onClick={async () => {
                  if (!pick) return
                  const ok = await assignRoom(ev.id, e.p.id, pick.id)
                  if (!ok) return toast('這間房已滿')
                  const left = pick.capacity - (byRoom.get(pick.id)?.length ?? 0) - 1
                  if (left <= 0) setPick(null)
                }}
              >
                <span>
                  <strong>{names(e.p).primary}</strong>
                  <span className="muted">{names(e.p).secondary}</span>
                </span>
              </button>
            ))
          ) : (
            <p className="muted pad center">{unassigned.length ? '沒有符合的人' : '所有人已安排房間 ✓'}</p>
          )}
        </div>
      </Sheet>

      <ConfirmSheet
        open={auto}
        onClose={() => setAuto(false)}
        onConfirm={async () => {
          const n = await autoAssignRooms(ev.id, [...unassigned].sort((a, b) => busOrder(a).localeCompare(busOrder(b))).map((e) => e.p.id))
          toast(`已新增 ${n} 間房，請檢查並調整`)
        }}
        title="自動分房"
        message={
          <p>
            把未安排的 {unassigned.length} 人按巴士座位次序，每兩人一間（相鄰座位通常是同行的人）；如果人數是單數，最後一人單人一間。系統不知道性別及誰與誰同行，分好後請逐間檢查，可移出或改為單人房。
          </p>
        }
        confirmText="自動分房"
      />
      <ConfirmSheet
        open={!!del}
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (del) await deleteRoom(del)
          toast('已刪除房間，住客改為未安排')
        }}
        title="刪除房間"
        message={<p>刪除房間 {del?.label}？房內的人會變成「未安排房間」。</p>}
        confirmText="刪除"
        danger
      />
    </div>
  )
}
