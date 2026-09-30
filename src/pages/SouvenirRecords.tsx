import { useMemo, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { EventRec } from '../db/types'
import { eligible, entitlement, undoRedemption, verifySouvenir } from '../lib/actions'
import { feedback } from '../lib/feedback'
import type { GuestEntry } from '../lib/search'
import { useDebounced, useEventData } from '../lib/hooks'
import { searchGuests } from '../lib/search'
import { formatTime } from '../lib/util'
import { GiftArt } from '../illustrations'
import { GuestRow } from '../components/GuestRow'
import { ConfirmSheet, EmptyState, FilterChip, PageHeader, SearchBar, toast } from '../components/ui'
import { nameOf } from '../lib/names'

// 名單派發及紀錄：哪些嘉賓已領／未領紀念品；在「未領取」名單點一下嘉賓即可派發（不用掃描 QR）
export default function SouvenirRecords() {
  const ev = useOutletContext<EventRec>()
  const [params, setParams] = useSearchParams()
  const items = useLiveQuery(() => db.souvenirs.where('eventId').equals(ev.id).sortBy('sortOrder'), [ev.id]) ?? []
  const reds = useLiveQuery(() => db.redemptions.where('eventId').equals(ev.id).filter((r) => !r.voided).toArray(), [ev.id]) ?? []
  const { index } = useEventData(ev.id)
  const itemId = params.get('item') ?? items[0]?.id
  const item = items.find((i) => i.id === itemId)
  const tab = params.get('tab') === 'pending' ? 'pending' : 'done'
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 150)
  const [undo, setUndo] = useState<{ pid: string; name: string } | null>(null)

  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params)
    n.set(k, v)
    setParams(n, { replace: true })
  }

  const { done, pending } = useMemo(() => {
    if (!item) return { done: [], pending: [] }
    const mine = reds.filter((r) => r.itemId === item.id)
    const byP = new Map<string, { qty: number; time: number; operator: string }>()
    for (const r of mine) {
      const x = byP.get(r.participantId) ?? { qty: 0, time: 0, operator: '' }
      x.qty += r.quantity
      if (r.time > x.time) Object.assign(x, { time: r.time, operator: r.operator })
      byP.set(r.participantId, x)
    }
    const matched = searchGuests(index, dq).filter((e) => e.p.status === 'active' && eligible(item, e.p))
    const done = matched
      .filter((e) => byP.has(e.p.id))
      .map((e) => ({ e, r: byP.get(e.p.id)! }))
      .sort((a, b) => b.r.time - a.r.time)
    const pending = matched.filter((e) => !byP.has(e.p.id))
    return { done, pending }
  }, [item, reds, index, dq])

  if (!items.length)
    return (
      <div className="page">
        <PageHeader zh="派發紀錄" en="Distribution Records" back={`/e/${ev.id}/souvenirs`} />
        <EmptyState art={<GiftArt />} zh="還沒有紀念品。" en="No souvenirs yet." />
      </div>
    )

  const qtyTotal = done.reduce((a, x) => a + x.r.qty, 0)

  // 按名單派發：與掃描派發用同一套檢查（資格、數量、庫存）
  const give = async (e: GuestEntry) => {
    if (!item) return
    const o = await verifySouvenir(ev.id, item.id, '', 'SEARCH', e.p.id)
    if (o.result === 'valid') {
      feedback('valid')
      toast(`✓ 已派發「${item.name}」×${o.souvenir?.quantity ?? 1} 給 ${nameOf(e.p)}`)
    } else {
      feedback('invalid')
      toast(o.result === 'duplicate' ? `${nameOf(e.p)} 已經領取` : o.reason || '未能派發')
    }
  }

  return (
    <div className="page">
      <PageHeader zh="名單派發及紀錄" en="Distribute by List" back={`/e/${ev.id}/souvenirs`} />
      <div className="chips">
        {items.map((i) => (
          <FilterChip key={i.id} active={i.id === itemId} onClick={() => set('item', i.id)}>
            {i.name}
          </FilterChip>
        ))}
      </div>
      <div className="tabs" style={{ marginTop: 12 }}>
        <button className={tab === 'done' ? 'active' : ''} onClick={() => set('tab', 'done')}>
          已領取<small>Collected · {done.length} 人 · {qtyTotal} 份</small>
        </button>
        <button className={tab === 'pending' ? 'active' : ''} onClick={() => set('tab', 'pending')}>
          未領取<small>Not yet · {pending.length} 人</small>
        </button>
      </div>
      <div className="toolbar">
        <SearchBar value={q} onChange={setQ} placeholder="搜尋姓名／編號" />
      </div>

      <p className="hint">{tab === 'pending' ? '點一下嘉賓即派發（不用掃描）。派錯了可到「已領取」點該嘉賓取消。' : '點一下嘉賓可取消領取。'}</p>

      {tab === 'done' ? (
        done.length ? (
          <div className="list card">
            {done.map(({ e, r }) => (
              <GuestRow
                key={e.p.id}
                e={e}
                onClick={() => setUndo({ pid: e.p.id, name: nameOf(e.p) })}
                trailing={
                  <span className="record-meta">
                    <strong>×{r.qty}</strong>
                    <span className="muted">
                      {formatTime(r.time)} · {r.operator}
                    </span>
                  </span>
                }
              />
            ))}
          </div>
        ) : (
          <p className="muted pad center">未有人領取</p>
        )
      ) : pending.length ? (
        <div className="list card">
          {pending.map((e) => (
            <GuestRow
              key={e.p.id}
              e={e}
              onClick={() => give(e)}
              trailing={item && <span className="btn btn-sm btn-mode">派發 ×{entitlement(item, e.p)}</span>}
            />
          ))}
        </div>
      ) : (
        <p className="muted pad center">全部已領取 ✓</p>
      )}

      <ConfirmSheet
        open={!!undo}
        onClose={() => setUndo(null)}
        onConfirm={async () => {
          const p = undo && (await db.participants.get(undo.pid))
          if (p && item) await undoRedemption(item.id, p)
          toast('已取消領取')
        }}
        title="取消領取"
        message={
          <p>
            把 {undo?.name} 的「{item?.name}」改回未領取？庫存會加回，並記錄在操作紀錄。
          </p>
        }
        confirmText="取消領取"
      />
    </div>
  )
}
