import { useRef, useState } from 'react'
import { Loader2, ScanText, X } from 'lucide-react'
import { grabView, recognizeText, useCamera } from '../lib/scanner'
import { extractFields, type CardFields } from '../lib/search'

const LABELS: [keyof CardFields, string][] = [
  ['name', '中文姓名'],
  ['englishName', '英文姓名'],
  ['birthDate', '出生日期'],
  ['idPrefix', '身份證頭 4 位'],
  ['memberId', '會員編號'],
  ['phone', '電話'],
]

// 登記時用的文字辨識：對準證件或會員證，抽取主要資料填入表格（不保存相片）
export default function CardScanner({ onUse, onClose }: { onUse: (f: CardFields) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const cam = useCamera(videoRef, true)
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<CardFields | null>(null)
  const [msg, setMsg] = useState('')

  const read = async () => {
    const v = videoRef.current
    if (!v) return
    setBusy(true)
    setMsg('')
    try {
      canvasRef.current ??= document.createElement('canvas')
      const view = grabView(v, canvasRef.current, 1280)
      if (!view) return setMsg('未能讀取畫面，請再試')
      const reads = await recognizeText(view.ctx, true)
      // 取抽到最多欄位的一次辨識結果
      const best = reads.map((r) => extractFields(r.text)).sort((a, b) => Object.values(b).filter(Boolean).length - Object.values(a).filter(Boolean).length)[0]
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
            <p className="hint">請核對；填入表格後仍可修改。相片不會保存。</p>
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
            <p className="hint">把證件或會員證放在畫面中央，文字要清晰，然後按「辨識」。</p>
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
