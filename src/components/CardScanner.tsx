import { useRef, useState } from 'react'
import { Loader2, ScanText, X } from 'lucide-react'
import { grabFromFrame, recognizeCard, useCamera } from '../lib/scanner'
import { extractFields, isDocWord, type CardFields } from '../lib/search'

const LABELS: [keyof CardFields, string][] = [
  ['name', '中文姓名'],
  ['englishName', '英文姓名'],
  ['birthDate', '出生日期'],
  ['idPrefix', '身份證頭 4 位'],
  ['permitNo', '回鄉證號碼'],
  ['permitExpiry', '證件有效期至'],
  ['memberId', '會員編號'],
  ['phone', '電話'],
]

// 登記時用的文字辨識：對準證件或會員證，抽取主要資料填入表格（不保存相片）
export default function CardScanner({ onUse, onClose }: { onUse: (f: CardFields) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const cam = useCamera(videoRef, true)
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<CardFields | null>(null)
  const [msg, setMsg] = useState('')
  const [names, setNames] = useState<string[]>([])

  const read = async () => {
    const v = videoRef.current
    if (!v) return
    setBusy(true)
    setMsg('')
    try {
      canvasRef.current ??= document.createElement('canvas')
      // 只讀取框內的證件範圍，並用較高解像度，細字較清楚
      const ctx = frameRef.current && grabFromFrame(v, frameRef.current, canvasRef.current, 1600, 0.1)
      if (!ctx) return setMsg('未能讀取畫面，請再試')
      const card = await recognizeCard(ctx)
      // 取抽到最多欄位的一次辨識結果（保留分行，姓名和其他資料不會混在一起）
      const best = card.texts.map((t) => extractFields(t)).sort((a, b) => Object.values(b).filter(Boolean).length - Object.values(a).filter(Boolean).length)[0]
      // 中文姓名：以「放大姓名範圍再辨識」的結果為準（較整張卡辨識可靠），並列出其他可能讓工作人員選
      const alts = [...new Set([...card.names.filter((n) => !isDocWord(n)), ...(best?.name && !isDocWord(best.name) ? [best.name] : [])])].slice(0, 4)
      if (best) best.name = alts[0] ?? ''
      setNames(alts)
      if (!best || !Object.values(best).some(Boolean)) return setMsg('辨識不到文字，請對準證件、保持光線充足後再試')
      setFound(best)
    } catch {
      setMsg('文字辨識未能載入，請連接網絡後再試')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cardscan" role="dialog" aria-label="文字辨識">
      <header>
        <strong>文字辨識 · 自動填寫</strong>
        <button className="scan-icon" aria-label="關閉" onClick={onClose}>
          <X size={24} />
        </button>
      </header>
      <div className="cardscan-view">
        <video ref={videoRef} className="camera-video" playsInline muted autoPlay />
        <div ref={frameRef} className="cardscan-frame" aria-hidden />
        {cam.status !== 'ready' && (
          <div className="camera-msg">
            {cam.status === 'starting' ? <Loader2 size={28} className="spin" /> : null}
            <span>{cam.status === 'starting' ? '正在開啟相機…' : '未能使用相機，請允許相機權限，或改用手動輸入'}</span>
          </div>
        )}
      </div>
      <div className="cardscan-panel">
        {found ? (
          <>
            <dl className="ocr-fields">
              {LABELS.filter(([k]) => found[k]).map(([k, zh]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt>{zh}</dt>
                  <dd>{found[k]}</dd>
                </div>
              ))}
            </dl>
            {names.length > 1 && (
              <div className="chips" style={{ marginBottom: 8 }}>
                <span className="muted">中文姓名可能是：</span>
                {names.map((n) => (
                  <button key={n} className={found.name === n ? 'chip active' : 'chip'} onClick={() => setFound({ ...found, name: n })}>
                    {n}
                  </button>
                ))}
              </div>
            )}
            <p className="hint">請核對，中文姓名最容易認錯；填入表格後仍可修改。相片不會保存。</p>
            <div className="cardscan-btns">
              <button className="btn btn-ghost" onClick={() => setFound(null)}>
                重新辨識
              </button>
              <button className="btn btn-primary" onClick={() => onUse(found)}>
                填入表格
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="hint">把證件放滿框內（身份證、回鄉證、會員證），保持平放、光線充足、避免反光，然後按「辨識」。</p>
            {msg && <p className="ocr-warn">{msg}</p>}
            <button className="btn btn-primary btn-block" onClick={read} disabled={busy || cam.status !== 'ready'}>
              <ScanText size={18} /> {busy ? '辨識中…' : '辨識'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
