import Dexie, { type Table } from 'dexie'
import type {
  AttendanceRecord,
  AttendanceSession,
  AuditLog,
  CheckIn,
  Coupon,
  EventRec,
  Participant,
  Resource,
  ScanLog,
  SeatAssignment,
  SouvenirItem,
  SouvenirRedemption,
  SyncConflict,
  Ticket,
} from './types'

// 裝置內資料庫（瀏覽器 IndexedDB）。所有操作先寫入這裏，所以離線也能用。
export class CheckInDB extends Dexie {
  events!: Table<EventRec, string>
  participants!: Table<Participant, string>
  tickets!: Table<Ticket, string>
  resources!: Table<Resource, string>
  seats!: Table<SeatAssignment, string>
  checkins!: Table<CheckIn, string>
  sessions!: Table<AttendanceSession, string>
  attendance!: Table<AttendanceRecord, string>
  souvenirs!: Table<SouvenirItem, string>
  redemptions!: Table<SouvenirRedemption, string>
  scanLogs!: Table<ScanLog, string>
  auditLogs!: Table<AuditLog, string>
  conflicts!: Table<SyncConflict, string>
  coupons!: Table<Coupon, string>

  constructor() {
    super('checkin-dragon')
    this.version(1).stores({
      events: 'id, date, status, mode',
      participants: 'id, eventId, memberId',
      tickets: 'id, eventId, participantId, qrCode, invitationId, ticketNumber',
      resources: 'id, eventId',
      seats: 'id, eventId, participantId, resourceId',
      checkins: 'id, eventId, participantId, time',
      sessions: 'id, eventId',
      attendance: 'id, sessionId, eventId, participantId',
      souvenirs: 'id, eventId',
      redemptions: 'id, eventId, itemId, participantId',
      scanLogs: 'id, eventId, time',
      auditLogs: 'id, eventId, time',
      conflicts: 'id, eventId',
    })
    // 第 2 版：憑券換領的換領券
    this.version(2).stores({
      coupons: 'id, eventId, itemId, code',
    })
  }
}

export const db = new CheckInDB()

export const allTables = () => [
  db.events,
  db.participants,
  db.tickets,
  db.resources,
  db.seats,
  db.checkins,
  db.sessions,
  db.attendance,
  db.souvenirs,
  db.redemptions,
  db.scanLogs,
  db.auditLogs,
  db.conflicts,
  db.coupons,
]
