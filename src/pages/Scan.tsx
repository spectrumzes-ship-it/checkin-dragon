import { useEffect, useMemo, useRef, useState, Fragment } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Camera, Flashlight, FlashlightOff, Keyboard, Loader2, QrCode, ScanText, X } from 'lucide-react'
import { db } from '../db/db'
import type { Participant, ScanMethod } from '../db/types'
import { checkIn, undoCheckIn, verifyCheckIn, verifyRollCall, verifySouvenir, type ScanOutcome } from '../lib/actions'
import { useDebounced, useEvent, useEventData } from '../lib/hooks'
import { fuzzyMatch, nameIdConflict, nameMismatch, searchGuests, similarity, type FuzzyMatch, extractFields, type CardFields } from '../lib/search'
import { setSettings, useSettings } from '../lib/settings'
import { cx, normalize } from '../lib/util'
import { nameOf } from '../lib/names'
import { getQrDetector, grabFrame, grabFromFrame, grabView, mainTextCluster, recognizeText, smoothBox, videoToView, type TextBox, useCamera, useOcrState, warmUpOcr } from '../lib/scanner'
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
    ['出生日期', f.birthDate],
    ['身份證頭 4 位', f.idPrefix],
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

  // ---- 文字辨識：讀取畫面中央一大片範圍的文字，再近似搜尋嘉賓 ----
  const ocrRunning = useRef(false)
  // 剛處理過（或被工作人員否決）的嘉賓，名牌仍在鏡頭前時不會再自動彈出
  const lastOcrPid = useRef<{ pid: string; text: string; misses: number }>({ pid: '', text: '', misses: 0 })
  const [liveText, setLiveText] = useState('')
  const [sameCard, setSameCard] = useState(false) // 已處理的名牌仍在鏡頭前
  // 貼合文字的框：記錄文字在相機影像上的位置；畫面大小改變（例如結果面板展開）時即時重新換算，框一直貼住文字
  const [textBox, setTextBoxRaw] = useState<TextBox | null>(null)
  const boxMiss = useRef(0)
  // 更新文字框：平穩移動；短暫讀不到（連續少於 3 次）保留原位，避免閃爍
  const updateTextBox = (next: TextBox | null) => {
    if (next) {
      boxMiss.current = 0
      setTextBoxRaw((prev) => smoothBox(prev, next))
    } else if (++boxMiss.current >= 3) setTextBoxRaw(null)
  }
  const setTextBoxes = (_: []) => {
    boxMiss.current = 0
    setTextBoxRaw(null)
  }
  const [, setViewTick] = useState(0)
  useEffect(() => {
    if (mode !== 'text') setTextBoxes([])
  }, [mode])
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const ro = new ResizeObserver(() => setViewTick((n) => n + 1))
    ro.observe(v)
    return () => ro.disconnect()
  })
  const outer =
    videoRef.current && textBox
      ? (() => {
          const pad = 12
          const a = videoToView(videoRef.current!, textBox.x0, textBox.y0)
          const z = videoToView(videoRef.current!, textBox.x1, textBox.y1)
          return { left: a.x - pad, top: a.y - pad, width: z.x - a.x + pad * 2, height: z.y - a.y + pad * 2 }
        })()
      : null

  const readText = async () => {
    const v = videoRef.current
    if (!v || ocrRunning.current) return null
    ocrRunning.current = true
    try {
      canvasRef.current ??= document.createElement('canvas')
      // 讀取整個看得見的畫面，找出文字位置（不再限制於固定框）
      const view = grabView(v, canvasRef.current, 1280)
      if (!view) return null
      // 原圖及黑白整理版都試，取最吻合的一個（對着螢幕、反光時較有用）
      const reads = await recognizeText(view.ctx)
      // 把文字位置換算到畫面上，畫出貼合文字的框
      const shown = reads.find((r) => r.boxes.length) ?? reads[0]
      const cluster = mainTextCluster(shown?.boxes ?? [])
      if (cluster) {
        const a = view.toVideo(cluster.x0, cluster.y0)
        const z = view.toVideo(cluster.x1, cluster.y1)
        updateTextBox({ x0: a.x, y0: a.y, x1: z.x, y1: z.y })
      } else updateTextBox(null)
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

  // 手動「立即辨識」：不論結果都顯示
  const doOcr = async () => {
    setOcrBusy(true)
    try {
      const r = await readText()
      if (r) setOcr({ text: r.text || '（未能辨識文字）', matches: r.matches })
    } catch {
      setOcr({ text: '（文字辨識未能載入，請連接網絡後再試）', matches: [] })
    } finally {
      setOcrBusy(false)
    }
  }

  // 自動辨識：文字模式下持續讀取，找到相符嘉賓（吻合度 80% 以上）即列出讓工作人員確認
  const autoRedeem = purpose === 'souvenir' && ev?.mode === 'gift'
  const autoOcr = mode === 'text' && cam.status === 'ready' && !outcome && !ocr
  useEffect(() => {
    if (!autoOcr) return
    let stop = false
    let timer = 0
    const loop = async () => {
      if (stop) return
      try {
        const r = await readText()
        if (r && !stop) {
          setLiveText(r.confidence >= 65 ? r.text : '') // 亂碼（信心度低）不顯示
          const top = r.matches[0]
          const last = lastOcrPid.current
          if (top && top.score >= 0.8) {
            // 同一位嘉賓而且文字大致相同 = 同一張名牌仍在鏡頭前：不再彈出
            const same = top.entry.p.id === last.pid && similarity(normalize(r.text), last.text) >= 0.8
            setSameCard(same)
            if (same) last.misses = 0
            else if (autoRedeem && top.score >= 0.95 && r.matches.filter((m) => m.score >= 0.95).length === 1 && !nameIdConflict(r.matches) && !nameMismatch(r.matches, r.text)) {
              // 禮品領取：完全吻合唯一一位會員 → 自動登記領取，不用再點選
              lastOcrPid.current = { pid: top.entry.p.id, text: normalize(r.text), misses: 0 }
              setTextBoxes([])
              run(r.text, 'OCR', top.entry.p.id)
              return
            } else {
              lastOcrPid.current = { pid: '', text: '', misses: 0 }
              setTextBoxes([])
              setOcr({ text: r.text, matches: r.matches })
              return
            }
          } else {
            setSameCard(false)
            if (last.pid && ++last.misses >= 3) last.pid = '' // 名牌已拿開
          }
        }
      } catch {
        /* 辨識資料未載入等：稍後再試 */
      }
      if (!stop) timer = window.setTimeout(loop, 350)
    }
    timer = window.setTimeout(loop, 300)
    return () => {
      stop = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOcr, index])

  const run = async (raw: string, method: ScanMethod, pid?: string) => {
    if (!id || busy.current) return
    busy.current = true
    setTextBoxes([]) // 清走畫面上的文字框痕跡
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

  // 名單上沒有這個人：帶同辨識到的欄位去「領取登記」（資料經畫面狀態傳遞，不放在網址）
  const registerFromOcr = (fields: CardFields) =>
    nav(`/e/${id}/souvenirs/records?item=${targetId}&tab=pending`, { state: { reg: fields, method: 'OCR' } })

  // 清除：拿走辨識結果及文字框，立即重新開始自動辨識（同一張名牌亦會重新辨識）
  const clearOcr = () => {
    lastOcrPid.current = { pid: '', text: '', misses: 0 }
    setSameCard(false)
    setLiveText('')
    setTextBoxes([])
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
            {ev.mode !== 'gift' && <option value="checkin">簽到 Check-In</option>}
            {sessions.map((s) => (
              <option key={s.id} value={`r:${s.id}`}>
                點名：{s.name}
              </option>
            ))}
            {souvenirs.map((s) => (
              <option key={s.id} value={`s:${s.id}`}>
                {ev.mode === 'gift' ? '禮品' : '紀念品'}：{s.name}
              </option>
            ))}
          </select>
        </div>
        {cam.torchSupported ? (
          <button className={cx('scan-icon', cam.torch && 'on')} aria-label={cam.torch ? '關閉手電筒' : '開啟手電筒'} aria-pressed={cam.torch} onClick={() => cam.setTorch(!cam.torch)}>
            {cam.torch ? <Flashlight size={22} /> : <FlashlightOff size={22} />}
          </button>
        ) : (
          <span className="scan-icon ghost" />
        )}
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
        {mode === 'text' && cam.status === 'ready' && !ocr && !outcome && (
          <div className="text-overlay" aria-hidden>
            {outer ? (
              <>
                <div className="text-outer" style={outer}>
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              </>
            ) : (
              <div className="text-guide" />
            )}
          </div>
        )}
        {mode === 'qr' && cam.status === 'ready' && (
          <p className="scan-hint">{noCodeHint ? '掃不到？可改用「文字」或「手動」' : '將 QR Code 放入框內'}</p>
        )}
        {mode === 'text' && cam.status === 'ready' && !outer && !ocr && <p className="scan-hint">對準名牌或門票，會自動找出文字</p>}
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
            {!armed && !outcome && (
              <button className="btn btn-primary btn-lg btn-block" onClick={() => setArmed(true)}>
                <QrCode size={20} /> 掃描下一張
              </button>
            )}
            {armed && (
              <div className="ocr-live">
                {cam.status === 'ready' ? <QrCode size={18} /> : <Loader2 size={18} className="spin" />}
                <span>{cam.status === 'ready' ? '自動掃描中 · 將 QR Code 放入框內' : '等待相機…'}</span>
              </div>
            )}
          </div>
        )}

        {mode === 'text' && (
          <div className="demo">
            {!ocr ? (
              <>
                <div className="ocr-live">
                  <Loader2 size={18} className="spin" />
                  <span>
                    {ocrState.state === 'loading'
                      ? `正在載入文字辨識 ${Math.round(ocrState.progress * 100)}%…`
                      : cam.status !== 'ready'
                        ? '等待相機…'
                        : sameCard
                          ? '已處理這張名牌，請換下一張'
                          : liveText
                          ? <>看到「<b>{liveText.slice(0, 30)}</b>」，未找到相符嘉賓{purpose === 'souvenir' && '；按「立即辨識」可新增領取人'}</>
                          : '自動辨識中 · 把名牌或門票放在框內'}
                  </span>
                </div>
                <button className="btn btn-ghost btn-block" onClick={doOcr} disabled={ocrBusy || cam.status !== 'ready'}>
                  <ScanText size={18} /> {ocrBusy ? '辨識中…' : '立即辨識'}
                </button>
                <p className="hint center">印刷的姓名、會員編號、邀請編號最準確；手寫字未能辨識</p>
              </>
            ) : ocr.matches.length === 0 ? (
              <div className="ocr-none">
                <OcrEdit value={ocr.text} onChange={editOcr} onClear={clearOcr} />
                <p className="ocr-none-title">找不到相符嘉賓 No matching guest found</p>
                <p className="hint">可在上面直接修改辨識到的文字，名單會即時更新。</p>
                <p className="hint">
                  目前活動：{ev.name} · 共 {index.length} 位嘉賓。如嘉賓屬於另一個活動，請按左上角 × 返回後切換活動。
                </p>
                {purpose === 'souvenir' ? (
                  <NewRecipient text={ocr.text} onGo={registerFromOcr} />
                ) : (
                  <div className="demo-btns">
                    <button onClick={() => nav(`/e/${ev.id}/guests/new`)}>新增嘉賓</button>
                  </div>
                )}
              </div>
            ) : (
              (() => {
                const mismatch = nameMismatch(ocr.matches, ocr.text)
                const conflict = nameIdConflict(ocr.matches)
                // 有完全吻合（姓名或編號）就只列出完全吻合的人；否則才列出後備（同姓差一字、只有姓氏等）
                const exact = ocr.matches.filter((m) => m.score >= 0.95)
                const list = (exact.length ? exact : ocr.matches).slice(0, 5)
                const pick = (m: FuzzyMatch) => {
                  lastOcrPid.current = { pid: m.entry.p.id, text: normalize(ocr.text), misses: 0 }
                  run(ocr.text, 'OCR', m.entry.p.id)
                }
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
            <SearchBar value={q} onChange={setQ} placeholder="姓名／編號／電話／公司／座位" autoFocus />
            <div className="manual-results">
              {!dq && <p className="muted pad center">輸入姓名、編號、電話、公司或座位，結果會即時出現</p>}
              {dq && results.length === 0 && <p className="muted pad">找不到「{dq}」</p>}
              {purpose === 'souvenir' && (
                <Link className="btn btn-mode manual-register" to={`/e/${ev.id}/souvenirs/records?item=${targetId}&tab=pending&reg=1`}>
                  ＋ 即場登記領取人
                </Link>
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
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'active' : ''} onClick={() => (setMode(m), setOcr(null))}>
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
          <X size={14} /> 清除
        </button>
      </span>
      <textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)} autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
    </label>
  )
}
