import { useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { GripVertical, Undo2, Users } from 'lucide-react'
import type { EventRec, Resource } from '../db/types'
import { moveSeat, undoMoveSeat } from '../lib/actions'
import { nameOf, names } from '../lib/names'
import type { GuestEntry } from '../lib/search'
import { cx } from '../lib/util'
import { GuestRow } from './GuestRow'
import { SoftTag, toast } from './ui'

type Slot = { seat: string; owner?: GuestEntry; companionOf?: GuestEntry }

// 以手指／滑鼠所在位置判斷放在哪個座位（用鍵盤操作時才用位置重疊判斷）
const byPointer: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  return hits.length ? hits : rectIntersection(args)
}
type Snap = Awaited<ReturnType<typeof moveSeat>>

// 單一席的座位名單：每個座位一行（包括空位），按住右邊「⠿」上下拖拉即可換座位（目標有人會對調）
export default function TableSeatList({
  ev,
  table,
  guests,
  onTap,
}: {
  ev: EventRec
  table: Resource
  guests: { seat: string; e: GuestEntry }[]
  onTap: (e: GuestEntry) => void
}) {
  const purpose = table.purpose
  const history = useRef<Snap[]>([])
  const [, force] = useState(0)
  const [dragging, setDragging] = useState<GuestEntry | null>(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )

  // 座位排列：一票多人佔連續座位；座位號衝突或未有座位號的，放到第一個空位
  const slots = useMemo(() => {
    const size = Math.max(table.capacity, guests.reduce((a, g) => a + g.e.p.guestCount, 0))
    const out: Slot[] = Array.from({ length: size }, (_, i) => ({ seat: String(i + 1) }))
    const place = (e: GuestEntry, start: number) => {
      out[start].owner = e
      for (let k = 1; k < e.p.guestCount && start + k < out.length; k++) if (!out[start + k].owner) out[start + k].companionOf = e
    }
    const later: GuestEntry[] = []
    for (const { seat, e } of [...guests].sort((a, b) => (Number(a.seat) || 999) - (Number(b.seat) || 999))) {
      const n = Number(seat) - 1
      if (n >= 0 && n < out.length && !out[n].owner && !out[n].companionOf) place(e, n)
      else later.push(e)
    }
    for (const e of later) {
      const free = out.findIndex((x) => !x.owner && !x.companionOf)
      if (free >= 0) place(e, free)
    }
    return out
  }, [guests, table.capacity])

  const onDragEnd = async (evt: DragEndEvent) => {
    setDragging(null)
    if (!evt.over) return
    const pid = String(evt.active.id).slice(2)
    const seat = String(evt.over.id).slice(5)
    const slot = slots.find((s) => s.seat === seat)
    // 放到同行者的位置 = 放到該位嘉賓本人的座位（對調）
    const target = slot?.companionOf ? slots.find((s) => s.owner?.p.id === slot.companionOf!.p.id)!.seat : seat
    const cur = slots.find((s) => s.owner?.p.id === pid)
    if (!cur || cur.seat === target) return
    const snap = await moveSeat(ev.id, pid, purpose, { resourceId: table.id, seatLabel: target })
    history.current.push(snap)
    force((n) => n + 1)
    toast(`${nameOf(cur.owner!.p)} → ${target} 號座位`)
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
      collisionDetection={byPointer}
      onDragStart={(e) => setDragging(slots.find((s) => s.owner?.p.id === String(e.active.id).slice(2))?.owner ?? null)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
      autoScroll
    >
      <div className="seatlist-head">
        <span className="muted">按住右邊 ⠿ 上下拖拉可調整座位，目標有人會對調</span>
        <button className="btn btn-ghost btn-sm" onClick={undo} disabled={!history.current.length}>
          <Undo2 size={16} /> 復原
        </button>
      </div>
      <div className="list card seatlist">
        {slots.map((s) => (
          <SeatRow
            key={s.seat}
            slot={s}
            over={Number(s.seat) > table.capacity}
            onTap={onTap}
            seatLine={(n) => `${table.purpose === '晚餐' ? '晚餐 ' : ''}第 ${table.label} 席 · ${n} 號`}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>{dragging ? <div className="guest-chip dragging">{nameOf(dragging.p)}</div> : null}</DragOverlay>
    </DndContext>
  )
}

function SeatRow({ slot, over, onTap, seatLine }: { slot: Slot; over: boolean; onTap: (e: GuestEntry) => void; seatLine: (n: string) => string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `seat:${slot.seat}` })
  const e = slot.owner
  const drag = useDraggable({ id: `g:${e?.p.id ?? 'none-' + slot.seat}`, disabled: !e })
  return (
    <div ref={setNodeRef} className={cx('seatlist-row', isOver && 'drop', over && 'extra', drag.isDragging && 'ghost')}>
      <span className="seatlist-no">{slot.seat}</span>
      {e ? (
        <>
          <div className="seatlist-guest">
            <GuestRow e={e} onClick={() => onTap(e)} trailing={<span />} />
          </div>
          <button
            ref={drag.setActivatorNodeRef}
            {...drag.listeners}
            {...drag.attributes}
            className="seatlist-grip"
            aria-label={`拖拉 ${nameOf(e.p)} 到其他座位`}
          >
            <GripVertical size={20} />
          </button>
          <span ref={drag.setNodeRef} className="seatlist-anchor" />
        </>
      ) : slot.companionOf ? (
        <>
          <div className="seatlist-guest">
            {/* 同行者：與嘉賓同樣大小及資料，只多一個「同行」標籤 */}
            <div className="guest-row companion-row">
              <span className="status-mark">
                <span className="companion-mark">
                  <Users size={18} />
                </span>
              </span>
              <span className="guest-row-main">
                <span className="guest-row-name">
                  <strong>{names(slot.companionOf.p).primary}</strong>
                  {names(slot.companionOf.p).secondary && <span className="muted">{names(slot.companionOf.p).secondary}</span>}
                  <SoftTag tone="mode">同行</SoftTag>
                </span>
                <span className="guest-row-sub">{seatLine(slot.seat)}</span>
              </span>
            </div>
          </div>
          <span className="seatlist-grip-space" />
        </>
      ) : (
        <span className="seatlist-empty">空位</span>
      )}
    </div>
  )
}
