import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useOutletContext, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Gift, Printer, ScanText, Ticket, UserPlus, Users } from 'lucide-react'
import CardScanner from '../components/CardScanner'
import Seal from '../components/Seal'
import { db } from '../db/db'
import type { EventRec, ScanMethod, SouvenirItem, SouvenirRedemption } from '../db/types'
import {
  eligible,
  emptyGuest,
  entitlement,
  generateCoupons,
  idPrefixOf,
  phoneRedeemedAt,
  voidCoupons,
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
import { ageFromBirth, cx, formatTime, todayKey, toDateKey } from '../lib/util'
import { GiftArt } from '../illustrations'
import { GuestRow } from '../components/GuestRow'
import { ConfirmSheet, EmptyState, FilterChip, PageHeader, SearchBar, Sheet, toast } from '../components/ui'
import { nameOf } from '../lib/names'

const METHOD: Record<ScanMethod, string> = { QR: 'QR', OCR: '文字辨識', MANUAL: '手動', SEARCH: '名單' }
const blankReg = () => ({ name: '', englishName: '', phone: '', age: '', birthDate: '', idPrefix: '', memberId: '', permitNo: '', permitExpiry: '', gender: '' as '' | 'M' | 'F' })
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
  const [proxyMode, setProxyMode] = useState(false) // 代領：揀選幾位一次派發
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [proxyAsk, setProxyAsk] = useState(false)
  const [proxyOther, setProxyOther] = useState('')
  const [phoneWarn, setPhoneWarn] = useState<number | null>(null) // 先到先得：同一電話已領過的時間

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
    const byP = new Map<string, { qty: number; time: number; operator: string; proxyBy?: string }>()
    for (const r of mine) {
      const x = byP.get(r.participantId) ?? { qty: 0, time: 0, operator: '' }
      x.qty += r.quantity
      if (r.time > x.time) Object.assign(x, { time: r.time, operator: r.operator, proxyBy: r.proxyBy })
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
  // 代領：一次派給已揀選的幾位；由其中一位或其他人代領
  const giveProxy = async (collector: string, collectorId?: string) => {
    if (!item) return
    let ok = 0
    const fail: string[] = []
    for (const e of pending.filter((x) => picked.has(x.p.id))) {
      const o = await verifySouvenir(ev.id, item.id, '', 'SEARCH', e.p.id, e.p.id === collectorId ? {} : { proxyBy: collector })
      if (o.result === 'valid') ok++
      else fail.push(nameOf(e.p))
    }
    feedback(ok ? 'valid' : 'invalid')
    toast(`✓ 已派發 ${ok} 位（由 ${collector} 領取）${fail.length ? `；未能派發：${fail.join('、')}` : ''}`)
    setPicked(new Set())
    setProxyMode(false)
    setProxyAsk(false)
    setProxyOther('')
  }
  // 限量先到先得：不登記，直接扣庫存
  const todayGiven = mine.filter((r) => toDateKey(new Date(r.time)) === todayKey()).reduce((a, r) => a + r.quantity, 0)
  const quotaFull = !!item?.dailyQuota && todayGiven >= item.dailyQuota
  const soldOut = (left !== null && left <= 0) || quotaFull
  const lowStock = !!item && item.stock !== null && item.stock > 0 && left !== null && left > 0 && left / item.stock < 0.1
  const giveAnonymous = async () => item && report(await verifySouvenir(ev.id, item.id, '', 'MANUAL'), '')

  const submitReg = async (force = false) => {
    if (!reg || !item) return
    if (!reg.name.trim() && !reg.englishName.trim()) return toast('請輸入中文或英文姓名')
    // 先到先得的輕度查重：同一電話已領過就先提醒（仍可照派）
    if (!force && logic === 'fcfs' && item.phoneCheck && reg.phone.trim()) {
      const t = await phoneRedeemedAt(ev.id, item.id, reg.phone)
      if (t) return setPhoneWarn(t)
    }
    const group = item.eligibility.startsWith('group:') ? [item.eligibility.slice(6)] : []
    const o = await registerAndRedeem(ev.id, item.id, { ...emptyGuest(), ...reg, giftGroups: group }, pre?.reg || usedOcr ? 'OCR' : 'MANUAL', ev.mode !== 'gift' && !joinEvent)
    setReg(null)
    setUsedOcr(false)
    report(o, reg.name.trim() || reg.englishName.trim())
  }

  return (
    <div className="page">
      <PageHeader
        zh={logic === 'fcfs' ? '領取登記及紀錄' : logic === 'coupon' ? '換領券及紀錄' : '名單派發及紀錄'}
        en={logic === 'fcfs' ? 'Collection Register' : logic === 'coupon' ? 'Coupons' : 'Distribute by List'}
        back={`/e/${ev.id}/souvenirs`}
        actions={
          (logic === 'person' || logic === 'invitation') &&
          item?.allowWalkIn !== false && (
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
          {item.dailyQuota ? ` · 今日 ${todayGiven} / ${item.dailyQuota}` : ''}
        </p>
      )}
      {lowStock && <p className="stock-warn">存貨只剩 {left} 份，請準備補貨或通知排隊人士</p>}

      {logic === 'coupon' && item ? (
        <CouponPanel ev={ev} item={item} mine={mine} names={new Map(index.map((e) => [e.p.id, nameOf(e.p)]))} people={index.filter((e) => e.p.status === 'active').map((e) => e.p)} report={report} onUndo={(rid, name) => setUndo({ rid, name })} />
      ) : logic === 'fcfs' && item ? (
        <>
          {soldOut ? (
            <div className="soldout-panel" role="status">
              <strong>{quotaFull && !(left !== null && left <= 0) ? '今日配額已派完' : '已派完'}</strong>
              <span>{quotaFull && !(left !== null && left <= 0) ? `今日已派 ${todayGiven} 份（每日上限 ${item.dailyQuota}），請明日再來` : `「${item.name}」全部 ${item.stock} 份已派發完畢`}</span>
            </div>
          ) : (
            <button className="btn btn-primary fcfs-give" onClick={() => setReg(blankReg())}>
              <UserPlus size={20} /> {`領取登記（派發 ×${Math.min(perClaimOf(item), left ?? Infinity)}）`}
            </button>
          )}
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
                    <Seal className="gift-seal" text="領" />
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
                    mark={<Seal className="gift-seal" text="領" />}
                    onClick={() => setUndo({ pid: e.p.id, name: nameOf(e.p) })}
                    trailing={
                      <span className="record-meta">
                        <strong>×{r.qty}</strong>
                        <span className="muted">
                          {formatTime(r.time)} · {r.operator}
                          {r.proxyBy && ` · 由 ${r.proxyBy} 代領`}
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
            <>
              <div className="proxy-bar">
                <button className={cx('btn btn-sm', proxyMode ? 'btn-primary' : 'btn-ghost')} onClick={() => (setProxyMode(!proxyMode), setPicked(new Set()))}>
                  <Users size={16} /> {proxyMode ? '取消代領' : '代領（一人領幾份）'}
                </button>
                {proxyMode && <span className="muted">已揀 {picked.size} 位</span>}
              </div>
              <div className="list card">
                {pending.map((e) => (
                  <GuestRow
                    key={e.p.id}
                    e={e}
                    mark={
                      proxyMode ? (
                        <span className={cx('proxy-check', picked.has(e.p.id) && 'on')}>{picked.has(e.p.id) && <Check size={18} strokeWidth={3} />}</span>
                      ) : (
                        <span className="gift-seal empty" aria-label="未領取" />
                      )
                    }
                    onClick={() =>
                      proxyMode
                        ? setPicked((x) => {
                            const n = new Set(x)
                            if (n.has(e.p.id)) n.delete(e.p.id)
                            else n.add(e.p.id)
                            return n
                          })
                        : give(e)
                    }
                    trailing={item && !proxyMode && <span className="btn btn-sm btn-mode">派發 ×{entitlement(item, e.p)}</span>}
                  />
                ))}
              </div>
              {proxyMode && picked.size > 0 && (
                <button className="btn btn-primary btn-block proxy-go" onClick={() => setProxyAsk(true)}>
                  派發給已揀的 {picked.size} 位
                </button>
              )}
            </>
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
            <button className="btn btn-primary" onClick={() => submitReg()}>
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
            <div className="field">
              <span>性別 Gender</span>
              <div className="seg" role="radiogroup">
                {([['', '未填'], ['M', '男'], ['F', '女']] as const).map(([v, zh]) => (
                  <button type="button" key={v} role="radio" aria-checked={(reg.gender ?? '') === v} className={(reg.gender ?? '') === v ? 'active' : ''} onClick={() => setReg({ ...reg, gender: v })}>
                    {zh}
                  </button>
                ))}
              </div>
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
              gender: f.gender || reg.gender,
              idPrefix: f.idPrefix || (ev.mode === 'bus' ? '' : f.permitNo.slice(0, 4)) || reg.idPrefix,
              permitNo: ev.mode === 'bus' ? f.permitNo || reg.permitNo : '',
              permitExpiry: ev.mode === 'bus' ? f.permitExpiry || reg.permitExpiry : '',
            })
            setUsedOcr(true)
            setScan(false)
          }}
        />
      )}

      <Sheet open={proxyAsk} onClose={() => setProxyAsk(false)} title="由誰領取？">
        <p className="hint">揀選實際來領取的人；其他人會記錄為「由某某代領」。</p>
        <div className="menu-list">
          {pending
            .filter((e) => picked.has(e.p.id))
            .map((e) => (
              <button key={e.p.id} className="menu-item" onClick={() => giveProxy(nameOf(e.p), e.p.id)}>
                {nameOf(e.p)}（本人）
              </button>
            ))}
        </div>
        <label className="field" style={{ marginTop: 12 }}>
          <span>其他人（名單以外，輸入名字）</span>
          <input value={proxyOther} onChange={(e) => setProxyOther(e.target.value)} placeholder="例如 陳太（家人）" />
        </label>
        <button className="btn btn-primary btn-block" disabled={!proxyOther.trim()} onClick={() => giveProxy(proxyOther.trim())}>
          由 {proxyOther.trim() || '…'} 代領
        </button>
      </Sheet>

      <ConfirmSheet
        open={phoneWarn !== null}
        onClose={() => setPhoneWarn(null)}
        onConfirm={() => submitReg(true)}
        title="此電話已領取過"
        message={<p>電話 {reg?.phone} 已於 {phoneWarn ? formatTime(phoneWarn) : ''} 領取過「{item?.name}」。仍然要派發嗎？</p>}
        confirmText="仍然派發"
      />

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

