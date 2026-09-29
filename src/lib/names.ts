import type { Participant } from '../db/types'
import { getSettings } from './settings'

// 姓名顯示次序：中文介面預設中文名先、英文名配後；英文介面相反。可在設定更改。
type Named = Pick<Participant, 'name' | 'englishName'>

export const zhFirst = () => {
  const o = getSettings().nameOrder
  return o === 'auto' ? true : o === 'zh' // 目前只有繁體中文介面；加入英文介面後 auto 會跟隨語言
}

export const names = (p: Named) => {
  const [a, b] = zhFirst() ? [p.name, p.englishName] : [p.englishName, p.name]
  const primary = a || b || ''
  const secondary = a && b ? b : ''
  return { primary, secondary, full: [primary, secondary].filter(Boolean).join(' ') }
}

export const nameOf = (p: Named) => names(p).primary
