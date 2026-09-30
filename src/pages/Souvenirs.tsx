import { useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ClipboardList, Gift, Pencil, Plus, ScanLine, ListChecks } from 'lucide-react'
import { db } from '../db/db'
import type { EventRec, SouvenirItem } from '../db/types'
import { eligibilityLabel, quantityLabel, saveSouvenir } from '../lib/actions'
import { uid } from '../lib/util'
import { useSettings } from '../lib/settings'
import { GiftArt } from '../illustrations'
import { EmptyState, PageHeader, ProgressBar, Sheet, toast } from '../components/ui'


export default function Souvenirs() {
  const ev = useOutletContext<EventRec>()
  const items = useLiveQuery(() => db.souvenirs.where('eventId').equals(ev.id).sortBy('sortOrder'), [ev.id])
  const reds = useLiveQuery(() => db.redemptions.where('eventId').equals(ev.id).filter((r) => !r.voided).toArray(), [ev.id]) ?? []
  const [edit, setEdit] = useState<SouvenirItem | null>(null)
  const groups = useSettings().giftGroups

  const blank = (): SouvenirItem => ({ id: uid(), eventId: ev.id, name: '', stock: 100, perGuest: 0, eligibility: 'all', sortOrder: (items?.length ?? 0) + 1 })

  if (!items) return <div className="page" />
  return (
    <div className="page">
      <PageHeader
        zh="紀念品"
        en="Souvenirs"
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setEdit(blank())}>
            <Plus size={18} /> 新增紀念品
          </button>
        }
      />
      <p className="hint">紀念品站獨立運作，與簽到狀態無關。在掃描畫面頂部把「掃描目的」改為紀念品即可開始派發。</p>
      {items.length === 0 ? (
        <EmptyState
          art={<GiftArt />}
          zh="還沒有紀念品。"
          en="No souvenirs yet."
          action={
            <button className="btn btn-primary" onClick={() => setEdit(blank())}>
              <Plus size={18} /> 新增紀念品
            </button>
          }
        />
      ) : (
        <div className="souvenir-grid">
          {items.map((it) => {
            const mine = reds.filter((r) => r.itemId === it.id)
            const qty = mine.reduce((a, r) => a + r.quantity, 0)
            const people = new Set(mine.map((r) => r.participantId)).size
            const left = it.stock === null ? null : it.stock - qty
            const low = left !== null && it.stock! > 0 && left / it.stock! < 0.1
            return (
              <section key={it.id} className="card souvenir-card">
                <div className="souvenir-head">
                  <span className="souvenir-icon">
                    <Gift size={22} />
                  </span>
                  <div>
                    <h3>{it.name}</h3>
                    <p className="muted">{eligibilityLabel(it.eligibility)}</p>
                    <p className="muted">{quantityLabel(it.perGuest)}</p>
                  </div>
                  <button className="icon-btn" aria-label="修改" onClick={() => setEdit(it)}>
                    <Pencil size={18} />
                  </button>
                </div>
                <p className="big-num">
                  {qty}
                  <small>{it.stock !== null ? ` / ${it.stock} 已派` : ' 已派'}</small>
                </p>
                {it.stock !== null && <ProgressBar value={qty} max={it.stock} tone={low ? 'warn' : 'mode'} />}
                <p className={low ? 'warn-text' : 'muted'}>
                  {people} 位嘉賓已領{left !== null && ` · 剩 ${left}`}
                  {low && ' · 庫存不足'}
                </p>
                <div className="souvenir-actions">
                  <Link to={`/e/${ev.id}/scan?p=s:${it.id}`} className="btn btn-primary">
                    <ScanLine size={18} /> 掃描派發
                  </Link>
                  <Link to={`/e/${ev.id}/souvenirs/records?item=${it.id}&tab=pending`} className="btn btn-mode">
                    <ListChecks size={18} /> 名單派發
                  </Link>
                  <Link to={`/e/${ev.id}/souvenirs/records?item=${it.id}`} className="btn btn-ghost">
                    <ClipboardList size={18} /> 派發紀錄
                  </Link>
                </div>
              </section>
            )
          })}
        </div>
      )}

      <Sheet
        open={!!edit}
        onClose={() => setEdit(null)}
        title={items.some((i) => i.id === edit?.id) ? '修改紀念品' : '新增紀念品'}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setEdit(null)}>
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={async () => {
                if (!edit?.name.trim()) return toast('請輸入名稱')
                await saveSouvenir({ ...edit, name: edit.name.trim() })
                setEdit(null)
                toast('已儲存')
              }}
            >
              儲存
            </button>
          </>
        }
      >
        {edit && (
          <>
            <label className="field">
              <span>名稱 Name</span>
              <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="例如 帆布袋 Tote Bag" autoFocus />
            </label>
            <div className="field-row">
              <label className="field">
                <span>總數量 Stock（留空 = 不限）</span>
                <input
                  type="number"
                  min={0}
                  value={edit.stock ?? ''}
                  onChange={(e) => setEdit({ ...edit, stock: e.target.value === '' ? null : Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>每張請柬份數（0 = 按人數）</span>
                <input type="number" min={0} value={edit.perGuest} onChange={(e) => setEdit({ ...edit, perGuest: Number(e.target.value) })} />
              </label>
            </div>
            <label className="field">
              <span>領取資格 Eligibility</span>
              <select value={edit.eligibility} onChange={(e) => setEdit({ ...edit, eligibility: e.target.value })}>
                <option value="all">所有人</option>
                <option value="vip">只限 VIP</option>
                {groups.map((t) => (
                  <option key={t} value={`group:${t}`}>
                    只限「{t}」
                  </option>
                ))}
                {!['all', 'vip', ...groups.map((t) => `group:${t}`)].includes(edit.eligibility) && (
                  <option value={edit.eligibility}>{eligibilityLabel(edit.eligibility)}（舊設定）</option>
                )}
              </select>
            </label>
            <p className="hint">
              「每張請柬份數」填 0：一票多人的請柬每位 1 份；填 2：每張請柬固定 2 份。
              <br />
              想只派給某一類嘉賓？先到 <Link to="/settings">設定 → 禮物組別</Link> 新增組別（例如「贊助商」），再在嘉賓資料選擇組別。
            </p>
          </>
        )}
      </Sheet>
    </div>
  )
}
