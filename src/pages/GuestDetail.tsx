import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Star, Bus, Clock, Gift, IdCard, Minus, Pencil, Phone, Plus, Building2, Ticket, UndoDot, UserRound, Armchair, NotebookPen, X } from 'lucide-react'
import { db } from '../db/db'
import type { EventRec, Participant } from '../db/types'
import { setRemarks, setVip, checkIn, deleteGuestPermanently, eligibilityLabel, eligible, entitlement, setGuestCancelled, undoCheckIn, undoRedemption, updateArrivedCount } from '../lib/actions'
import { feedback } from '../lib/feedback'
import type { GuestEntry } from '../lib/search'
import { formatDateTime, formatTime } from '../lib/util'
import { TableIcon } from '../components/icons'
import { StatusIcon } from '../components/StatusIcon'
import { ConfirmSheet, SoftTag, StatusBadge, toast } from '../components/ui'
import { nameOf, names } from '../lib/names'

const METHOD = { QR: 'QR 掃描', OCR: '文字辨識', MANUAL: '手動', SEARCH: '搜尋' }

export default function GuestDetail({ ev, gid, entry, onClose }: { ev: EventRec; gid: string; entry?: GuestEntry; onClose: () => void }) {
  const [confirm, setConfirm] = useState<null | 'undo' | 'cancel' | 'delete'>(null)
  const logs = useLiveQuery(() => db.auditLogs.where('eventId').equals(ev.id).filter((l) => l.objectId === gid).reverse().sortBy('time'), [ev.id, gid]) ?? []
  const souvenirs = useLiveQuery(() => db.souvenirs.where('eventId').equals(ev.id).sortBy('sortOrder'), [ev.id]) ?? []
  const reds = useLiveQuery(() => db.redemptions.where('participantId').equals(gid).filter((r) => !r.voided).toArray(), [gid]) ?? []

  if (!entry) return <p className="muted pad">找不到此嘉賓</p>
  const p = entry.p
  const t = entry.tickets[0]
  const status = p.status === 'cancelled' ? 'cancelled' : p.attendance

  const Row = ({ icon, zh, value }: { icon: React.ReactNode; zh: string; value?: React.ReactNode }) =>
    value ? (
      <div className="detail-row">
        <span className="detail-icon">{icon}</span>
        <span className="detail-label">{zh}</span>
        <span className="detail-value">{value}</span>
      </div>
    ) : null

  return (
    <div className="guest-detail card">
      <div className="guest-detail-head">
        <div>
          <h2>{names(p).primary}</h2>
          {names(p).secondary && <p className="muted">{names(p).secondary}</p>}
          <div className="tag-row">
            <StatusBadge status={status} />
            <button
              className={`vip-toggle ${p.vip ? 'on' : ''}`}
              aria-pressed={p.vip}
              onClick={async () => {
                await setVip(p, !p.vip)
                toast(p.vip ? '已取消 VIP' : `⭐ ${nameOf(p)} 已設為 VIP`)
              }}
            >
              <Star size={14} fill={p.vip ? 'currentColor' : 'none'} /> {p.vip ? 'VIP' : '設為 VIP'}
            </button>
            {p.guestCount > 1 && <SoftTag>{p.guestCount} 位</SoftTag>}
            {p.tags.map((x) => (
              <SoftTag key={x}>{x}</SoftTag>
            ))}
          </div>
        </div>
        <button className="icon-btn" aria-label="關閉" onClick={onClose}>
          <X size={20} />
        </button>
      </div>

      {p.status === 'active' && (
        <div className="detail-primary">
          {p.attendance === 'not_arrived' ? (
            <button
              className="btn btn-primary btn-lg btn-block"
              onClick={async () => {
                await checkIn(p, 'SEARCH', 'checkin', '', t)
                feedback('valid')
                toast(`✓ ${nameOf(p)} 已簽到`)
              }}
            >
              <StatusIcon kind="arrived" size={22} /> 簽到 Check-In
            </button>
          ) : (
            <>
              <div className="checked-box tone-ok">
                <StatusIcon kind="arrived" size={20} /> 已於 {p.checkedInAt ? formatTime(p.checkedInAt) : ''} 簽到
                {p.checkInMethod && <small> · {METHOD[p.checkInMethod]}</small>}
              </div>
              {p.guestCount > 1 && (
                <div className="stepper">
                  <span>到達人數</span>
                  <button className="icon-btn" aria-label="減少" onClick={() => updateArrivedCount(p, p.arrivedCount - 1)} disabled={p.arrivedCount <= 1}>
                    <Minus size={18} />
                  </button>
                  <strong>
                    {p.arrivedCount} / {p.guestCount}
                  </strong>
                  <button className="icon-btn" aria-label="增加" onClick={() => updateArrivedCount(p, p.arrivedCount + 1)} disabled={p.arrivedCount >= p.guestCount}>
                    <Plus size={18} />
                  </button>
                </div>
              )}
              <button className="btn btn-ghost btn-block" onClick={() => setConfirm('undo')}>
                <UndoDot size={18} /> 取消簽到 Undo
              </button>
            </>
          )}
        </div>
      )}

      <div className="detail-section">
        <Row icon={<UserRound size={18} />} zh="姓名" value={[names(p).primary, names(p).secondary].filter(Boolean).join(' · ')} />
        <Row icon={<Ticket size={18} />} zh="邀請編號" value={t?.invitationId} />
        <Row icon={<IdCard size={18} />} zh="會員編號" value={p.memberId} />
        <Row icon={<Ticket size={18} />} zh="QR 內容" value={t?.qrCode && <code>{t.qrCode}</code>} />
        <Row icon={<Phone size={18} />} zh="電話" value={p.phone && <a href={`tel:${p.phone}`}>{p.phone}</a>} />
        <Row icon={<Building2 size={18} />} zh="公司" value={p.company} />
      </div>

      {entry.seats.length > 0 && (
        <div className="detail-section">
          {entry.seats.map((s, i) =>
            s.resource.type === 'table' ? (
              <Row
                key={i}
                icon={<TableIcon size={18} />}
                zh={s.resource.purpose === '晚餐' ? '晚餐席號' : '席號'}
                value={
                  <Link to={`/e/${ev.id}/tables/${s.resource.id}`}>
                    第 {s.resource.label} 席{s.seatLabel && ` · ${s.seatLabel} 號座位`}
                  </Link>
                }
              />
            ) : (
              <Row key={i} icon={<Bus size={18} />} zh="巴士" value={`${s.resource.label} 車${s.seatLabel ? ` · ${s.seatLabel} 號座位` : ''}`} />
            ),
          )}
        </div>
      )}

      <div className="detail-section">
        <Row icon={<Clock size={18} />} zh="簽到時間" value={p.checkedInAt ? formatDateTime(p.checkedInAt) : '未簽到'} />
        <Row icon={<Armchair size={18} />} zh="飲食" value={p.dietary} />
      </div>

      {souvenirs.length > 0 && (
        <div className="detail-section">
          <h3 className="detail-h">
            <Gift size={16} /> 紀念品 Souvenirs
          </h3>
          {souvenirs.map((s) => {
            const mine = reds.filter((r) => r.itemId === s.id)
            const qty = mine.reduce((a, r) => a + r.quantity, 0)
            const ok = eligible(s, p)
            return (
              <div key={s.id} className="souvenir-line">
                <span>
                  <strong>{s.name}</strong>
                  <span className="muted">
                    {' '}
                    · {ok ? `可領 ${entitlement(s, p)} 份` : eligibilityLabel(s.eligibility)}
                  </span>
                </span>
                {qty > 0 ? (
                  <span className="souvenir-status">
                    <SoftTag tone="warn">
                      已領 ×{qty} · {formatTime(mine[mine.length - 1].time)}
                    </SoftTag>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={async () => {
                        await undoRedemption(s.id, p)
                        toast('已取消領取')
                      }}
                    >
                      取消
                    </button>
                  </span>
                ) : (
                  <span className="muted">{ok ? '未領' : '—'}</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="detail-actions">
        <Link to={`/e/${ev.id}/guests/${p.id}/edit`} className="btn btn-ghost">
          <Pencil size={18} /> 修改
        </Link>
        {p.status === 'active' ? (
          <button className="btn btn-ghost" onClick={() => setConfirm('cancel')}>
            取消嘉賓
          </button>
        ) : (
          <>
            <button
              className="btn btn-ghost"
              onClick={async () => {
                await setGuestCancelled(p, false)
                toast('已恢復嘉賓')
              }}
            >
              恢復嘉賓
            </button>
            <button className="btn btn-danger-ghost" onClick={() => setConfirm('delete')}>
              永久刪除
            </button>
          </>
        )}
      </div>

      {logs.length > 0 && (
        <div className="detail-section">
          <h3 className="detail-h">操作紀錄 History</h3>
          <ul className="mini-log">
            {logs.slice(0, 10).map((l) => (
              <li key={l.id}>
                <span className="muted">{formatDateTime(l.time)}</span> {l.action} <span className="muted">· {l.user}</span>
                {l.reason && <span className="muted"> · {l.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <RemarksBox p={p} />

      <ConfirmSheet
        open={confirm === 'undo'}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          await undoCheckIn(p)
          toast('已取消簽到')
        }}
        title="取消簽到"
        message={<p>把 {nameOf(p)} 改回「未到」？此操作會記錄在操作紀錄。</p>}
        confirmText="取消簽到"
      />
      <ConfirmSheet
        open={confirm === 'cancel'}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          await setGuestCancelled(p, true)
          toast('已取消嘉賓，其門票將顯示為無效')
        }}
        title="取消嘉賓"
        message={<p>取消後掃描此嘉賓的票會顯示「已取消」。資料不會刪除，可隨時恢復。</p>}
        confirmText="取消嘉賓"
      />
      <ConfirmSheet
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          await deleteGuestPermanently(p)
          toast('已永久刪除')
          onClose()
        }}
        title="永久刪除嘉賓"
        message={<p>永久刪除後無法復原。</p>}
        confirmText="永久刪除"
        danger
        requireText="刪除"
      />
    </div>
  )
}

// 備註：直接在詳情頁輸入或修改（離開輸入框或按「儲存」即保存，並記錄在操作紀錄）
function RemarksBox({ p }: { p: Participant }) {
  const [text, setText] = useState(p.remarks || '')
  useEffect(() => setText(p.remarks || ''), [p.id, p.remarks])
  const changed = text.trim() !== (p.remarks || '').trim()
  const save = async () => {
    if (!changed) return
    await setRemarks(p, text)
    toast('已儲存備註')
  }
  return (
    <div className="detail-section remarks-box">
      <h3 className="detail-h">
        <NotebookPen size={16} /> 備註 Notes
      </h3>
      <textarea
        rows={3}
        value={text}
        placeholder="新增備註，例如：遲到、代領、要求靠近舞台…"
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
      />
      {changed && (
        <div className="remarks-actions">
          <button className="btn btn-ghost btn-sm" onPointerDown={(e) => e.preventDefault()} onClick={() => setText(p.remarks || '')}>
            還原
          </button>
          <button className="btn btn-primary btn-sm" onPointerDown={(e) => e.preventDefault()} onClick={save}>
            儲存
          </button>
        </div>
      )}
    </div>
  )
}
