import type { ReactNode } from 'react'
import { Gift } from 'lucide-react'
import type { GuestEntry } from '../lib/search'
import { cx, formatTime } from '../lib/util'
import { SoftTag, VipBadge } from './ui'
import { StatusIcon } from './StatusIcon'
import { isAnonymous, names } from '../lib/names'

export const seatText = (e: GuestEntry) =>
  e.seats
    .map((s) =>
      s.resource.type === 'table'
        ? `${s.resource.purpose === '晚餐' ? '晚餐 ' : ''}第 ${s.resource.label} 席${s.seatLabel ? ` · ${s.seatLabel} 號` : ''}`
        : `${s.resource.label} 車${s.seatLabel ? ` · ${s.seatLabel} 號` : ''}`,
    )
    .join('　')

export const StatusMark = ({ e }: { e: GuestEntry }) => {
  const p = e.p
  const kind = p.status === 'cancelled' ? 'cancelled' : p.attendance
  return (
    <span className="status-mark">
      <StatusIcon kind={kind} size={32} />
    </span>
  )
}

export const GuestRow = ({
  e,
  onClick,
  selected,
  souvenir,
  trailing,
  onMarkClick,
  mark,
  seating = true,
}: {
  e: GuestEntry
  onClick?: () => void
  selected?: boolean
  souvenir?: boolean
  trailing?: ReactNode
  mark?: ReactNode // 取代左邊的簽到狀態圖示（例如紀念品名單顯示「已領取」圖案）
  onMarkClick?: () => void // 按左邊狀態圓圈：快速簽到／取消簽到
  seating?: boolean // 活動有席位／巴士時才顯示「未安排座位」
}) => {
  const p = e.p
  const row = (
    <>
      <span className="guest-row-main">
        <span className="guest-row-name">
          <strong>{names(p).primary}</strong>
          {names(p).secondary && <span className="muted">{names(p).secondary}</span>}
          {e.sameName && <SoftTag tone="info">同名 · #{p.memberId || e.tickets[0]?.invitationId || '—'}</SoftTag>}
          {p.vip && <VipBadge />}
          {p.companionOf && <SoftTag tone="mode">同行</SoftTag>}
          {p.leftAt && <SoftTag tone="warn">中途離開</SoftTag>}
          {p.giftOnly && <SoftTag tone="info">只領禮品</SoftTag>}
          {p.guestCount > 1 && <SoftTag>{p.attendance === 'partial' ? `${p.arrivedCount}/` : ''}{p.guestCount} 位</SoftTag>}
        </span>
        <span className="guest-row-sub">
          {e.room && <span className="muted">房 {e.room.label}　</span>}
          {seatText(e) || (isAnonymous(p) ? <span className="muted">不記名</span> : seating ? <span className="muted">未安排座位</span> : null)}
          {p.tags.map((t) => (
            <SoftTag key={t}>{t}</SoftTag>
          ))}
          {souvenir && (
            <SoftTag tone="warn">
              <Gift size={12} /> 已領
            </SoftTag>
          )}
        </span>
      </span>
      <span className="guest-row-end">
        {trailing ?? (p.checkedInAt && p.attendance !== 'not_arrived' ? <span className="muted">{formatTime(p.checkedInAt)}</span> : null)}
      </span>
    </>
  )
  const cls = cx('guest-row', selected && 'selected', p.status === 'cancelled' && 'cancelled')
  if (!onMarkClick || p.status === 'cancelled')
    return (
      <button type="button" className={cls} onClick={onClick}>
        {mark ? <span className="status-mark">{mark}</span> : <StatusMark e={e} />}
        {row}
      </button>
    )
  return (
    <div className={cx(cls, 'split')}>
      <button
        type="button"
        className="mark-btn"
        onClick={onMarkClick}
        aria-label={p.attendance === 'not_arrived' ? `${names(p).primary} 簽到` : `${names(p).primary} 取消簽到`}
      >
        <StatusMark e={e} />
      </button>
      <button type="button" className="guest-row-btn" onClick={onClick}>
        {row}
      </button>
    </div>
  )
}
