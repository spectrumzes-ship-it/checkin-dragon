import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { BarcodeDetector as ZXingDetector, prepareZXingModule } from 'barcode-detector/ponyfill'
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import type { Worker as OcrWorker } from 'tesseract.js'

// ================= 相機 =================

export type CameraStatus = 'starting' | 'ready' | 'denied' | 'unavailable' | 'insecure' | 'error'

// 開啟後鏡頭並保持開啟；切換 QR／文字／手動模式時不會重新開關（速度關鍵）
export const useCamera = (videoRef: RefObject<HTMLVideoElement | null>, enabled: boolean) => {
  const [status, setStatus] = useState<CameraStatus>('starting')
  const [torchSupported, setTorchSupported] = useState(false)
  const [torch, setTorchState] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const start = useCallback(async () => {
    if (!window.isSecureContext) return setStatus('insecure')
    if (!navigator.mediaDevices?.getUserMedia) return setStatus('unavailable')
    setStatus('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      streamRef.current = stream
      const v = videoRef.current
      if (v) {
        v.srcObject = stream
        v.setAttribute('playsinline', 'true')
        v.muted = true
        await v.play().catch(() => {})
      }
      const track = stream.getVideoTracks()[0]
      const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean }
      setTorchSupported(!!caps.torch)
      setStatus('ready')
    } catch (e) {
      const name = (e as DOMException).name
      setStatus(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' ? 'unavailable' : 'error')
    }
  }, [videoRef])

  useEffect(() => {
    if (!enabled) return
    start()
    // 切換到其他 App 時關閉鏡頭，回來時重新開啟
    const onVis = () => (document.hidden ? stop() : start())
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      stop()
    }
  }, [enabled, start, stop])

  // 影像框可能比相機遲出現（例如資料仍在載入），每次畫面更新都確保相機影像已接上
  useEffect(() => {
    const v = videoRef.current
    const st = streamRef.current
    if (v && st && v.srcObject !== st) {
      v.srcObject = st
      v.play().catch(() => {})
    }
  })

  const setTorch = useCallback(async (on: boolean) => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
      setTorchState(on)
    } catch {
      setTorchSupported(false)
    }
  }, [])

  return { status, retry: start, torchSupported, torch, setTorch }
}

// 截取畫面中央指定比例的區域（只處理掃描框內的影像，速度較快）
export const grabFrame = (video: HTMLVideoElement, widthRatio: number, aspect: number, canvas: HTMLCanvasElement, maxW = 960) => {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return null
  let w = vw * widthRatio
  let h = w / aspect
  if (h > vh * 0.9) {
    h = vh * 0.9
    w = h * aspect
  }
  const sx = (vw - w) / 2
  const sy = (vh - h) / 2
  const scale = Math.min(1, maxW / w)
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(video, sx, sy, w, h, 0, 0, canvas.width, canvas.height)
  return ctx
}

// ================= QR Code =================

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> }
let detectorPromise: Promise<Detector> | null = null

