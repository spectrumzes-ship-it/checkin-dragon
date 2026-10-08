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
  language: 'zh-Hant' | 'zh-Hans' | 'en' // 介面語言（第 5 階段加入切換）；英文版的「已到」用綠色勾號，不用「到」印章
  rollView: 'auto' | 'list' | 'seats' // 巴士點名：座位表（預設，auto 亦等於座位表）或名單
  specialNotes: string[] // 「特別需要」的選項（可自訂）
  giftGroups: string[] // 禮物領取組別（可自訂；紀念品可設定只限某組別領取）
}

const KEY = 'ckd-settings'

const defaults = (): Settings => ({
  theme: 'light',
  autoReturn: 3000,
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
  language: 'zh-Hant',
  rollView: 'auto',
  specialNotes: ['輪椅', '素食', '需協助', '傳譯'],
  giftGroups: [],
})

const load = (): Settings => {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = { ...defaults(), ...JSON.parse(raw) }
      // 2026-10-08：預設顯示時間改為 3 秒；仍是舊預設（1.5 或 2 秒）的裝置一併更新（只做一次）
      if (!localStorage.getItem('ckd-ar3')) {
        if (s.autoReturn === 1500 || s.autoReturn === 2000) {
          s.autoReturn = 3000
          localStorage.setItem(KEY, JSON.stringify(s))
        }
        localStorage.setItem('ckd-ar3', '1')
      }
      return s
    }
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
