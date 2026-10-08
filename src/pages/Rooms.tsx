import { useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { BedDouble, BedSingle, Plus, Printer, Trash2, UserPlus, Wand2, X } from 'lucide-react'
import type { EventRec, Resource } from '../db/types'
import { addRoom, assignRoom, autoAssignRooms, clearRooms, deleteRoom, updateRoom } from '../lib/actions'
import { useDebounced, useEventData } from '../lib/hooks'
import { searchGuests, type GuestEntry } from '../lib/search'
import { nameOf, names } from '../lib/names'
import { cx } from '../lib/util'
import { ConfirmSheet, EmptyState, PageHeader, SearchBar, Sheet, SoftTag, toast } from '../components/ui'
import { BusArt } from '../illustrations'

const roomType = (n: number) => (n <= 1 ? '單人房' : n === 2 ? '雙人房' : `${n} 人房`)

// 旅遊模式：酒店房間分配。拖拉名字到房間即可；房間人數跟隨實際入住人數（空房預設為雙人房）
export default function Rooms() {
  const ev = useOutletContext<EventRec>()
  const nav = useNavigate()
  const { data, index } = useEventData(ev.id)
  const [pick, setPick] = useState<Resource | null>(null) // 正在為哪間房加入住客（不用拖拉的做法）
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 150)
  const [del, setDel] = useState<Resource | null>(null)
  const [auto, setAuto] = useState(false)
  const [manage, setManage] = useState<null | 'clear' | 'redo'>(null)
  const [dragging, setDragging] = useState<GuestEntry | null>(null)
  const lastDrag = useRef(0)
  // 電腦按住移動即拖；手機按住約 0.3 秒才開始（快速掃動仍是捲動畫面）
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }))

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
  const open = (e: GuestEntry) => Date.now() - lastDrag.current > 400 && nav(`/e/${ev.id}/guests/${e.p.id}`)

  const onDragEnd = async (evt: DragEndEvent) => {
    setDragging(null)
    lastDrag.current = Date.now()
    if (!evt.over) return
    const pid = String(evt.active.id).slice(2)
    const target = String(evt.over.id) === 'pool' ? null : String(evt.over.id).slice(5)
    const e = people.find((x) => x.p.id === pid)
    if (!e || (e.room?.id ?? null) === target) return
    const ok = await assignRoom(ev.id, pid, target)
    if (!ok) return toast('這間房已滿（最多 6 人）')
    toast(target ? `${nameOf(e.p)} → 房間 ${rooms.find((r) => r.id === target)?.label}` : `${nameOf(e.p)} 已移出房間`)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(e) => setDragging(people.find((x) => x.p.id === String(e.active.id).slice(2)) ?? null)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
      autoScroll
    >
      <div className="page">
        <PageHeader
          zh="房間"
          en="Rooms"
          actions={
            <>
              {rooms.length > 0 && (
                <>
                  <button className="icon-btn" aria-label="列印房間名單" title="列印房間名單（可存成 PDF）" onClick={() => nav(`/e/${ev.id}/print?type=rooms`)}>
                    <Printer size={20} />
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setManage('clear')} disabled={housed === 0}>
                    清空
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setManage('redo')}>
                    重新安排
                  </button>
                </>
              )}
            <button
              className="btn btn-primary btn-sm"
              onClick={async () => {
                const r = await addRoom(ev.id)
                toast(`已新增房間 ${r.label}`)
              }}
            >
              <Plus size={18} /> 新增房間
            </button>
            </>
          }
        />
        <p className="hint">
          共 {rooms.length} 間房 · 已安排 {housed} 人 · 未安排 {unassigned.length} 人。把名字拖到房間（手機：按住約半秒），房間人數會跟隨入住人數自動變成單人房、雙人房…；新房間預設為雙人房。酒店房號通常到埗才知道：先用 #1、#2 分房，到酒店後在每間房的「填房號」填上即可。
        </p>

        <Pool entries={unassigned} active={!!dragging} onOpen={open} onAuto={() => setAuto(true)} />

        {rooms.length === 0 ? (
          <EmptyState art={<BusArt />} zh="還沒有房間，請按「新增房間」或「自動分房」。" en="No rooms yet." />
        ) : (
          <div className="room-grid">
            {rooms.map((r) => (
              <RoomCard key={r.id} room={r} who={byRoom.get(r.id) ?? []} onOpen={open} onAdd={() => (setQ(''), setPick(r))} onDelete={() => setDel(r)} onRemove={(e) => assignRoom(ev.id, e.p.id, null)} />
            ))}
          </div>
        )}
      </div>
      <DragOverlay dropAnimation={null}>{dragging ? <div className="guest-chip dragging">{nameOf(dragging.p)}</div> : null}</DragOverlay>

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
                  if (!(await assignRoom(ev.id, e.p.id, pick.id))) return toast('這間房已滿（最多 6 人）')
                  toast(`${nameOf(e.p)} → 房間 ${pick.label}`)
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
        <button className="btn btn-primary btn-block" style={{ marginTop: 12 }} onClick={() => setPick(null)}>
          完成
        </button>
      </Sheet>

      <ConfirmSheet
        open={auto}
        onClose={() => setAuto(false)}
        onConfirm={async () => {
          const n = await autoAssignRooms(ev.id, [...unassigned].sort((a, b) => busOrder(a).localeCompare(busOrder(b))).map((e) => e.p.id))
          toast(`已安排 ${n} 間房，請檢查並調整`)
        }}
        title="自動分房"
        message={
          <p>
            先用現有的空房（已有人入住的房間不會再加人），空房不夠才新增房間。已填「同行人士」的人同住一間；其餘的人按巴士座位次序，同性別的每兩人一間（未填性別的另外配對），剩下的單人一間。分好後請逐間檢查，再拖拉調整。
          </p>
        }
        confirmText="自動分房"
      />
      <ConfirmSheet
        open={manage === 'clear'}
        onClose={() => setManage(null)}
        onConfirm={async () => {
          await clearRooms(ev.id, true)
          toast('已清空，所有人變回未安排房間')
        }}
        title="清空房間"
        message={<p>把已安排的 {housed} 人全部移出房間？{rooms.length} 間房會保留（變回空的雙人房），房號不變。</p>}
        confirmText="清空"
        danger
      />
      <ConfirmSheet
        open={manage === 'redo'}
        onClose={() => setManage(null)}
        onConfirm={async () => {
          await clearRooms(ev.id, false)
          toast('已刪除所有房間，所有人回到「未安排房間」')
        }}
        title="重新安排房間"
        message={
          <p>
            刪除現有的 {rooms.length} 間房（包括你改過的房號及手動調整），已安排的 {housed} 人全部放回「未安排房間」。之後可以新增房間再拖拉，或按「自動分房」。
          </p>
        }
        confirmText="重新安排"
        danger
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
    </DndContext>
  )
}

