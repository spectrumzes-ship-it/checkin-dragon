import { Bus, Gift, Ticket, UtensilsCrossed, type LucideIcon, type LucideProps } from 'lucide-react'
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
    zh: '旅遊巴士模式',
    en: 'Tour Bus Mode',
    icon: Bus,
    types: ['Tour', 'School Trip', 'Company Trip', 'Shuttle'],
  },
  gift: {
    zh: '禮品領取模式',
    en: 'Gift Collection Mode',
    icon: Gift,
    types: ['Gift Counter', 'Redemption', 'Promotion'],
  },
}

// 活動類型：資料內保存英文代號，畫面顯示繁體中文
export const TYPE_LABEL: Record<string, string> = {
  Concert: '音樂會',
  Performance: '表演',
  Exhibition: '展覽',
  Premiere: '首映',
  'VIP Event': '貴賓活動',
  'Company Event': '公司活動',
  'Launch Event': '發佈會',
  Wedding: '婚宴',
  'Annual Dinner': '周年晚宴',
  Dinner: '晚宴',
  Gala: '慶典晚會',
  'Award Ceremony': '頒獎典禮',
  'VIP Dinner': '貴賓晚宴',
  Tour: '旅行團',
  'School Trip': '學校旅行',
  'Company Trip': '公司旅行',
  Shuttle: '接駁巴士',
  'Gift Counter': '禮品發放點',
  Redemption: '換領',
  Promotion: '推廣活動',
}
export const typeLabel = (t: string) => TYPE_LABEL[t] ?? t

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
