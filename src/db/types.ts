// 所有資料的形狀。三種模式共用同一套資料結構。

export type Mode = 'event' | 'banquet' | 'bus'
export type EventStatus = 'active' | 'completed' | 'archived'
export type ScanMethod = 'QR' | 'OCR' | 'MANUAL' | 'SEARCH'

export interface BusConfig {
  label: string
  capacity: number
}

export interface EventRec {
  id: string
  name: string
  mode: Mode
  type: string
  date: string // YYYY-MM-DD
  startTime: string // HH:mm
  endTime: string
  venue: string
  notes: string
  status: EventStatus
  code: string
  modeConfig: {
    tableCount?: number
    seatsPerTable?: number
    buses?: BusConfig[]
    dinnerTables?: number
    dinnerSeats?: number
    anonymous?: boolean // 不記名門票：名單以票號顯示
  }
  createdAt: number
  updatedAt: number
}

export type Attendance = 'not_arrived' | 'partial' | 'arrived'

export interface Participant {
  id: string
  eventId: string
  name: string
  englishName: string
  memberId: string
  phone: string
  company: string
  vip: boolean
  guestCount: number
  tags: string[]
  dietary: string
  remarks: string
  status: 'active' | 'cancelled'
  attendance: Attendance
  arrivedCount: number
  checkedInAt: number | null
  checkInMethod: ScanMethod | null
  manual: boolean
  ticketLabel?: string // 不記名門票的票號（沒有姓名時用作顯示名稱）
  companionOf?: string // 由請柬分拆出來的同行者：所屬請柬（原嘉賓）的編號
  createdAt: number
  updatedAt: number
}

export interface Ticket {
  id: string
  eventId: string
  participantId: string
  qrCode: string
  invitationId: string
  ticketNumber: string
  status: 'valid' | 'used' | 'cancelled'
  usedAt: number | null
}

export interface Resource {
  id: string
  eventId: string
  type: 'table' | 'bus'
  label: string
  capacity: number
  purpose: string
  sortOrder: number
}

export interface SeatAssignment {
  id: string
  eventId: string
  participantId: string
  resourceId: string
  seatLabel: string
}

export type CheckInKind = 'checkin' | 'undo' | 'reentry' | 'manual_override'

export interface CheckIn {
  id: string
  eventId: string
  participantId: string
  ticketId: string | null
  time: number
  method: ScanMethod
  deviceId: string
  operator: string
  kind: CheckInKind
  reason: string
  voided: boolean
  count: number
}

export interface AttendanceSession {
  id: string
  eventId: string
  name: string
  time: string
  location: string
  notes: string
  createdAt: number
}

export interface AttendanceRecord {
  id: string // `${sessionId}:${participantId}`
  sessionId: string
  eventId: string
  participantId: string
  status: 'present' | 'absent'
  checkedAt: number
  deviceId: string
  operator: string
}

export interface SouvenirItem {
  id: string
  eventId: string
  name: string
  stock: number | null // null = 不限數量
  perGuest: number // 0 = 跟嘉賓人數
  eligibility: string // 'all' | 'vip' | 'tag:XXX'
  sortOrder: number
}

export interface SouvenirRedemption {
  id: string
  eventId: string
  itemId: string
  participantId: string
  quantity: number
  time: number
  deviceId: string
  operator: string
  kind: 'redeem' | 'undo'
  voided: boolean
}

export type ScanPurpose = 'checkin' | 'rollcall' | 'souvenir'
export type ScanResultType =
  | 'valid'
  | 'invalid'
  | 'duplicate'
  | 'manual'
  | 'no_match'
  | 'not_eligible'
  | 'out_of_stock'

export interface ScanLog {
  id: string
  eventId: string
  purpose: ScanPurpose
  rawValue: string
  type: ScanMethod
  result: ScanResultType
  reason: string
  participantId: string | null
  time: number
  deviceId: string
  operator: string
}

export interface AuditLog {
  id: string
  eventId: string | null
  action: string
  objectType: string
  objectId: string
  guestName: string
  user: string
  deviceId: string
  time: number
  reason: string
}

export interface SyncConflict {
  id: string
  eventId: string
  type: 'double_checkin' | 'double_redemption' | 'concurrent_edit'
  participantId: string
  status: 'open' | 'resolved'
  createdAt: number
}
