import { useSettings } from '../lib/settings'
import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { EventRec } from '../db/types'
import { checkIn, emptyGuest, guestToInput, saveGuest, type GuestInput, idPrefixOf } from '../lib/actions'
import { feedback } from '../lib/feedback'
import { cx, ageFromBirth } from '../lib/util'
import { PageHeader, toast } from '../components/ui'
import CardScanner from '../components/CardScanner'
import { ScanText } from 'lucide-react'


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

  useEffect(() => {
    if (existing) guestToInput(existing).then((x) => (setG(x), setMore(true)))
  }, [existing])

  const up = <K extends keyof GuestInput>(k: K, v: GuestInput[K]) => setG((s) => ({ ...s, [k]: v }))
  const tables = resources.filter((r) => r.type === 'table' && r.purpose !== '晚餐')
  const dinner = resources.filter((r) => r.type === 'table' && r.purpose === '晚餐')
  const buses = resources.filter((r) => r.type === 'bus')

  const anonymous = !!ev.modeConfig.anonymous
  const submit = async (andCheckIn: boolean) => {
    if (!g.name.trim() && !g.englishName.trim() && !(anonymous && g.ticketNumber.trim())) return toast(anonymous ? '請輸入票號或姓名' : '請輸入姓名')
    const p = await saveGuest(ev.id, g, existing ?? undefined)
    if (andCheckIn) {
      const t = await db.tickets.where('participantId').equals(p.id).first()
      await checkIn(p, 'MANUAL', 'checkin', '臨時嘉賓', t)
      feedback('valid')
      toast(`✓ ${p.englishName || p.name} 已新增並簽到`)
    } else toast(existing ? '已儲存' : '已新增嘉賓')
    nav(`/e/${ev.id}/guests/${p.id}`, { replace: true })
  }

  return (
    <div className="page narrow">
      <PageHeader zh={gid ? '修改嘉賓' : '新增嘉賓'} en={gid ? 'Edit Guest' : 'Add Guest'} back />
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
              idPrefix: f.idPrefix || s.idPrefix,
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
              <span>中文姓名 Name{anonymous && '（可留空）'}</span>
              <input value={g.name} onChange={(e) => up('name', e.target.value)} autoFocus={!gid && !anonymous} />
            </label>
            <label className="field">
              <span>英文姓名 English Name</span>
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
                <select value={g.tableId} onChange={(e) => up('tableId', e.target.value)}>
                  <option value="">未安排</option>
                  {tables.map((t) => (
                    <option key={t.id} value={t.id}>
                      第 {t.label} 席
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>座位 Seat</span>
                <input value={g.tableSeat} onChange={(e) => up('tableSeat', e.target.value)} inputMode="numeric" />
              </label>
            </div>
          )}
          {buses.length > 0 && (
            <div className="field-row">
              <label className="field">
                <span>巴士 Bus</span>
                <select value={g.busId} onChange={(e) => up('busId', e.target.value)}>
                  <option value="">未安排</option>
                  {buses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label} 車
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>巴士座位 Bus Seat</span>
                <input value={g.busSeat} onChange={(e) => up('busSeat', e.target.value)} />
              </label>
            </div>
          )}
          {dinner.length > 0 && (
            <div className="field-row">
              <label className="field">
                <span>聚餐席號 Dinner Table</span>
                <select value={g.dinnerTableId} onChange={(e) => up('dinnerTableId', e.target.value)}>
                  <option value="">未安排</option>
                  {dinner.map((t) => (
                    <option key={t.id} value={t.id}>
                      第 {t.label} 席
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>餐席座位 Seat</span>
                <input value={g.dinnerSeat} onChange={(e) => up('dinnerSeat', e.target.value)} inputMode="numeric" />
              </label>
            </div>
          )}

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
            <label className="field">
              <span>備註 Remarks</span>
              <textarea rows={2} value={g.remarks} onChange={(e) => up('remarks', e.target.value)} />
            </label>
          </fieldset>
        )}

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={() => nav(-1)}>
            取消
          </button>
          <button className="btn btn-secondary btn-lg">{gid ? '儲存' : '新增'}</button>
          {!gid && ev.mode !== 'gift' && (
            <button type="button" className="btn btn-primary btn-lg" onClick={() => submit(true)}>
              新增並簽到
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
