import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import QRCode from 'qrcode'
import { ChevronLeft, Printer } from 'lucide-react'
import { db } from '../db/db'
import type { EventRec } from '../db/types'
import { names } from '../lib/names'
import { useSettings } from '../lib/settings'
import { formatDate, formatDateRange, roomText } from '../lib/util'
import { useEventData } from '../lib/hooks'
import { TEST_GROUPS } from '../lib/testChecklist'
import { MODE_META } from '../components/icons'

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

  const { index } = useEventData(ev?.id)
  const [done, setDone] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('ckd-testlist') || '{}')
    } catch {
      return {}
    }
  })
  const tick = (id: string) =>
    setDone((d) => {
      const n = { ...d, [id]: !d[id] }
      try {
        localStorage.setItem('ckd-testlist', JSON.stringify(n))
      } catch {
        /* 私密瀏覽：不保存 */
      }
      return n
    })

  if (!ev || !data) return <div className="page" />
  // 門票及標籤：取頭 8 位有姓名、未取消的人
  const labelPeople = index.filter((e) => e.p.status === 'active' && (e.p.name || e.p.englishName) && e.tickets[0]).slice(0, 8)
  const allItems = TEST_GROUPS.flatMap((g) => g.items)
  const doneCount = allItems.filter((i) => done[i.id]).length

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

      <h2 className="kit-h kit-break">
        三、門票及標籤 <small>{MODE_META[ev.mode].zh} · {ev.name}</small>
      </h2>
      <div className="kit-labels" data-mode={ev.mode}>
        {labelPeople.map((e) => {
          const t = e.tickets[0]
          const table = e.seats.find((x) => x.resource.type === 'table' && !x.resource.purpose)
          const bus = e.seats.find((x) => x.resource.type === 'bus')
          return (
            <div key={e.p.id} className={`kit-label kit-label-${ev.mode}`}>
              <div className="kit-label-band">
                <span>{ev.mode === 'event' ? '入場券 TICKET' : ev.mode === 'banquet' ? '座位卡 SEAT' : ev.mode === 'bus' ? '團員名牌 TOUR' : '會員卡 MEMBER'}</span>
                <span>{ev.name}</span>
              </div>
              <div className="kit-label-body">
                <div className="kit-label-text">
                  <b>{names(e.p).primary}</b>
                  <span>{names(e.p).secondary}</span>
                  {ev.mode === 'banquet' && table && (
                    <em>
                      第 {table.resource.label} 席 · {table.seatLabel} 號
                    </em>
                  )}
                  {ev.mode === 'bus' && (
                    <em>
                      {bus ? `${bus.resource.label} 車 ${bus.seatLabel} 號` : ''}
                      {e.room ? ` · ${roomText(e.room)}` : ''}
                    </em>
                  )}
                  {ev.mode === 'event' && <em>{formatDateRange(ev)} · {ev.startTime}</em>}
                  {ev.mode === 'gift' && <em>會員編號 {e.p.memberId}</em>}
                  <code>{ev.mode === 'gift' ? e.p.memberId : t.ticketNumber || t.invitationId || t.qrCode}</code>
                </div>
                <QR value={t.qrCode} />
              </div>
            </div>
          )
        })}
      </div>

      <h2 className="kit-h kit-break">
        四、證件辨識測試卡 <small>新增嘉賓 →「文字辨識 · 自動填寫」，把卡放滿框內</small>
      </h2>
      <div className="kit-ids">
        <div className="kit-id hkid">
          <span className="kit-id-specimen">樣本 SPECIMEN</span>
          <div className="kit-id-in">
          <div className="kit-id-head">
            測試用身份證樣式（非真實證件）
            <small>IDENTITY CARD TEST SAMPLE</small>
          </div>
          <b className="kit-id-zh">李 智 能</b>
          <span className="kit-id-en">LEE, Chi Nan</span>
          <span className="kit-id-code">2621 2535 5174</span>
          <span className="kit-id-lbl">出生日期 Date of Birth</span>
          <span className="kit-id-val">01-01-1985 &nbsp; 男 M</span>
          <span className="kit-id-lbl">簽發日期 Date of Issue</span>
          <span className="kit-id-val">(01-79) 26-11-18</span>
          </div>
          <span className="kit-id-no">Z683365(5)</span>
        </div>
        <div className="kit-id hrp">
          <span className="kit-id-specimen">樣本 SPECIMEN</span>
          <div className="kit-id-in">
          <div className="kit-id-head">
            港澳居民来往内地通行证（测试样式）
            <small>MAINLAND TRAVEL PERMIT TEST SAMPLE</small>
          </div>
          <span className="kit-id-lbl">姓名</span>
          <b className="kit-id-zh">陈丽华</b>
          <span className="kit-id-en">CHAN, LAI WA</span>
          <span className="kit-id-val">出生日期 1980.01.01 &nbsp; 性别 女</span>
          <span className="kit-id-val">有效期限 2024.05.06-2034.05.05</span>
          </div>
          <span className="kit-id-no">证件号码 H08765432 01</span>
        </div>
      </div>
      <p className="hint">「會員禮品派發日」名單已有李智能（身份證 Z683、1985-01-01），可在掃描「文字」模式測試找會員。應讀到：身份證卡 → 李智能、LEE CHI NAN、1985-01-01、男、Z683；回鄉證卡 → 陈丽华、CHAN LAI WA、1980-01-01、女、H08765432、2034-05-05。</p>

      <h2 className="kit-h kit-break">
        五、真機測試清單{' '}
        <small>
          已完成 {doneCount} / {allItems.length}（剔選會記住在這部裝置）
        </small>
      </h2>
      <div className="kit-checklist">
        {TEST_GROUPS.map((g) => (
          <section key={g.title} className="card kit-group">
            <h3>
              {g.title}
              {g.note && <small>{g.note}</small>}
            </h3>
            {g.items.map((it) => (
              <label key={it.id} className={done[it.id] ? 'kit-item on' : 'kit-item'}>
                <input type="checkbox" checked={!!done[it.id]} onChange={() => tick(it.id)} />
                <span>
                  <b>{it.do}</b>
                  <small>應該：{it.expect}</small>
                </span>
              </label>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
