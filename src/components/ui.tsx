import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Cloud, CloudOff, Search, Star, X } from 'lucide-react'
import type { EventRec, Mode } from '../db/types'
import type { Stats } from '../lib/hooks'
import { useOnline } from '../lib/hooks'
import { cx, dateParts, endDateOf, formatDate, formatDateRange } from '../lib/util'
import { MODE_META, ModeIcon } from './icons'
import { StatusIcon } from './StatusIcon'

// ---------- 文字 ----------

export const Bi = ({ zh, en, className }: { zh: ReactNode; en?: ReactNode; className?: string }) => (
  <span className={cx('bi', className)}>
    <span className="bi-zh">{zh}</span>
    {en && <span className="bi-en">{en}</span>}
  </span>
)

export const SectionTitle = ({ zh, en, action }: { zh: string; en?: string; action?: ReactNode }) => (
  <div className="section-title">
    <h2>
      {zh}
      {en && <small>{en}</small>}
    </h2>
    {action}
  </div>
)

export const PageHeader = ({
  zh,
  en,
  back,
  actions,
}: {
  zh: string
  en?: string
  back?: string | true
  actions?: ReactNode
}) => {
  const nav = useNavigate()
  return (
    <header className="page-header">
      {back && (
        <button className="icon-btn" aria-label="返回" onClick={() => (back === true ? nav(-1) : nav(back))}>
          <ChevronLeft size={22} />
        </button>
      )}
      <h1>
        {zh}
        {en && <small>{en}</small>}
      </h1>
      <div className="page-header-actions">{actions}</div>
    </header>
  )
}

// ---------- 卡片 ----------

export const ModeCard = ({ mode, count }: { mode: Mode; count?: number }) => {
  const m = MODE_META[mode]
  return (
    <Link to={`/events?mode=${mode}`} className="mode-card" data-mode={mode}>
      <span className="mode-card-icon">
        <ModeIcon mode={mode} size={28} />
      </span>
      <Bi zh={m.zh} en={m.en} />
      {count !== undefined && <span className="mode-card-count">{count} 個活動</span>}
    </Link>
  )
}

export const ModeChip = ({ mode }: { mode: Mode }) => (
  <span className="mode-chip" data-mode={mode}>
    <ModeIcon mode={mode} size={14} />
    {MODE_META[mode].zh.replace('模式', '')}
  </span>
)

export const EventCard = ({ event, stats }: { event: EventRec; stats?: Stats }) => {
  const m = MODE_META[event.mode]
  return (
    <Link to={`/e/${event.id}`} className="event-card" data-mode={event.mode}>
      <div className="event-card-top">
        <span className="event-card-icon">
          <ModeIcon mode={event.mode} size={22} />
        </span>
        <Bi zh={m.zh.replace('模式', '')} en={m.en.replace(' Mode', '')} className="event-card-mode" />
      </div>
      <h3>{event.name}</h3>
      <p className="muted">
        {multiDay(event) ? formatDateRange(event) : '今日'} · {event.startTime} · {event.venue}
      </p>
      {stats && (
        <>
          {event.mode !== 'gift' ? <ProgressBar value={stats.arrived} max={stats.total} /> : stats.stock ? <ProgressBar value={stats.given ?? 0} max={stats.stock} /> : null}
          <div className="event-card-foot">
            {event.mode === 'gift' ? (
              stats.stock ? (
                <span>
                  <strong>{stats.given ?? 0}</strong> / {stats.stock} 已派
                </span>
              ) : (
                <span>
                  <strong>{stats.given ?? 0}</strong> 已派（不限數量）
                </span>
              )
            ) : (
              <span>
                <strong>{stats.arrived}</strong> / {stats.total} 已到
              </span>
            )}
            <span className="btn btn-sm btn-mode">繼續 →</span>
          </div>
        </>
      )}
    </Link>
  )
}

const multiDay = (e: EventRec) => endDateOf(e) !== e.date

export const DateBlock = ({ date }: { date: string }) => {
  const { month, day } = dateParts(date)
  return (
    <span className="date-block">
      <small>{month}</small>
      <strong>{day}</strong>
    </span>
  )
}

export const EventRow = ({ event, stats, trailing }: { event: EventRec; stats?: Stats; trailing?: ReactNode }) => (
  <div className="event-row" data-mode={event.mode}>
    <Link to={`/e/${event.id}`} className="event-row-link">
      <DateBlock date={event.date} />
      <span className="event-row-icon">
        <ModeIcon mode={event.mode} size={18} />
      </span>
      <span className="event-row-main">
        <strong>{event.name}</strong>
        <span className="muted">
          {multiDay(event) && `至 ${formatDate(endDateOf(event))} · `}
          {event.startTime} · {event.venue}
          {stats && event.mode === 'gift' ? ` · ${stats.given ?? 0}${stats.stock ? `/${stats.stock}` : ''} 已派` : stats && stats.total > 0 && ` · ${stats.arrived}/${stats.total}`}
        </span>
      </span>
    </Link>
    {trailing}
  </div>
)

// ---------- 統計 ----------

type Tone = 'ok' | 'bad' | 'warn' | 'info' | 'mode' | 'plain'

