import { useEffect, useMemo, useRef, useState, Fragment } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Camera, ChevronDown, Flashlight, FlashlightOff, Keyboard, Loader2, Plus, QrCode, ScanText, X } from 'lucide-react'
import { db } from '../db/db'
import type { EventRec, Participant, ScanMethod } from '../db/types'
import { checkIn, undoCheckIn, verifyCheckIn, verifyRollCall, verifySouvenir, type ScanOutcome } from '../lib/actions'
import { useDebounced, useEvent, useEventData } from '../lib/hooks'
import { fuzzyMatch, nameIdConflict, nameMismatch, searchGuests, type FuzzyMatch, extractFields, type CardFields } from '../lib/search'
import { setSettings, useSettings } from '../lib/settings'
import { cx, isOnDay, isUpcoming, todayKey } from '../lib/util'
import { nameOf } from '../lib/names'
import { getQrDetector, grabFrame, grabFromFrame, grabView, recognizeText, useCamera, useOcrState, warmUpOcr } from '../lib/scanner'
import { GuestRow } from '../components/GuestRow'
import { ScanResult } from '../components/ScanResult'
import { ModeIcon } from '../components/icons'
import { ConfirmSheet, SearchBar, toast } from '../components/ui'

type ScanMode = 'qr' | 'text' | 'manual'


// 萬用掃描：QR／文字／手動三合一，全程不離開相機畫面
// 文字掃描找不到會員時：列出抽取到的主要資料，可一按新增領取人
function NewRecipient({ text, onGo, compact }: { text: string; onGo: (f: CardFields) => void; compact?: boolean }) {
  const f = extractFields(text)
  const rows: [string, string][] = [
    ['中文姓名', f.name],
    ['英文姓名', f.englishName],
    ['性別', f.gender === 'M' ? '男' : f.gender === 'F' ? '女' : ''],
    ['出生日期', f.birthDate],
    ['身份證頭 4 位', f.idPrefix],
    ['回鄉證號碼', f.permitNo],
    ['證件有效期至', f.permitExpiry],
    ['會員編號', f.memberId],
    ['電話', f.phone],
  ]
  return (
    <div className="ocr-new">
      {!compact && (
        <dl className="ocr-fields">
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <Fragment key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </Fragment>
            ))}
        </dl>
      )}
      <button className="btn btn-mode btn-block" onClick={() => onGo(f)}>
        {compact ? '都不是？新增領取人' : '＋ 新增領取人並登記'}
      </button>
    </div>
  )
}

