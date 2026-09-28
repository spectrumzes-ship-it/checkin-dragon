import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Flashlight, Keyboard, QrCode, ScanText, X, Zap } from 'lucide-react'
import { db } from '../db/db'
import type { Participant, ScanMethod } from '../db/types'
import { checkIn, eligible, redeemedQty, verifyCheckIn, verifyRollCall, verifySouvenir, type ScanOutcome } from '../lib/actions'
import { useDebounced, useEvent, useEventData } from '../lib/hooks'
import { fuzzyMatch, searchGuests, type FuzzyMatch } from '../lib/search'
import { setSettings, useSettings } from '../lib/settings'
import { cx } from '../lib/util'
import { GuestRow } from '../components/GuestRow'
import { ScanResult } from '../components/ScanResult'
import { ModeIcon } from '../components/icons'
import { SearchBar } from '../components/ui'

type ScanMode = 'qr' | 'text' | 'manual'

// 萬用掃描：QR／文字／手動三合一，全程不離開相機畫面
export default function Scan() {
  const { id } = useParams()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const ev = useEvent(id)
  const settings = useSettings()
  const { index } = useEventData(id)
  const sessions = useLiveQuery(() => (id ? db.sessions.where('eventId').equals(id).sortBy('time') : []), [id]) ?? []
  const souvenirs = useLiveQuery(() => (id ? db.souvenirs.where('eventId').equals(id).sortBy('sortOrder') : []), [id]) ?? []

  const [mode, setMode] = useState<ScanMode>(() =>
    settings.defaultScanMode === 'last' ? settings.lastScanMode : settings.defaultScanMode,
  )
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null)
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 120)
  const [ocr, setOcr] = useState<{ text: string; matches: FuzzyMatch[] } | null>(null)
  const busy = useRef(false)
  const vv = useVisibleViewport()

  // 掃描目的：入場／點名／紀念品
  const purposeKey = params.get('p') ?? 'checkin'
  const purpose: 'checkin' | 'rollcall' | 'souvenir' = purposeKey.startsWith('s:') ? 'souvenir' : purposeKey.startsWith('r:') ? 'rollcall' : 'checkin'
  const targetId = purposeKey.slice(2)
  const target = purpose === 'souvenir' ? souvenirs.find((s) => s.id === targetId) : purpose === 'rollcall' ? sessions.find((s) => s.id === targetId) : null

  useEffect(() => setSettings({ lastScanMode: mode }), [mode])
  useEffect(() => {
    if (id) setSettings({ currentEventId: id })
  }, [id])

  const results = useMemo(() => (dq ? searchGuests(index, dq).slice(0, 30) : []), [index, dq])

  const run = async (raw: string, method: ScanMethod, pid?: string) => {
    if (!id || busy.current) return
    busy.current = true
    try {
      let out: ScanOutcome
      if (purpose === 'souvenir') out = await verifySouvenir(id, targetId, raw, method, pid)
      else if (purpose === 'rollcall') out = await verifyRollCall(id, targetId, raw, method, pid)
      else out = await verifyCheckIn(id, raw, method, pid)
      setOcr(null)
      setOutcome(out)
    } finally {
      busy.current = false
    }
  }

  // ---- 原型用：模擬掃描不同類型的票 ----
  const demo = async (kind: 'valid' | 'duplicate' | 'invalid' | 'cancelled' | 'wrong') => {
    if (!id) return
    const ps = await db.participants.where('eventId').equals(id).toArray()
    const randomOf = (xs: Participant[]) => xs[Math.floor(Math.random() * xs.length)]
    let p: Participant | undefined
    if (kind === 'invalid') return run('XYZ-00000', 'QR')
    if (kind === 'wrong') {
      const other = await db.tickets.filter((t) => t.eventId !== id).first()
      return run(other?.qrCode ?? 'NONE', 'QR')
    }
    if (kind === 'cancelled') p = randomOf(ps.filter((x) => x.status === 'cancelled'))
    else {
      const active = ps.filter((x) => x.status === 'active')
      let done: Set<string>
      if (purpose === 'souvenir' && target && 'eligibility' in target) {
        const rs = await db.redemptions.where('itemId').equals(target.id).filter((r) => !r.voided).toArray()
        done = new Set(rs.map((r) => r.participantId))
        const pool = active.filter((x) => eligible(target, x))
        p = randomOf(kind === 'valid' ? pool.filter((x) => !done.has(x.id)) : pool.filter((x) => done.has(x.id)))
        if (p && kind === 'valid' && (await redeemedQty(target.id, p.id)) > 0) p = undefined
      } else if (purpose === 'rollcall') {
        const rs = await db.attendance.where('sessionId').equals(targetId).filter((a) => a.status === 'present').toArray()
        done = new Set(rs.map((r) => r.participantId))
        p = randomOf(kind === 'valid' ? active.filter((x) => !done.has(x.id)) : active.filter((x) => done.has(x.id)))
      } else {
        p = randomOf(kind === 'valid' ? active.filter((x) => x.attendance === 'not_arrived') : active.filter((x) => x.attendance !== 'not_arrived'))
      }
    }
    if (!p) return run('NO-SAMPLE', 'QR')
    const t = await db.tickets.where('participantId').equals(p.id).first()
    return run(t?.qrCode ?? p.memberId, 'QR')
  }

  const demoOcr = (text: string) => {
    const matches = fuzzyMatch(index, text)
    setOcr({ text, matches })
  }

  if (!ev) return <div className="scan" />

  return (
    <div className="scan" data-mode={ev.mode} style={vv ? { height: vv.height, transform: `translateY(${vv.top}px)` } : undefined}>
      <header className="scan-top">
        <button className="scan-icon" aria-label="關閉掃描" onClick={() => nav(`/e/${ev.id}`)}>
          <X size={24} />
        </button>
        <div className="scan-title">
          <span className="scan-event">
            <ModeIcon mode={ev.mode} size={16} /> {ev.name}
          </span>
          <select
            className="scan-purpose"
            value={purposeKey}
            onChange={(e) => setParams({ p: e.target.value }, { replace: true })}
            aria-label="掃描目的"
          >
            <option value="checkin">入場 Check-In</option>
            {sessions.map((s) => (
              <option key={s.id} value={`r:${s.id}`}>
                點名：{s.name}
              </option>
            ))}
            {souvenirs.map((s) => (
              <option key={s.id} value={`s:${s.id}`}>
                紀念品：{s.name}
              </option>
            ))}
          </select>
        </div>
        <button className="scan-icon" aria-label="閃光燈（第 3 階段）" disabled>
          <Flashlight size={22} />
        </button>
      </header>

      <div className={cx('scan-view', mode === 'manual' && 'compact')}>
        <div className="camera-placeholder">
          <span>相機預覽 Camera</span>
          <small>第 3 階段啟用真實相機，現在可用下方「模擬掃描」測試</small>
        </div>
        {mode !== 'manual' && (
          <div className={cx('scan-frame', mode === 'text' && 'wide')}>
            <i />
            <i />
            <i />
            <i />
          </div>
        )}
        {mode === 'qr' && <p className="scan-hint">將 QR Code 放入框內</p>}
        {mode === 'text' && <p className="scan-hint">對準 姓名／會員編號／邀請編號</p>}
      </div>

      <div className="scan-panel">
        {mode === 'qr' && (
          <div className="demo">
            <p className="demo-title">
              <Zap size={14} /> 模擬掃描 Demo
            </p>
            <div className="demo-btns">
              <button onClick={() => demo('valid')}>有效票</button>
              <button onClick={() => demo('duplicate')}>{purpose === 'checkin' ? '已入場的票' : purpose === 'souvenir' ? '已領取的票' : '已點名的票'}</button>
              <button onClick={() => demo('invalid')}>無效票</button>
              {purpose === 'checkin' && <button onClick={() => demo('cancelled')}>已取消的票</button>}
              {purpose === 'checkin' && <button onClick={() => demo('wrong')}>其他活動的票</button>}
            </div>
          </div>
        )}

        {mode === 'text' && (
          <div className="demo">
            {!ocr ? (
              <>
                <p className="demo-title">
                  <Zap size={14} /> 模擬文字辨識 Demo
                </p>
                <div className="demo-btns">
                  <button onClick={() => demoOcr('VIP-A0265')}>VIP-A0265</button>
                  <button onClick={() => demoOcr('CHAN TAl MAN')}>CHAN TAl MAN（認錯字）</button>
                  <button onClick={() => demoOcr('CHAN')}>CHAN（多人）</button>
                  <button onClick={() => demoOcr('HELLO WORLD')}>隨意文字</button>
                </div>
              </>
            ) : ocr.matches.length === 0 ? (
              <div className="ocr-none">
                <p>
                  辨識到「<strong>{ocr.text}</strong>」
                </p>
                <p className="ocr-none-title">找不到相符嘉賓 No matching guest found</p>
                <div className="demo-btns">
                  <button onClick={() => (setOcr(null), setMode('manual'), setQ(ocr.text))}>手動搜尋</button>
                  <button onClick={() => nav(`/e/${ev.id}/guests/new`)}>新增嘉賓</button>
                  <button onClick={() => setOcr(null)}>再試</button>
                </div>
              </div>
            ) : (
              <div className="ocr-matches">
                <p className="demo-title">
                  辨識到「{ocr.text}」·{' '}
                  {ocr.matches.length === 1 || ocr.matches[0].score >= 0.9 && (ocr.matches[1]?.score ?? 0) < 0.8 ? '最可能是' : '可能的嘉賓 Possible Matches'}
                </p>
                {(ocr.matches[0].score >= 0.9 && (ocr.matches[1]?.score ?? 0) < 0.8 ? ocr.matches.slice(0, 1) : ocr.matches).map((m) => (
                  <GuestRow
                    key={m.entry.p.id}
                    e={m.entry}
                    onClick={() => run(ocr.text, 'OCR', m.entry.p.id)}
                    trailing={
                      <span className="match">
                        {Math.round(m.score * 100)}%<small>{m.field}</small>
                      </span>
                    }
                  />
                ))}
                <div className="demo-btns">
                  <button onClick={() => setOcr(null)}>都不是，再試</button>
                </div>
              </div>
            )}
          </div>
        )}

        {mode === 'manual' && (
          <div className="manual">
            <SearchBar value={q} onChange={setQ} placeholder="姓名／編號／電話／公司／座位" autoFocus />
            <div className="manual-results">
              {!dq && <p className="muted pad center">輸入姓名、編號、電話、公司或座位，結果會即時出現</p>}
              {dq && results.length === 0 && <p className="muted pad">找不到「{dq}」</p>}
              {results.map((e) => (
                <GuestRow key={e.p.id} e={e} onClick={() => run(dq, 'MANUAL', e.p.id)} />
              ))}
            </div>
          </div>
        )}

        <div className="scan-modes" role="tablist">
          {(
            [
              ['qr', QrCode, 'QR'],
              ['text', ScanText, '文字 Text'],
              ['manual', Keyboard, '手動 Manual'],
            ] as const
          ).map(([m, Icon, label]) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'active' : ''} onClick={() => (setMode(m), setOcr(null))}>
              <Icon size={22} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {outcome && (
        <ScanResult
          outcome={outcome}
          purpose={purpose}
          onDone={() => {
            setOutcome(null)
            if (mode === 'manual') setQ('')
          }}
          onDetails={outcome.participant ? () => nav(`/e/${ev.id}/guests/${outcome.participant!.id}`) : undefined}
          onReentry={
            purpose === 'checkin' && outcome.participant
              ? async () => {
                  const p = outcome.participant!
                  const t = await db.tickets.where('participantId').equals(p.id).first()
                  const np = await checkIn(p, 'MANUAL', 'reentry', '', t)
                  setOutcome({ ...outcome, result: 'manual', participant: np, time: Date.now(), previousTime: undefined })
                }
              : undefined
          }
        />
      )}
    </div>
  )
}

// iPhone 彈出鍵盤時，畫面可見範圍會縮小；掃描畫面跟隨可見範圍，搜尋欄就不會被推走或留下大片空白
function useVisibleViewport() {
  const [vv, setVv] = useState<{ height: number; top: number } | null>(null)
  useEffect(() => {
    const v = window.visualViewport
    if (!v) return
    const update = () => {
      setVv({ height: v.height, top: v.offsetTop })
      if (window.scrollY) window.scrollTo(0, 0)
    }
    update()
    v.addEventListener('resize', update)
    v.addEventListener('scroll', update)
    return () => {
      v.removeEventListener('resize', update)
      v.removeEventListener('scroll', update)
    }
  }, [])
  return vv
}