// 可拖拉的名字
const Person = ({ e, onOpen, onRemove }: { e: GuestEntry; onOpen: (e: GuestEntry) => void; onRemove?: () => void }) => {
  const drag = useDraggable({ id: `g:${e.p.id}` })
  return (
    <span ref={drag.setNodeRef} {...drag.listeners} {...drag.attributes} className={cx('room-person', drag.isDragging && 'ghost')} onClick={() => onOpen(e)}>
      <span>
        <strong>{names(e.p).primary}</strong>
        {e.p.gender && <small className="muted">{e.p.gender === 'M' ? '男' : '女'}</small>}
        {e.p.leftAt && <SoftTag tone="warn">中途離開</SoftTag>}
      </span>
      {onRemove && (
        <button
          className="chip-x"
          aria-label={`把 ${nameOf(e.p)} 移出房間`}
          onPointerDown={(x) => x.stopPropagation()}
          onClick={(x) => {
            x.stopPropagation()
            onRemove()
          }}
        >
          <X size={16} />
        </button>
      )}
    </span>
  )
}

const RoomCard = ({ room, who, onOpen, onAdd, onDelete, onRemove }: { room: Resource; who: GuestEntry[]; onOpen: (e: GuestEntry) => void; onAdd: () => void; onDelete: () => void; onRemove: (e: GuestEntry) => void }) => {
  const drop = useDroppable({ id: `room:${room.id}` })
  const n = who.length || 2
  const custom = room.purpose === 'custom' // 已填酒店房號
  return (
    <section ref={drop.setNodeRef} className={cx('card room-card', drop.isOver && 'drop')}>
      <header>
        {n === 1 ? <BedSingle size={20} /> : <BedDouble size={20} />}
        {/* #編號固定；酒店房號到埗後才填（未填時留空） */}
        <span className="room-no">#{room.sortOrder}</span>
        <input
          className="room-label"
          defaultValue={custom ? room.label : ''}
          placeholder="填房號"
          aria-label="酒店房號"
          inputMode="numeric"
          key={room.label + room.purpose}
          onBlur={(e) => e.target.value.trim() !== (custom ? room.label : '') && updateRoom(room, { label: e.target.value })}
        />
        <SoftTag tone={who.length ? 'mode' : undefined}>
          {roomType(n)}
          {who.length === 0 && ' · 空房'}
        </SoftTag>
        <button className="icon-btn" aria-label={`刪除房間 ${room.label}`} onClick={onDelete}>
          <Trash2 size={16} />
        </button>
      </header>
      <div className="room-people">
        {who.map((e) => (
          <Person key={e.p.id} e={e} onOpen={onOpen} onRemove={() => onRemove(e)} />
        ))}
        <button className="room-add" onClick={onAdd}>
          <UserPlus size={16} /> {who.length ? '再加入住客' : '把名字拖到這裏，或按此加入'}
        </button>
      </div>
    </section>
  )
}

// 未安排房間的人：可拖到房間；把房內的人拖回這裏 = 移出
const Pool = ({ entries, active, onOpen, onAuto }: { entries: GuestEntry[]; active: boolean; onOpen: (e: GuestEntry) => void; onAuto: () => void }) => {
  const drop = useDroppable({ id: 'pool' })
  return (
    <section ref={drop.setNodeRef} className={cx('card room-pool', drop.isOver && 'drop', active && 'targetable')}>
      <header>
        <strong>未安排房間</strong>
        <SoftTag>{entries.length}</SoftTag>
        {entries.length > 1 && (
          <button className="btn btn-ghost btn-sm" onClick={onAuto}>
            <Wand2 size={16} /> 自動分房
          </button>
        )}
      </header>
      <div className="room-pool-list">
        {entries.length ? entries.map((e) => <Person key={e.p.id} e={e} onOpen={onOpen} />) : <p className="muted small">全部已安排 ✓ 把名字拖到這裏可移出房間</p>}
      </div>
    </section>
  )
}
