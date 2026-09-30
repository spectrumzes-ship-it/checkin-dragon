import { useEffect, useMemo, useState } from 'react'
import { useLocation, useOutletContext, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Gift, ScanText, UserPlus } from 'lucide-react'
import CardScanner from '../components/CardScanner'
import { db } from '../db/db'
import type { EventRec, ScanMethod } from '../db/types'
import {
  eligible,
  emptyGuest,
  entitlement,
  idPrefixOf,
  logicLabel,
  logicOf,
  perClaimOf,
  quantityLabel,
  registerAndRedeem,
  undoRedemption,
  undoRedemptionById,
  verifySouvenir,
  type ScanOutcome,
} from '../lib/actions'
import { feedback } from '../lib/feedback'
import { useDebounced, useEventData } from '../lib/hooks'
import { searchGuests, type GuestEntry } from '../lib/search'
import { ageFromBirth, formatTime } from '../lib/util'
import { GiftArt } from '../illustrations'
import { GuestRow } from '../components/GuestRow'
import { ConfirmSheet, EmptyState, FilterChip, PageHeader, SearchBar, Sheet, toast } from '../components/ui'
import { nameOf } from '../lib/names'

const METHOD: Record<ScanMethod, string> = { QR: 'QR', OCR: '文字辨識', MANUAL: '手動', SEARCH: '名單' }
const blankReg = () => ({ name: '', englishName: '', phone: '', age: '', birthDate: '', idPrefix: '', memberId: '', permitNo: '', permitExpiry: '' })
const TICK = { accentColor: 'var(--mode-ink)' }

