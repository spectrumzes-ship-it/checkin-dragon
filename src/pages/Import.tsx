import { useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, RefreshCw, Upload, XCircle } from 'lucide-react'
import { db } from '../db/db'
import type { EventRec } from '../db/types'
import { buildRows, fieldsFor, guessMapping, ImportFileError, importRows, readTable, rowTitle, templateCsv, type FieldKey, type ImportRow } from '../lib/importer'
import { PageHeader, toast } from '../components/ui'

const MODE_WORD: Record<EventRec['mode'], string> = { event: '嘉賓', banquet: '嘉賓', bus: '團員', gift: '會員' }

// 匯入名單：選檔 → 核對欄位 → 預覽（有問題的行標紅）→ 匯入
export default function Import() {
  const ev = useOutletContext<EventRec>()
  const nav = useNavigate()
  const word = MODE_WORD[ev.mode]
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ name: string; table: string[][] } | null>(null)
  const [mapping, setMapping] = useState<(FieldKey | '')[]>([])
  const [onExisting, setOnExisting] = useState<'skip' | 'update'>('update')
  const [onlyIssues, setOnlyIssues] = useState(false)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)

  const ctx = useLiveQuery(async () => {
    const [participants, tickets, resources, seats] = await Promise.all([
      db.participants.where('eventId').equals(ev.id).toArray(),
      db.tickets.where('eventId').equals(ev.id).toArray(),
      db.resources.where('eventId').equals(ev.id).toArray(),
      db.seats.where('eventId').equals(ev.id).toArray(),
    ])
    return { participants, tickets, resources, seats }
  }, [ev.id])

  const rows = useMemo(() => (file && ctx ? buildRows(file.table, mapping, { ev, ...ctx }) : []), [file, mapping, ctx, ev])
  const bad = rows.filter((r) => r.errors.length).length
  const existing = rows.filter((r) => !r.errors.length && r.existingId).length
  const fresh = rows.length - bad - existing
  const warned = rows.filter((r) => !r.errors.length && r.warnings.length).length
  const willImport = fresh + (onExisting === 'update' ? existing : 0)
  const hasName = mapping.includes('name') || mapping.includes('englishName')

  const open = async (f: File | undefined) => {
    if (!f) return
    try {
      const table = await readTable(f)
      if (table.length < 2) return toast('檔案沒有資料（第一行要是標題，第二行起是名單）')
      setFile({ name: f.name, table })
      setMapping(guessMapping(table[0], ev.mode))
      setOnlyIssues(false)
    } catch (e) {
      toast(e instanceof ImportFileError ? e.message : '未能讀取這個檔案，請確認是 Excel（.xlsx）或 CSV')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([templateCsv(ev.mode)], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `匯入範本-${ev.mode === 'banquet' ? '宴會' : ev.mode === 'bus' ? '旅遊' : ev.mode === 'gift' ? '禮品' : '活動'}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const run = async () => {
    setBusy(true)
    try {
      const r = await importRows(ev, rows, onExisting)
      toast(`已匯入：新增 ${r.added} 位${r.updated ? `、更新 ${r.updated} 位` : ''}${r.skipped ? `、略過 ${r.skipped} 位` : ''}`)
      nav(`/e/${ev.id}/guests`)
    } catch {
      toast('匯入失敗，請再試一次')
    } finally {
      setBusy(false)
    }
  }

  const fields = fieldsFor(ev.mode)
  const shown = (onlyIssues ? rows.filter((r) => r.errors.length || r.warnings.length) : rows).slice(0, 300)

  return (
    <div className="page narrow import-page">
      <PageHeader zh={`匯入${word}名單`} en="Import" back={`/e/${ev.id}/guests`} />

      {!file ? (
        <>
          <label
            className={drag ? 'import-drop on' : 'import-drop'}
            onDragOver={(e) => (e.preventDefault(), setDrag(true))}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => (e.preventDefault(), setDrag(false), open(e.dataTransfer.files[0]))}
          >
            <FileSpreadsheet size={44} strokeWidth={1.6} />
            <b>選擇 Excel 或 CSV 檔案</b>
            <small>支援 .xlsx、.csv；第一行是標題</small>
            <span className="btn btn-primary">
              <Upload size={18} /> 選擇檔案
            </span>
            <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => open(e.target.files?.[0])} hidden />
          </label>
          <p className="hint">🔒 檔案只在這部裝置讀取，不會上傳到任何地方。身份證號碼只會保存頭 4 位。</p>
          <section className="card import-help">
            <h3>欄位名稱怎樣寫？</h3>
            <p className="muted">不用跟足格式，App 會按標題自動配對，匯入前可以再修改。常用標題：</p>
            <p className="import-words">{fields.map((f) => f.label).join('、')}</p>
            <button className="btn btn-ghost" onClick={download}>
              <Download size={18} /> 下載範本（CSV）
            </button>
          </section>
        </>
      ) : (
        <>
          <section className="card import-file">
            <FileSpreadsheet size={22} />
            <span>
              <b>{file.name}</b>
              <small>共 {file.table.length - 1} 行</small>
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
              <RefreshCw size={16} /> 換檔案
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt,.xls" onChange={(e) => open(e.target.files?.[0])} hidden />
          </section>

          <h2 className="import-h">
            1. 核對欄位 <small>左邊是檔案的標題，右邊選擇對應的資料</small>
          </h2>
          <div className="card import-map">
            {file.table[0].map((h, i) => {
              const sample = file.table.slice(1, 4).map((r) => r[i]).filter(Boolean).join('、')
              return (
                <label key={i} className={mapping[i] ? 'import-col' : 'import-col off'}>
                  <span>
                    <b>{h || `第 ${i + 1} 欄`}</b>
                    <small>{sample || '（空白）'}</small>
                  </span>
                  <select value={mapping[i] ?? ''} onChange={(e) => setMapping(mapping.map((m, j) => (j === i ? (e.target.value as FieldKey | '') : m === e.target.value && e.target.value ? '' : m)))}>
                    <option value="">不匯入</option>
                    {fields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
              )
            })}
          </div>
          {!hasName && <p className="warn-text">⚠ 請最少選擇一欄「中文姓名」或「英文姓名」</p>}

          <h2 className="import-h">
            2. 預覽 <small>有問題的行不會匯入，可修改 Excel 後再匯入</small>
          </h2>
          <div className="import-stats">
            <span className="ok">
              <CheckCircle2 size={16} /> 新增 {fresh}
            </span>
            {existing > 0 && (
              <span className="info">
                <RefreshCw size={16} /> 已在名單 {existing}
              </span>
            )}
            {warned > 0 && (
              <span className="warn">
                <AlertTriangle size={16} /> 提示 {warned}
              </span>
            )}
            {bad > 0 && (
              <span className="bad">
                <XCircle size={16} /> 有問題 {bad}
              </span>
            )}
          </div>
          {existing > 0 && (
            <div className="seg import-seg" role="radiogroup" aria-label="已在名單的人">
              <button role="radio" aria-checked={onExisting === 'update'} className={onExisting === 'update' ? 'active' : ''} onClick={() => setOnExisting('update')}>
                已在名單：更新資料
              </button>
              <button role="radio" aria-checked={onExisting === 'skip'} className={onExisting === 'skip' ? 'active' : ''} onClick={() => setOnExisting('skip')}>
                已在名單：略過
              </button>
            </div>
          )}
          {(bad > 0 || warned > 0) && (
            <label className="check-row">
              <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
              <span>
                <strong>只顯示有問題或提示的行</strong>
              </span>
            </label>
          )}
          <div className="card import-rows">
            {shown.map((r) => (
              <Row key={r.line} r={r} mode={ev.mode} onExisting={onExisting} />
            ))}
            {rows.length > shown.length && !onlyIssues && <p className="muted pad center">只顯示首 300 行；全部 {rows.length} 行都會一併檢查及匯入</p>}
            {shown.length === 0 && <p className="muted pad center">沒有需要留意的行</p>}
          </div>

          <div className="import-go">
            <button className="btn btn-primary btn-block btn-lg" disabled={busy || !hasName || willImport === 0} onClick={run}>
              <Upload size={18} /> {busy ? '匯入中…' : `匯入 ${willImport} 位${word}`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function Row({ r, mode, onExisting }: { r: ImportRow; mode: EventRec['mode']; onExisting: 'skip' | 'update' }) {
  const place =
    mode === 'banquet' && r.table ? `第 ${r.table} 席${r.seat ? ` · ${r.seat} 號` : ''}` : mode === 'bus' && r.bus ? `${r.bus} 車${r.busSeat ? ` · ${r.busSeat} 號` : ''}` : ''
  const state = r.errors.length ? 'bad' : r.existingId ? 'info' : r.warnings.length ? 'warn' : 'ok'
  return (
    <div className={`import-row ${state}`}>
      <span className="import-line">{r.line}</span>
      <span className="import-who">
        <b>{rowTitle(r)}</b>
        <small>{[r.code || r.memberId, place, r.guestCount && r.guestCount > 1 ? `${r.guestCount} 位` : '', r.vip ? 'VIP' : ''].filter(Boolean).join(' · ')}</small>
        {r.errors.map((m) => (
          <em key={m} className="bad">
            ✕ {m}
          </em>
        ))}
        {r.existingId && !r.errors.length && <em className="info">已在名單 · {onExisting === 'update' ? '會更新' : '會略過'}</em>}
        {r.warnings.map((m) => (
          <em key={m} className="warn">
            ! {m}
          </em>
        ))}
      </span>
    </div>
  )
}
