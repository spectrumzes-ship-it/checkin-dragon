import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { Hand, Undo2, Users } from 'lucide-react'
import type { EventRec, Resource } from '../db/types'
import { moveSeat, undoMoveSeat } from '../lib/actions'
import { useDebounced, useEventData } from '../lib/hooks'
import { searchGuests, type GuestEntry } from '../lib/search'
import { cx } from '../lib/util'
import { PageHeader, SearchBar, SoftTag, toast } from '../components/ui'

type Slot = { seat: string; owner?: GuestEntry; companionOf?: GuestEntry }
type Snap = Awaited<ReturnType<typeof moveSeat>>

const shortName = (e: GuestEntry) => e.p.englishName || e.p.name

// 座位編排：拖拉名字換位（目標有人即對調）；亦可「點名字 → 點座位」
export default function SeatingPlan() {
  const ev = useOutletContext<EventRec>()
  const purpose = ev.mode === 'bus' ? '晚餐' : ''
  const { data, index } = useEventData(ev.id)
  const [selected, setSelected] = useState<string | null>(null)
  const [dragging, setDragging] = useState<GuestEntry | null>(null)
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 150)
  const history = useRef<Snap[]>([])
  const [, force] = useState(0)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // 觸控：按住約 0.2 秒才開始拖拉，避免捲動畫面時誤拖
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  )

  const { tables, slotsByTable, unassigned, byId } = useMemo(() => {
    const tables: Resource[] = data?.resources.filter((r) => r.type === 'table' && r.purpose === purpose) ?? []
    const ids = new Set(tables.map((t) => t.id))
    const byId = new Map(index.map((e) => [e.p.id, e]))
    const slotsByTable = new Map<string, Slot[]>()
    for (const t of tables) {
      const assigned = index
        .filter((e) => e.p.status === 'active')
        .map((e) => ({ e, s: e.seats.find((s) => s.resource.id === t.id) }))
        .filter((x) => x.s)
        .sort((a, b) => (Number(a.s!.seatLabel) || 999) - (Number(b.s!.seatLabel) || 999))
      const size = Math.max(t.capacity, assigned.reduce((a, x) => a + x.e.p.guestCount, 0))
      const slots: Slot[] = Array.from({ length: size }, (_, i) => ({ seat: String(i + 1) }))
      const place = (e: GuestEntry, start: number) => {
        slots[start].owner = e
        for (let k = 1; k < e.p.guestCount && start + k < slots.length; k++) if (!slots[start + k].owner) slots[start + k].companionOf = e
      }
      const later: GuestEntry[] = []
      for (const { e, s } of assigned) {
        const n = Number(s!.seatLabel) - 1
        if (n >= 0 && n < slots.length && !slots[n].owner && !slots[n].companionOf) place(e, n)
        else later.push(e) // 未有座位號或座位衝突：放到第一個空位
      }
      for (const e of later) {
        const free = slots.findIndex((x) => !x.owner && !x.companionOf)
        if (free >= 0) place(e, free)
      }
      slotsByTable.set(t.id, slots)
    }
    const unassigned = index.filter((e) => e.p.status === 'active' && !e.seats.some((s) => ids.has(s.resource.id)))
    return { tables, slotsByTable, unassigned, byId }
  }, [data, index, purpose])

  const pool = useMemo(() => {
    const ids = new Set(unassigned.map((e) => e.p.id))
    return dq ? searchGuests(index, dq).filter((e) => ids.has(e.p.id)) : unassigned
  }, [unassigned, index, dq])

  const move = async (pid: string, target: { resourceId: string; seatLabel: string } | null) => {
    const e = byId.get(pid)
    if (!e) return
    const cur = e.seats.find((s) => s.resource.purpose === purpose && s.resource.type === 'table')
    if (target && cur && cur.resource.id === target.resourceId && cur.seatLabel === target.seatLabel) return
    if (!target && !cur) return
    const snap = await moveSeat(ev.id, pid, purpose, target)
    history.current.push(snap)
    force((n) => n + 1)
    setSelected(null)
    const t = tables.find((x) => x.id === target?.resourceId)
    toast(target ? `${shortName(e)} → 第 ${t?.label} 席 ${target.seatLabel} 號` : `${shortName(e)} 已移出席位`)
  }

  // 放到同行者的位置 = 放到該位嘉賓本人的座位（對調）
  const resolveTarget = (overId: string) => {
    if (overId === 'pool') return null
    const [, tid, seat] = overId.split(':')
    const slot = slotsByTable.get(tid)?.find((s) => s.seat === seat)
    const ownerSeat = slot?.companionOf?.seats.find((s) => s.resource.id === tid)?.seatLabel
    return { resourceId: tid, seatLabel: ownerSeat || seat }
  }

  const onDragStart = (e: DragStartEvent) => setDragging(byId.get(String(e.active.id).slice(2)) ?? null)
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null)
    if (!e.over) return
    move(String(e.active.id).slice(2), resolveTarget(String(e.over.id)))
  }

  const tapSlot = (tid: string, slot: Slot) => {
    const who = slot.owner ?? slot.companionOf
    if (selected && who?.p.id === selected) return setSelected(null)
    if (selected) return move(selected, resolveTarget(`slot:${tid}:${slot.seat}`))
    if (slot.owner) setSelected(slot.owner.p.id)
    else if (slot.companionOf) setSelected(slot.companionOf.p.id)
  }

  const undo = async () => {
    const snap = history.current.pop()
    if (!snap) return
    await undoMoveSeat(ev.id, snap)
    force((n) => n + 1)
    toast('已復原上一次調位')
  }

  if (!data) return <div className="page" />
  const sel = selected ? byId.get(selected) : null

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)} autoScroll>
      <div className="page seating">
        <PageHeader
          zh={purpose ? '餐席編排' : '座位編排'}
          en="Seating Plan"
          back={`/e/${ev.id}/tables`}
          actions={
            <button className="btn btn-ghost btn-sm" onClick={undo} disabled={!history.current.length}>
              <Undo2 size={16} /> 復原
            </button>
          }
        />
        <p className={cx('seating-hint', sel && 'active')}>
          {sel ? (
            <>
              <Hand size={16} /> 已選「{shortName(sel)}」→ 點目標座位（有人會對調），或點「未安排」移出
              <button className="link" onClick={() => setSelected(null)}>
                取消
              </button>
            </>
          ) : (
            <>拖拉名字到另一個座位；目標座位有人會自動對調。手機：按住名字再拖，或先點名字再點座位。</>
          )}
        </p>

        <div className="seating-layout">
          <Pool
            entries={pool}
            total={unassigned.length}
            q={q}
            setQ={setQ}
            selected={selected}
            onTap={(pid) => setSelected(selected === pid ? null : pid)}
            onTapPool={() => selected && move(selected, null)}
          />
          <div className="seating-tables">
            {tables.map((t) => {
              const slots = slotsByTable.get(t.id) ?? []
              const used = slots.filter((s) => s.owner || s.companionOf).length
              return (
                <section key={t.id} className={cx('seat-table', used > t.capacity && 'over')}>
                  <header>
                    <strong>第 {t.label} 席</strong>
                    <span className={cx(used >= t.capacity && 'full')}>
                      {used} / {t.capacity}
                    </span>
                  </header>
                  <div className="seat-slots">
                    {slots.map((s) => (
                      <SeatSlot key={s.seat} id={`slot:${t.id}:${s.seat}`} slot={s} over={Number(s.seat) > t.capacity} selected={selected} onTap={() => tapSlot(t.id, s)} />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      </div>
      <DragOverlay dropAnimation={null}>{dragging ? <div className="guest-chip dragging">{shortName(dragging)}</div> : null}</DragOverlay>
    </DndContext>
  )
}

const Chip = ({ e, selected, children }: { e: GuestEntry; selected: boolean; children?: ReactNode }) => {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: `g:${e.p.id}` })
  return (
    <span ref={setNodeRef} {...listeners} {...attributes} title={e.p.englishName + (e.p.name ? ' ' + e.p.name : '')} className={cx('guest-chip', selected && 'selected', isDragging && 'ghost', e.p.vip && 'vip')}>
      <span className="guest-chip-name">{shortName(e)}</span>
      {e.p.guestCount > 1 && <span className="guest-chip-plus">+{e.p.guestCount - 1}</span>}
      {children}
    </span>
  )
}

const SeatSlot = ({ id, slot, over, selected, onTap }: { id: string; slot: Slot; over: boolean; selected: string | null; onTap: () => void }) => {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div ref={setNodeRef} className={cx('seat-slot', isOver && 'drop', over && 'extra', !slot.owner && !slot.companionOf && 'vacant', selected && 'targetable')} onClick={onTap}>
      <span className="seat-no">{slot.seat}</span>
      {slot.owner ? (
        <Chip e={slot.owner} selected={selected === slot.owner.p.id} />
      ) : slot.companionOf ? (
        <span className="companion">{shortName(slot.companionOf).split(' ')[0]} 同行</span>
      ) : (
        <span className="muted">空位</span>
      )}
    </div>
  )
}

const Pool = ({
  entries,
  total,
  q,
  setQ,
  selected,
  onTap,
  onTapPool,
}: {
  entries: GuestEntry[]
  total: number
  q: string
  setQ: (v: string) => void
  selected: string | null
  onTap: (pid: string) => void
  onTapPool: () => void
}) => {
  const { setNodeRef, isOver } = useDroppable({ id: 'pool' })
  return (
    <aside ref={setNodeRef} className={cx('seat-pool card', isOver && 'drop', selected && 'targetable')} onClick={(e) => e.target === e.currentTarget && onTapPool()}>
      <header onClick={onTapPool}>
        <Users size={18} /> 未安排 <SoftTag>{total}</SoftTag>
      </header>
      {total > 8 && <SearchBar value={q} onChange={setQ} placeholder="搜尋未安排嘉賓" />}
      <div className="seat-pool-list" onClick={(e) => e.target === e.currentTarget && onTapPool()}>
        {entries.length ? (
          entries.map((e) => (
            <span key={e.p.id} onClick={(ev) => (ev.stopPropagation(), onTap(e.p.id))}>
              <Chip e={e} selected={selected === e.p.id} />
            </span>
          ))
        ) : (
          <p className="muted small">{total ? '沒有符合的嘉賓' : '全部已安排 ✓ 把名字拖到這裏可移出席位'}</p>
        )}
      </div>
    </aside>
  )
}