// Android Chrome 內建 QR 辨識最快；iPhone／其他瀏覽器用 ZXing（已隨 App 下載，可離線）
export const getQrDetector = () =>
  (detectorPromise ??= (async () => {
    const Native = (window as unknown as { BarcodeDetector?: { new (o: object): Detector; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector
    if (Native) {
      try {
        if ((await Native.getSupportedFormats()).includes('qr_code')) return new Native({ formats: ['qr_code'] })
      } catch {
        /* 改用 ZXing */
      }
    }
    prepareZXingModule({
      overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? zxingWasmUrl : prefix + path) },
    })
    return new ZXingDetector({ formats: ['qr_code'] }) as unknown as Detector
  })())

// ================= 文字辨識 OCR =================

const vendor = `${import.meta.env.BASE_URL}vendor/`
let ocrPromise: Promise<OcrWorker> | null = null
export type OcrState = 'idle' | 'loading' | 'ready' | 'error'
let ocrState: OcrState = 'idle'
const ocrListeners = new Set<(s: OcrState, p: number) => void>()
const setOcr = (s: OcrState, p = 0) => {
  ocrState = s
  ocrListeners.forEach((l) => l(s, p))
}

// 第一次使用時下載辨識資料（約 5 MB），之後保存在裝置，離線亦可用
export const getOcr = () =>
  (ocrPromise ??= (async () => {
    setOcr('loading')
    try {
      const { createWorker, PSM } = await import('tesseract.js')
      const worker = await createWorker(['eng', 'chi_tra'], 1, {
        workerPath: `${vendor}tesseract/worker.min.js`,
        corePath: `${vendor}tesseract/`,
        langPath: `${vendor}tessdata/`,
        logger: (m) => m.status?.startsWith('loading') && setOcr('loading', m.progress),
      })
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1' })
      setOcr('ready')
      return worker
    } catch (e) {
      ocrPromise = null
      setOcr('error')
      throw e
    }
  })())

export const useOcrState = () => {
  const [s, setS] = useState<{ state: OcrState; progress: number }>({ state: ocrState, progress: 0 })
  useEffect(() => {
    const l = (state: OcrState, progress: number) => setS({ state, progress })
    ocrListeners.add(l)
    return () => void ocrListeners.delete(l)
  }, [])
  return s
}

// 影像整理：轉灰階後逐區域判斷黑白（適應光暗不均、名牌四周有背景的情況），變成「白底黑字」
const binarize = (ctx: CanvasRenderingContext2D) => {
  const { width: w, height: h } = ctx.canvas
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const gray = new Float32Array(w * h)
  for (let i = 0, j = 0; i < d.length; i += 4, j++) gray[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
  // 積分圖：快速計算每點附近的平均亮度
  const integ = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x]
      integ[(y + 1) * (w + 1) + x + 1] = integ[y * (w + 1) + x + 1] + row
    }
  }
  const r = Math.max(8, Math.round(Math.min(w, h) / 8))
  let darkCount = 0
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1)
      const sum = integ[y1 * (w + 1) + x1] - integ[y0 * (w + 1) + x1] - integ[y1 * (w + 1) + x0] + integ[y0 * (w + 1) + x0]
      const mean = sum / ((x1 - x0) * (y1 - y0))
      const dark = gray[y * w + x] < mean * 0.85
      out[y * w + x] = dark ? 0 : 255
      if (dark) darkCount++
    }
  }
  // 深底淺字（例如黑色名牌）：反轉成白底黑字
  if (darkCount > w * h * 0.5) for (let j = 0; j < out.length; j++) out[j] = 255 - out[j]
  removeFrames(out, w, h)
  for (let i = 0, j = 0; i < d.length; i += 4, j++) d[i] = d[i + 1] = d[i + 2] = out[j]
  ctx.putImageData(img, 0, 0)
}

// 清除不似文字的黑色大區塊（例如名牌邊緣、桌面陰影形成的長框），只保留字形
const removeFrames = (px: Uint8Array, w: number, h: number) => {
  const seen = new Uint8Array(w * h)
  const stack: number[] = []
  const comp: number[] = []
  for (let start = 0; start < px.length; start++) {
    if (px[start] !== 0 || seen[start]) continue
    stack.push(start)
    seen[start] = 1
    comp.length = 0
    let minX = w, maxX = 0, minY = h, maxY = 0
    while (stack.length) {
      const i = stack.pop()!
      comp.push(i)
      const x = i % w, y = (i / w) | 0
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]
      for (const n of nb) if (n >= 0 && px[n] === 0 && !seen[n]) (seen[n] = 1), stack.push(n)
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1
    const tooBig = bw > w * 0.6 || bh > h * 0.75
    const tooSmall = comp.length < 6 // 雜點
    const thinLine = (bw > h * 1.5 && bh < 6) || (bh > h * 0.5 && bw < 6)
    if (tooBig || tooSmall || thinLine) for (const i of comp) px[i] = 255
  }
}

const clean = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.replace(/[^\p{L}\p{N}]/gu, '').length >= 2)

export const recognizeText = async (ctx: CanvasRenderingContext2D) => {
  const worker = await getOcr()
  // 先試原圖；認不到再試整理成黑白的版本
  const first = await worker.recognize(ctx.canvas)
  let lines = clean(first.data.text)
  let confidence = first.data.confidence
  if (!lines.length || confidence < 55) {
    binarize(ctx)
    const second = await worker.recognize(ctx.canvas)
    const l2 = clean(second.data.text)
    if (l2.length && second.data.confidence >= confidence) {
      lines = l2
      confidence = second.data.confidence
    }
  }
  return { text: lines.join(' '), lines, confidence }
}

// 活動前預先載入文字辨識（「準備離線使用」）
export const warmUpOcr = () => getOcr().then(() => true).catch(() => false)
