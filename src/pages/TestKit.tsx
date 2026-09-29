import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import QRCode from 'qrcode'
import { ChevronLeft, Printer } from 'lucide-react'
import { db } from '../db/db'
import type { EventRec } from '../db/types'
import { names } from '../lib/names'
import { useSettings } from '../lib/settings'
import { formatDate } from '../lib/util'

interface Card {
  title: string
  tone: 'ok' | 'warn' | 'bad'
  code: string
  label: string
  sub?: string
}

const QR = ({ value }: { value: string }) => {
  const [src, setSrc] = useState('')
  useEffect(() => {
    QRCode.toDataURL(value, { margin: 1, width: 360, errorCorrectionLevel: 'M' }).then(setSrc)
  }, [value])
  return src ? <img src={src} alt={value} className="kit-qr" /> : <div className="kit-qr" />
}

// 測試工具包：按目前資料即時產生測試 QR Code 及名牌，可列印或在另一部裝置的螢幕顯示
export default function TestKit() {
  const nav = useNavigate()
  const { currentEventId } = useSettings()
  const events = useLiveQuery(() => db.events.filter((e) => e.status !== 'archived').toArray(), []) ?? []
  const [eventId, setEventId] = useState('')
  const ev: EventRec | undefined = events.find((e) => e.id === (eventId || currentEventId)) ?? events[0]

  const data = useLiveQuery(async () => {
    if (!ev) return null
    const ps = await db.participants.where('eventId').equals(ev.id).toArray()
    const ts = await db.tickets.where('eventId').equals(ev.id).toArray()
    const tBy = new Map(ts.map((t) => [t.participantId, t]))
    const named = ps.filter((p) => p.name || p.englishName)
    const pickN = (xs: typeof ps, n: number) => xs.slice(0, n).map((p) => ({ p, t: tBy.get(p.id)! })).filter((x) => x.t)
    const other = await db.tickets.filter((t) => t.eventId !== ev.id).first()
    const otherEv = other ? await db.events.get(other.eventId) : undefined
    const star = named.find((p) => p.englishName === 'CHAN TAI MAN') ?? named.find((p) => p.status === 'active' && p.attendance === 'not_arrived')
    return {
      valid: pickN(ps.filter((p) => p.status === 'active' && p.attendance === 'not_arrived' && p.id !== star?.id), 6),
      used: pickN(ps.filter((p) => p.status === 'active' && p.attendance !== 'not_arrived'), 2),
      cancelled: pickN(ps.filter((p) => p.status === 'cancelled'), 1),
      other: other && otherEv ? { code: other.qrCode, event: otherEv.name } : null,
      star: star ? { p: star, t: tBy.get(star.id) } : null,
    }
  }, [ev?.id])

  if (!ev || !data) return <div className="page" />

  const cards: Card[] = [
    ...data.valid.map(({ p, t }) => ({ title: '有效票', tone: 'ok' as const, code: t.qrCode, label: names(p).full, sub: '應顯示：綠色 有效' })),
    ...data.used.map(({ p, t }) => ({ title: '已簽到的票', tone: 'warn' as const, code: t.qrCode, label: names(p).full, sub: '應顯示：橙色 已簽到' })),
    ...data.cancelled.map(({ p, t }) => ({ title: '已取消的票', tone: 'bad' as const, code: t.qrCode, label: names(p).full, sub: '應顯示：粉紅 無效（已取消）' })),
    ...(data.other ? [{ title: '其他活動的票', tone: 'bad' as const, code: data.other.code, label: data.other.event, sub: '應顯示：粉紅 無效（其他活動）' }] : []),
    { title: '無效票', tone: 'bad', code: 'XYZ-00000', label: '不存在的票號', sub: '應顯示：粉紅 無效（找不到）' },
  ]
  const s = data.star
  const inv = s?.t?.invitationId || s?.t?.ticketNumber || ''

  return (
    <div className="page kit">
      <div className="kit-toolbar no-print">
        <button className="icon-btn" aria-label="返回" onClick={() => nav(-1)}>
          <ChevronLeft size={22} />
        </button>
        <h1>
          測試工具包 <small>Test Kit</small>
        </h1>
        <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
          <Printer size={16} /> 列印
        </button>
      </div>
      <div className="card no-print kit-intro">
        <label className="field">
          <span>測試活動</span>
          <select value={ev.id} onChange={(e) => setEventId(e.target.value)}>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {formatDate(e.date)} · {e.name}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">
          用法：列印本頁，或在另一部電腦／平板的螢幕打開本頁，然後用手機的「掃描」對準下面的 QR Code 和名牌。有效票掃描後會變成「已簽到」；想再測試可到「設定 → 重設示範資料」，本頁會自動更新。
        </p>
      </div>

      <h2 className="kit-h">
        一、QR Code 測試 <small>{ev.name}</small>
      </h2>
      <div className="kit-grid">
        {cards.map((c, i) => (
          <div key={i} className={`kit-card tone-${c.tone}`}>
            <span className="kit-tag">{c.title}</span>
            <QR value={c.code} />
            <strong>{c.label}</strong>
            <code>{c.code}</code>
            <small>{c.sub}</small>
          </div>
        ))}
      </div>

      {s && (
        <>
          <h2 className="kit-h">
            二、文字辨識測試（名牌） <small>選「文字」模式，把名牌放入扁長方形框內</small>
          </h2>
          <div className="kit-names">
            <div className="kit-name">
              <span className="kit-tag">完全吻合</span>
              <b>{s.p.englishName || s.p.name}</b>
              <span>{inv}</span>
            </div>
            <div className="kit-name">
              <span className="kit-tag">邀請編號</span>
              <b className="mono">{inv || s.p.memberId}</b>
            </div>
            <div className="kit-name">
              <span className="kit-tag">中文姓名</span>
              <b>{s.p.name}</b>
            </div>
            <div className="kit-name">
              <span className="kit-tag">認錯字（I 印成 l）</span>
              <b>{(s.p.englishName || '').replace('I', 'l')}</b>
            </div>
            <div className="kit-name blur">
              <span className="kit-tag">模糊</span>
              <b>{s.p.englishName || s.p.name}</b>
            </div>
            <div className="kit-name">
              <span className="kit-tag">找不到（應提示手動搜尋）</span>
              <b>HELLO WORLD</b>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
