import { useMemo, useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Archive, CheckCircle2, Copy, Gift, ListChecks, Pencil, Plus, ScanLine, Search, Star, UserX } from 'lucide-react'
import { db } from '../db/db'
import type { EventRec } from '../db/types'
import { duplicateEvent, logicLabel, logicOf, quantityLabel, setEventStatus, verifyCheckIn, type ScanOutcome } from '../lib/actions'
import { computeStats, useDebounced, useEventData } from '../lib/hooks'
import { searchGuests } from '../lib/search'
import { cx, formatTime, pct } from '../lib/util'
import { names } from '../lib/names'
import { rollCounts, rollSummary } from '../lib/rollcall'
import { useBusOf } from './RollCall'
import Seal from '../components/Seal'
import { TableIcon } from '../components/icons'
import { GuestRow } from '../components/GuestRow'
import { ScanResult } from '../components/ScanResult'
import { ConfirmSheet, DonutChart, MetricCard, MiniBarChart, ProgressBar, SearchBar, SectionTitle, Sheet, toast, CarsBar } from '../components/ui'

// 禮品領取模式的「完成活動」摘要：派發數字
function GiftNumbers({ ev }: { ev: EventRec }) {
  const reds = useLiveQuery(() => db.redemptions.where('eventId').equals(ev.id).filter((r) => !r.voided).toArray(), [ev.id]) ?? []
  return (
    <div className="summary-grid">
      <MetricCard zh="已派發" en="Given" value={reds.reduce((a, r) => a + r.quantity, 0)} sub="份" tone="ok" />
      <MetricCard zh="領取次數" en="Claims" value={reds.length} />
      <MetricCard zh="已登記領取人" en="Recipients" value={new Set(reds.map((r) => r.participantId).filter(Boolean)).size} />
    </div>
  )
}

