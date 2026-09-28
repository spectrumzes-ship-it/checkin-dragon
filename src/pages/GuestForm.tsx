import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { EventRec } from '../db/types'
import { checkIn, emptyGuest, guestToInput, saveGuest, type GuestInput } from '../lib/actions'
import { feedback } from '../lib/feedback'
import { cx } from '../lib/util'
import { PageHeader, toast } from '../components/ui'

const TAGS = ['輪椅', '素食', '需協助', '重要嘉賓', '傳譯']

export default function GuestForm() {
  const ev = useOutletContext<EventRec>()
  const { gid } = useParams()
  const nav = useNavigate()
  const existing = useLiveQuery(() => (gid ? db.participants.get(gid) : undefined), [gid])
  const resources = useLiveQuery(() => db.resources.where('eventId').equals(ev.id).sortBy('sortOrder'), [ev.id]) ?? []
  const [g, setG] = useState<GuestInput>(emptyGuest)
  const [more, setMore] = useState(false)

  useEffect(() => {
    if (existing) guestToInput(existing).then((x) => (setG(x), setMore(true)))
  }, [existing])

  const up = <K extends keyof GuestInput>(k: K, v: GuestInput[K]) => setG((s) => ({ ...s, [k]: v }))
  const tables = resources.filter((r) => r.type === 'table' && r.purpose !== '晚餐')
  const dinner = resources.filter((r) => r.type === 'table' && r.purpose === '晚餐')
  const buses = resources.filter((r) => r.type === 'bus')

  const submit = async (andCheckIn: boolean) => {
    if (!g.name.trim() && !g.englishName.trim()) return toast('請輸入姓名')
    const p = await saveGuest(ev.id, g, existing ?? undefined)
    if (andCheckIn) {
      const t = await db.tickets.where('participantId').equals(p.id).first()
      await checkIn(p, 'MANUAL', 'checkin', '臨時嘉賓', t)
      feedback('valid')
      toast(`✓ ${p.englishName || p.name} 已新增並入場`)
    } else toast(existing ? '已儲存' : '已新增嘉賓')
    nav(`/e/${ev.id}/guests/${p.id}`, { replace: true })
  }

  return (
    <div className="page narrow">
      <PageHeader zh={gid ? '修改嘉賓' : '新增嘉賓'} en={gid ? 'Edit Guest' : 'Add Guest'} back />
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          submit(false)
        }}
      >
        <fieldset className="card">
          <div className="field-row">
            <label className="field">
              <span>中文姓名 Name</span>
              <input value={g.name} onChange={(e) => up('name', e.target.value)} autoFocus={!gid} />
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
                <span>桌號 Table</span>
                <select value={g.tableId} onChange={(e) => up('tableId', e.target.value)}>
                  <option value="">未安排</option>
                  {tables.map((t) => (
                    <option key={t.id} value={t.id}>
                      第 {t.label} 桌
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
            <label className="field">
              <span>晚餐桌號 Dinner Table</span>
              <select value={g.dinnerTableId} onChange={(e) => up('dinnerTableId', e.target.value)}>
                <option value="">未安排</option>
                {dinner.map((t) => (
                  <option key={t.id} value={t.id}>
                    第 {t.label} 桌
                  </option>
                ))}
              </select>
            </label>
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
              <span>QR Code 內容（留空則自動產生）</span>
              <input value={g.qrCode} onChange={(e) => up('qrCode', e.target.value)} />
            </label>
            <div className="field">
              <span>特別需要 Special Notes</span>
              <div className="chips">
                {TAGS.map((t) => (
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
            <label className="field">
              <span>飲食需要 Dietary</span>
              <input value={g.dietary} onChange={(e) => up('dietary', e.target.value)} />
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
          {!gid && (
            <button type="button" className="btn btn-primary btn-lg" onClick={() => submit(true)}>
              新增並入場
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
