import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearAll, resetDemo } from '../db/seed'
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

export default function Settings() {
  const s = useSettings()
  const nav = useNavigate()
  const [confirm, setConfirm] = useState<null | 'reset' | 'clear'>(null)
  const set = (p: Partial<S>) => setSettings(p)

  return (
    <div className="page narrow">
      <PageHeader zh="設定" en="Settings" />

      <SectionTitle zh="一般" en="General" />
      <div className="card set-group">
        <Item zh="語言" en="Language" hint="English、日本語 將在第 5 階段加入">
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

      <SectionTitle zh="掃描" en="Scan" />
      <div className="card set-group">
        <Item zh="掃描結果顯示時間" en="Result Display Time" hint="之後自動返回相機；「重複」「無效」會多顯示 1 秒；選「不自動返回」要點一下畫面才返回">
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
        <Item zh="試聽提示音" en="Test Sounds">
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

      <SectionTitle zh="關於" en="About" />
      <div className="card about">
        <img src={logo} alt="點名龍 Logo" width={96} height={96} />
        <div>
          <h3>Check-In Dragon 點名龍</h3>
          <p className="muted">活動・宴會・巴士出席管理</p>
          <p className="muted">版本 0.2.0 · 外觀原型（第 2 階段）</p>
        </div>
      </div>

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
