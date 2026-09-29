import { Circle, CircleAlert, CircleCheck, CircleDashed, CircleX } from 'lucide-react'

// 簽到狀態圖示：一律用圓圈圖案（不用文字符號，各裝置外觀一致）
//   已到 = 實心圓圈打勾；未到 = 空心圓圈；部分到達 = 虛線圓圈；已取消 = 圓圈打叉；重複／注意 = 圓圈感嘆號
export type StatusKind = 'arrived' | 'partial' | 'not_arrived' | 'cancelled' | 'warn'

export const StatusIcon = ({ kind, size = 32 }: { kind: StatusKind; size?: number }) => {
  switch (kind) {
    case 'arrived':
      return <CircleCheck size={size} strokeWidth={2} className="si si-ok" fill="currentColor" aria-label="已到" />
    case 'partial':
      return <CircleDashed size={size} strokeWidth={2} className="si si-warn" aria-label="部分到達" />
    case 'cancelled':
      return <CircleX size={size} strokeWidth={2} className="si si-bad" aria-label="已取消" />
    case 'warn':
      return <CircleAlert size={size} strokeWidth={2} className="si si-warn" aria-label="注意" />
    default:
      return <Circle size={size} strokeWidth={1.75} className="si si-plain" aria-label="未到" />
  }
}
