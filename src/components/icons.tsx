import { Bus, Ticket, UtensilsCrossed, type LucideIcon, type LucideProps } from 'lucide-react'
import type { Mode } from '../db/types'

export const MODE_META: Record<Mode, { zh: string; en: string; icon: LucideIcon; types: string[] }> = {
  event: {
    zh: '活動模式',
    en: 'Event Mode',
    icon: Ticket,
    types: ['Concert', 'Performance', 'Exhibition', 'Premiere', 'VIP Event', 'Company Event', 'Launch Event'],
  },
  banquet: {
    zh: '宴會模式',
    en: 'Banquet Mode',
    icon: UtensilsCrossed,
    types: ['Wedding', 'Annual Dinner', 'Dinner', 'Gala', 'Award Ceremony', 'VIP Dinner'],
  },
  bus: {
    zh: '巴士模式',
    en: 'Bus Mode',
    icon: Bus,
    types: ['Tour', 'School Trip', 'Company Trip', 'Shuttle'],
  },
}

export const ModeIcon = ({ mode, ...props }: { mode: Mode } & LucideProps) => {
  const Icon = MODE_META[mode].icon
  return <Icon strokeWidth={1.9} {...props} />
}

// 自繪圓桌圖示（Lucide 沒有合適的圓桌）
export const TableIcon = ({ size = 24, strokeWidth = 1.9 }: { size?: number; strokeWidth?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round">
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="3.5" r="1.3" />
    <circle cx="12" cy="20.5" r="1.3" />
    <circle cx="3.5" cy="12" r="1.3" />
    <circle cx="20.5" cy="12" r="1.3" />
    <circle cx="6" cy="6" r="1.3" />
    <circle cx="18" cy="18" r="1.3" />
    <circle cx="18" cy="6" r="1.3" />
    <circle cx="6" cy="18" r="1.3" />
  </svg>
)