// 名單派發及紀錄：哪些嘉賓已領／未領紀念品；在「未領取」名單點一下嘉賓即可派發（不用掃描 QR）
// 亦可即場登記名單上沒有的領取人；「限量先到先得」可不登記直接派發
export default function SouvenirRecords() {
  const ev = useOutletContext<EventRec>()
  const [params, setParams] = useSearchParams()
  const items = useLiveQuery(() => db.souvenirs.where('eventId').equals(ev.id).sortBy('sortOrder'), [ev.id]) ?? []
  const reds = useLiveQuery(() => db.redemptions.where('eventId').equals(ev.id).filter((r) => !r.voided).toArray(), [ev.id]) ?? []
  const { index } = useEventData(ev.id)
  const itemId = params.get('item') ?? items[0]?.id
  const item = items.find((i) => i.id === itemId)
  const tab = params.get('tab') === 'done' ? 'done' : 'pending' // 預設先看「未領取」
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 150)
  const [undo, setUndo] = useState<{ pid?: string; rid?: string; name: string } | null>(null)
  const [reg, setReg] = useState<ReturnType<typeof blankReg> | null>(null)
  const [scan, setScan] = useState(false)
  const [usedOcr, setUsedOcr] = useState(false)
  const [joinEvent, setJoinEvent] = useState(false) // 即場登記：false = 只領禮品；true = 同時參加活動

  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params)
    n.set(k, v)
    n.delete('reg')
    setParams(n, { replace: true })
  }

  // 由掃描畫面按「即場登記領取人」進入：直接打開登記表
  // 由文字掃描進入時會帶來辨識到的欄位（不放在網址內），登記表會預先填好
  const loc = useLocation()
  const pre = loc.state as { reg?: Partial<ReturnType<typeof blankReg>>; method?: ScanMethod } | null
  useEffect(() => {
    if (pre?.reg)
      setReg({
        ...blankReg(),
        ...pre.reg,
        age: ageFromBirth(pre.reg.birthDate ?? ''),
        idPrefix: pre.reg.idPrefix || (ev.mode === 'bus' ? '' : (pre.reg.permitNo ?? '').slice(0, 4)),
        permitNo: ev.mode === 'bus' ? (pre.reg.permitNo ?? '') : '',
        permitExpiry: ev.mode === 'bus' ? (pre.reg.permitExpiry ?? '') : '',
      })
    else if (params.get('reg') === '1') setReg(blankReg())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.key])

  const logic = item ? logicOf(item) : 'person'
  const mine = useMemo(() => reds.filter((r) => r.itemId === item?.id).sort((a, b) => b.time - a.time), [reds, item])
  const given = mine.reduce((a, r) => a + r.quantity, 0)
  const left = !item || item.stock === null ? null : item.stock - given

  const { done, pending } = useMemo(() => {
    if (!item) return { done: [], pending: [] }
    const byP = new Map<string, { qty: number; time: number; operator: string }>()
    for (const r of mine) {
      const x = byP.get(r.participantId) ?? { qty: 0, time: 0, operator: '' }
      x.qty += r.quantity
      if (r.time > x.time) Object.assign(x, { time: r.time, operator: r.operator })
      byP.set(r.participantId, x)
    }
    // 按請柬派發：同一張請柬有人領了，其他同行者不再列入「未領取」
    const byId = new Map(index.map((e) => [e.p.id, e]))
    const root = (pid: string) => byId.get(pid)?.p.companionOf ?? pid
    const claimedRoots = new Set([...byP.keys()].map(root))
    const matched = searchGuests(index, dq).filter((e) => e.p.status === 'active' && eligible(item, e.p))
    const done = matched
      .filter((e) => byP.has(e.p.id))
      .map((e) => ({ e, r: byP.get(e.p.id)! }))
      .sort((a, b) => b.r.time - a.r.time)
    const pending = matched.filter((e) => !byP.has(e.p.id) && !(logic === 'invitation' && claimedRoots.has(root(e.p.id))))
    return { done, pending }
  }, [item, mine, index, dq, logic])

  if (!items.length)
    return (
      <div className="page">
        <PageHeader zh="名單派發及紀錄" en="Distribute by List" back={`/e/${ev.id}/souvenirs`} />
        <EmptyState art={<GiftArt />} zh="還沒有紀念品。" en="No souvenirs yet." />
      </div>
    )

  const report = (o: ScanOutcome, who: string) => {
    if (!item) return
    if (o.result === 'valid') {
      feedback('valid')
      toast(`✓ 已派發「${item.name}」×${o.souvenir?.quantity ?? 1}${who ? ` 給 ${who}` : ''}`)
    } else {
      feedback('invalid')
      toast(o.reason || (o.result === 'duplicate' ? `${who} 已經領取` : '未能派發'))
    }
  }

  // 按名單派發：與掃描派發用同一套檢查（資格、數量、庫存）
  const give = async (e: GuestEntry) => item && report(await verifySouvenir(ev.id, item.id, '', 'SEARCH', e.p.id), nameOf(e.p))
  // 限量先到先得：不登記，直接扣庫存
  const soldOut = left !== null && left <= 0
  const giveAnonymous = async () => item && report(await verifySouvenir(ev.id, item.id, '', 'MANUAL'), '')

  const submitReg = async () => {
    if (!reg || !item) return
    if (!reg.name.trim() && !reg.englishName.trim()) return toast('請輸入中文或英文姓名')
    const group = item.eligibility.startsWith('group:') ? [item.eligibility.slice(6)] : []
    const o = await registerAndRedeem(ev.id, item.id, { ...emptyGuest(), ...reg, giftGroups: group }, pre?.reg || usedOcr ? 'OCR' : 'MANUAL', ev.mode !== 'gift' && !joinEvent)
    setReg(null)
    setUsedOcr(false)
    report(o, reg.name.trim() || reg.englishName.trim())
  }

  return (
    <div className="page">
      <PageHeader
        zh={logic === 'fcfs' ? '領取登記及紀錄' : '名單派發及紀錄'}
        en={logic === 'fcfs' ? 'Collection Register' : 'Distribute by List'}
        back={`/e/${ev.id}/souvenirs`}
        actions={
          logic !== 'fcfs' && (
            <button className="btn btn-primary btn-sm" onClick={() => setReg(blankReg())}>
              <UserPlus size={18} /> 即場登記
            </button>
          )
        }
      />
      <div className="chips">
        {items.map((i) => (
          <FilterChip key={i.id} active={i.id === itemId} onClick={() => set('item', i.id)}>
            {i.name}
          </FilterChip>
        ))}
      </div>
      {item && (
        <p className="hint">
          {logicLabel(item)} · {quantityLabel(item, left)} · 已派 {given} 份
        </p>
      )}

      {logic === 'fcfs' && item ? (
        <>
          <button className="btn btn-primary fcfs-give" onClick={() => setReg(blankReg())} disabled={soldOut}>
            <UserPlus size={20} /> {soldOut ? '禮物已派發完畢' : `領取登記（派發 ×${Math.min(perClaimOf(item), left ?? Infinity)}）`}
          </button>
          {!soldOut && (
            <button className="btn btn-ghost fcfs-give" onClick={giveAnonymous}>
              <Gift size={20} /> 不登記，直接派發
            </button>
          )}
          <p className="hint">先到先得：每次登記或派發即扣庫存，不查重複，派完即止。點下面的紀錄可取消。</p>
          {mine.length ? (
            <div className="list card">
              {mine.map((r) => {
                const e = index.find((x) => x.p.id === r.participantId)
                return (
                  <button key={r.id} className="fcfs-row" onClick={() => setUndo({ rid: r.id, name: e ? nameOf(e.p) : '未登記領取人' })}>
                    <span>
                      <strong>{e ? nameOf(e.p) : '未登記'}</strong>
                      <span className="muted">
                        {formatTime(r.time)} · {METHOD[r.method ?? 'MANUAL']} · {r.operator}
                      </span>
                    </span>
                    <strong>×{r.quantity}</strong>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="muted pad center">未有派發紀錄</p>
          )}
        </>
      ) : (
        <>
          <div className="tabs" style={{ marginTop: 12 }}>
            <button className={tab === 'pending' ? 'active' : ''} onClick={() => set('tab', 'pending')}>
              未領取<small>Not yet · {pending.length} 人</small>
            </button>
            <button className={tab === 'done' ? 'active' : ''} onClick={() => set('tab', 'done')}>
              已領取<small>Collected · {done.length} 人 · {done.reduce((a, x) => a + x.r.qty, 0)} 份</small>
            </button>
          </div>
          <div className="toolbar">
            <SearchBar value={q} onChange={setQ} placeholder="搜尋姓名／編號／電話" />
          </div>
          <p className="hint">
            {tab === 'pending'
              ? `點一下嘉賓即派發（不用掃描）。${logic === 'invitation' ? '同一張請柬任何一位領了，其他同行者會自動從這裏消失。' : ''}派錯了可到「已領取」點該嘉賓取消。名單上沒有的人請按「即場登記」。`
              : '點一下嘉賓可取消領取。'}
          </p>

          {tab === 'done' ? (
            done.length ? (
              <div className="list card">
                {done.map(({ e, r }) => (
                  <GuestRow
                    key={e.p.id}
                    e={e}
                    mark={
                      <span className="gift-mark done" aria-label="已領取">
                        <Gift size={18} />
                      </span>
                    }
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
                <GuestRow key={e.p.id} e={e} mark={<span className="gift-mark" aria-label="未領取" />} onClick={() => give(e)} trailing={item && <span className="btn btn-sm btn-mode">派發 ×{entitlement(item, e.p)}</span>} />
              ))}
            </div>
          ) : (
            <p className="muted pad center">{dq ? `找不到「${dq}」，可按「即場登記」` : index.length ? '全部已領取 ✓' : '名單上未有領取人，請按「即場登記」'}</p>
          )}
        </>
      )}

      <Sheet
        open={!!reg}
        onClose={() => setReg(null)}
        title={logic === 'fcfs' ? '領取登記' : '即場登記並派發'}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setReg(null)}>
              取消
            </button>
            <button className="btn btn-primary" onClick={submitReg}>
              登記並派發
            </button>
          </>
        }
      >
        {reg && (
          <>
            {ev.mode !== 'gift' && (
              <div className="radio-list" role="radiogroup" style={{ marginBottom: 12 }}>
                <label className={!joinEvent ? 'active' : ''}>
                  <input type="radio" name="join" style={TICK} checked={!joinEvent} onChange={() => setJoinEvent(false)} />
                  <span>
                    <strong>只領禮品</strong>
                    <small>不計入出席人數、座位及點名。</small>
                  </span>
                </label>
                <label className={joinEvent ? 'active' : ''}>
                  <input type="radio" name="join" style={TICK} checked={joinEvent} onChange={() => setJoinEvent(true)} />
                  <span>
                    <strong>即場登記參加活動</strong>
                    <small>加入嘉賓名單，可簽到及安排座位。</small>
                  </span>
                </label>
              </div>
            )}
            <button type="button" className="btn btn-mode btn-block scan-fill" onClick={() => setScan(true)}>
              <ScanText size={18} /> 文字辨識 · 自動填寫
            </button>
            <p className="hint">{pre?.reg ? '以下資料由文字辨識自動填入，請核對後才提交。' : ''}只有姓名必填（中文或英文其中一個），其他可留空。</p>
            <div className="field-row">
              <label className="field">
                <span>中文姓名 Name</span>
                <input value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} autoFocus />
              </label>
              <label className="field">
                <span>英文姓名 English</span>
                <input value={reg.englishName} onChange={(e) => setReg({ ...reg, englishName: e.target.value })} autoCapitalize="characters" />
              </label>
            </div>
            <label className="field">
              <span>電話號碼 Phone</span>
              <input value={reg.phone} onChange={(e) => setReg({ ...reg, phone: e.target.value })} inputMode="tel" />
            </label>
            <div className="field-row">
              <label className="field">
                <span>出生日期 Date of Birth</span>
                <input type="date" value={reg.birthDate} onChange={(e) => setReg({ ...reg, birthDate: e.target.value, age: ageFromBirth(e.target.value) || reg.age })} />
              </label>
              <label className="field">
                <span>年齡 Age（填出生日期會自動計算）</span>
                <input value={reg.age} onChange={(e) => setReg({ ...reg, age: e.target.value })} inputMode="numeric" />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>身份證（只存頭 4 位）</span>
                <input value={reg.idPrefix} onChange={(e) => setReg({ ...reg, idPrefix: idPrefixOf(e.target.value) })} maxLength={4} placeholder="例如 A123" autoCapitalize="characters" />
              </label>
              <label className="field">
                <span>會員編號 Member ID</span>
                <input value={reg.memberId} onChange={(e) => setReg({ ...reg, memberId: e.target.value })} />
              </label>
            </div>
            {ev.mode === 'bus' && (
              <div className="field-row">
                <label className="field">
                  <span>回鄉證號碼</span>
                  <input value={reg.permitNo} onChange={(e) => setReg({ ...reg, permitNo: e.target.value.toUpperCase() })} placeholder="例如 H12345678" autoCapitalize="characters" />
                </label>
                <label className="field">
                  <span>證件有效期至</span>
                  <input type="date" value={reg.permitExpiry} onChange={(e) => setReg({ ...reg, permitExpiry: e.target.value })} />
                </label>
              </div>
            )}
          </>
        )}
      </Sheet>

      {scan && reg && (
        <CardScanner
          onClose={() => setScan(false)}
          onUse={(f) => {
            setReg({
              ...reg,
              name: f.name || reg.name,
              englishName: f.englishName || reg.englishName,
              memberId: f.memberId || reg.memberId,
              phone: f.phone || reg.phone,
              birthDate: f.birthDate || reg.birthDate,
              age: ageFromBirth(f.birthDate) || reg.age,
              idPrefix: f.idPrefix || (ev.mode === 'bus' ? '' : f.permitNo.slice(0, 4)) || reg.idPrefix,
              permitNo: ev.mode === 'bus' ? f.permitNo || reg.permitNo : '',
              permitExpiry: ev.mode === 'bus' ? f.permitExpiry || reg.permitExpiry : '',
            })
            setUsedOcr(true)
            setScan(false)
          }}
        />
      )}

      <ConfirmSheet
        open={!!undo}
        onClose={() => setUndo(null)}
        onConfirm={async () => {
          if (undo?.rid) await undoRedemptionById(undo.rid)
          else {
            const p = undo?.pid && (await db.participants.get(undo.pid))
            if (p && item) await undoRedemption(item.id, p)
          }
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
