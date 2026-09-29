// 把文字辨識所需檔案複製到 public/vendor，令 App 不需連接外部網站、可離線使用。
// 由 npm run dev / build 自動執行。
import { cpSync, mkdirSync } from 'node:fs'

const out = 'public/vendor'
mkdirSync(`${out}/tesseract`, { recursive: true })
mkdirSync(`${out}/tessdata`, { recursive: true })
cpSync('node_modules/tesseract.js/dist/worker.min.js', `${out}/tesseract/worker.min.js`)
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'])
  cpSync(`node_modules/tesseract.js-core/${f}`, `${out}/tesseract/${f}`)
for (const lang of ['eng', 'chi_tra'])
  cpSync(`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`, `${out}/tessdata/${lang}.traineddata.gz`)
console.log('vendor files copied')
