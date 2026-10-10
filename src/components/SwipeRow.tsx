import { useRef, useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { cx } from '../lib/util'

// 可向左拉出「刪除」的一行（活動、點名、嘉賓名單共用）；選擇模式下點一下 = 剔選
// 只有橫向拉動才會打開，直向捲動不受影響；拉動或已打開時不會觸發原本的點擊
export default function SwipeRow({
  children,
  open,
  onOpen,
  onDelete,
  label = '刪除',
  selecting = false,
  checked = false,
  onToggle,
}: {
  children: ReactNode
  open: boolean
  onOpen: (o: boolean) => void
  onDelete: () => void
  label?: string
  selecting?: boolean
  checked?: boolean
  onToggle?: () => void
}) {
  const W = 88
  const start = useRef<{ x: number; y: number; base: number; moved: boolean } | null>(null)
  const swallow = useRef(false) // 拉動後放手產生的點擊要吞掉
  const [dx, setDx] = useState<number | null>(null)
  const offset = selecting ? 0 : dx ?? (open ? -W : 0)
  return (
    // 未拉開時隱藏刪除按鈕（半透明主題下不會透出來）
    <div className={cx('swipe-row', offset !== 0 && 'swiping')}>
      {!selecting && (
        <button className="swipe-del" onClick={onDelete} tabIndex={open ? 0 : -1} aria-hidden={!open}>
          <Trash2 size={18} /> {label}
        </button>
      )}
      <div
        className={cx('swipe-front', selecting && 'selecting')}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined, transition: dx !== null ? 'none' : undefined }}
        onPointerDown={(e) => {
          swallow.current = false // 上一次拉動沒有產生點擊時，不要吞掉這一次
          if (selecting || e.button > 0) return
          start.current = { x: e.clientX, y: e.clientY, base: open ? -W : 0, moved: false }
        }}
        onPointerMove={(e) => {
          const s = start.current
          if (!s) return
          const mx = e.clientX - s.x
          if (!s.moved && Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(e.clientY - s.y) * 1.5) {
            s.moved = true
            e.currentTarget.setPointerCapture?.(e.pointerId)
          }
          if (s.moved) setDx(Math.max(-W - 24, Math.min(0, s.base + mx)))
        }}
        onPointerUp={() => {
          const s = start.current
          start.current = null
          if (s?.moved) {
            swallow.current = true
            setTimeout(() => (swallow.current = false), 400) // 只吞掉放手後即時產生的點擊
            onOpen((dx ?? 0) < -W / 2)
          }
          setDx(null)
        }}
        onPointerCancel={() => ((start.current = null), setDx(null))}
        onClickCapture={(e) => {
          if (swallow.current || selecting || open) {
            e.preventDefault()
            e.stopPropagation()
            if (!swallow.current) {
              if (selecting) onToggle?.()
              else onOpen(false)
            }
            swallow.current = false
          }
        }}
      >
        {selecting && <span className={cx('swipe-check', checked && 'on')} role="checkbox" aria-checked={checked} />}
        <div className="swipe-body">{children}</div>
      </div>
    </div>
  )
}
