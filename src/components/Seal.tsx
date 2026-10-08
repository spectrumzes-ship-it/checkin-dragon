import { Check } from 'lucide-react'
import { useSettings } from '../lib/settings'
import { cx } from '../lib/util'

// 「已到」的記號：中文介面是紅色「到」印章；英文介面改用西方常用的綠色勾號
// text：印章上的字（簽到／點名「到」、紀念品「領」）
export default function Seal({ className, text = '到' }: { className: string; text?: string }) {
  const en = useSettings().language === 'en'
  return (
    <span className={cx(className, en && 'seal-en')} aria-hidden="true">
      {en ? <Check size={18} strokeWidth={3.2} /> : text}
    </span>
  )
}