export const MetricCard = ({
  zh,
  en,
  value,
  sub,
  tone = 'plain',
  icon,
  to,
}: {
  zh: string
  en: string
  value: ReactNode
  sub?: ReactNode
  tone?: Tone
  icon?: ReactNode
  to?: string // 有連結時整張卡可按，打開對應名單
}) => {
  const body = (
    <>
      <div className="metric-label">
        {icon}
        <Bi zh={zh} en={en} />
        {to && <ChevronRight size={16} className="metric-go" />}
      </div>
      <div className="metric-value">{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </>
  )
  return to ? (
    <Link to={to} className={cx('metric', 'metric-link', `tone-${tone}`)}>
      {body}
    </Link>
  ) : (
    <div className={cx('metric', `tone-${tone}`)}>{body}</div>
  )
}

export const ProgressBar = ({ value, max, tone = 'mode' }: { value: number; max: number; tone?: Tone }) => (
  <div className={cx('progress', `tone-${tone}`)} role="progressbar" aria-valuenow={value} aria-valuemax={max}>
    <span style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%` }} />
  </div>
)

export const DonutChart = ({ value, max, size = 148, label }: { value: number; max: number; size?: number; label?: ReactNode }) => {
  const r = 42
  const c = 2 * Math.PI * r
  const frac = max ? Math.min(1, value / max) : 0
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="10" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="var(--mode-solid)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`}
          transform="rotate(-90 50 50)"
          style={{ transition: 'stroke-dasharray 300ms ease' }}
        />
      </svg>
      <div className="donut-label">{label}</div>
    </div>
  )
}

export const MiniBarChart = ({ buckets }: { buckets: { label: string; value: number }[] }) => {
  const max = Math.max(1, ...buckets.map((b) => b.value))
  return (
    <div className="bars">
      {buckets.map((b, i) => (
        <div key={i} className="bars-col" title={`${b.label} · ${b.value}`}>
          <span className="bars-val">{b.value || ''}</span>
          <span className="bars-bar" style={{ height: `${(b.value / max) * 100}%` }} />
          <span className="bars-label">{b.label}</span>
        </div>
      ))}
    </div>
  )
}

// ---------- 標籤 ----------

export const StatusBadge = ({ status }: { status: 'arrived' | 'partial' | 'not_arrived' | 'cancelled' }) => {
  const map = {
    arrived: ['ok', '已到'],
    partial: ['warn', '部分'],
    not_arrived: ['plain', '未到'],
    cancelled: ['bad', '已取消'],
  } as const
  const [tone, text] = map[status]
  return (
    <span className={cx('badge', `tone-${tone}`)}>
      <StatusIcon kind={status} size={14} /> {text}
    </span>
  )
}

export const VipBadge = () => (
  <span className="vip-badge">
    <Star size={12} fill="currentColor" /> VIP
  </span>
)

export const SoftTag = ({ children, tone }: { children: ReactNode; tone?: Tone }) => (
  <span className={cx('soft-tag', tone && `tone-${tone}`)}>{children}</span>
)

export const FilterChip = ({
  active,
  onClick,
  children,
  count,
}: {
  active?: boolean
  onClick?: () => void
  children: ReactNode
  count?: number
}) => (
  <button type="button" className={cx('chip', active && 'active')} onClick={onClick} aria-pressed={active}>
    {children}
    {count !== undefined && <span className="chip-count">{count}</span>}
  </button>
)

// ---------- 輸入 ----------

export const SearchBar = ({
  value,
  onChange,
  placeholder,
  large,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  large?: boolean
  autoFocus?: boolean
}) => (
  <label className={cx('search', large && 'search-lg')}>
    <Search size={large ? 22 : 18} />
    <input
      type="search"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      autoFocus={autoFocus}
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="search"
    />
    {value && (
      <button type="button" className="search-clear" aria-label="清除" onClick={() => onChange('')}>
        <X size={16} />
      </button>
    )}
  </label>
)

export const EmptyState = ({ art, zh, en, action }: { art: ReactNode; zh: string; en: string; action?: ReactNode }) => (
  <div className="empty">
    <div className="empty-art">{art}</div>
    <p className="empty-zh">{zh}</p>
    <p className="empty-en">{en}</p>
    {action}
  </div>
)

// ---------- 同步狀態 ----------

export const SyncIndicator = () => {
  const online = useOnline()
  return online ? (
    <span className="sync ok" title="資料已保存在本機">
      <Cloud size={16} /> <span>已保存</span>
    </span>
  ) : (
    <span className="sync off" title="離線中，資料照常保存在本機">
      <CloudOff size={16} /> <span>離線</span>
    </span>
  )
}

// ---------- 底部彈出視窗 ----------

export const Sheet = ({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}) => {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{title}</h3>
          <button className="icon-btn" aria-label="關閉" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  )
}

// 重要操作的確認視窗；requireText 需要輸入指定文字才可確認（防誤刪）
export const ConfirmSheet = ({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  danger,
  requireText,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: ReactNode
  confirmText: string
  danger?: boolean
  requireText?: string
}) => {
  const [typed, setTyped] = useState('')
  useEffect(() => setTyped(''), [open])
  const ok = !requireText || typed.trim() === requireText
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            className={cx('btn', danger ? 'btn-danger' : 'btn-primary')}
            disabled={!ok}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmText}
          </button>
        </>
      }
    >
      <div className="confirm-msg">{message}</div>
      {requireText && (
        <label className="field">
          <span>請輸入「{requireText}」確認</span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </label>
      )}
    </Sheet>
  )
}

// ---------- 小提示 Toast ----------

let toastMsg: { id: number; text: string } | null = null
const toastListeners = new Set<() => void>()
export const toast = (text: string) => {
  toastMsg = { id: Date.now(), text }
  toastListeners.forEach((l) => l())
  const id = toastMsg.id
  setTimeout(() => {
    if (toastMsg?.id === id) {
      toastMsg = null
      toastListeners.forEach((l) => l())
    }
  }, 2200)
}
export const ToastHost = () => {
  const msg = useSyncExternalStore(
    (cb) => {
      toastListeners.add(cb)
      return () => toastListeners.delete(cb)
    },
    () => toastMsg,
  )
  return msg ? (
    <div className="toast" role="status" key={msg.id}>
      {msg.text}
    </div>
  ) : null
}
