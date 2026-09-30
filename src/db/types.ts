// 所有資料的形狀。四種模式共用同一套資料結構。

export type Mode = 'event' | 'banquet' | 'bus' | 'gift' // gift = 禮品領取（純禮品發放點，不綁定門票或名單）
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
  date: string // YYYY-MM-DD（開始日期）
  endDate?: string // 跨日活動的結束日期；沒有 = 單日活動
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
  tags: string[] // 特別需要
  giftGroups?: string[] // 禮物領取組別（在設定自訂）
  dietary: string // 舊欄位：已由「特別需要」取代，不再輸入
  remarks: string
  status: 'active' | 'cancelled'
  attendance: Attendance
  arrivedCount: number
  checkedInAt: number | null
  checkInMethod: ScanMethod | null
  manual: boolean
  ticketLabel?: string // 不記名門票的票號（沒有姓名時用作顯示名稱）
  age?: string // 即場登記：年齡
  birthDate?: string // 即場登記：出生日期 YYYY-MM-DD
  idPrefix?: string // 即場登記：身份證號碼頭 4 位（私隱考慮，不保存完整號碼）
  walkIn?: boolean // 由「即場登記」新增（不是預先匯入／輸入的名單）
  giftOnly?: boolean // 只領禮品：不計入出席、座位及點名
  leftAt?: number // 巴士行程：中途離開的時間（之後的點名及聚餐安排不再計算此人）
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

// 派發邏輯：person = 按人頭／門票；invitation = 按請柬（同行者共用）；fcfs = 限量先到先得（不認人）
export type SouvenirLogic = 'person' | 'invitation' | 'fcfs'

export interface SouvenirItem {
  id: string
  eventId: string
  name: string
  stock: number | null // null = 不限數量
  perGuest: number // 舊欄位（已由 logic + perClaim 取代）
  logic?: SouvenirLogic // 派發邏輯
  perClaim?: number // 每次領取上限（份）
  eligibility: string // 'all' | 'vip' | 'group:禮物組別'（舊資料可能有 'tag:XXX'）
  sortOrder: number
}

export interface SouvenirRedemption {
  id: string
  eventId: string
  itemId: string
  participantId: string // 限量先到先得而沒有登記領取人時為空字串
  quantity: number
  method?: ScanMethod // 核銷方式（QR／文字掃描／手動）
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