export default function Scan() {
  const { id } = useParams()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const ev = useEvent(id)
  const settings = useSettings()
  const { index } = useEventData(id)
  const sessions = useLiveQuery(() => (id ? db.sessions.where('eventId').equals(id).sortBy('time') : []), [id]) ?? []
  // 可切換的活動：今日活動排前，之後是即將舉行，再之後是過去的（已封存的不列出）
  const allEvents = useLiveQuery(() => db.events.toArray(), []) ?? []
  const eventChoices = useMemo(() => {
    const today = todayKey()
    const rank = (e: EventRec) => (isOnDay(e, today) ? 0 : isUpcoming(e, today) ? 1 : 2)
    return allEvents
      .filter((e) => e.status !== 'archived' || e.id === id)
      .sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)))
  }, [allEvents, id])
  const souvenirs = useLiveQuery(() => (id ? db.souvenirs.where('eventId').equals(id).sortBy('sortOrder') : []), [id]) ?? []

  const [mode, setMode] = useState<ScanMode>(() =>
    settings.defaultScanMode === 'last' ? settings.lastScanMode : settings.defaultScanMode,
  )
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null)
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 120)
  const [ocr, setOcr] = useState<{ text: string; matches: FuzzyMatch[] } | null>(null)
  const busy = useRef(false)
  const [undoP, setUndoP] = useState<Participant | null>(null)
  const vv = useVisibleViewport()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const cam = useCamera(videoRef, !!ev)
  const ocrState = useOcrState()
  const [armed, setArmed] = useState(true) // 「連續掃描」關閉時，每次結果後要按「掃描下一張」
  const [ocrBusy, setOcrBusy] = useState(false)
  const [noCodeHint, setNoCodeHint] = useState(false)
  // iPhone／iPad：相機權限仍是「每次詢問」時，提示可改為永久允許
  const [permTip, setPermTip] = useState(false)
  useEffect(() => {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    if (!ios) return
    try {
      if (localStorage.getItem('ckd-hide-perm-tip')) return
    } catch {
      /* ignore */
    }
    navigator.permissions
      ?.query({ name: 'camera' as PermissionName })
      .then((st) => setPermTip(st.state !== 'granted'))
      .catch(() => setPermTip(true))
  }, [])
  const outcomeRef = useRef<ScanOutcome | null>(null)
  outcomeRef.current = outcome
  // 防止同一張票仍放在鏡頭前時被重複讀取：處理過的票要離開鏡頭（連續約半秒看不到）才會再接受
  const lastCode = useRef<{ value: string; misses: number }>({ value: '', misses: 0 })

  // 掃描目的：簽到／點名／紀念品
  // 禮品領取模式沒有簽到：預設掃描目的為第一款禮品
  const purposeKey = params.get('p') ?? (ev?.mode === 'gift' && souvenirs[0] ? `s:${souvenirs[0].id}` : 'checkin')
  const purpose: 'checkin' | 'rollcall' | 'souvenir' = purposeKey.startsWith('s:') ? 'souvenir' : purposeKey.startsWith('r:') ? 'rollcall' : 'checkin'
  const targetId = purposeKey.slice(2)

  useEffect(() => setSettings({ lastScanMode: mode }), [mode])
  // 背景預先下載文字辨識資料（有網絡時），之後離線亦可用；不會阻礙 QR 掃描
  useEffect(() => {
    if (!navigator.onLine) return
    const t = window.setTimeout(() => warmUpOcr(), mode === 'text' ? 0 : 3000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (id && ev) setSettings({ currentEventId: id })
    if (ev === null) setSettings({ currentEventId: null })
  }, [id, ev])

  const purposeOptions: [string, string][] = [
    ...(ev?.mode !== 'gift' ? [['checkin', '簽到'] as [string, string]] : []),
    ...sessions.map((x): [string, string] => [`r:${x.id}`, `點名：${x.name}`]),
    ...souvenirs.map((x): [string, string] => [`s:${x.id}`, `${ev?.mode === 'gift' ? '禮品' : '紀念品'}：${x.name}`]),
  ]
  // 方塊內只顯示簡短名稱（「禮品：」「紀念品：」等前綴已由「掃描目的」說明）
  const purposeLabel = (purposeOptions.find(([v]) => v === purposeKey)?.[1] ?? '簽到').replace(/^(禮品|紀念品)：/, '')
  const addTo = purpose === 'souvenir' ? `/e/${id}/souvenirs/records?item=${targetId}&tab=pending&reg=1` : `/e/${id}/guests/new`
  const results = useMemo(() => (dq ? searchGuests(index, dq).slice(0, 30) : []), [index, dq])

  // ---- QR 連續掃描：每秒約 8 次讀取掃描框內的畫面 ----
  const scanning = mode === 'qr' && cam.status === 'ready' && !outcome && armed
  useEffect(() => {
    if (!scanning) return
    let stop = false
    let timer = 0
    const started = Date.now()
    setNoCodeHint(false)
    const tick = async () => {
      if (stop) return
      const v = videoRef.current
      try {
        const det = await getQrDetector()
        canvasRef.current ??= document.createElement('canvas')
        const f = frameRef.current
        const ctx = v && (f ? grabFromFrame(v, f, canvasRef.current, 720, 0.15) : grabFrame(v, 0.75, 1, canvasRef.current, 720))
        if (ctx && !busy.current && !outcomeRef.current) {
          const codes = await det.detect(canvasRef.current)
          const value = codes[0]?.rawValue?.trim()
          const last = lastCode.current
          if (value && value === last.value) last.misses = 0 // 同一張票仍在鏡頭前：不再處理
          else {
            if (last.value && ++last.misses >= 4) last.value = '' // 已拿開
            if (value) {
              lastCode.current = { value, misses: 0 }
              await run(value, 'QR')
              return
            }
            if (Date.now() - started > 8000) setNoCodeHint(true)
          }
        }
      } catch {
        /* 單次讀取失敗，繼續下一次 */
      }
      if (!stop) timer = window.setTimeout(tick, 120)
    }
    tick()
    return () => {
      stop = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning, purposeKey])

  // ---- 文字辨識：按「立即識別」才拍下畫面、讀取文字，再近似搜尋嘉賓（不再自動連續辨識） ----
  const ocrRunning = useRef(false)
  const [snap, setSnap] = useState<string | null>(null) // 拍下的畫面（辨識時及看結果時定格顯示）
  useEffect(() => {
    if (mode !== 'text') setSnap(null)
  }, [mode])
  // 換活動或掃描目的：清走上一次的辨識結果
  useEffect(() => {
    setOcr(null)
    setSnap(null)
  }, [id, purposeKey])

  const readText = async () => {
    const v = videoRef.current
    if (!v || ocrRunning.current) return null
    ocrRunning.current = true
    try {
      canvasRef.current ??= document.createElement('canvas')
      // 讀取整個看得見的畫面
      const view = grabView(v, canvasRef.current, 1280)
      if (!view) return null
      setSnap(canvasRef.current.toDataURL('image/jpeg', 0.75))
      // 原圖及黑白整理版都試，取最吻合的一個（對着螢幕、反光時較有用）
      const reads = await recognizeText(view.ctx)
      let best = { text: reads[0]?.text ?? '', confidence: reads[0]?.confidence ?? 0, matches: [] as FuzzyMatch[] }
      for (const r of reads) {
        // 整段文字一次比對：同時考慮姓名及編號，可判斷兩者是否屬於同一人
        const matches = fuzzyMatch(index, r.text)
        if ((matches[0]?.score ?? 0) > (best.matches[0]?.score ?? 0) || !best.text) best = { ...r, matches }
        if ((matches[0]?.score ?? 0) >= 0.95) break
      }
      return best
    } finally {
      ocrRunning.current = false
    }
  }

  // 「立即識別」：拍下畫面 → 辨識文字 → 與名單比對
  const autoRedeem = purpose === 'souvenir' && ev?.mode === 'gift'
  const doOcr = async () => {
    setOcrBusy(true)
    try {
      const r = await readText()
      if (!r) return
      const top = r.matches[0]
      if (autoRedeem && top && top.score >= 0.95 && r.matches.filter((m) => m.score >= 0.95).length === 1 && !nameIdConflict(r.matches) && !nameMismatch(r.matches, r.text)) {
        // 禮品領取：完全吻合唯一一位會員 → 直接登記領取，不用再點選
        await run(r.text, 'OCR', top.entry.p.id)
        return
      }
      setOcr({ text: r.text || '（未能辨識文字）', matches: r.matches })
    } catch {
      setOcr({ text: '（文字辨識未能載入，請連接網絡後再試）', matches: [] })
    } finally {
      setOcrBusy(false)
    }
  }

  const run = async (raw: string, method: ScanMethod, pid?: string) => {
    if (!id || busy.current) return
    busy.current = true
    try {
      let out: ScanOutcome
      if (purpose === 'souvenir') out = await verifySouvenir(id, targetId, raw, method, pid)
      else if (purpose === 'rollcall') out = await verifyRollCall(id, targetId, raw, method, pid)
      else out = await verifyCheckIn(id, raw, method, pid)
      setOcr(null)
      setSnap(null)
      setOutcome(out)
    } finally {
      busy.current = false
    }
  }

  // 名單上沒有這個人：帶同辨識到的欄位去「領取登記」（資料經畫面狀態傳遞，不放在網址）
  const registerFromOcr = (fields: CardFields) =>
    nav(`/e/${id}/souvenirs/records?item=${targetId}&tab=pending`, { state: { reg: fields, method: 'OCR' } })

  // 重新拍照：拿走辨識結果及定格畫面
  const clearOcr = () => {
    setSnap(null)
    setOcr(null)
  }

  // 工作人員修改辨識到的文字：稍候片刻後重新比對（避免每打一個字都計算）
  const editTimer = useRef(0)
  const editOcr = (text: string) => {
    setOcr((o) => (o ? { ...o, text } : o))
    clearTimeout(editTimer.current)
    editTimer.current = window.setTimeout(() => {
      setOcr((o) => (o && o.text === text ? { text, matches: fuzzyMatch(index, text) } : o))
    }, 250)
  }

  // 活動已不存在（例如示範資料已重新產生）：返回首頁，不會卡在黑畫面
  if (ev === null) return <Navigate to="/" replace />
  if (!ev) return <div className="scan" />

  return (
    <div className="scan" data-mode={ev.mode} style={vv ? { height: vv.height, transform: `translateY(${vv.top}px)` } : undefined}>
      <header className="scan-top">
        <button className="scan-icon" aria-label="關閉掃描" onClick={() => nav(`/e/${ev.id}`)}>
          <X size={24} />
        </button>
        {/* 左：活動；右：掃描目的（有多於一個時才顯示；按整個方塊即彈出選單） */}
        <div className="scan-title">
          <label className="scan-pick">
            <ModeIcon mode={ev.mode} size={18} />
            <span className="scan-pick-text">{ev.name}</span>
            <ChevronDown size={16} />
            <select value={ev.id} onChange={(e) => nav(`/e/${e.target.value}/scan`, { replace: true })} aria-label="切換活動">
              {eventChoices.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          {/* 只有一個掃描目的（例如只有簽到）就不顯示右邊方塊 */}
          {purposeOptions.length > 1 && (
            <label className="scan-pick purpose">
              <span className="scan-pick-text">{purposeLabel}</span>
              <ChevronDown size={16} />
              <select value={purposeKey} onChange={(e) => setParams({ p: e.target.value }, { replace: true })} aria-label="掃描目的">
                {purposeOptions.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {cam.torchSupported ? (
          <button className={cx('scan-icon', cam.torch && 'on')} aria-label={cam.torch ? '關閉手電筒' : '開啟手電筒'} aria-pressed={cam.torch} onClick={() => cam.setTorch(!cam.torch)}>
            {cam.torch ? <Flashlight size={22} /> : <FlashlightOff size={22} />}
          </button>
        ) : null}
      </header>

      <div className={cx('scan-view', mode === 'manual' && 'compact')}>
        <video ref={videoRef} className="camera-video" playsInline muted autoPlay />
        {cam.status !== 'ready' && (
          <div className="camera-msg">
            {cam.status === 'starting' ? (
              <>
                <Loader2 size={28} className="spin" />
                <span>正在開啟相機…</span>
              </>
            ) : (
              <>
                <Camera size={32} />
                <strong>
                  {cam.status === 'denied'
                    ? '未允許使用相機'
                    : cam.status === 'insecure'
                      ? '需要 https 網址才可使用相機'
                      : cam.status === 'unavailable'
                        ? '找不到相機'
                        : '相機未能開啟'}
                </strong>
                {cam.status === 'denied' && (
                  <small>
                    iPhone／iPad：設定 → Safari → 相機 → 允許（或網址列「大小」→ 網站設定）。
                    <br />
                    Android：網址列左邊的圖示 → 權限 → 相機 → 允許。
                  </small>
                )}
                <div className="demo-btns">
                  <button onClick={cam.retry}>再試一次</button>
                  <button onClick={() => setMode('manual')}>改用手動搜尋</button>
                </div>
              </>
            )}
          </div>
        )}
        {mode === 'qr' && cam.status === 'ready' && (
          <div ref={frameRef} className="scan-frame">
            <i />
            <i />
            <i />
            <i />
          </div>
        )}
        {mode === 'text' && cam.status === 'ready' && !outcome && (
          snap ? (
            <div className={cx('text-snap', ocrBusy && 'reading')}>
              <img src={snap} alt="拍下的畫面" />
              {ocrBusy && <i className="text-scanline" />}
            </div>
          ) : (
            <div className="scan-frame wide text-frame" aria-hidden>
              <i />
              <i />
              <i />
              <i />
            </div>
          )
        )}
        {mode === 'qr' && cam.status === 'ready' && (
          <p className="scan-hint">{noCodeHint ? '掃不到？可改用「文字」或「手動」' : '將 QR Code 放入框內'}</p>
        )}
        {mode === 'text' && cam.status === 'ready' && !snap && <p className="scan-hint">把名牌或門票放入框內</p>}
        {mode === 'text' && ocrBusy && <p className="scan-hint reading">辨識中…</p>}
      </div>

      <div className="scan-panel">
        {permTip && cam.status === 'ready' && (
          <div className="perm-tip">
            <span>每次都要按「允許」相機？可在 Safari「大小 ᴀA → 網站設定 → 相機 → 允許」改為永久允許。</span>
            <button
              onClick={() => {
                setPermTip(false)
                try {
                  localStorage.setItem('ckd-hide-perm-tip', '1')
                } catch {
                  /* ignore */
                }
              }}
            >
              知道了
            </button>
          </div>
        )}
        {mode === 'qr' && (
          <div className="demo">
            <ol className="ocr-steps">
              <li>
                <b>1</b>QR Code 放入框內
              </li>
              <li>
                <b>2</b>自動讀取
              </li>
            </ol>
            {!armed && !outcome ? (
              <button className="ocr-shoot" onClick={() => setArmed(true)}>
                <QrCode size={22} /> 掃描下一張
              </button>
            ) : (
              <div className="ocr-shoot is-status" role="status">
                {cam.status === 'ready' ? <QrCode size={22} /> : <Loader2 size={22} className="spin" />}
                {cam.status === 'ready' ? '自動掃描中' : '等待相機…'}
              </div>
            )}
          </div>
        )}

        {mode === 'text' && (
          <div className="demo">
            {!ocr ? (
              <>
                <ol className="ocr-steps">
                  <li>
                    <b>1</b>對準名牌或門票
                  </li>
                  <li>
                    <b>2</b>按「立即識別」
                  </li>
                </ol>
                <button className="ocr-shoot" onClick={doOcr} disabled={ocrBusy || cam.status !== 'ready'}>
                  {ocrBusy ? <Loader2 size={22} className="spin" /> : <Camera size={22} />}
                  {ocrBusy
                    ? '辨識中…'
                    : ocrState.state === 'loading'
                      ? `載入文字辨識 ${Math.round(ocrState.progress * 100)}%`
                      : cam.status !== 'ready'
                        ? '等待相機…'
                        : '立即識別'}
                </button>
                <p className="hint center">印刷的姓名、會員編號、邀請編號最準確；手寫字未能辨識</p>
              </>
            ) : ocr.matches.length === 0 ? (
              <div className="ocr-none">
                <OcrEdit value={ocr.text} onChange={editOcr} onClear={clearOcr} />
                <p className="ocr-none-title">找不到相符{purpose === 'souvenir' ? '領取人' : '嘉賓'}，是否新增？</p>
                <p className="hint">可在上面直接修改辨識到的文字，名單會即時更新。</p>
                <p className="hint">
                  目前活動：{ev.name} · 共 {index.length} 位嘉賓。如嘉賓屬於另一個活動，請按左上角 × 返回後切換活動。
                </p>
                {purpose === 'souvenir' ? (
                  <NewRecipient text={ocr.text} onGo={registerFromOcr} />
                ) : (
                  <button className="ocr-shoot" onClick={() => nav(`/e/${ev.id}/guests/new`)}>
                    新增嘉賓
                  </button>
                )}
              </div>
            ) : (
              (() => {
                const mismatch = nameMismatch(ocr.matches, ocr.text)
                const conflict = nameIdConflict(ocr.matches)
                // 有完全吻合（姓名或編號）就只列出完全吻合的人；否則才列出後備（同姓差一字、只有姓氏等）
                const exact = ocr.matches.filter((m) => m.score >= 0.95)
                const list = (exact.length ? exact : ocr.matches).slice(0, 5)
                const pick = (m: FuzzyMatch) => run(ocr.text, 'OCR', m.entry.p.id)
                const row = (m: FuzzyMatch) => (
                  <GuestRow
                    key={m.entry.p.id}
                    e={m.entry}
                    onClick={() => pick(m)}
                    trailing={
                      <span className="match">
                        {Math.round(m.score * 100)}%<small>{m.field}</small>
                      </span>
                    }
                  />
                )
                return (
                  <div className="ocr-matches">
                    <OcrEdit value={ocr.text} onChange={editOcr} onClear={clearOcr} />
                    {conflict ? (
                      <p className="ocr-warn">⚠ 姓名與編號指向不同的人，請核對後才簽到</p>
                    ) : (
                      mismatch && <p className="ocr-warn">⚠ 編號吻合，但卡上姓名與此嘉賓不符，請核對後才簽到</p>
                    )}
                    <p className="ocr-group">可能的嘉賓 Possible matches · {purpose === 'souvenir' ? '點選以登記領取' : '點選以簽到'}</p>
                    {list.map(row)}
                    {purpose === 'souvenir' && <NewRecipient text={ocr.text} onGo={registerFromOcr} compact />}
                  </div>
                )
              })()
            )}
          </div>
        )}

        {mode === 'manual' && (
          <div className="manual">
            {/* 搜尋欄旁的「新增」：手機彈出鍵盤時仍看得到 */}
            <div className="manual-bar">
              <SearchBar value={q} onChange={setQ} placeholder="姓名／編號／電話／公司／座位" autoFocus />
              <Link className="manual-add" to={addTo}>
                <Plus size={18} /> {purpose === 'souvenir' ? '登記' : '新增'}
              </Link>
            </div>
            <div className="manual-results">
              {!dq && <p className="muted pad center">輸入姓名、編號、電話、公司或座位，結果會即時出現</p>}
              {dq && results.length === 0 && (
                <div className="manual-none">
                  <p>找不到「{dq}」，是否新增？</p>
                  <Link className="ocr-shoot" to={addTo}>
                    <Plus size={20} /> {purpose === 'souvenir' ? '即場登記領取人' : '新增嘉賓'}
                  </Link>
                </div>
              )}
              {results.map((e) => {
                // 簽到用途：每行可直接「簽到」或「取消簽到」
                const canToggle = purpose === 'checkin' && e.p.status === 'active'
                const arrived = e.p.attendance !== 'not_arrived'
                return (
                  <GuestRow
                    key={e.p.id}
                    e={e}
                    // 簽到用途：左邊圓圈 = 簽到／取消簽到（需確認）；按名字或右邊按鈕 = 嘉賓詳情
                    onClick={() => (canToggle ? nav(`/e/${ev.id}/guests/${e.p.id}`) : run(dq, 'MANUAL', e.p.id))}
                    onMarkClick={canToggle ? () => (arrived ? setUndoP(e.p) : run(dq, 'MANUAL', e.p.id)) : undefined}
                    trailing={
                      canToggle ? (
                        <span className="btn btn-sm btn-ghost" aria-hidden>
                          詳情 ›
                        </span>
                      ) : undefined
                    }
                  />
                )
              })}
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
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'active' : ''} onClick={() => (setMode(m), setOcr(null), setSnap(null))}>
              <Icon size={22} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      <ConfirmSheet
        open={!!undoP}
        onClose={() => setUndoP(null)}
        onConfirm={async () => {
          if (undoP) await undoCheckIn(undoP)
          toast('已取消簽到')
        }}
        title="取消簽到"
        message={<p>把 {undoP && nameOf(undoP)} 改回「未到」？此操作會記錄在操作紀錄。</p>}
        confirmText="取消簽到"
      />
      {outcome && (
        <ScanResult
          outcome={outcome}
          purpose={purpose}
          onDone={() => {
            setOutcome(null)
            if (mode === 'manual') setQ('')
            if (mode === 'qr' && !settings.continuousScan) setArmed(false)
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

// 辨識到的文字：可直接修改（例如把認錯的字改正）
function OcrEdit({ value, onChange, onClear }: { value: string; onChange: (v: string) => void; onClear: () => void }) {
  // 多行顯示，完整看到辨識到的內容
  const rows = Math.min(4, Math.max(2, Math.ceil(value.length / 24)))
  return (
    <label className="ocr-edit">
      <span className="ocr-edit-head">
        辨識到的文字 · 可修改
        <button type="button" className="ocr-clear" onClick={(e) => (e.preventDefault(), onClear())}>
          <Camera size={14} /> 重拍
        </button>
      </span>
      <textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)} autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
    </label>
  )
}
