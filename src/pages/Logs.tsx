import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { EventRec, ScanResultType } from '../db/types'
import { formatDateTime } from '../lib/util'
import { PageHeader } from '../components/ui'

const RESULT: Record<ScanResultType, [string, string]> = {
  valid: ['ok', '✓ 有效'],
  manual: ['info', '✋ 手動'],
  invalid: ['bad', '× 無效'],
  no_match: ['bad', '× 找不到'],
  not_eligible: ['bad', '× 不符資格'],
  duplicate: ['warn', '! 重複'],
  out_of_stock: ['warn', '! 無庫存'],
}
const PURPOSE = { checkin: '入場', rollcall: '點名', souvenir: '紀念品' }

export default function Logs() {
  const ev = useOutletContext<EventRec>()
  const [tab, setTab] = useState<'audit' | 'scan'>('audit')
  const audit = useLiveQuery(() => db.auditLogs.where('eventId').equals(ev.id).reverse().sortBy('time'), [ev.id]) ?? []
  const scans = useLiveQuery(() => db.scanLogs.where('eventId').equals(ev.id).reverse().sortBy('time'), [ev.id]) ?? []
  const names = useLiveQuery(async () => {
    const ps = await db.participants.where('eventId').equals(ev.id).toArray()
    return new Map(ps.map((p) => [p.id, p.englishName || p.name]))
  }, [ev.id])

  return (
    <div className="page">
      <PageHeader zh="紀錄" en="Logs" />
      <div className="tabs">
        <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>
          操作紀錄<small>Audit Log · {audit.length}</small>
        </button>
        <button className={tab === 'scan' ? 'active' : ''} onClick={() => setTab('scan')}>
          掃描紀錄<small>Scan Log · {scans.length}</small>
        </button>
      </div>
      <p className="hint">紀錄只會新增，不能修改。</p>
      <div className="card log-table-wrap">
        {tab === 'audit' ? (
          audit.length ? (
            <table className="log-table">
              <thead>
                <tr>
                  <th>時間</th>
                  <th>動作</th>
                  <th>嘉賓</th>
                  <th>操作員</th>
                  <th>原因</th>
                </tr>
              </thead>
              <tbody>
                {audit.slice(0, 500).map((l) => (
                  <tr key={l.id}>
                    <td className="nowrap muted">{formatDateTime(l.time)}</td>
                    <td>{l.action}</td>
                    <td>{l.guestName}</td>
                    <td>{l.user}</td>
                    <td className="muted">{l.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted pad">未有操作紀錄</p>
          )
        ) : scans.length ? (
          <table className="log-table">
            <thead>
              <tr>
                <th>時間</th>
                <th>結果</th>
                <th>用途</th>
                <th>方式</th>
                <th>內容</th>
                <th>嘉賓</th>
              </tr>
            </thead>
            <tbody>
              {scans.slice(0, 500).map((l) => (
                <tr key={l.id}>
                  <td className="nowrap muted">{formatDateTime(l.time)}</td>
                  <td>
                    <span className={`badge tone-${RESULT[l.result][0]}`}>{RESULT[l.result][1]}</span>
                  </td>
                  <td>{PURPOSE[l.purpose]}</td>
                  <td>{l.type}</td>
                  <td>
                    <code>{l.rawValue}</code>
                  </td>
                  <td>{l.participantId ? names?.get(l.participantId) : <span className="muted">{l.reason}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted pad">未有掃描紀錄</p>
        )}
      </div>
    </div>
  )
}
