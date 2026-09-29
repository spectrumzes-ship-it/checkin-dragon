// 文字掃描框：找出主要文字範圍，並令框平穩移動（純計算，方便自動測試）

export interface TextBox {
  x0: number
  y0: number
  x1: number
  y1: number
  conf?: number
}

// 只取「主要的一組文字」（例如名牌本身）：以最大最清楚的一行為中心，加入附近的行；背景零碎字不計
export const mainTextCluster = (boxes: TextBox[]): TextBox | null => {
  if (!boxes.length) return null
  const h = (b: TextBox) => b.y1 - b.y0
  const anchor = [...boxes].sort((a, b) => h(b) * (b.conf ?? 50) - h(a) * (a.conf ?? 50))[0]
  const c = { x0: anchor.x0, y0: anchor.y0, x1: anchor.x1, y1: anchor.y1 }
  const gap = h(anchor) * 1.6
  let grew = true
  const left = boxes.filter((b) => b !== anchor)
  while (grew) {
    grew = false
    for (let i = left.length - 1; i >= 0; i--) {
      const b = left[i]
      const nearY = b.y0 <= c.y1 + gap && b.y1 >= c.y0 - gap
      const nearX = b.x0 <= c.x1 + (c.x1 - c.x0) * 0.5 && b.x1 >= c.x0 - (c.x1 - c.x0) * 0.5
      const similarSize = h(b) >= h(anchor) * 0.4
      if (nearY && nearX && similarSize) {
        c.x0 = Math.min(c.x0, b.x0)
        c.y0 = Math.min(c.y0, b.y0)
        c.x1 = Math.max(c.x1, b.x1)
        c.y1 = Math.max(c.y1, b.y1)
        left.splice(i, 1)
        grew = true
      }
    }
  }
  return c
}

// 平穩移動：位置只有明顯改變才移動，並與上一次位置取中間值，避免框不停跳動
export const smoothBox = (prev: TextBox | null, next: TextBox): TextBox => {
  if (!prev) return next
  const iw = Math.max(0, Math.min(prev.x1, next.x1) - Math.max(prev.x0, next.x0))
  const ih = Math.max(0, Math.min(prev.y1, next.y1) - Math.max(prev.y0, next.y0))
  const area = (b: TextBox) => (b.x1 - b.x0) * (b.y1 - b.y0)
  const iou = (iw * ih) / (area(prev) + area(next) - iw * ih || 1)
  if (iou < 0.3) return next // 名牌已移到別處：直接跳過去
  const tol = Math.max(prev.x1 - prev.x0, prev.y1 - prev.y0) * 0.06
  const small = Math.abs(prev.x0 - next.x0) < tol && Math.abs(prev.y0 - next.y0) < tol && Math.abs(prev.x1 - next.x1) < tol && Math.abs(prev.y1 - next.y1) < tol
  if (small) return prev // 細微差異（手震、辨識誤差）：不移動
  const mix = (a: number, b: number) => a * 0.5 + b * 0.5
  return { x0: mix(prev.x0, next.x0), y0: mix(prev.y0, next.y0), x1: mix(prev.x1, next.x1), y1: mix(prev.y1, next.y1) }
}
