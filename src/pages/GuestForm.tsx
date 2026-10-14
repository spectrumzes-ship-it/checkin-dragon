import { useSettings } from '../lib/settings'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { EventRec, Participant, Resource } from '../db/types'
import { checkIn, emptyGuest, guestToInput, saveGuest, type GuestInput, idPrefixOf } from '../lib/actions'
import { feedback } from '../lib/feedback'
import { cx, ageFromBirth, todayKey, searchNorm } from '../lib/util'
import { PageHeader, Sheet, toast } from '../components/ui'
import CardScanner from '../components/CardScanner'
import { ScanText, X } from 'lucide-react'
import { names } from '../lib/names'


export default function GuestForm() {
  const settings = useSettings()
  const ev = useOutletContext<EventRec>()
  const { gid } = useParams()
  const nav = useNavigate()
  const existing = useLiveQuery(() => (gid ? db.participants.get(gid) : undefined), [gid])
  const resources = useLiveQuery(() => db.resources.where('eventId').equals(ev.id).sortBy('sortOrder'), [ev.id]) ?? []
  const [g, setG] = useState<GuestInput>(emptyGuest)
  const [more, setMore] = useState(false)
  const [scan, setScan] = useState(false)
  // 未儲存的修改：與打開時的資料比較；離開前問是否儲存
  const [base, setBase] = useState(() => JSON.stringify(emptyGuest()))
  const [leave, setLeave] = useState<null | (() => void)>(null)
  const dirty = JSON.stringify(g) !== base
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  useEffect(() => {
    if (existing) guestToInput(existing).then((x) => (setG(x), setBase(JSON.stringify(x)), setMore(true)))
  }, [existing])

  // 按頁面以外的連結（底部選單、活動分頁等）或關閉瀏覽器時，先問是否儲存
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current) return
      const a = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null
      if (!a || a.closest('form') || a.target === '_blank' || /^(tel|mailto):/.test(a.getAttribute('href') ?? '')) return
      const href = a.getAttribute('href') ?? ''
      if (!href.startsWith('#/')) return
      e.preventDefault()
      e.stopPropagation()
      setLeave(() => () => nav(href.slice(1)))
    }
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault()
    }
    document.addEventListener('click', onClick, true)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [nav])
  const guard = (go: () => void) => (dirty ? setLeave(() => go) : go())

  const up = <K extends keyof GuestInput>(k: K, v: GuestInput[K]) => setG((s) => ({ ...s, [k]: v }))

  // 選了席號／車：座位自動填上下一個空位（座位空白，或仍是上次自動填的號碼時才會改）
  const seats = useLiveQuery(() => db.seats.where('eventId').equals(ev.id).toArray(), [ev.id]) ?? []
  const allPeople = useLiveQuery(() => db.participants.where('eventId').equals(ev.id).toArray(), [ev.id]) ?? []
  const autoSeat = useRef<Record<string, string>>({})
  const [autoNote, setAutoNote] = useState('')
  const pickPlace = (idKey: 'tableId' | 'busId' | 'dinnerTableId', seatKey: 'tableSeat' | 'busSeat' | 'dinnerSeat', rid: string) => {
    const r = resources.find((x) => x.id === rid)
    setG((s) => {
      const next = { ...s, [idKey]: rid }
      const cur = s[seatKey]
      if (!r || (cur && cur !== autoSeat.current[seatKey])) return next
      const taken = new Set(seats.filter((x) => x.resourceId === rid && x.participantId !== gid).map((x) => x.seatLabel))
      const free = Array.from({ length: r.capacity }, (_, i) => String(i + 1)).find((n) => !taken.has(n)) ?? ''
      autoSeat.current[seatKey] = free
      setAutoNote(free ? `已自動填上${r.type === 'bus' ? ` ${r.label} 車` : ` 第 ${r.label} 席`}的下一個空位：${free} 號（可修改）` : `${r.type === 'bus' ? `${r.label} 車` : `第 ${r.label} 席`}已坐滿`)
      return { ...next, [seatKey]: free }
    })
  }

  // 座位下拉選單：每個座位顯示是否已安排其他人；揀了有人的座位會提示，並建議最近的空位
  const pName = new Map(partnersAll().map((p) => [p.id, names(p).full]))
  function partnersAll() {
    return allPeople
  }
  const occupied = (rid: string) => {
    const m = new Map<string, string>()
    for (const x of seats) if (x.resourceId === rid && x.participantId !== gid && x.seatLabel) m.set(x.seatLabel, x.participantId)
    return m
  }
  const seatList = (r: Resource | undefined, current: string) => {
    if (!r) return []
    const nums = Array.from({ length: r.capacity }, (_, i) => String(i + 1))
    return current && !nums.includes(current) ? [...nums, current] : nums
  }
  const nearestFree = (r: Resource, want: string) => {
    const taken = occupied(r.id)
    const n = Number(want)
    const free = seatList(r, '').filter((x) => !taken.has(x))
    if (!free.length) return ''
    if (!n) return free[0]
    // 圓枱首尾相連；巴士按號碼前後
    const dist = (x: number) => (r.type === 'table' ? Math.min(Math.abs(x - n), r.capacity - Math.abs(x - n)) : Math.abs(x - n))
    return [...free].sort((a, b) => dist(+a) - dist(+b) || +b - +a)[0]
  }
  const [clash, setClash] = useState<null | { seatKey: 'tableSeat' | 'busSeat' | 'dinnerSeat'; r: Resource; want: string; who: string; suggest: string; prev: string }>(null)
  const pickSeat = (seatKey: 'tableSeat' | 'busSeat' | 'dinnerSeat', r: Resource | undefined, v: string) => {
    const prev = g[seatKey]
    up(seatKey, v)
    autoSeat.current[seatKey] = ''
    setAutoNote('')
    const who = r && v ? occupied(r.id).get(v) : undefined
    if (r && who) setClash({ seatKey, r, want: v, who: pName.get(who) ?? '其他人', suggest: nearestFree(r, v), prev })
  }
  const placeName = (r: Resource) => (r.type === 'bus' ? `${r.label} 車` : `${r.purpose === '晚餐' ? '餐席 ' : ''}第 ${r.label} 席`)
  const placeOption = (r: Resource) => {
    const k = occupied(r.id).size
    return `${placeName(r)} · ${k >= r.capacity ? '已滿' : `${k}/${r.capacity}`}`
  }
  const seatSelect = (seatKey: 'tableSeat' | 'busSeat' | 'dinnerSeat', rid: string) => {
    const r = resources.find((x) => x.id === rid)
    const taken = r ? occupied(r.id) : new Map<string, string>()
    return (
      <select value={g[seatKey]} onChange={(e) => pickSeat(seatKey, r, e.target.value)} disabled={!r}>
        <option value="">{r ? '未定' : '請先選擇'}</option>
        {seatList(r, g[seatKey]).map((n) => (
          <option key={n} value={n}>
            {n} 號{taken.has(n) ? `　${pName.get(taken.get(n)!) ?? ''}（已安排）` : ''}
          </option>
        ))}
      </select>
    )
  }
  const tables = resources.filter((r) => r.type === 'table' && r.purpose !== '晚餐')
  const dinner = resources.filter((r) => r.type === 'table' && r.purpose === '晚餐')
  const buses = resources.filter((r) => r.type === 'bus')

  const anonymous = !!ev.modeConfig.anonymous
  const partners = allPeople.filter((p) => p.status === 'active' && !p.giftOnly && p.id !== gid).sort((a, b) => names(a).full.localeCompare(names(b).full, 'zh-Hant'))
  const started = !!gid || todayKey() >= ev.date // 活動當日或之後
  const submit = async (andCheckIn: boolean, after?: () => void) => {
    if (!g.name.trim() && !g.englishName.trim() && !(anonymous && g.ticketNumber.trim())) return toast(anonymous ? '請輸入票號或姓名' : '請輸入姓名')
    const p = await saveGuest(ev.id, g, existing ?? undefined)
    if (andCheckIn) {
      const t = await db.tickets.where('participantId').equals(p.id).first()
      await checkIn(p, 'MANUAL', 'checkin', '臨時嘉賓', t)
      feedback('valid')
      toast(`✓ ${p.englishName || p.name} 已新增並簽到`)
    } else toast(existing ? '已儲存' : '已新增嘉賓')
    setBase(JSON.stringify(g))
    dirtyRef.current = false
    if (after) after()
    else nav(`/e/${ev.id}/guests/${p.id}`, { replace: true })
  }

  return (
    <div className="page narrow">
      <PageHeader zh={gid ? '修改嘉賓' : '新增嘉賓'} en={gid ? 'Edit Guest' : 'Add Guest'} back onBack={guard} />
      {/* 登記參加者：文字辨識（自動填寫）或手動輸入；不需要掃描 QR */}
      <button type="button" className="btn btn-mode btn-block scan-fill" onClick={() => setScan(true)}>
        <ScanText size={18} /> 文字辨識 · 自動填寫
      </button>
      {scan && (
        <CardScanner
          onClose={() => setScan(false)}
          onUse={(f) => {
            setG((s) => ({
              ...s,
              name: f.name || s.name,
              englishName: f.englishName || s.englishName,
              memberId: f.memberId || s.memberId,
              phone: f.phone || s.phone,
              birthDate: f.birthDate || s.birthDate,
              age: ageFromBirth(f.birthDate) || s.age,
              // 旅遊巴士保存回鄉證號碼及有效期；其他模式只保留證件號碼頭 4 位
              gender: f.gender || s.gender,
              idPrefix: f.idPrefix || (ev.mode === 'bus' ? '' : f.permitNo.slice(0, 4)) || s.idPrefix,
              ...(ev.mode === 'bus' ? { permitNo: f.permitNo || s.permitNo, permitExpiry: f.permitExpiry || s.permitExpiry } : {}),
            }))
            setMore(true)
            setScan(false)
            toast('已填入辨識到的資料，請核對')
          }}
        />
      )}
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          submit(false)
        }}
      >
        <fieldset className="card">
          {anonymous && (
            <label className="field">
              <span>票號 Ticket No.（不記名門票只需填票號）</span>
              <input value={g.ticketNumber} onChange={(e) => up('ticketNumber', e.target.value)} autoFocus={!gid} autoCapitalize="characters" />
            </label>
          )}
          <div className="field-row">
            <label className="field">
              <span>中文姓名{anonymous ? '（可留空）' : ' Name'}</span>
              <input value={g.name} onChange={(e) => up('name', e.target.value)} autoFocus={!gid && !anonymous} />
            </label>
            <label className="field">
              <span>英文姓名 English</span>
              <input value={g.englishName} onChange={(e) => up('englishName', e.target.value)} autoCapitalize="characters" />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span>會員編號 Member ID</span>
              <input value={g.memberId} onChange={(e) => up('memberId', e.target.value)} />
            </label>
            <label className="field">
              <span>邀請編號 Invitation ID</span>
              <input value={g.invitationId} onChange={(e) => up('invitationId', e.target.value)} />
            </label>
          </div>

          {tables.length > 0 && (
            <div className="field-row">
              <label className="field">
                <span>席號 Table</span>
                <select value={g.tableId} onChange={(e) => pickPlace('tableId', 'tableSeat', e.target.value)}>
                  <option value="">未安排</option>
                  {tables.map((t) => (
                    <option key={t.id} value={t.id}>
                      {placeOption(t)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>座位 Seat</span>
                {seatSelect('tableSeat', g.tableId)}
              </label>
            </div>
          )}
          {buses.length > 0 && (
            <div className="field-row">
              <label className="field">
                <span>巴士 Bus</span>
                <select value={g.busId} onChange={(e) => pickPlace('busId', 'busSeat', e.target.value)}>
                  <option value="">未安排</option>
                  {buses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {placeOption(b)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>巴士座位 Bus Seat</span>
                {seatSelect('busSeat', g.busId)}
              </label>
            </div>
          )}
          {dinner.length > 0 && (
            <div className="field-row">
              <label className="field">
                <span>餐席 Meal Table</span>
                <select value={g.dinnerTableId} onChange={(e) => pickPlace('dinnerTableId', 'dinnerSeat', e.target.value)}>
                  <option value="">未安排</option>
                  {dinner.map((t) => (
                    <option key={t.id} value={t.id}>
                      {placeOption(t)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>餐席座位 Seat</span>
                {seatSelect('dinnerSeat', g.dinnerTableId)}
              </label>
            </div>
          )}
          {autoNote && (tables.length > 0 || buses.length > 0 || dinner.length > 0) && <p className="hint">{autoNote}</p>}

          <div className="field-row">
            <label className="field check">
              <input type="checkbox" checked={g.vip} onChange={(e) => up('vip', e.target.checked)} />
              <span>⭐ VIP</span>
            </label>
            <label className="field">
              <span>人數 Guest Count</span>
              <input type="number" min={1} max={20} value={g.guestCount} onChange={(e) => up('guestCount', Number(e.target.value))} />
            </label>
          </div>
          <div className="field">
            <span>性別 Gender</span>
            <div className="seg" role="radiogroup">
              {([['', '未填'], ['M', '男'], ['F', '女']] as const).map(([v, zh]) => (
                <button type="button" key={v} role="radio" aria-checked={(g.gender ?? '') === v} className={(g.gender ?? '') === v ? 'active' : ''} onClick={() => up('gender', v)}>
                  {zh}
                </button>
              ))}
            </div>
          </div>
          {ev.mode !== 'gift' && (
            <div className="field">
              <span>{ev.mode === 'bus' ? '同行人士（自動分房同住一間）' : '同行人士'}</span>
              <PartnerPicker value={g.partnerId ?? ''} people={partners} onChange={(v) => up('partnerId', v)} />
            </div>
          )}
        </fieldset>

        {!more ? (
          <button type="button" className="btn btn-ghost" onClick={() => setMore(true)}>
            ＋ 更多資料（電話、公司、標籤、備註）
          </button>
        ) : (
          <fieldset className="card">
            <div className="field-row">
              <label className="field">
                <span>電話 Phone</span>
                <input value={g.phone} onChange={(e) => up('phone', e.target.value)} inputMode="tel" />
              </label>
              <label className="field">
                <span>公司 Company</span>
                <input value={g.company} onChange={(e) => up('company', e.target.value)} />
              </label>
            </div>
            <label className="field">
              <span>QR Code 內容（留空則自動產生 8 位隨機編號）</span>
              <input value={g.qrCode} onChange={(e) => up('qrCode', e.target.value)} />
            </label>
            <div className="field">
              <span>特別需要 Special Notes</span>
              <div className="chips">
                {[...new Set([...settings.specialNotes, ...g.tags])].map((t) => (
                  <button
                    type="button"
                    key={t}
                    className={cx('chip', g.tags.includes(t) && 'active')}
                    onClick={() => up('tags', g.tags.includes(t) ? g.tags.filter((x) => x !== t) : [...g.tags, t])}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            {[...new Set([...settings.giftGroups, ...g.giftGroups])].length > 0 && (
              <div className="field">
                <span>禮物組別 Gift Group</span>
                <div className="chips">
                  {[...new Set([...settings.giftGroups, ...g.giftGroups])].map((t) => (
                    <button
                      type="button"
                      key={t}
                      className={cx('chip', g.giftGroups.includes(t) && 'active')}
                      onClick={() => up('giftGroups', g.giftGroups.includes(t) ? g.giftGroups.filter((x) => x !== t) : [...g.giftGroups, t])}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="field-row">
              <label className="field">
                <span>年齡 Age</span>
                <input value={g.age} onChange={(e) => up('age', e.target.value)} inputMode="numeric" />
              </label>
              <label className="field">
                <span>出生日期 Date of Birth</span>
                <input type="date" value={g.birthDate} onChange={(e) => setG((s) => ({ ...s, birthDate: e.target.value, age: ageFromBirth(e.target.value) || s.age }))} />
              </label>
            </div>
            <label className="field">
              <span>身份證號碼（只保存頭 4 位）</span>
              <input value={g.idPrefix} onChange={(e) => up('idPrefix', idPrefixOf(e.target.value))} maxLength={4} placeholder="例如 A123" autoCapitalize="characters" />
            </label>
            {ev.mode === 'bus' && (
              <div className="field-row">
                <label className="field">
                  <span>回鄉證號碼</span>
                  <input value={g.permitNo ?? ''} onChange={(e) => up('permitNo', e.target.value.toUpperCase())} placeholder="例如 H12345678" autoCapitalize="characters" />
                </label>
                <label className="field">
                  <span>證件有效期至</span>
                  <input type="date" value={g.permitExpiry ?? ''} onChange={(e) => up('permitExpiry', e.target.value)} />
                </label>
              </div>
            )}
            <label className="field">
              <span>備註 Remarks</span>
              <textarea rows={2} value={g.remarks} onChange={(e) => up('remarks', e.target.value)} />
            </label>
          </fieldset>
        )}

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={() => guard(() => nav(-1))}>
            取消
          </button>
          {/* 活動日之前是預先輸入名單，只有「新增」；活動當日起才有「新增並簽到」 */}
          <button className={started ? 'btn btn-secondary btn-lg' : 'btn btn-primary btn-lg'}>{gid ? '儲存' : '新增'}</button>
          {!gid && ev.mode !== 'gift' && started && (
            <button type="button" className="btn btn-primary btn-lg" onClick={() => submit(true)}>
              新增並簽到
            </button>
          )}
        </div>
      </form>

      <Sheet
        open={!!clash}
        onClose={() => (clash && up(clash.seatKey, clash.prev), setClash(null))}
        title="座位已有人"
        footer={
          clash && (
            <>
              <button className="btn btn-ghost" onClick={() => (up(clash.seatKey, clash.prev), setClash(null))}>
                揀其他座位
              </button>
              {clash.suggest && (
                <button className="btn btn-primary" onClick={() => (up(clash.seatKey, clash.suggest), setClash(null))}>
                  改坐 {clash.suggest} 號
                </button>
              )}
            </>
          )
        }
      >
        {clash && (
          <p className="confirm-msg">
            {placeName(clash.r)} {clash.want} 號已安排給 <b>{clash.who}</b>。
            {clash.suggest ? `最近的空位是 ${clash.suggest} 號，要改坐 ${clash.suggest} 號嗎？` : `${placeName(clash.r)}已經坐滿，請選擇其他${clash.r.type === 'bus' ? '車' : '席'}。`}
          </p>
        )}
      </Sheet>

      <Sheet
        open={!!leave}
        onClose={() => setLeave(null)}
        title="未儲存的修改"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setLeave(null)}>
              繼續修改
            </button>
            <button
              className="btn btn-danger-ghost"
              onClick={() => {
                const go = leave
                setLeave(null)
                dirtyRef.current = false
                go?.()
              }}
            >
              不儲存
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                const go = leave
                setLeave(null)
                submit(false, go ?? undefined)
              }}
            >
              儲存
            </button>
          </>
        }
      >
        <p className="confirm-msg">你修改了{gid ? '嘉賓資料' : '新嘉賓的資料'}但未儲存。離開前要儲存嗎？</p>
      </Sheet>
    </div>
  )
}

// 同行人士：輸入名字搜尋，或直接在清單點選
function PartnerPicker({ value, people, onChange }: { value: string; people: Participant[]; onChange: (v: string) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const chosen = people.find((p) => p.id === value)
  if (chosen && !open)
    return (
      <div className="partner-chosen">
        <b>{names(chosen).full}</b>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => (setOpen(true), setQ(''))}>
          更改
        </button>
        <button type="button" className="icon-btn" aria-label="移除同行人士" onClick={() => onChange('')}>
          <X size={18} />
        </button>
      </div>
    )
  const k = searchNorm(q)
  const list = (k ? people.filter((p) => searchNorm([p.name, p.englishName, p.phone, p.memberId].join(' ')).includes(k)) : people).slice(0, 30)
  return (
    <div className="partner-pick">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="輸入名字搜尋，或在下面點選" onFocus={() => setOpen(true)} />
      <div className="partner-list" role="listbox">
        {list.map((p) => (
          <button
            type="button"
            role="option"
            aria-selected={p.id === value}
            key={p.id}
            className={p.id === value ? 'on' : ''}
            onClick={() => (onChange(p.id), setOpen(false), setQ(''))}
          >
            <b>{names(p).primary}</b>
            <small>{names(p).secondary}</small>
          </button>
        ))}
        {list.length === 0 && <p className="muted pad center">找不到「{q}」</p>}
      </div>
      {chosen && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
          不更改
        </button>
      )}
    </div>
  )
}
