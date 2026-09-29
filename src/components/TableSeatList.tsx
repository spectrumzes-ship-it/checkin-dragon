import { useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { Undo2, Users } from 'lucide-react'
import type { EventRec, Participant, Resource } from '../db/types'
import { checkIn, moveSeat, splitCompanion, undoCheckIn, undoMoveSeat } from '../lib/actions'
import { feedback } from '../lib/feedback'
import { nameOf, names } from '../lib/names'
import type { GuestEntry } from '../lib/search'
import { cx } from '../lib/util'
import { GuestRow } from './GuestRow'
import { ConfirmSheet, SoftTag, toast } from './ui'

export type Slot = { seat: string; owner?: GuestEntry; companionOf?: GuestEntry }

// 座位排列：一票多人佔連續座位；座位號衝突或未有座位號的，放到第一個空位（席位名單、單一席、列印共用）
export const buildSlots = (capacity: number, guests: { seat: string; e: GuestEntry }[]) => {
  const size = Math.max(capacity, guests.reduce((a, g) => a + g.e.p.guestCount, 0))
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
}

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
  onOpen,
  allowCheckIn = true,
  compact,
}: {
  ev: EventRec
  table: Resource
  guests: { seat: string; e: GuestEntry }[]
  onOpen: (e: GuestEntry) => void // 點名字：打開嘉賓詳細資料
  allowCheckIn?: boolean // 點勾號圓圈：簽到／取消簽到（巴士聚餐餐席不適用）
  compact?: boolean // 席位名單內使用：不重複顯示說明，只在有調位時顯示「復原」
}) {
  const purpose = table.purpose
  const history = useRef<Snap[]>([])
  const [, force] = useState(0)
  const [dragging, setDragging] = useState<GuestEntry | null>(null)
  // 拖拉整個姓名框：電腦按住移動即拖；手機按住約 0.3 秒才開始（手指快速掃動仍是捲動畫面）
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )
  // 拖拉放手後的一刻不當作「點一下」（避免誤開詳情或誤簽到）
  const lastDrag = useRef(0)
  const guard = (fn: () => void) => () => {
    if (Date.now() - lastDrag.current > 400) fn()
  }
  const [undoP, setUndoP] = useState<Participant | null>(null)
  const toggle = async (e: GuestEntry) => {
    if (e.p.attendance !== 'not_arrived') return setUndoP(e.p)
    await checkIn(e.p, 'SEARCH', 'checkin', '', e.tickets[0])
    feedback('valid')
    toast(`✓ ${nameOf(e.p)} 已簽到`)
  }

  const slots = useMemo(() => buildSlots(table.capacity, guests), [guests, table.capacity])

  const onDragEnd = async (evt: DragEndEvent) => {
    setDragging(null)
    lastDrag.current = Date.now()
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
      onDragCancel={() => {
        setDragging(null)
        lastDrag.current = Date.now()
      }}
      autoScroll
    >
      {!compact ? (
        <div className="seatlist-head">
          <span className="muted">拖拉姓名可調整座位（手機：按住約半秒），目標有人會對調；點勾號簽到，點姓名看詳情</span>
          <button className="btn btn-ghost btn-sm" onClick={undo} disabled={!history.current.length}>
            <Undo2 size={16} /> 復原
          </button>
        </div>
      ) : (
        history.current.length > 0 && (
          <div className="seatlist-head compact">
            <button className="btn btn-ghost btn-sm" onClick={undo}>
              <Undo2 size={16} /> 復原此席調位
            </button>
          </div>
        )
      )}
      <div className="list card seatlist">
        {slots.map((s) => (
          <SeatRow
            key={s.seat}
            slot={s}
            over={Number(s.seat) > table.capacity}
            onOpen={(e) => guard(() => onOpen(e))()}
            onToggle={allowCheckIn ? (e) => guard(() => toggle(e))() : undefined}
            seatLine={(n) => `${table.purpose === '晚餐' ? '晚餐 ' : ''}第 ${table.label} 席 · ${n} 號`}
          />
        ))}
      </div>
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
      <DragOverlay dropAnimation={null}>{dragging ? <div className="guest-chip dragging">{nameOf(dragging.p)}</div> : null}</DragOverlay>
    </DndContext>
  )
}

function SeatRow({
  slot,
  over,
  onOpen,
  onToggle,
  seatLine,
}: {
  slot: Slot
  over: boolean
  onOpen: (e: GuestEntry) => void
  onToggle?: (e: GuestEntry) => void
  seatLine: (n: string) => string
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `seat:${slot.seat}` })
  const e = slot.owner
  const drag = useDraggable({ id: `g:${e?.p.id ?? 'none-' + slot.seat}`, disabled: !e })
  return (
    <div ref={setNodeRef} className={cx('seatlist-row', isOver && 'drop', over && 'extra', drag.isDragging && 'ghost')}>
      <span className="seatlist-no">{slot.seat}</span>
      {e ? (
        <>
          {/* 整個姓名框可拖拉；點姓名 = 詳情；點勾號 = 簽到 */}
          <div ref={drag.setNodeRef} {...drag.listeners} {...drag.attributes} role="group" aria-roledescription="可拖拉" className="seatlist-guest draggable">
            <GuestRow e={e} onClick={() => onOpen(e)} onMarkClick={onToggle ? () => onToggle(e) : undefined} trailing={<span />} />
          </div>
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
          <button
            className="seatlist-split"
            onClick={async () => {
              const c = await splitCompanion(slot.companionOf!.p)
              if (c) toast(`已分拆「${nameOf(c)}」，可獨立安排座位`)
            }}
          >
            分拆
          </button>
        </>
      ) : (
        <span className="seatlist-empty">空位</span>
      )}
    </div>
  )
}
