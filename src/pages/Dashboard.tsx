import { useMemo, useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Archive, CheckCircle2, Copy, Gift, ListChecks, Pencil, Plus, ScanLine, Search, Star, UserX, Users } from 'lucide-react'
import { db } from '../db/db'
import type { EventRec } from '../db/types'
import { duplicateEvent, logicLabel, logicOf, quantityLabel, setEventStatus, verifyCheckIn, type ScanOutcome } from '../lib/actions'
import { computeStats, useDebounced, useEventData } from '../lib/hooks'
import { searchGuests } from '../lib/search'
import { formatTime, pct } from '../lib/util'
import { TableIcon } from '../components/icons'
import { GuestRow } from '../components/GuestRow'
import { ScanResult } from '../components/ScanResult'
import { ConfirmSheet, DonutChart, MetricCard, MiniBarChart, ProgressBar, SearchBar, SectionTitle, Sheet, toast } from '../components/ui'

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
  const qty = reds.reduce((a, r) => a + r.quantity, 0)
  return (
    <>
      <div className="metrics">
        <MetricCard zh="禮品款式" en="Gifts" value={items.length} icon={<Gift size={18} />} to={`/e/${ev.id}/souvenirs`} />
        <MetricCard zh="已派發" en="Given" value={qty} tone="ok" sub="份" icon={<CheckCircle2 size={18} />} />
        <MetricCard zh="領取次數" en="Claims" value={reds.length} icon={<ListChecks size={18} />} />
        <MetricCard zh="已登記領取人" en="Recipients" value={new Set(reds.map((r) => r.participantId).filter(Boolean)).size} icon={<Users size={18} />} to={`/e/${ev.id}/guests`} />
      </div>
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
          <p className="muted pad">
            還沒有禮品。<Link to={`/e/${ev.id}/souvenirs`}>新增禮品</Link>
          </p>
        )}
      </section>
    </>
  )
}

export default function Dashboard() {
  const ev = useOutletContext<EventRec>()
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

  const passengerCount = data?.participants.filter((p) => p.status === 'active' && !p.giftOnly).length ?? 0

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
      <div className="metrics">
        <MetricCard zh={ev.mode === 'bus' ? '乘客' : '總人數'} en="Total" value={stats.total} sub={`${stats.invitations} ${ev.modeConfig.anonymous ? '張門票' : '張邀請'}`} icon={<Users size={18} />} to={`/e/${ev.id}/guests`} />
        <MetricCard zh="已到" en="Arrived" value={stats.arrived} tone="ok" icon={<CheckCircle2 size={18} />} to={`/e/${ev.id}/guests?filter=arrived`} />
        <MetricCard zh="未到" en="Not Arrived" value={stats.notArrived} icon={<UserX size={18} />} to={`/e/${ev.id}/guests?filter=not_arrived`} />
        <MetricCard zh="出席率" en="Attendance" value={`${stats.rate}%`} tone="mode" sub={<ProgressBar value={stats.arrived} max={stats.total} />} />
        <MetricCard zh="VIP" en="VIP" value={`${stats.vipArrived} / ${stats.vipTotal}`} icon={<Star size={18} />} to={`/e/${ev.id}/guests?filter=vip`} />
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
                    const present = attendance.filter((a) => a.sessionId === s.id && a.status === 'present').length
                    return (
                      <Link key={s.id} to={`/e/${ev.id}/rollcall/${s.id}`} className="session-row">
                        <span className="session-name">
                          <strong>{s.name}</strong>
                          <span className="muted">
                            {s.time} · {s.location}
                          </span>
                        </span>
                        <span className="session-count">
                          {present} / {passengerCount} {present === passengerCount && '✓'}
                        </span>
                        <ProgressBar value={present} max={passengerCount} tone={present === passengerCount ? 'ok' : 'mode'} />
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
          <SectionTitle zh="最近簽到" en="Recent Check-ins" />
          {recent.length ? (
            <div className="list">
              {recent.map((e) => (
                <GuestRow key={e.p.id} e={e} onClick={() => nav(`/e/${ev.id}/guests/${e.p.id}`)} />
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