// 憑券換領：統計、輸入編號換領、生成及列印換領券、作廢、紀錄
function CouponPanel({
  ev,
  item,
  mine,
  names: nameMap,
  people,
  report,
  onUndo,
}: {
  ev: EventRec
  item: SouvenirItem
  mine: SouvenirRedemption[]
  names: Map<string, string>
  people: import('../db/types').Participant[]
  report: (o: ScanOutcome, who: string) => void
  onUndo: (rid: string, name: string) => void
}) {
  const coupons = useLiveQuery(() => db.coupons.where('itemId').equals(item.id).toArray(), [item.id]) ?? []
  const [code, setCode] = useState('')
  const [gen, setGen] = useState<null | { named: boolean; count: number }>(null)
  const [voidBatch, setVoidBatch] = useState<number | null>(null)
  const used = new Map(mine.filter((r) => r.couponId).map((r) => [r.couponId!, r]))
  const voided = coupons.filter((c) => c.voided).length
  const redeemed = coupons.filter((c) => used.has(c.id)).length
  const batches = [...new Set(coupons.map((c) => c.batch))].sort((a, b) => b - a)
  const typed = code.trim().toUpperCase()
  const found = typed.length >= 6 ? coupons.find((c) => c.code === typed) : undefined
  const redeem = async () => {
    if (!typed) return
    report(await verifySouvenir(ev.id, item.id, typed, 'MANUAL'), found?.name ?? '')
    setCode('')
  }
  return (
    <>
      <div className="coupon-stats">
        <span><b>{coupons.length}</b>已印</span>
        <span><b>{redeemed}</b>已換領</span>
        <span><b>{coupons.length - redeemed - voided}</b>未換領</span>
        <span><b>{voided}</b>作廢</span>
      </div>
      <div className="coupon-entry">
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="輸入券上編號（或用掃描）" autoCapitalize="characters" onKeyDown={(e) => e.key === 'Enter' && redeem()} />
        <button className="btn btn-primary" onClick={redeem} disabled={!typed}>
          換領
        </button>
      </div>
      {found && (
        <p className="hint">
          {found.voided ? '此券已作廢' : used.has(found.id) ? `此券已於 ${formatTime(used.get(found.id)!.time)} 換領` : '此券未換領'}
          {found.name && ` · ${found.name}`}{' '}
          <button className="link" onClick={() => voidCoupons([found.id], !found.voided)}>
            {found.voided ? '恢復此券' : '作廢此券'}
          </button>
        </p>
      )}
      <div className="coupon-actions">
        <Link to={`/e/${ev.id}/scan?p=s:${item.id}`} className="btn btn-mode">
          <Ticket size={18} /> 掃描換領
        </Link>
        <button className="btn btn-ghost" onClick={() => setGen({ named: false, count: 50 })}>
          ＋ 生成換領券
        </button>
      </div>
      {batches.length > 0 && (
        <div className="list card">
          {batches.map((b) => {
            const cs = coupons.filter((c) => c.batch === b)
            const r = cs.filter((c) => used.has(c.id)).length
            const v = cs.filter((c) => c.voided).length
            return (
              <div key={b} className="coupon-batch">
                <span>
                  <strong>第 {b} 批 · {cs.length} 張{cs[0]?.name ? '（記名）' : ''}</strong>
                  <span className="muted">已換領 {r}{v ? ` · 作廢 ${v}` : ''}</span>
                </span>
                <Link className="btn btn-sm btn-ghost" to={`/e/${ev.id}/print?type=coupons&item=${item.id}&batch=${b}`}>
                  <Printer size={16} /> 列印
                </Link>
                <button className="btn btn-sm btn-ghost" onClick={() => (v === cs.length ? voidCoupons(cs.map((c) => c.id), false) : setVoidBatch(b))}>
                  {v === cs.length ? '恢復' : '作廢'}
                </button>
              </div>
            )
          })}
        </div>
      )}
      <p className="hint">一券只可換領一次；作廢的券掃描時會顯示「已作廢」。點下面的紀錄可取消換領。</p>
      {mine.length ? (
        <div className="list card">
          {mine.map((r) => {
            const c = coupons.find((x) => x.id === r.couponId)
            const who = (r.participantId && nameMap.get(r.participantId)) || c?.name || ''
            return (
              <button key={r.id} className="fcfs-row" onClick={() => onUndo(r.id, who || `換領券 ${c?.code ?? ''}`)}>
                <Seal className="gift-seal" text="領" />
                <span>
                  <strong>{who || `換領券 ${c?.code ?? ''}`}</strong>
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
        <p className="muted pad center">未有換領紀錄</p>
      )}

      <Sheet
        open={!!gen}
        onClose={() => setGen(null)}
        title="生成換領券"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setGen(null)}>
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={async () => {
                if (!gen) return
                const r = await generateCoupons(ev.id, item.id, gen.named ? { people } : { count: gen.count })
                setGen(null)
                toast(`已生成第 ${r.batch} 批 ${r.count} 張，可按「列印」`)
              }}
            >
              生成
            </button>
          </>
        }
      >
        {gen && (
          <>
            <div className="radio-list" role="radiogroup">
              <label className={!gen.named ? 'active' : ''}>
                <input type="radio" name="cn" style={TICK} checked={!gen.named} onChange={() => setGen({ ...gen, named: false })} />
                <span>
                  <strong>不記名</strong>
                  <small>自訂張數，任何人持券都可換領。</small>
                </span>
              </label>
              <label className={gen.named ? 'active' : ''}>
                <input type="radio" name="cn" style={TICK} checked={gen.named} onChange={() => setGen({ ...gen, named: true })} />
                <span>
                  <strong>記名（按名單每人一張）</strong>
                  <small>券上印名字，共 {people.length} 張。</small>
                </span>
              </label>
            </div>
            {!gen.named && (
              <label className="field">
                <span>張數（最多 2000）</span>
                <input type="number" min={1} max={2000} value={gen.count} onChange={(e) => setGen({ ...gen, count: Math.max(1, Math.min(2000, Number(e.target.value) || 1)) })} />
              </label>
            )}
            <p className="hint">每張券有隨機編號及 QR，不能估到其他號碼。生成後按「列印」，A4 每頁 10 張，有裁剪線。</p>
          </>
        )}
      </Sheet>
      <ConfirmSheet
        open={voidBatch !== null}
        onClose={() => setVoidBatch(null)}
        onConfirm={() => voidCoupons(coupons.filter((c) => c.batch === voidBatch && !used.has(c.id)).map((c) => c.id))}
        title={`作廢第 ${voidBatch} 批`}
        message={<p>把第 {voidBatch} 批中未換領的券全部作廢？作廢後掃描會顯示「已作廢」，之後可按「恢復」。</p>}
        confirmText="作廢"
        danger
      />
    </>
  )
}