// 禮品領取模式的總覽：每款禮品派了多少、剩多少
function GiftSummary({ ev }: { ev: EventRec }) {
  const items = useLiveQuery(() => db.souvenirs.where('eventId').equals(ev.id).sortBy('sortOrder'), [ev.id]) ?? []
  const reds = useLiveQuery(() => db.redemptions.where('eventId').equals(ev.id).filter((r) => !r.voided).toArray(), [ev.id]) ?? []
  const people = useLiveQuery(() => db.participants.where('eventId').equals(ev.id).toArray(), [ev.id]) ?? []
  const qty = reds.reduce((a, r) => a + r.quantity, 0)
  const stock = items.length && items.every((i) => i.stock !== null) ? items.reduce((a, i) => a + (i.stock ?? 0), 0) : null
  const byId = new Map(people.map((p) => [p.id, p]))
  const itemName = new Map(items.map((i) => [i.id, i.name]))
  const recent = [...reds].sort((a, b) => b.time - a.time).slice(0, 6)
  return (
    <>
      {/* 和色統一設計：大數字卡＋十格進度＋三格摘要 */}
      <section className="dash-hero card">
        <div className="dash-hero-top">
          <span className="dash-hero-label">已派發 GIVEN</span>
          <span className="dash-hero-num">
            <b>{qty}</b>
            <span>{stock !== null ? `/ ${stock} 份` : '份（不限數量）'}</span>
          </span>
          {stock !== null && (
            <div className="dash-hero-meter">
              <CarsBar value={qty} max={stock} />
            </div>
          )}
        </div>
        <div className="dash-split">
          <Link to={`/e/${ev.id}/souvenirs`}>
            <small>禮品款式</small>
            <b>{items.length}</b>
          </Link>
          <Link to={`/e/${ev.id}/souvenirs/records`}>
            <small>領取次數</small>
            <b>{reds.length}</b>
          </Link>
          <Link to={`/e/${ev.id}/guests`}>
            <small>已登記領取人</small>
            <b>{new Set(reds.map((r) => r.participantId).filter(Boolean)).size}</b>
          </Link>
        </div>
      </section>

      {items.length === 0 ? (
        <Link to={`/e/${ev.id}/souvenirs?new=1`} className="dash-scan">
          <Plus size={22} /> 第一步：新增禮品
        </Link>
      ) : (
        <Link to={`/e/${ev.id}/scan`} className="dash-scan">
          <ScanLine size={22} /> 掃描派發
        </Link>
      )}

      {recent.length > 0 && (
        <section className="card" style={{ marginBottom: 16 }}>
          <SectionTitle zh="最近領取" en="Recent" />
          <div className="list">
            {recent.map((r) => {
              const p = byId.get(r.participantId)
              return (
                <Link key={r.id} to={p ? `/e/${ev.id}/guests/${p.id}` : `/e/${ev.id}/souvenirs/records?item=${r.itemId}`} className="stamp-row">
                  <Seal className="stamp-seal" text="領" />
                  <span className="stamp-name">
                    <b>{p ? names(p).primary : '未登記領取人'}</b>
                    <small>
                      {itemName.get(r.itemId)} ×{r.quantity}
                    </small>
                  </span>
                  <span className="stamp-time">{formatTime(r.time)}</span>
                </Link>
              )
            })}
          </div>
        </section>
      )}
      <section className="card">
        <SectionTitle zh="禮品" en="Gifts" />
        {items.length ? (
          <div className="list">
            {items.map((it) => {
              const given = reds.filter((r) => r.itemId === it.id).reduce((a, r) => a + r.quantity, 0)
              const left = it.stock === null ? null : it.stock - given
              return (
                <Link key={it.id} to={`/e/${ev.id}/souvenirs/records?item=${it.id}${logicOf(it) === 'fcfs' ? '' : '&tab=pending'}`} className="gift-line">
                  <span>
                    <strong>{it.name}</strong>
                    <span className="muted">
                      {logicLabel(it)} · {quantityLabel(it, left)}
                    </span>
                  </span>
                  <span className="gift-line-num">
                    {given}
                    <small>{it.stock !== null ? ` / ${it.stock}` : ''} 已派</small>
                  </span>
                </Link>
              )
            })}
          </div>
        ) : (
          <div className="gift-empty">
            <p>還沒有禮品，請先新增要派發的禮品。</p>
            <Link to={`/e/${ev.id}/souvenirs?new=1`} className="btn btn-primary btn-block">
              <Plus size={18} /> 新增禮品
            </Link>
          </div>
        )}
      </section>
    </>
  )
}

