import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import type { Mode } from '../db/types'
import { saveEvent, type EventInput } from '../lib/actions'
import { useEvent } from '../lib/hooks'
import { setSettings } from '../lib/settings'
import { todayKey } from '../lib/util'
import { MODE_META, ModeIcon, typeLabel } from '../components/icons'
import { PageHeader, toast } from '../components/ui'

const blank = (mode: Mode): EventInput => ({
  name: '',
  mode,
  type: MODE_META[mode].types[0],
  date: todayKey(),
  endDate: '',
  startTime: '18:30',
  endTime: '22:00',
  venue: '',
  notes: '',
  tableCount: 20,
  seatsPerTable: 12,
  buses: [{ label: 'A', capacity: 45 }],
  dinnerTables: 0,
  dinnerSeats: 12,
  anonymous: false,
})

export default function EventForm() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const nav = useNavigate()
  const existing = useEvent(id)
  const [f, setF] = useState<EventInput>(() => blank((params.get('mode') as Mode) || 'event'))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!existing) return
    setF({
      name: existing.name,
      mode: existing.mode,
      type: existing.type,
      date: existing.date,
      endDate: existing.endDate ?? '',
      startTime: existing.startTime,
      endTime: existing.endTime,
      venue: existing.venue,
      notes: existing.notes,
      tableCount: existing.modeConfig.tableCount ?? 20,
      seatsPerTable: existing.modeConfig.seatsPerTable ?? 12,
      buses: existing.modeConfig.buses ?? [{ label: 'A', capacity: 45 }],
      dinnerTables: existing.modeConfig.dinnerTables ?? 0,
      dinnerSeats: existing.modeConfig.dinnerSeats ?? 12,
      anonymous: existing.modeConfig.anonymous ?? false,
    })
  }, [existing])

  const up = <K extends keyof EventInput>(k: K, v: EventInput[K]) => setF((s) => ({ ...s, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return toast('請輸入活動名稱')
    setSaving(true)
    const ev = await saveEvent(f, existing ?? undefined)
    setSettings({ currentEventId: ev.id })
    toast(existing ? '已儲存' : '已建立活動')
    nav(`/e/${ev.id}`, { replace: true })
  }

  return (
    <div className="page narrow" data-mode={f.mode}>
      <PageHeader zh={id ? '修改活動' : '建立活動'} en={id ? 'Edit Event' : 'New Event'} back />
      <form className="form" onSubmit={submit}>
        <fieldset className="card">
          <legend>模式 Mode</legend>
          <div className="mode-picker">
            {(['event', 'banquet', 'bus', 'gift'] as Mode[]).map((m) => (
              <button
                type="button"
                key={m}
                data-mode={m}
                className={f.mode === m ? 'active' : ''}
                disabled={!!id}
                onClick={() => setF((s) => ({ ...s, mode: m, type: MODE_META[m].types[0] }))}
              >
                <ModeIcon mode={m} size={24} />
                <span className="bi">
                  <span className="bi-zh">{MODE_META[m].zh}</span>
                  <span className="bi-en">{MODE_META[m].en}</span>
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="card">
          <legend>基本資料 Details</legend>
          <label className="field">
            <span>活動名稱 Event Name *</span>
            <input value={f.name} onChange={(e) => up('name', e.target.value)} placeholder="例如 Annual Dinner 2026" autoFocus={!id} />
          </label>
          <label className="field">
            <span>活動類型 Type</span>
            <select value={f.type} onChange={(e) => up('type', e.target.value)}>
              {MODE_META[f.mode].types.map((t) => (
                <option key={t} value={t}>
                  {typeLabel(t)} {t}
                </option>
              ))}
            </select>
          </label>
          <div className="field-row">
            <label className="field">
              <span>{f.mode === 'banquet' ? '日期 Date' : '開始日期 Start Date'}</span>
              <input type="date" value={f.date} onChange={(e) => up('date', e.target.value)} />
            </label>
            {f.mode !== 'banquet' && (
              <label className="field">
                <span>結束日期（單日可留空）</span>
                <input type="date" value={f.endDate} min={f.date} onChange={(e) => up('endDate', e.target.value)} />
              </label>
            )}
          </div>
          <div className="field-row">
            <label className="field">
              <span>開始 Start</span>
              <input type="time" value={f.startTime} onChange={(e) => up('startTime', e.target.value)} />
            </label>
            <label className="field">
              <span>結束 End</span>
              <input type="time" value={f.endTime} onChange={(e) => up('endTime', e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>地點 Venue</span>
            <input value={f.venue} onChange={(e) => up('venue', e.target.value)} placeholder="例如 Grand Ballroom" />
          </label>
          <label className="field">
            <span>備註 Notes</span>
            <textarea rows={3} value={f.notes} onChange={(e) => up('notes', e.target.value)} />
          </label>
          {f.mode !== 'bus' && f.mode !== 'gift' && (
            <label className="toggle-row">
              <input type="checkbox" checked={f.anonymous} onChange={(e) => up('anonymous', e.target.checked)} />
              <span>
                <strong>不記名門票 Unnamed Tickets</strong>
                <small>門票只有票號／QR Code，不記錄嘉賓姓名；名單及掃描結果以票號顯示。個別門票仍可補上姓名（例如 VIP）。</small>
              </span>
            </label>
          )}
        </fieldset>

        {f.mode === 'banquet' && (
          <fieldset className="card">
            <legend>宴會設定 Banquet</legend>
            <div className="field-row">
              <label className="field">
                <span>席數 Tables</span>
                <input type="number" min={0} max={300} value={f.tableCount} onChange={(e) => up('tableCount', Number(e.target.value))} />
              </label>
              <label className="field">
                <span>每席人數（一圍幾位） Seats / Table</span>
                <input type="number" min={1} max={30} value={f.seatsPerTable} onChange={(e) => up('seatsPerTable', Number(e.target.value))} />
              </label>
            </div>
            <p className="hint">共 {f.tableCount * f.seatsPerTable} 個座位。個別席數人數不同（例如主家席），可在「席號」畫面逐席修改。</p>
          </fieldset>
        )}

        {f.mode === 'bus' && (
          <fieldset className="card">
            <legend>巴士設定 Buses</legend>
            {f.buses.map((b, i) => (
              <div className="field-row" key={i}>
                <label className="field">
                  <span>車號 Bus</span>
                  <input
                    value={b.label}
                    onChange={(e) => up('buses', f.buses.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  />
                </label>
                <label className="field">
                  <span>載客量 Capacity</span>
                  <input
                    type="number"
                    min={1}
                    value={b.capacity}
                    onChange={(e) => up('buses', f.buses.map((x, j) => (j === i ? { ...x, capacity: Number(e.target.value) } : x)))}
                  />
                </label>
                <button type="button" className="icon-btn field-del" aria-label="刪除巴士" onClick={() => up('buses', f.buses.filter((_, j) => j !== i))}>
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => up('buses', [...f.buses, { label: String.fromCharCode(65 + f.buses.length), capacity: 45 }])}
            >
              <Plus size={16} /> 加一架巴士
            </button>
            <div className="field-row">
              <label className="field">
                <span>聚餐席數（沒有聚餐填 0） Dinner Tables</span>
                <input type="number" min={0} value={f.dinnerTables} onChange={(e) => up('dinnerTables', Number(e.target.value))} />
              </label>
              <label className="field">
                <span>每席人數 Seats / Table</span>
                <input type="number" min={1} max={30} value={f.dinnerSeats} onChange={(e) => up('dinnerSeats', Number(e.target.value))} />
              </label>
            </div>
          </fieldset>
        )}

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={() => nav(-1)}>
            取消
          </button>
          <button className="btn btn-primary btn-lg" disabled={saving}>
            {id ? '儲存' : '建立活動'}
          </button>
        </div>
      </form>
    </div>
  )
}
