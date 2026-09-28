import { getSettings } from './settings'

// 三種不同的柔和提示音 + 震動（iPhone／iPad 瀏覽器不支援震動，會自動略過）
let ctx: AudioContext | null = null

const tone = (freqs: number[], dur = 0.12, gap = 0.04, type: OscillatorType = 'sine') => {
  try {
    ctx ??= new AudioContext()
    let t = ctx.currentTime
    for (const f of freqs) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = type
      osc.frequency.value = f
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + dur + 0.02)
      t += dur + gap
    }
  } catch {
    /* 無聲音支援 */
  }
}

const vibrate = (pattern: number | number[]) => {
  if (getSettings().vibration && 'vibrate' in navigator) navigator.vibrate(pattern)
}

export type Feedback = 'valid' | 'invalid' | 'duplicate' | 'manual' | 'tap'

export const feedback = (kind: Feedback) => {
  const sound = getSettings().sound
  switch (kind) {
    case 'valid':
      if (sound) tone([880, 1318], 0.1)
      vibrate(60)
      break
    case 'invalid':
      if (sound) tone([330, 262], 0.18, 0.06, 'triangle')
      vibrate([180, 80, 180])
      break
    case 'duplicate':
      if (sound) tone([660, 660], 0.09, 0.08, 'triangle')
      vibrate([80, 60, 80])
      break
    case 'manual':
      if (sound) tone([740, 988], 0.1)
      vibrate(60)
      break
    case 'tap':
      if (sound) tone([1046], 0.05)
      vibrate(20)
      break
  }
}
