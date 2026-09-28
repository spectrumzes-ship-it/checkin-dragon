import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Archive, Copy, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { db } from '../db/db'
import type { EventRec, Mode } from '../db/types'
import { deleteEventPermanently, duplicateEvent, setEventStatus } from '../lib/actions'
import { useEventSummaries } from '../lib/hooks'
import { setSettings } from '../lib/settings'
import { normalize, todayKey } from '../lib/util'
import { CalendarArt } from '../illustrations'
import { MODE_META, ModeIcon } from '../components/icons'
import { ConfirmSheet, EmptyState, EventRow, FilterChip, PageHeader, SearchBar, Sheet, toast } from '../components/ui'

type Tab = 'today' | 'upcoming' | 'past' | 'archived'
const TABS: [Tab, string, string][] = [
  ['today', '今日', 'Today'],
  ['upcoming', '即將舉行', 'Upcoming'],
  ['past', '已完成', 'Past'],
  ['archived', '已封存', 'Archived'],
]

export default function EventList() {
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const mode = (params.get('mode') as Mode | null) ?? null
  const pick = params.get('pick')
  const events = useLiveQuery(() => db.events.toArray(), [])
  const today = todayKey()
  const defaultTab: Tab = events?.some((e) => e.date === today && e.status !== 'archived') ? 'today' : 'upcoming'
  const tab = (params.get('tab') as Tab | null) ?? defaultTab
  const [q, setQ] = useState('')
  const [menu, setMenu] = useState<EventRec | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<EventRec | null>(null)

  const inTab = (e: EventRec, t: Tab) =>
    t === 'archived'
      ? e.status === 'archived'
      : e.status !== 'archived' &&
        (t === 'today' ? e.date === today : t === 'upcoming' ? e.date > today : e.date < today || e.status === 'completed')

  const list = useMemo(() => {
    if (!events) return []
    const nq = normalize(q)
    return events
      .filter((e) => (!mode || e.mode === mode) && inTab(e, tab) && (!nq || normalize(e.name + e.venue).includes(nq)))
      .sort((a, b) => (tab === 'past' || tab === 'archived' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, mode, tab, q])
  const summaries = useEventSummaries(list)

  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }

  const open = (e: EventRec) => {
    setSettings({ currentEventId: e.id })
    nav(pick === 'guests' ? `/e/${e.id}/guests` : pick === 'scan' ? `/e/${e.id}/scan` : `/e/${e.id}`)
  }

  const m = mode ? MODE_META[mode] : null

  return (
    <div className="page" data-mode={mode ?? undefined}>
      <PageHeader
        zh={pick ? '選擇活動' : m ? m.zh : '活動'}
        en={pick ? 'Choose an event' : m ? m.en : 'Events'}
        back={mode ? '/' : undefined}
        actions={
          <Link to={`/events/new${mode ? `?mode=${mode}` : ''}`} className="btn btn-primary btn-sm">
            <Plus size={18} /> 新活動
          </Link>
        }
      />
      {m && (
        <div className="mode-banner">
          <ModeIcon mode={mode!} size={20} /> {m.zh} · {m.en}
        </div>
      )}

      <div className="tabs" role="tablist">
        {TABS.map(([t, zh, en]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => set('tab', t)}>
            {zh}
            <small>{en}</small>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <SearchBar value={q} onChange={setQ} placeholder="搜尋活動名稱／地點" />
        <div className="chips">
          <FilterChip active={!mode} onClick={() => set('mode', null)}>
            全部
          </FilterChip>
          {(['event', 'banquet', 'bus'] as Mode[]).map((md) => (
            <FilterChip key={md} active={mode === md} onClick={() => set('mode', md)}>
              <ModeIcon mode={md} size={14} /> {MODE_META[md].zh.replace('模式', '')}
            </FilterChip>
          ))}
        </div>
      </div>

      {list.length === 0 ? (
        <div className="card">
          <EmptyState
            art={<CalendarArt />}
            zh={tab === 'archived' ? '沒有已封存的活動。' : '這裏還沒有活動。'}
            en={tab === 'archived' ? 'No archived events.' : 'No events here yet.'}
            action={
              tab !== 'archived' && (
                <Link to="/events/new" className="btn btn-primary">
                  <Plus size={18} /> 建立活動
                </Link>
              )
            }
          />
        </div>
      ) : (
        <div className="list card">
          {list.map((e) => (
            <div key={e.id} onClickCapture={pick ? (ev) => (ev.preventDefault(), open(e)) : () => setSettings({ currentEventId: e.id })}>
              <EventRow
                event={e}
                stats={summaries[e.id]}
                trailing={
                  !pick && (
                    <button className="icon-btn" aria-label="更多操作" onClick={(ev) => (ev.stopPropagation(), setMenu(e))}>
                      <MoreHorizontal size={20} />
                    </button>
                  )
                }
              />
            </div>
          ))}
        </div>
      )}

      <Sheet open={!!menu} onClose={() => setMenu(null)} title={menu?.name ?? ''}>
        {menu && (
          <div className="menu-list">
            {menu.status !== 'archived' ? (
              <>
                <Link className="menu-item" to={`/e/${menu.id}/edit`}>
                  <Pencil size={20} /> 修改 <small>Edit</small>
                </Link>
                <button
                  className="menu-item"
                  onClick={async () => {
                    const ev = await duplicateEvent(menu)
                    setMenu(null)
                    toast(`已複製：${ev.name}`)
                  }}
                >
                  <Copy size={20} /> 複製 <small>Duplicate</small>
                </button>
                <button
                  className="menu-item"
                  onClick={async () => {
                    await setEventStatus(menu, 'archived')
                    setMenu(null)
                    toast('已封存，可在「已封存」找回')
                  }}
                >
                  <Archive size={20} /> 封存 <small>Archive</small>
                </button>
              </>
            ) : (
              <>
                <button
                  className="menu-item"
                  onClick={async () => {
                    await setEventStatus(menu, 'active')
                    setMenu(null)
                    toast('已恢復活動')
                  }}
                >
                  <RotateCcw size={20} /> 恢復 <small>Restore</small>
                </button>
                <button
                  className="menu-item danger"
                  onClick={() => {
                    setConfirmDelete(menu)
                    setMenu(null)
                  }}
                >
                  <Trash2 size={20} /> 永久刪除 <small>Delete permanently</small>
                </button>
              </>
            )}
          </div>
        )}
      </Sheet>

      <ConfirmSheet
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete) await deleteEventPermanently(confirmDelete)
          toast('已永久刪除')
        }}
        title="永久刪除活動"
        message={<p>此活動的所有嘉賓、入場紀錄、點名和紀念品紀錄將會永久刪除，<strong>無法復原</strong>。</p>}
        confirmText="永久刪除"
        danger
        requireText={confirmDelete?.name}
      />
    </div>
  )
}
