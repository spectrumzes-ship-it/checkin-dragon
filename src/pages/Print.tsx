import { busRows, defaultLayout } from '../lib/busLayout'
import { useEffect, useMemo, useState, Fragment, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft, Gift, Printer } from 'lucide-react'
import { useEvent, useEventData } from '../lib/hooks'
import { names, nameOf } from '../lib/names'
import type { GuestEntry } from '../lib/search'
import type { Resource } from '../db/types'
import { formatDateTime, formatDateRange, roomText } from '../lib/util'
import { typeLabel } from '../components/icons'
import { buildSlots } from '../components/TableSeatList'

const extra = (e: GuestEntry) => [...e.p.tags, e.p.dietary].filter(Boolean).join('、')

// 列印：每席名單（每席一頁或連續）、單一席、總名單。可在列印視窗選「儲存為 PDF」
export default function Print() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const type = params.get('type') ?? 'tables'
  const cont = params.get('cont') === '1'
  const tid = params.get('tid')
  // 揀選的席（逗號分隔）；沒有就列印全部
  const tids = params.get('tids')?.split(',').filter(Boolean) ?? null
  const ev = useEvent(id)
  const { data, index } = useEventData(id)

  const tables = useMemo(() => {
    if (!data) return []
    const byId = new Map(index.map((e) => [e.p.id, e]))
    return data.resources
      .filter((r) => r.type === 'table' && (type !== 'table' || r.id === tid) && (!tids || tids.includes(r.id)))
      .map((t) => {
        const guests = data.seats
          .filter((s) => s.resourceId === t.id)
          .map((s) => ({ seat: s.seatLabel, e: byId.get(s.participantId)! }))
          .filter((x) => x.e && x.e.p.status === 'active')
        return { t, slots: buildSlots(t.capacity, guests), count: guests.reduce((a, g) => a + g.e.p.guestCount, 0) }
      })
  }, [data, index, type, tid, params])

  const all = useMemo(
    () =>
      index
        .filter((e) => e.p.status === 'active')
        .sort((a, b) => nameOf(a.p).localeCompare(nameOf(b.p), 'zh-Hant')),
    [index],
  )

  if (!ev || !data) return <div className="page" />
  const now = formatDateTime(Date.now())
  const head = (sub: string) => (
    <header className="print-head">
      <div>
        <h1>{ev.name}</h1>
        <p>
          {typeLabel(ev.type)} · {formatDateRange(ev)} {ev.startTime} · {ev.venue}
        </p>
      </div>
      <strong className="print-sub">{sub}</strong>
    </header>
  )
  // 座位欄：宴會 = 席號；旅遊 = 巴士座位＋餐席＋房號；活動／禮品領取 = 有就顯示
  const seatText = (e: GuestEntry) =>
    [
      ...e.seats.map((s) =>
        s.resource.type === 'table'
          ? `${s.resource.purpose === '晚餐' ? '餐席 ' : ''}第 ${s.resource.label} 席${s.seatLabel ? ` · ${s.seatLabel} 號` : ''}`
          : `${s.resource.label} 車${s.seatLabel ? ` ${s.seatLabel} 號` : ''}`,
      ),
      ...(e.room ? [roomText(e.room)] : []),
    ].join('、') || (ev.mode === 'banquet' || ev.mode === 'bus' ? '未安排' : '')
  const showSeat = ev.mode !== 'gift' && ev.mode !== 'event' ? true : all.some((e) => e.seats.length || e.room)
  const checkLabel = ev.mode === 'bus' ? '報到' : '簽到'

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <Link to={type === 'coupons' ? `/e/${ev.id}/souvenirs/records?item=${params.get('item') ?? ''}` : type === 'rooms' ? `/e/${ev.id}/rooms` : type === 'bus' ? `/e/${ev.id}/seats` : type === 'all' ? `/e/${ev.id}/guests` : `/e/${ev.id}/tables?view=list`} className="icon-btn" aria-label="返回">
          <ChevronLeft size={22} />
        </Link>
        <strong>列印預覽</strong>
        <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
          <Printer size={16} /> 列印／儲存為 PDF
        </button>
      </div>

      {type === 'coupons' ? (
        <CouponsPrint ev={ev} itemId={params.get('item') ?? ''} batch={Number(params.get('batch')) || 0} />
      ) : type === 'rooms' ? (
        <RoomsPrint data={data} index={index} head={head} now={now} />
      ) : type === 'bus' ? (
        data.resources
          .filter((r) => r.type === 'bus')
          .map((b) => {
            const bySeat = new Map<string, GuestEntry>()
            index.forEach((e) => e.seats.forEach((s) => s.resource.id === b.id && e.p.status === 'active' && bySeat.set(s.seatLabel, e)))
            const layout = ev.modeConfig.buses?.find((x) => x.label === b.label)?.layout ?? defaultLayout(b.capacity)
            const rows = busRows(b.capacity, layout)
            return (
              <Fragment key={b.id}>
                {/* 第一頁：大座位圖（司機、領隊貼在車頭用） */}
                <section className="print-sheet page">
                  {head(`${b.label} 車 · 座位圖 · ${bySeat.size} / ${b.capacity} 位`)}
                  {/* 座位格高度按排數計算，大車（13 排）也能放進一頁 A4 */}
                  <div className="print-bus-map big" style={{ ['--seat-h' as string]: `${Math.min(18, Math.floor(225 / rows.length) - 2)}mm` }}>
                    <div className="print-bus-front">車頭 FRONT</div>
                    {rows.map((row, r) => (
                      <div key={r} className="print-bus-row" style={{ gridTemplateColumns: row.map((n) => (n === null ? '14px' : 'minmax(0, 1fr)')).join(' ') }}>
                        {row.map((n, k) =>
                          n ? (
                            <span key={k} className={bySeat.get(String(n)) ? 'seat taken' : 'seat'}>
                              <small>{n}</small>
                              {bySeat.get(String(n)) ? nameOf(bySeat.get(String(n))!.p) : ''}
                            </span>
                          ) : (
                            <span key={k} />
                          ),
                        )}
                      </div>
                    ))}
                  </div>
                  <footer className="print-foot">列印時間 {now}</footer>
                </section>
                {/* 第二頁：乘客名單（點名用） */}
                <section className="print-sheet page">
                  {head(`${b.label} 車 · 乘客名單 · ${bySeat.size} 人`)}
                  <table className="print-table">
                    <thead>
                      <tr>
                        <th className="no">座位</th>
                        <th>姓名</th>
                        <th>英文姓名</th>
                        <th>電話</th>
                        <th>備註</th>
                        <th>上車</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...bySeat.entries()]
                        .sort((a, b2) => Number(a[0]) - Number(b2[0]))
                        .map(([seat, e]) => (
                          <tr key={seat}>
                            <td className="no">{seat}</td>
                            <td className="b">{names(e.p).primary}</td>
                            <td>{names(e.p).secondary}</td>
                            <td>{e.p.phone}</td>
                            <td>{[extra(e), e.p.leftAt ? '中途離開' : ''].filter(Boolean).join('、')}</td>
                            <td className="check">☐</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  <footer className="print-foot">列印時間 {now}</footer>
                </section>
              </Fragment>
            )
          })
      ) : type === 'all' ? (
        <section className="print-sheet">
          {head(`${ev.mode === 'gift' ? '領取人名單' : ev.mode === 'bus' ? '團員名單' : '總名單'} · ${all.length} ${ev.mode === 'bus' || ev.mode === 'gift' ? '人' : '張邀請'}`)}
          <table className="print-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>英文姓名</th>
                {ev.mode === 'bus' && <th>電話</th>}
                {showSeat && <th>{ev.mode === 'banquet' ? '席號／座位' : '座位／房號'}</th>}
                <th>VIP</th>
                {ev.mode !== 'bus' && <th>人數</th>}
                <th>特別需要</th>
                {ev.mode !== 'gift' && <th>{checkLabel}</th>}
              </tr>
            </thead>
            <tbody>
              {all.map((e) => (
                <tr key={e.p.id}>
                  <td className="b">{names(e.p).primary}</td>
                  <td>{names(e.p).secondary}</td>
                  {ev.mode === 'bus' && <td>{e.p.phone}</td>}
                  {showSeat && <td>{seatText(e)}</td>}
                  <td>{e.p.vip ? '★' : ''}</td>
                  {ev.mode !== 'bus' && <td>{e.p.guestCount > 1 ? e.p.guestCount : ''}</td>}
                  <td>{extra(e)}</td>
                  {ev.mode !== 'gift' && <td className="check">{e.p.attendance !== 'not_arrived' ? '✓' : '☐'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <footer className="print-foot">列印時間 {now}</footer>
        </section>
      ) : (
        tables.map(({ t, slots, count }) => (
          <section key={t.id} className={`print-sheet ${cont ? 'cont' : 'page'}`}>
            {head(`${t.purpose === '晚餐' ? '餐席 ' : ''}第 ${t.label.replace(/^0+(?=\d)/, '')} 席 · ${count} / ${t.capacity} 位`)}
            <table className="print-table">
              <thead>
                <tr>
                  <th className="no">座位</th>
                  <th>姓名</th>
                  <th>英文姓名</th>
                  <th>VIP</th>
                  <th>特別需要</th>
                  <th>簽到</th>
                </tr>
              </thead>
              <tbody>
                {slots.map((s) => {
                  const e = s.owner ?? s.companionOf
                  return (
                    <tr key={s.seat} className={!e ? 'vacant-row' : ''}>
                      <td className="no">{s.seat}</td>
                      <td className="b">
                        {e ? names(e.p).primary : '（空位）'}
                        {s.companionOf && <span className="tag">同行</span>}
                      </td>
                      <td>{e ? names(e.p).secondary : ''}</td>
                      <td>{s.owner?.p.vip ? '★' : ''}</td>
                      <td>{s.owner ? extra(s.owner) : ''}</td>
                      <td className="check">{e ? (e.p.attendance !== 'not_arrived' ? '✓' : '☐') : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!cont && <footer className="print-foot">列印時間 {now}</footer>}
          </section>
        ))
      )}
    </div>
  )
}

// 房間名單：每間房一行；未填酒店房號的留空格，到酒店後可手寫
function RoomsPrint({ data, index, head, now }: { data: { resources: Resource[] }; index: GuestEntry[]; head: (sub: string) => ReactNode; now: string }) {
  const rooms = data.resources.filter((r) => r.type === 'room').sort((a, b) => a.sortOrder - b.sortOrder)
  const people = index.filter((e) => e.p.status === 'active' && !e.p.giftOnly)
  const byRoom = new Map<string, GuestEntry[]>()
  for (const e of people) if (e.room) byRoom.set(e.room.id, [...(byRoom.get(e.room.id) ?? []), e])
  const unassigned = people.filter((e) => !e.room && !e.p.leftAt)
  const housed = people.filter((e) => e.room).length
  const kind = (n: number) => (n <= 1 ? '單人房' : n === 2 ? '雙人房' : `${n} 人房`)
  return (
    <section className="print-sheet">
      {head(`房間名單 · ${rooms.length} 間 · ${housed} 人`)}
      <table className="print-table rooms">
        <thead>
          <tr>
            <th className="no">#</th>
            <th>房號</th>
            <th>房型</th>
            <th>住客</th>
            <th>英文姓名</th>
            <th>性別</th>
            <th>電話</th>
            <th>備註</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((r) => {
            const who = byRoom.get(r.id) ?? []
            const rows = who.length ? who : [null]
            return rows.map((e, i) => (
              <tr key={`${r.id}-${i}`} className={i === 0 ? 'room-first' : ''}>
                {i === 0 && (
                  <>
                    <td className="no" rowSpan={rows.length}>
                      {r.sortOrder}
                    </td>
                    <td className="b room-no" rowSpan={rows.length}>
                      {r.purpose === 'custom' ? r.label : <span className="write-in" />}
                    </td>
                    <td rowSpan={rows.length}>{kind(who.length || 2)}</td>
                  </>
                )}
                <td className="b">{e ? names(e.p).primary : '（空房）'}</td>
                <td>{e ? names(e.p).secondary : ''}</td>
                <td>{e?.p.gender === 'M' ? '男' : e?.p.gender === 'F' ? '女' : ''}</td>
                <td>{e?.p.phone ?? ''}</td>
                <td>{e ? [extra(e), e.p.leftAt ? '中途離開' : ''].filter(Boolean).join('、') : ''}</td>
              </tr>
            ))
          })}
        </tbody>
      </table>
      {unassigned.length > 0 && (
        <p className="print-note">未安排房間（{unassigned.length} 人）：{unassigned.map((e) => nameOf(e.p)).join('、')}</p>
      )}
      <footer className="print-foot">列印時間 {now}</footer>
    </section>
  )
}

// 禮物換領券：140 × 60 毫米，A4 直放每頁 4 張，上下無縫（共用裁剪線）；右邊 46 毫米存根留底，頁頂印本頁資料
function CouponsPrint({ ev, itemId, batch }: { ev: import('../db/types').EventRec; itemId: string; batch: number }) {
  const item = useLiveQuery(() => db.souvenirs.get(itemId), [itemId])
  const all = useLiveQuery(() => db.coupons.where('itemId').equals(itemId).toArray(), [itemId]) ?? []
  // 流水號：新券有 seq；舊券按編號次序補上
  const numbered = [...all].sort((a, b) => (a.seq ?? 1e9) - (b.seq ?? 1e9) || a.batch - b.batch || a.createdAt - b.createdAt || a.code.localeCompare(b.code)).map((c, i) => ({ ...c, no: c.seq ?? i + 1 }))
  const coupons = numbered.filter((c) => !batch || c.batch === batch)
  const [qr, setQr] = useState<Record<string, string>>({})
  useEffect(() => {
    let off = false
    Promise.all(coupons.map(async (c) => [c.code, await QRCode.toDataURL(c.code, { margin: 0, width: 220, errorCorrectionLevel: 'M' })] as const)).then((rows) => {
      if (!off) setQr(Object.fromEntries(rows))
    })
    return () => {
      off = true
    }
  }, [coupons.length, itemId, batch]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!item) return null
  const per = 4
  const pages: (typeof coupons)[] = []
  for (let i = 0; i < coupons.length; i += per) pages.push(coupons.slice(i, i + per))
  const qty = Math.max(1, item.perClaim ?? 1)
  const dateText = ev.endDate && ev.endDate > ev.date ? `${ev.date.replace(/-/g, '.')} – ${ev.endDate.slice(5).replace('-', '.')}` : ev.date.replace(/-/g, '.')
  return (
    <>
      <p className="no-print hint" style={{ padding: '0 16px' }}>
        每張 140 × 60 毫米（右邊另有 46 毫米存根），A4 直放每頁 4 張，上下無縫。共 {coupons.length} 張、{pages.length} 頁。列印時選 A4、縮放 100%、開啟「背景圖形」，沿虛線剪開。
      </p>
      {pages.map((pg, i) => (
        <section key={i} className="print-sheet page gc-sheet">
          {/* 頁頂：本頁資料及使用方法（用盡頁面上下的空位） */}
          <div className="gc-pagehead">
            <span>
              <b>{item.name}</b> · {ev.name} · 第 {pg[0].batch} 批
            </span>
            <span>
              本頁 No. {String(pg[0].no).padStart(4, '0')} – {String(pg[pg.length - 1].no).padStart(4, '0')} · 第 {i + 1} / {pages.length} 頁
            </span>
            <small>沿虛線剪開：左邊換領券交給來賓，右邊存根由工作人員留底（換領時填上日期、經手人）。</small>
          </div>
          {pg.map((c) => (
            <div key={c.id} className="gc">
              <div className="gc-main">
                <div className="gc-title">
                  <Gift className="gc-gift" strokeWidth={2.4} />
                  <div>
                    <b>領取禮品</b>
                    <span>
                      活動換領券 <em>第 {c.no} 張</em>
                    </span>
                  </div>
                </div>
                <div className="gc-qty">
                  <b>{qty}</b>
                  <span>份</span>
                </div>
                <div className="gc-item">
                  <small>禮品</small>
                  <strong>{item.name}</strong>
                </div>
                <p className="gc-text">
                  憑本券可於{ev.venue || '活動服務台'}領取「{item.name}」{qty} 份。
                  {item.stock !== null ? '數量有限，換完即止。' : ''}
                </p>
                <span className="gc-stamp">不可轉讓</span>
                <div className="gc-date">
                  <small>活動日期</small>
                  <b>{dateText}</b>
                </div>
                <small className="gc-note">※ 每券換領一次，影印無效。{ev.name}</small>
              </div>
              <div className="gc-stub">
                <span className="gc-tag">GIFT</span>
                <Gift className="gc-stub-gift" strokeWidth={2.4} />
                {qr[c.code] ? <img src={qr[c.code]} alt={c.code} /> : <div className="gc-qr-ph" />}
                <b>No. {String(c.no).padStart(4, '0')}</b>
                <code>{c.code}</code>
              </div>
              {/* 存根（留底）：工作人員保留，方便對數 */}
              <div className="gc-keep">
                <small>存根 · 留底</small>
                <b>No. {String(c.no).padStart(4, '0')}</b>
                <span>{item.name}</span>
                <code>{c.code}</code>
                <i>換領日期</i>
                <i>經手人</i>
              </div>
            </div>
          ))}
        </section>
      ))}
    </>
  )
}