export default function Dashboard() {
  const ev = useOutletContext<EventRec>()
  const busOf = useBusOf(ev.id) // 必須放在任何提早 return 之前（React 規則）
  const nav = useNavigate()
  const { data, index } = useEventData(ev.id)
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 120)
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null)
  const [complete, setComplete] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)

  const checkins = useLiveQuery(() => db.checkins.where('eventId').equals(ev.id).toArray(), [ev.id]) ?? []
  const sessions = useLiveQuery(() => db.sessions.where('eventId').equals(ev.id).toArray(), [ev.id]) ?? []
  const attendance = useLiveQuery(() => db.attendance.where('eventId').equals(ev.id).toArray(), [ev.id]) ?? []
  const souvenirs = useLiveQuery(() => db.souvenirs.where('eventId').equals(ev.id).toArray(), [ev.id]) ?? []
  const dupes = useLiveQuery(() => db.scanLogs.where('eventId').equals(ev.id).filter((l) => l.result === 'duplicate' && l.purpose === 'checkin').count(), [ev.id]) ?? 0
  const redemptions = useLiveQuery(() => db.redemptions.where('eventId').equals(ev.id).toArray(), [ev.id]) ?? []

  const stats = useMemo(() => computeStats(data?.participants ?? []), [data])
  const results = useMemo(() => (dq ? searchGuests(index, dq).slice(0, 8) : []), [index, dq])

  // 每 15 分鐘簽到人數（最多顯示最近 12 格 = 3 小時）
  const buckets = useMemo(() => {
    const valid = checkins.filter((c) => !c.voided && c.kind === 'checkin')
    if (!valid.length) return []
    const step = 15 * 60000
    const last = Math.max(...valid.map((c) => c.time))
    const first = Math.max(Math.min(...valid.map((c) => c.time)), last - 11 * step)
    const start = Math.floor(first / step) * step
    const n = Math.floor((last - start) / step) + 1
    const out = Array.from({ length: n }, (_, i) => ({ label: formatTime(start + i * step), value: 0 }))
    for (const c of valid) {
      const i = Math.floor((c.time - start) / step)
      if (i >= 0 && i < n) out[i].value += c.count
    }
    return out
  }, [checkins])

  const recent = useMemo(
    () =>
      index
        .filter((e) => e.p.checkedInAt && e.p.attendance !== 'not_arrived')
        .sort((a, b) => (b.p.checkedInAt ?? 0) - (a.p.checkedInAt ?? 0))
        .slice(0, 6),
    [index],
  )

  const tableStats = useMemo(() => {
    if (!data) return { total: 0, withArrivals: 0 }
    const tables = data.resources.filter((r) => r.type === 'table' && r.purpose !== '晚餐')
    const arrivedIds = new Set(data.participants.filter((p) => p.attendance !== 'not_arrived').map((p) => p.id))
    const withArrivals = tables.filter((t) => data.seats.some((s) => s.resourceId === t.id && arrivedIds.has(s.participantId))).length
    return { total: tables.length, withArrivals }
  }, [data])


  if (!data) return <div className="page" />

  const leftCount = data?.participants.filter((p) => p.status === 'active' && p.leftAt).length ?? 0
  const tapGuest = async (pid: string) => {
    setOutcome(await verifyCheckIn(ev.id, '', 'SEARCH', pid))
    setQ('')
  }

  return (
    <div className="page">
      {ev.mode === 'banquet' && (
        <div className="banquet-search">
          <SearchBar large value={q} onChange={setQ} placeholder="搜尋嘉賓姓名／公司／席號 Search guest" />
          {dq && (
            <div className="list card search-results">
              {results.length ? (
                results.map((e) => <GuestRow key={e.p.id} e={e} onClick={() => tapGuest(e.p.id)} trailing={<span className="btn btn-sm btn-mode">簽到</span>} />)
              ) : (
                <p className="muted pad">找不到「{dq}」</p>
              )}
            </div>
          )}
        </div>
      )}

      {ev.mode === 'gift' ? (
        <GiftSummary ev={ev} />
      ) : (
        <>
      {/* 頂部大數字卡（和色預覽）：已入場／已入席／已報到＋十格進度＋三格摘要 */}
      {(() => {
        const pct = stats.total ? Math.round((stats.arrived / stats.total) * 100) : 0
        const word = ev.mode === 'banquet' ? ['已入席', 'SEATED', '位'] : ev.mode === 'bus' ? ['已報到', 'CHECKED IN', '人'] : ['已入場', 'ADMITTED', ev.modeConfig.anonymous ? '張門票' : '位']
        return (
          <section className="dash-hero card">
            <div className="dash-hero-top">
              <span className="dash-hero-label">
                {word[0]} {word[1]}
              </span>
              <Link to={`/e/${ev.id}/guests?filter=arrived`} className="dash-hero-num">
                <b>{stats.arrived}</b>
                <span>
                  / {stats.total} {word[2]}
                </span>
              </Link>
              <div className="dash-hero-meter" aria-label={`出席率 ${pct}%`}>
                <div className="rc-cars-row">
                  {Array.from({ length: 10 }, (_, i) => (
                    <i key={i} className={pct >= (i + 1) * 10 ? 'on' : pct > i * 10 + 4 ? 'half' : ''} />
                  ))}
                </div>
                <b>{pct}%</b>
              </div>
            </div>
            <div className="dash-split">
              <Link to={`/e/${ev.id}/guests?filter=vip`}>
                <small>VIP</small>
                <b>
                  {stats.vipArrived}/{stats.vipTotal}
                </b>
              </Link>
              <Link to={`/e/${ev.id}/guests?filter=not_arrived`}>
                <small>未到</small>
                <b>{stats.notArrived}</b>
              </Link>
              {ev.mode === 'banquet' ? (
                <Link to={`/e/${ev.id}/tables`}>
                  <small>有人入席</small>
                  <b>
                    {tableStats.withArrivals}/{tableStats.total}
                    <em> 席</em>
                  </b>
                </Link>
              ) : (
                <Link to={`/e/${ev.id}/logs`}>
                  <small>重複</small>
                  <b className={dupes ? 'warn' : ''}>{dupes}</b>
                </Link>
              )}
            </div>
          </section>
        )
      })()}

      <Link to={`/e/${ev.id}/scan`} className="dash-scan">
        <ScanLine size={22} /> {ev.mode === 'banquet' ? '掃描簽到' : ev.mode === 'bus' ? '掃描報到' : '掃描門票'}
      </Link>

      <div className="metrics">
        {leftCount > 0 && <MetricCard zh="中途離開" en="Left Early" value={leftCount} icon={<UserX size={18} />} to={`/e/${ev.id}/guests?filter=left`} />}
        {ev.mode === 'banquet' && (
          <MetricCard zh="總席數" en="Tables" value={tableStats.total} sub={`${tableStats.withArrivals} 席已有人到`} icon={<TableIcon size={18} />} to={`/e/${ev.id}/tables`} />
        )}
        {souvenirs.length > 0 && (
          <MetricCard
            zh="紀念品已領"
            en="Souvenirs"
            value={redemptions.filter((r) => !r.voided).reduce((a, r) => a + r.quantity, 0)}
            tone="warn"
            icon={<Gift size={18} />}
            to={`/e/${ev.id}/souvenirs/records`}
          />
        )}
      </div>

      <div className="dash-grid">
        <section className="card dash-donut">
          <SectionTitle zh="簽到進度" en="Progress" />
          <div className="donut-wrap">
            <DonutChart
              value={stats.arrived}
              max={stats.total}
              label={
                <>
                  <strong>{stats.rate}%</strong>
                  <small>
                    {stats.arrived} / {stats.total}
                  </small>
                </>
              }
            />
            <ul className="legend">
              <li>
                <span className="dot ok" /> 已到 {stats.arrived}
              </li>
              <li>
                <span className="dot plain" /> 未到 {stats.notArrived}
              </li>
              {stats.cancelled > 0 && (
                <li>
                  <span className="dot bad" /> 已取消 {stats.cancelled} 張
                </li>
              )}
            </ul>
          </div>
        </section>

        <section className="card">
          <SectionTitle zh="簽到時段" en="Arrivals / 15 min" />
          {buckets.length ? <MiniBarChart buckets={buckets} /> : <p className="muted pad">未有簽到紀錄</p>}
        </section>

        {ev.mode === 'bus' && (
          <section className="card span-2">
            <SectionTitle zh="點名總覽" en="Roll Call" action={<Link className="link" to={`/e/${ev.id}/rollcall`}>全部</Link>} />
            {sessions.length ? (
              <div className="session-list">
                {sessions
                  .sort((a, b) => a.time.localeCompare(b.time))
                  .map((s) => {
                    const c = rollCounts(data?.participants ?? [], s, attendance, busOf)
                    return (
                      <Link key={s.id} to={`/e/${ev.id}/rollcall/${s.id}`} className="session-row">
                        <span className="session-name">
                          <strong>{s.name}</strong>
                          <span className="muted">
                            {s.time} · {s.location}
                          </span>
                        </span>
                        <span className={cx('session-count', c.done && 'done')}>{rollSummary(c)}</span>
                        <ProgressBar value={c.present} max={c.expected} tone={c.done ? 'ok' : 'mode'} />
                      </Link>
                    )
                  })}
              </div>
            ) : (
              <p className="muted pad">未有點名</p>
            )}
          </section>
        )}

        <section className="card">
          <SectionTitle zh="快速操作" en="Quick Actions" />
          <div className="quick">
            <Link to={`/e/${ev.id}/scan`} className="quick-btn primary">
              <ScanLine size={24} /> 掃描
            </Link>
            <Link to={`/e/${ev.id}/guests/new`} className="quick-btn">
              <Plus size={24} /> 嘉賓
            </Link>
            <Link to={`/e/${ev.id}/guests?focus=1`} className="quick-btn">
              <Search size={24} /> 搜尋
            </Link>
            <Link to={`/e/${ev.id}/guests?filter=not_arrived`} className="quick-btn">
              <UserX size={24} /> 缺席
            </Link>
            <Link to={`/e/${ev.id}/guests?filter=vip`} className="quick-btn">
              <Star size={24} /> VIP
            </Link>
            {ev.mode === 'bus' && (
              <Link to={`/e/${ev.id}/rollcall`} className="quick-btn">
                <ListChecks size={24} /> 點名
              </Link>
            )}
          </div>
        </section>

        <section className="card">
          <SectionTitle zh={ev.mode === 'banquet' ? '最近入席' : ev.mode === 'bus' ? '最近報到' : '最近入場'} en="Recent" />
          {recent.length ? (
            <div className="list">
              {recent.map((e) => (
                <Link key={e.p.id} to={`/e/${ev.id}/guests/${e.p.id}`} className="stamp-row">
                  <Seal className="stamp-seal" />
                  <span className="stamp-name">
                    <b>{names(e.p).primary}</b>
                    <small>{[names(e.p).secondary, e.tickets[0]?.ticketNumber || e.tickets[0]?.invitationId || e.p.memberId].filter(Boolean).join(' · ')}</small>
                  </span>
                  {e.p.vip && <span className="stamp-vip">VIP</span>}
                  <span className="stamp-time">{e.p.checkedInAt ? formatTime(e.p.checkedInAt) : ''}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="muted pad">未有簽到紀錄</p>
          )}
        </section>
      </div>

        </>
      )}

      <section className="event-actions">
        <Link to={`/e/${ev.id}/edit`} className="btn btn-ghost">
          <Pencil size={18} /> 修改活動
        </Link>
        <button
          className="btn btn-ghost"
          onClick={async () => {
            const n = await duplicateEvent(ev)
            toast(`已複製：${n.name}`)
          }}
        >
          <Copy size={18} /> 複製
        </button>
        {ev.status === 'active' && (
          <button className="btn btn-ghost" onClick={() => setComplete(true)}>
            <CheckCircle2 size={18} /> 完成活動
          </button>
        )}
        {ev.status !== 'archived' && (
          <button className="btn btn-ghost" onClick={() => setConfirmArchive(true)}>
            <Archive size={18} /> 封存
          </button>
        )}
      </section>

      <Sheet
        open={complete}
        onClose={() => setComplete(false)}
        title="完成活動 Complete Event"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setComplete(false)}>
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={async () => {
                await setEventStatus(ev, 'completed')
                setComplete(false)
                toast('活動已完成')
              }}
            >
              確認完成
            </button>
          </>
        }
      >
        {ev.mode === 'gift' ? (
          <GiftNumbers ev={ev} />
        ) : (
          <div className="summary-grid">
            <MetricCard zh="總人數" en="Total" value={stats.total} />
            <MetricCard zh="出席" en="Attended" value={stats.arrived} tone="ok" />
            <MetricCard zh="缺席" en="Absent" value={stats.notArrived} />
            <MetricCard zh="出席率" en="Attendance" value={`${pct(stats.arrived, stats.total)}%`} tone="mode" />
          </div>
        )}
        <p className="hint">完成後仍可查看及修改。匯出報告功能將在第 4 階段加入。</p>
      </Sheet>

      <ConfirmSheet
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        onConfirm={async () => {
          await setEventStatus(ev, 'archived')
          toast('已封存，可在活動列表「已封存」找回')
          nav('/events')
        }}
        title="封存活動"
        message={<p>封存後活動會移到「已封存」，資料不會刪除，隨時可以恢復。</p>}
        confirmText="封存"
      />

      {outcome && <ScanResult outcome={outcome} purpose="checkin" onDone={() => setOutcome(null)} />}
    </div>
  )
}
