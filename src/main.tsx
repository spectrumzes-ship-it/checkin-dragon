import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
// 點名頁的數字（看板、進度、出發時間）用窄身字體，較易一眼看清
import '@fontsource/barlow-condensed/600.css'
import '@fontsource/barlow-condensed/700.css'
import './styles/tokens.css'
import './styles/app.css'
import App from './App'
import { ensureSeeded } from './db/seed'

// 要求瀏覽器長期保存資料（減少被系統自動清除的機會）
navigator.storage?.persist?.().catch(() => {})

ensureSeeded().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
