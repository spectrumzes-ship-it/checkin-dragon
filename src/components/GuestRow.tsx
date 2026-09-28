import type { ReactNode } from 'react'
import { Gift } from 'lucide-react'
import type { GuestEntry } from '../lib/search'
import { cx, formatTime } from '../lib/util'
import { SoftTag, VipBadge } from './ui'

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
  if (p.status === 'cancelled')
    return (
      <span className="status-mark tone-bad" aria-label="已取消">
        ×
      </span>
    )
  if (p.attendance === 'arrived')
    return (
      <span className="status-mark tone-ok" aria-label="已到">
        ✓
      </span>
    )
  if (p.attendance === 'partial')
    return (
      <span className="status-mark tone-warn" aria-label="部分到達">
        ◐
      </span>
    )
  return (
    <span className="status-mark tone-plain" aria-label="未到">
      ○
    </span>
  )
}

export const GuestRow = ({
  e,
  onClick,
  selected,
  souvenir,
  trailing,
}: {
  e: GuestEntry
  onClick?: () => void
  selected?: boolean
  souvenir?: boolean
  trailing?: ReactNode
}) => {
  const p = e.p
  return (
    <button type="button" className={cx('guest-row', selected && 'selected', p.status === 'cancelled' && 'cancelled')} onClick={onClick}>
      <StatusMark e={e} />
      <span className="guest-row-main">
        <span className="guest-row-name">
          <strong>{p.englishName || p.name}</strong>
          {p.englishName && p.name && <span className="muted">{p.name}</span>}
          {p.vip && <VipBadge />}
          {p.guestCount > 1 && <SoftTag>{p.attendance === 'partial' ? `${p.arrivedCount}/` : ''}{p.guestCount} 位</SoftTag>}
        </span>
        <span className="guest-row-sub">
          {seatText(e) || <span className="muted">未安排座位</span>}
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
    </button>
  )
}
