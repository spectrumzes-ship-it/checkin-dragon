import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { useSettings } from './lib/settings'
import { AppShell } from './components/AppShell'
import { EmptyState, PageHeader } from './components/ui'
import Home from './pages/Home'
import EventList from './pages/EventList'
import EventForm from './pages/EventForm'
import EventLayout from './pages/EventLayout'
import Dashboard from './pages/Dashboard'
import Guests from './pages/Guests'
import GuestForm from './pages/GuestForm'
import Scan from './pages/Scan'
import Tables, { TableDetail } from './pages/Tables'
import RollCall, { BusSeats, RollCallSession } from './pages/RollCall'
import Souvenirs from './pages/Souvenirs'
import SouvenirRecords from './pages/SouvenirRecords'
import Rooms from './pages/Rooms'
import TestKit from './pages/TestKit'
import Print from './pages/Print'
import Logs from './pages/Logs'
import Settings from './pages/Settings'

const Reports = () => (
  <div className="page">
    <PageHeader zh="報告" en="Reports" />
    <EmptyState art={<FileText size={64} strokeWidth={1.4} />} zh="報告及匯出將在第 4 階段加入。" en="Reports coming in Phase 4." />
  </div>
)

const useTheme = () => {
  const { theme, skin } = useSettings()
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
  }, [theme])
  // 介面主題：和色是基本樣式（不加標記）；其他主題加 data-skin（soft 柔和〔預設〕、bear 熊本熊、kiosk 車站售票機）
  useEffect(() => {
    const root = document.documentElement
    if (skin && skin !== 'wairo') root.setAttribute('data-skin', skin)
    else root.removeAttribute('data-skin')
  }, [skin])
}

export default function App() {
  useTheme()
  // 更改姓名顯示次序後，重新繪畫整個畫面
  const { nameOrder } = useSettings()
  return (
    <HashRouter>
      <Routes key={nameOrder}>
        <Route path="/e/:id/scan" element={<Scan />} />
        <Route path="/e/:id/print" element={<Print />} />
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="events" element={<EventList />} />
          <Route path="events/new" element={<EventForm />} />
          <Route path="reports" element={<Reports />} />
          <Route path="settings" element={<Settings />} />
          <Route path="test-kit" element={<TestKit />} />
          <Route path="e/:id/edit" element={<EventForm />} />
          <Route path="e/:id" element={<EventLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="guests" element={<Guests />} />
            <Route path="guests/new" element={<GuestForm />} />
            <Route path="guests/:gid" element={<Guests />} />
            <Route path="guests/:gid/edit" element={<GuestForm />} />
            <Route path="tables" element={<Tables />} />
            <Route path="tables/plan" element={<Navigate to={{ pathname: "..", search: "?view=plan" }} relative="path" replace />} />
            <Route path="tables/:tid" element={<TableDetail />} />
            <Route path="rollcall" element={<RollCall />} />
            <Route path="rollcall/:sid" element={<RollCallSession />} />
            <Route path="seats" element={<BusSeats />} />
            <Route path="rooms" element={<Rooms />} />
            <Route path="souvenirs" element={<Souvenirs />} />
            <Route path="souvenirs/records" element={<SouvenirRecords />} />
            <Route path="logs" element={<Logs />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
