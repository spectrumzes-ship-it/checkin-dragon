import { getSettings } from './settings'

// 提示音參考日本車站的聲音（全部自行合成的原創音色及旋律，不是錄音）：
//   有效 = 自動改札機「嗶」一聲；手動 = 「嗶嗶」兩聲；重複 = 三聲短促「嗶」；
//   無效 = 改札機攔截時的「叮咚」雙音鐘聲；確認出發 = 月台發車旋律風格的短鐘聲
// 震動：iPhone／iPad 瀏覽器不支援震動，會自動略過
let ctx: AudioContext | null = null
const audio = () => (ctx ??= new AudioContext())

// 改札機式「嗶」：高音、短、乾脆（正弦波加少許三角波，令聲音在嘈雜環境也清楚）
const pip = (times: number, freq = 2093, len = 0.07, gap = 0.05, vol = 0.16) => {
  try {
    const a = audio()
    let t = a.currentTime + 0.01
    for (let n = 0; n < times; n++) {
      for (const [type, mul, g] of [['sine', 1, vol], ['triangle', 1, vol * 0.35]] as const) {
        const osc = a.createOscillator()
        const gain = a.createGain()
        osc.type = type
        osc.frequency.value = freq * mul
        gain.gain.setValueAtTime(0.0001, t)
        gain.gain.exponentialRampToValueAtTime(g, t + 0.004)
        gain.gain.setValueAtTime(g, t + len * 0.7)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + len)
        osc.connect(gain).connect(a.destination)
        osc.start(t)
        osc.stop(t + len + 0.02)
      }
      t += len + gap
    }
  } catch {
    /* 無聲音支援 */
  }
}

// 鐘聲：基音加兩個泛音，敲擊後慢慢消失（「叮咚」及發車旋律用）
const bells = (notes: [freq: number, at: number, len: number][], vol = 0.14) => {
  try {
    const a = audio()
    const t0 = a.currentTime + 0.01
    for (const [f, at, len] of notes) {
      const t = t0 + at
      for (const [mul, g] of [[1, vol], [2, vol * 0.28], [3, vol * 0.1]]) {
        const osc = a.createOscillator()
        const gain = a.createGain()
        osc.type = 'sine'
        osc.frequency.value = f * mul
        gain.gain.setValueAtTime(0.0001, t)
        gain.gain.exponentialRampToValueAtTime(g, t + 0.006)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + len / mul)
        osc.connect(gain).connect(a.destination)
        osc.start(t)
        osc.stop(t + len + 0.05)
      }
    }
  } catch {
    /* 無聲音支援 */
  }
}

// 原創的發車旋律風格短句（五聲音階，約 2 秒）
const N = { G5: 784, A5: 880, C6: 1047, D6: 1175, E6: 1319, G6: 1568, A6: 1760, C7: 2093 }
const DEPART: [number, number, number][] = [
  [N.G5, 0, 0.6], [N.C6, 0.18, 0.6], [N.E6, 0.36, 0.6], [N.G6, 0.54, 0.7],
  [N.E6, 0.78, 0.6], [N.A6, 0.96, 0.7], [N.G6, 1.14, 0.7], [N.C7, 1.38, 1.2],
]

const vibrate = (pattern: number | number[]) => {
  if (getSettings().vibration && 'vibrate' in navigator) navigator.vibrate(pattern)
}

export type Feedback = 'valid' | 'invalid' | 'duplicate' | 'manual' | 'tap' | 'depart'

export const feedback = (kind: Feedback) => {
  const sound = getSettings().sound
  switch (kind) {
    case 'valid': // 改札機「嗶」
      if (sound) pip(1)
      vibrate(60)
      break
    case 'manual': // 「嗶嗶」
      if (sound) pip(2, 2093, 0.06, 0.05)
      vibrate([50, 40, 50])
      break
    case 'duplicate': // 三聲短促「嗶」：已處理過，請留意
      if (sound) pip(3, 1661, 0.05, 0.045)
      vibrate([80, 60, 80])
      break
    case 'invalid': // 改札機攔截的「叮咚」
      if (sound) bells([[1319, 0, 0.55], [1047, 0.32, 0.8]], 0.16)
      vibrate([180, 80, 180])
      break
    case 'tap': // 取消等輕觸：很輕的一聲
      if (sound) pip(1, 1568, 0.04, 0, 0.08)
      vibrate(20)
      break
    case 'depart': // 確認出發：發車旋律風格
      if (sound) bells(DEPART, 0.12)
      vibrate([60, 60, 60, 60, 200])
      break
  }
}
