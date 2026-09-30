import { useSyncExternalStore } from 'react'
import { uid } from './util'

// 裝置設定：保存在這部裝置的瀏覽器內。
export interface Settings {
  theme: 'light' | 'dark' | 'system'
  autoReturn: number // 毫秒；0 = 關閉
  nameOrder: 'auto' | 'zh' | 'en'
  sound: boolean
  vibration: boolean
  continuousScan: boolean
  defaultScanMode: 'qr' | 'text' | 'last'
  lastScanMode: 'qr' | 'text' | 'manual'
  operator: string
  deviceName: string
  deviceId: string
  currentEventId: string | null
  specialNotes: string[] // 「特別需要」的選項（可自訂）
  giftGroups: string[] // 禮物領取組別（可自訂；紀念品可設定只限某組別領取）
}

const KEY = 'ckd-settings'

const defaults = (): Settings => ({
  theme: 'light',
  autoReturn: 1500,
  nameOrder: 'auto',
  sound: true,
  vibration: true,
  continuousScan: true,
  defaultScanMode: 'qr',
  lastScanMode: 'qr',
  operator: '管理員',
  deviceName: '我的裝置',
  deviceId: uid(),
  currentEventId: null,
  specialNotes: ['輪椅', '素食', '需協助', '傳譯'],
  giftGroups: [],
})

const load = (): Settings => {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...defaults(), ...JSON.parse(raw) }
  } catch {
    /* 私密瀏覽等情況：使用預設值 */
  }
  const s = defaults()
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
  return s
}

let state = load()
const listeners = new Set<() => void>()

export const getSettings = () => state

export const setSettings = (patch: Partial<Settings>) => {
  state = { ...state, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}

export const useSettings = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
