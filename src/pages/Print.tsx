import { useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft, Printer } from 'lucide-react'
import { useEvent, useEventData } from '../lib/hooks'
import { names, nameOf } from '../lib/names'
import type { GuestEntry } from '../lib/search'
import { formatDateTime, formatDateRange } from '../lib/util'
import { typeLabel } from '../components/icons'
import { buildSlots } from '../components/TableSeatList'

const logo = `${import.meta.env.BASE_URL}icons/logo-256.png`
const extra = (e: GuestEntry) => [...e.p.tags, e.p.dietary].filter(Boolean).join('、')

// 列印：每席名單（每席一頁或連續）、單一席、總名單。可在列印視窗選「儲存為 PDF」
export default function Print() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const type = params.get('type') ?? 'tables'
  const cont = params.get('cont') === '1'
  const tid = params.get('tid')
  const ev = useEvent(id)
  const { data, index } = useEventData(id)

  const tables = useMemo(() => {
    if (!data) return []
    const byId = new Map(index.map((e) => [e.p.id, e]))
    return data.resources
      .filter((r) => r.type === 'table' && (type !== 'table' || r.id === tid))
      .map((t) => {
        const guests = data.seats
          .filter((s) => s.resourceId === t.id)
          .map((s) => ({ seat: s.seatLabel, e: byId.get(s.participantId)! }))
          .filter((x) => x.e && x.e.p.status === 'active')
        return { t, slots: buildSlots(t.capacity, guests), count: guests.reduce((a, g) => a + g.e.p.guestCount, 0) }
      })
  }, [data, index, type, tid])

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
      <img src={logo} alt="" width={40} height={40} />
      <div>
        <h1>{ev.name}</h1>
        <p>
          {typeLabel(ev.type)} · {formatDateRange(ev)} {ev.startTime} · {ev.venue}
        </p>
      </div>
      <strong className="print-sub">{sub}</strong>
    </header>
  )
  const seatText = (e: GuestEntry) =>
    e.seats
      .filter((s) => s.resource.type === 'table')
      .map((s) => `${s.resource.purpose === '晚餐' ? '晚餐' : ''}第 ${s.resource.label} 席${s.seatLabel ? ` · ${s.seatLabel} 號` : ''}`)
      .join('、') || '未安排'

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <Link to={`/e/${ev.id}/tables?view=list`} className="icon-btn" aria-label="返回">
          <ChevronLeft size={22} />
        </Link>
        <strong>列印預覽</strong>
        <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
          <Printer size={16} /> 列印／儲存為 PDF
        </button>
      </div>

      {type === 'all' ? (
        <section className="print-sheet">
          {head(`總名單 · ${all.length} 張邀請`)}
          <table className="print-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>英文姓名</th>
                <th>席號／座位</th>
                <th>VIP</th>
                <th>人數</th>
                <th>特別需要</th>
                <th>簽到</th>
              </tr>
            </thead>
            <tbody>
              {all.map((e) => (
                <tr key={e.p.id}>
                  <td className="b">{names(e.p).primary}</td>
                  <td>{names(e.p).secondary}</td>
                  <td>{seatText(e)}</td>
                  <td>{e.p.vip ? '★' : ''}</td>
                  <td>{e.p.guestCount > 1 ? e.p.guestCount : ''}</td>
                  <td>{extra(e)}</td>
                  <td className="check">{e.p.attendance !== 'not_arrived' ? '✓' : '☐'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <footer className="print-foot">列印時間 {now}</footer>
        </section>
      ) : (
        tables.map(({ t, slots, count }) => (
          <section key={t.id} className={`print-sheet ${cont ? 'cont' : 'page'}`}>
            {head(`${t.purpose === '晚餐' ? '晚餐 ' : ''}第 ${t.label} 席 · ${count} / ${t.capacity} 位`)}
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
