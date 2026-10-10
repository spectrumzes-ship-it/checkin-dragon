import { useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ClipboardList, Gift, Pencil, Plus, ScanLine, ListChecks, Ticket } from 'lucide-react'
import { db } from '../db/db'
import type { EventRec, SouvenirItem, SouvenirLogic } from '../db/types'
import { eligibilityLabel, logicLabel, logicOf, perClaimOf, quantityLabel, saveSouvenir } from '../lib/actions'
import { todayKey, toDateKey, uid } from '../lib/util'
import { useSettings } from '../lib/settings'
import { GiftArt } from '../illustrations'
import { EmptyState, PageHeader, CarsBar, Sheet, toast } from '../components/ui'


const LOGICS: [SouvenirLogic, string, string][] = [
  ['person', '按人頭／門票登記派發', '每位（每張門票）可領一次。適合旅遊、活動、宴會一般情況。'],
  ['invitation', '按請柬單位派發（同行者共用）', '同一張請柬只可領一次，任何一位領了，其他同行者不可再領。適合宴會家庭請柬。'],
  ['fcfs', '限量先到先得', '不認人、不查重複，每次核銷即扣庫存，派完即止。適合「禮品領取」。'],
]
// 禮品領取模式的三種派發方式
const GIFT_LOGICS: [SouvenirLogic, string, string][] = [
  ['person', '按人頭登記派發（會員名單）', '可事前匯入會員名單，憑會員卡 QR 或搜尋名字派發；每人可領一次。'],
  ['coupon', '憑券換領', '自動生成 QR 換領券並列印，一券換一份，不記名（亦可按名單生成記名券）。'],
  ['fcfs', '限量先到先得', '不認人、不查重複，每派一份就扣庫存，派完即止；可選擇登記領取人資料。'],
]

