import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useOcrState, warmUpOcr } from '../lib/scanner'
import { Sheet } from '../components/ui'
import { clearAll, DEMO_VERSION, demoVersionOnDevice, resetDemo } from '../db/seed'
import { setSettings, useSettings, type Settings as S } from '../lib/settings'
import { feedback } from '../lib/feedback'
import { cx } from '../lib/util'
import { ConfirmSheet, PageHeader, SectionTitle, toast } from '../components/ui'

const logo = `${import.meta.env.BASE_URL}icons/logo-256.png`

const Seg = <T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) => (
  <div className="seg" role="radiogroup">
    {options.map(([v, label]) => (
      <button key={String(v)} role="radio" aria-checked={value === v} className={cx(value === v && 'active')} onClick={() => onChange(v)}>
        {label}
      </button>
    ))}
  </div>
)

const Toggle = ({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) => (
  <button role="switch" aria-checked={on} aria-label={label} className={cx('toggle', on && 'on')} onClick={() => onChange(!on)}>
    <span />
  </button>
)

const Item = ({ zh, en, hint, children }: { zh: string; en: string; hint?: string; children: ReactNode }) => (
  <div className="set-item">
    <div className="set-label">
      <span>{zh}</span>
      <small>{en}</small>
      {hint && <em>{hint}</em>}
    </div>
    <div className="set-control">{children}</div>
  </div>
)

// 可自訂的選項清單：點 ✕ 刪除，輸入後按「新增」
const ListEditor = ({ zh, en, hint, placeholder, values, onChange }: { zh: string; en: string; hint: string; placeholder: string; values: string[]; onChange: (v: string[]) => void }) => {
  const [text, setText] = useState('')
  const add = () => {
    const t = text.trim()
    if (!t) return
    if (!values.includes(t)) onChange([...values, t])
    setText('')
  }
  return (
    <div className="set-item set-list">
      <div className="set-label">
        <span>{zh}</span>
        <small>{en}</small>
        <em>{hint}</em>
      </div>
      <div className="chips">
        {values.map((v) => (
          <span key={v} className="chip active">
            {v}
            <button className="chip-x" aria-label={`刪除 ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
              ✕
            </button>
          </span>
        ))}
        {!values.length && <span className="muted">未有選項</span>}
      </div>
      <form
        className="set-list-add"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input className="set-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={`新增${zh}`} />
        <button className="btn btn-mode btn-sm" type="submit">
          新增
        </button>
      </form>
    </div>
  )
}

export default function Settings() {
  const s = useSettings()
  const nav = useNavigate()
  const [confirm, setConfirm] = useState<null | 'reset' | 'clear'>(null)
  const [guide, setGuide] = useState(false)
  const [camGuide, setCamGuide] = useState(false)
  const ocr = useOcrState()
  const installed = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  const set = (p: Partial<S>) => setSettings(p)

  return (
    <div className="page narrow">
      <PageHeader zh="設定" en="Settings" />

      <SectionTitle zh="一般" en="General" />
      <div className="card set-group">
        <Item zh="語言" en="Language" hint="簡體中文、English 將在第 5 階段加入">
          <Seg value="zh" options={[['zh', '繁體中文']]} onChange={() => {}} />
        </Item>
        <Item zh="姓名顯示" en="Name Order" hint="例：陳大文 CHAN TAI MAN／CHAN TAI MAN 陳大文">
          <Seg
            value={s.nameOrder}
            options={[['auto', '跟隨語言'], ['zh', '中文名先'], ['en', '英文名先']]}
            onChange={(v) => set({ nameOrder: v })}
          />
        </Item>
        <Item zh="外觀" en="Theme">
          <Seg value={s.theme} options={[['light', '淺色'], ['dark', '深色'], ['system', '跟隨系統']]} onChange={(v) => set({ theme: v })} />
        </Item>
      </div>

      <SectionTitle zh="嘉賓資料選項" en="Guest Options" />
      <div className="card set-group">
        <ListEditor
          zh="特別需要"
          en="Special Notes"
          hint="新增／修改嘉賓時可選擇的項目。刪除選項不會改動已經選了的嘉賓。"
          placeholder="例如 嬰兒椅"
          values={s.specialNotes}
          onChange={(v) => set({ specialNotes: v })}
        />
        <ListEditor
          zh="禮物組別"
          en="Gift Groups"
          hint="自訂哪一類嘉賓可以領取禮物（例如 贊助商、工作人員）。在嘉賓資料選擇組別，再在紀念品的「領取資格」選「只限該組別」。"
          placeholder="例如 贊助商"
          values={s.giftGroups}
          onChange={(v) => set({ giftGroups: v })}
        />
      </div>

      <SectionTitle zh="掃描" en="Scan" />
      <div className="card set-group">
        <Item zh="掃描結果顯示時間" en="Result Display Time" hint="之後自動返回相機；有席位或車位（宴會、巴士）會多顯示 3 秒，「重複」「無效」多 1 秒；點一下畫面可提早返回">
          <select className="set-input set-select" value={s.autoReturn} onChange={(e) => set({ autoReturn: Number(e.target.value) })}>
            {[
              [1000, '1 秒'],
              [1500, '1.5 秒'],
              [2000, '2 秒'],
              [3000, '3 秒'],
              [5000, '5 秒'],
              [8000, '8 秒'],
              [10000, '10 秒'],
              [0, '不自動返回'],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Item>
        <Item zh="提示音" en="Scan Sound">
          <Toggle
            label="提示音"
            on={s.sound}
            onChange={(v) => {
              set({ sound: v })
              if (v) setTimeout(() => feedback('valid'), 0)
            }}
          />
        </Item>
        <Item zh="震動" en="Vibration" hint="iPhone／iPad 不支援">
          <Toggle label="震動" on={s.vibration} onChange={(v) => set({ vibration: v })} />
        </Item>
        <Item zh="連續掃描" en="Continuous Scan">
          <Toggle label="連續掃描" on={s.continuousScan} onChange={(v) => set({ continuousScan: v })} />
        </Item>
        <Item zh="預設掃描方式" en="Default Scan Mode">
          <Seg value={s.defaultScanMode} options={[['qr', 'QR'], ['text', '文字'], ['last', '上次使用']]} onChange={(v) => set({ defaultScanMode: v })} />
        </Item>
        <Item zh="試聽提示音" en="Test Sounds" hint="參考日本車站改札機及發車鐘聲（原創合成）">
          <div className="chips">
            <button className="chip" onClick={() => feedback('valid')}>
              有效
            </button>
            <button className="chip" onClick={() => feedback('invalid')}>
              無效
            </button>
            <button className="chip" onClick={() => feedback('duplicate')}>
              重複
            </button>
            <button className="chip" onClick={() => feedback('manual')}>
              手動
            </button>
            <button className="chip" onClick={() => feedback('depart')}>
              確認出發
            </button>
          </div>
        </Item>
      </div>

      <SectionTitle zh="操作員與裝置" en="Operator & Device" />
      <div className="card set-group">
        <Item zh="操作員名字" en="Operator" hint="會記錄在每一個操作">
          <input className="set-input" value={s.operator} onChange={(e) => set({ operator: e.target.value })} />
        </Item>
        <Item zh="裝置名稱" en="Device" hint="例如 iPad 1 · 入口 A">
          <input className="set-input" value={s.deviceName} onChange={(e) => set({ deviceName: e.target.value })} />
        </Item>
        <Item zh="身份與密碼" en="Roles & PIN" hint="第 5 階段加入">
          <span className="muted">管理員</span>
        </Item>
      </div>

      <SectionTitle zh="資料" en="Data" />
      <div className="card set-group">
        <Item zh="匯入／匯出／備份" en="Import · Export · Backup" hint="第 4–5 階段加入">
          <span className="muted">—</span>
        </Item>
        <Item zh="重設示範資料" en="Reset Demo Data" hint="清除所有資料並重新載入示範活動">
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirm('reset')}>
            重設
          </button>
        </Item>
        <Item zh="清除所有資料" en="Clear All Data">
          <button className="btn btn-danger-ghost btn-sm" onClick={() => setConfirm('clear')}>
            清除
          </button>
        </Item>
      </div>

      <SectionTitle zh="裝置與離線" en="Device & Offline" />
      <div className="card set-group">
        <Item zh="加到主畫面" en="Install App" hint={installed ? '已安裝，現正以 App 形式使用' : undefined}>
          {installed ? <span className="badge tone-ok">已安裝</span> : <button className="btn btn-ghost btn-sm" onClick={() => setGuide(true)}>教我安裝</button>}
        </Item>
        <Item zh="相機權限" en="Camera Permission" hint="iPhone／iPad 每次都要按「允許」？可改為永久允許">
          <button className="btn btn-ghost btn-sm" onClick={() => setCamGuide(true)}>
            設定方法
          </button>
        </Item>
        <Item zh="文字辨識資料" en="Text Recognition Data" hint="約 5 MB，下載後離線亦可使用文字辨識">
          {ocr.state === 'ready' ? (
            <span className="badge tone-ok">已準備</span>
          ) : ocr.state === 'loading' ? (
            <span className="muted">下載中 {Math.round(ocr.progress * 100)}%</span>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => warmUpOcr().then((ok) => toast(ok ? '文字辨識已準備好，離線亦可使用' : '下載失敗，請連接網絡後再試'))}>
              {ocr.state === 'error' ? '重試下載' : '立即下載'}
            </button>
          )}
        </Item>
        <Item zh="測試工具包" en="Test Kit" hint="可列印的測試 QR Code 及名牌">
          <Link to="/test-kit" className="btn btn-ghost btn-sm">
            打開
          </Link>
        </Item>
      </div>

      <SectionTitle zh="關於" en="About" />
      <div className="card about">
        <img src={logo} alt="點名龍 Logo" width={96} height={96} />
        <div>
          <h3>Check-In Dragon 點名龍</h3>
          <p className="muted">活動・宴會・旅遊、禮品管理</p>
          <p className="muted">製作者：Kevin</p>
          <p className="muted">版權所有 SPARKY</p>
          <p>
            <a href="https://www.sparky.hk" target="_blank" rel="noreferrer">
              www.sparky.hk
            </a>
          </p>
          <p className="muted">版本 0.3.0 · 核心功能（第 3 階段）</p>
          <p className="muted">更新時間 {__BUILD_TIME__}</p>
          <p className="muted">
            示範資料版本 v{demoVersionOnDevice() || '—'}
            {demoVersionOnDevice() !== DEMO_VERSION && ` · 最新為 v${DEMO_VERSION}，可按「重設示範資料」更新`}
          </p>
        </div>
      </div>

      <Sheet open={camGuide} onClose={() => setCamGuide(false)} title="相機權限 Camera">
        <div className="guide">
          <p className="hint">iPhone／iPad 的 Safari 預設每次重新開啟網頁都會詢問相機權限。改為「允許」後就不會再問。</p>
          <h4>方法一：只針對本 App（建議）</h4>
          <ol>
            <li>用 Safari 打開本 App 的網址</li>
            <li>按網址列左邊的「大小」／「ᴀA」圖示</li>
            <li>按「網站設定」</li>
            <li>把「相機」改為「允許」</li>
          </ol>
          <h4>方法二：所有網站</h4>
          <ol>
            <li>打開 iPhone「設定」App</li>
            <li>App → Safari（舊版 iOS：直接按 Safari）</li>
            <li>網站設定 → 相機 → 允許</li>
          </ol>
          <h4>Android（Chrome）</h4>
          <ol>
            <li>第一次按「允許」後會自動記住</li>
            <li>如曾按「封鎖」：網址列左邊圖示 → 權限 → 相機 → 允許</li>
          </ol>
        </div>
      </Sheet>
      <Sheet open={guide} onClose={() => setGuide(false)} title="加到主畫面 Install">
        <div className="guide">
          <h4>iPhone／iPad（Safari）</h4>
          <ol>
            <li>用 Safari 打開本 App 的網址</li>
            <li>按底部（iPad 在頂部）的「分享」按鈕 □↑</li>
            <li>向下捲動，按「加入主畫面」</li>
            <li>按「新增」，主畫面就會出現小龍圖示</li>
          </ol>
          <h4>Android（Chrome）</h4>
          <ol>
            <li>用 Chrome 打開本 App 的網址</li>
            <li>按右上角「⋮」</li>
            <li>按「安裝應用程式」或「加到主畫面」</li>
          </ol>
          <h4>電腦（Chrome／Edge）</h4>
          <ol>
            <li>按網址列右邊的「安裝」圖示</li>
          </ol>
          <p className="hint">安裝後由主畫面圖示打開，沒有網絡也可以使用。iPhone 必須加到主畫面，資料才不會被 Safari 自動清除。</p>
        </div>
      </Sheet>
      <ConfirmSheet
        open={confirm === 'reset'}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          await resetDemo()
          set({ currentEventId: null })
          toast('已重設示範資料')
          nav('/')
        }}
        title="重設示範資料"
        message={<p>所有活動、嘉賓和紀錄會被清除，並重新載入示範資料。</p>}
        confirmText="重設"
        danger
      />
      <ConfirmSheet
        open={confirm === 'clear'}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          await clearAll()
          set({ currentEventId: null })
          toast('已清除所有資料')
          nav('/')
        }}
        title="清除所有資料"
        message={<p>這部裝置上的所有活動、嘉賓和紀錄會被永久清除，無法復原。</p>}
        confirmText="清除"
        danger
        requireText="清除"
      />
    </div>
  )
}