export default function Souvenirs() {
  const ev = useOutletContext<EventRec>()
  const items = useLiveQuery(() => db.souvenirs.where('eventId').equals(ev.id).sortBy('sortOrder'), [ev.id])
  const reds = useLiveQuery(() => db.redemptions.where('eventId').equals(ev.id).filter((r) => !r.voided).toArray(), [ev.id]) ?? []
  const coupons = useLiveQuery(() => db.coupons.where('eventId').equals(ev.id).toArray(), [ev.id]) ?? []
  const logics = ev.mode === 'gift' ? GIFT_LOGICS : LOGICS
  const today = todayKey()
  const [edit, setEdit] = useState<SouvenirItem | null>(null)
  const groups = useSettings().giftGroups
  const word = ev.mode === 'gift' ? '禮品' : '紀念品'

  const blank = (): SouvenirItem => ({ id: uid(), eventId: ev.id, name: '', stock: 100, perGuest: 0, perClaim: 1, logic: ev.mode === 'gift' ? 'fcfs' : 'person', eligibility: 'all', sortOrder: (items?.length ?? 0) + 1 })

  if (!items) return <div className="page" />
  return (
    <div className="page">
      <PageHeader
        zh={word}
        en={ev.mode === 'gift' ? 'Gifts' : 'Souvenirs'}
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setEdit(blank())}>
            <Plus size={18} /> 新增{word}
          </button>
        }
      />
      <p className="hint">{ev.mode === 'gift' ? '每款禮品可用掃描、領取登記或名單派發。' : '紀念品站獨立運作，與簽到狀態無關。在掃描畫面頂部把「掃描目的」改為紀念品即可開始派發。'}</p>
      {items.length === 0 ? (
        <EmptyState
          art={<GiftArt />}
          zh={`還沒有${word}。`}
          en="No souvenirs yet."
          action={
            <button className="btn btn-primary" onClick={() => setEdit(blank())}>
              <Plus size={18} /> 新增{word}
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
                    <p className="muted">{logicLabel(it)}</p>
                    <p className="muted">{quantityLabel(it, left)}</p>
                  </div>
                  <button className="icon-btn" aria-label="修改" onClick={() => setEdit(it)}>
                    <Pencil size={18} />
                  </button>
                </div>
                <p className="big-num">
                  {qty}
                  <small>{it.stock !== null ? ` / ${it.stock} 已派` : ' 已派'}</small>
                </p>
                {it.stock !== null && <CarsBar value={qty} max={it.stock} tone={low ? 'warn' : undefined} />}
                <p className={low ? 'warn-text' : 'muted'}>
                  {logicOf(it) === 'coupon' ? `${mine.length} 張券已換領` : `${people} 位嘉賓已領`}
                  {left !== null && ` · 剩 ${left}`}
                  {low && ' · 存貨不足'}
                </p>
                {logicOf(it) === 'coupon' &&
                  (() => {
                    const cs = coupons.filter((c) => c.itemId === it.id)
                    const used = new Set(mine.map((r) => r.couponId))
                    const voided = cs.filter((c) => c.voided).length
                    const redeemed = cs.filter((c) => used.has(c.id)).length
                    return (
                      <p className="muted">
                        已印 {cs.length} 張 · 已換領 {redeemed} · 未換領 {cs.length - redeemed - voided}
                        {voided > 0 && ` · 作廢 ${voided}`}
                      </p>
                    )
                  })()}
                {logicOf(it) === 'fcfs' && it.dailyQuota ? (
                  <p className="muted">
                    今日已派 {mine.filter((r) => toDateKey(new Date(r.time)) === today).reduce((a, r) => a + r.quantity, 0)} / {it.dailyQuota} 份（每日上限）
                  </p>
                ) : null}
                <div className="souvenir-actions">
                  <Link to={`/e/${ev.id}/scan?p=s:${it.id}`} className="btn btn-primary">
                    <ScanLine size={18} /> {logicOf(it) === 'coupon' ? '掃描換領' : '掃描派發'}
                  </Link>
                  <Link to={`/e/${ev.id}/souvenirs/records?item=${it.id}&tab=pending`} className="btn btn-mode">
                    {logicOf(it) === 'coupon' ? <Ticket size={18} /> : <ListChecks size={18} />}{' '}
                    {logicOf(it) === 'fcfs' ? '領取登記' : logicOf(it) === 'coupon' ? '換領券' : '名單派發'}
                  </Link>
                  <Link to={`/e/${ev.id}/souvenirs/records?item=${it.id}&tab=done`} className="btn btn-ghost">
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
        title={`${items.some((i) => i.id === edit?.id) ? '修改' : '新增'}${word}`}
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
            {/* 先到先得及憑券換領不認人，所以沒有領取資格 */}
            {(logicOf(edit) === 'person' || logicOf(edit) === 'invitation') && (
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
            )}
            <div className="field-row">
              <label className="field">
                <span>總數量 Stock</span>
                <input
                  type="number"
                  min={0}
                  value={edit.stock ?? ''}
                  placeholder="不限"
                  onChange={(e) => setEdit({ ...edit, stock: e.target.value === '' ? null : Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>每次領取上限（份）</span>
                <input
                  type="number"
                  min={1}
                  value={edit.perClaim ?? perClaimOf(edit)}
                  onChange={(e) => setEdit({ ...edit, logic: logicOf(edit), perClaim: Math.max(1, Number(e.target.value) || 1) })}
                />
              </label>
            </div>
            <p className="hint">總數量留空 = 不限數量。設了上限後，不論哪一種派發方式，派完即止。</p>
            <div className="field">
              <span>派發方式 Distribution</span>
              <div className="radio-list" role="radiogroup">
                {logics.map(([v, zh, note]) => (
                  <label key={v} className={logicOf(edit) === v ? 'active' : ''}>
                    <input type="radio" name="logic" checked={logicOf(edit) === v} onChange={() => setEdit({ ...edit, perClaim: perClaimOf(edit), logic: v })} />
                    <span>
                      <strong>{zh}</strong>
                      <small>{note}</small>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            {(logicOf(edit) === 'person' || logicOf(edit) === 'invitation') && (
              <label className="check-row">
                <input type="checkbox" checked={edit.allowWalkIn !== false} onChange={(e) => setEdit({ ...edit, allowWalkIn: e.target.checked })} />
                <span>
                  <strong>容許即場加入名單</strong>
                  <small>名單上沒有的人可以即場登記並派發</small>
                </span>
              </label>
            )}
            {logicOf(edit) === 'fcfs' && (
              <>
                <label className="field">
                  <span>每日上限（份）Daily Quota</span>
                  <input
                    type="number"
                    min={1}
                    value={edit.dailyQuota ?? ''}
                    placeholder="不限"
                    onChange={(e) => setEdit({ ...edit, dailyQuota: e.target.value === '' ? null : Math.max(1, Number(e.target.value)) })}
                  />
                </label>
                <p className="hint">多日活動適用：例如共 300 份、每日上限 100 份，避免第一日全部派完。留空 = 不限。</p>
                <label className="check-row">
                  <input type="checkbox" checked={!!edit.phoneCheck} onChange={(e) => setEdit({ ...edit, phoneCheck: e.target.checked })} />
                  <span>
                    <strong>同一電話再次登記時提醒</strong>
                    <small>只是提醒，仍可照樣派發</small>
                  </span>
                </label>
              </>
            )}
            <p className="hint">
              想只派給某一類嘉賓？先到 <Link to="/settings">設定 → 禮物組別</Link> 新增組別（例如「贊助商」），再在嘉賓資料選擇組別。
            </p>
          </>
        )}
      </Sheet>
    </div>
  )
}
