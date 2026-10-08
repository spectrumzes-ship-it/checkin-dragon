import { useEffect, useRef, useState } from 'react'
import { CircleAlert, CircleCheck, CircleX, Gift, Star } from 'lucide-react'
import type { ScanOutcome } from '../lib/actions'
import { feedback } from '../lib/feedback'
import { useSettings } from '../lib/settings'
import { formatTime } from '../lib/util'
import { names } from '../lib/names'

// 全螢幕驗證結果：顏色 + 符號 + 文字三重提示（色盲亦可分辨）
const LOOK = {
  valid: { tone: 'ok', sym: CircleCheck, en: 'VALID', zh: '有效' },
  manual: { tone: 'info', sym: CircleCheck, en: 'MANUAL CHECK', zh: '手動確認' },
  invalid: { tone: 'bad', sym: CircleX, en: 'INVALID', zh: '無效' },
  no_match: { tone: 'bad', sym: CircleX, en: 'NOT FOUND', zh: '找不到' },
  not_eligible: { tone: 'bad', sym: CircleX, en: 'NOT ELIGIBLE', zh: '不符合資格' },
  duplicate: { tone: 'warn', sym: CircleAlert, en: 'ALREADY CHECKED IN', zh: '已簽到' },
  out_of_stock: { tone: 'warn', sym: CircleAlert, en: 'OUT OF STOCK', zh: '庫存已用完' },
} as const

export type ResultPurpose = 'checkin' | 'rollcall' | 'souvenir'

export const ScanResult = ({
  outcome,
  purpose,
  onDone,
  onReentry,
  onDetails,
}: {
  outcome: ScanOutcome
  purpose: ResultPurpose
  onDone: () => void
  onReentry?: () => void
  onDetails?: () => void
}) => {
  const { autoReturn, language: lang } = useSettings()
  const [paused, setPaused] = useState(false)
  const done = useRef(onDone)
  done.current = onDone
  // 結果剛出現時忽略點擊，避免同一下點擊或誤觸即時跳過結果
  const shownAt = useRef(Date.now())
  const tapToClose = () => {
    if (Date.now() - shownAt.current > 400) onDone()
  }
  const look = { ...LOOK[outcome.result] }
  if (outcome.result === 'duplicate') {
    if (purpose === 'souvenir') Object.assign(look, { en: 'ALREADY COLLECTED', zh: '已領取' })
    if (purpose === 'rollcall') Object.assign(look, { en: 'ALREADY PRESENT', zh: '已點名' })
  }
  if (outcome.result === 'valid' && purpose === 'souvenir') Object.assign(look, { en: 'COLLECT', zh: '可領取' })
  if (outcome.result === 'valid' && purpose === 'rollcall') Object.assign(look, { en: 'PRESENT', zh: '已到' })

  useEffect(() => {
    const r = outcome.result
    feedback(r === 'valid' ? 'valid' : r === 'manual' ? 'manual' : r === 'duplicate' || r === 'out_of_stock' ? 'duplicate' : 'invalid')
  }, [outcome])

  // 重複、無效時多留 1 秒；有席位／車位（宴會、巴士）時多留 3 秒（照顧年長工作人員），讓工作人員看清楚席號及座號
  const hasSeat = purpose !== 'souvenir' && !!outcome.seats?.length
  const delay = autoReturn ? autoReturn + (look.tone === 'warn' || look.tone === 'bad' ? 1000 : 0) + (hasSeat ? 3000 : 0) : 0
  useEffect(() => {
    if (!delay || paused) return
    const t = setTimeout(() => done.current(), delay)
    return () => clearTimeout(t)
  }, [delay, paused])

  const p = outcome.participant
  return (
    <div className={`result tone-${look.tone}`} onClick={tapToClose} role="alert">
      <div className="result-inner">
        <look.sym className="result-sym" strokeWidth={1.6} aria-hidden />
        <div className="result-title">
          <span className="result-en">{look.en}</span>
          <span className="result-zh">{look.zh}</span>
        </div>

        {p && (
          <div className="result-guest">
            <div className="result-name">{names(p).primary}</div>
            {names(p).secondary && <div className="result-name-2">{names(p).secondary}</div>}
            <div className="result-meta">
              {p.vip && (
                <span className="result-vip">
                  <Star size={16} fill="currentColor" /> VIP
                </span>
              )}
              {p.guestCount > 1 && <span>{p.guestCount} 位</span>}
              {p.tags.map((t) => (
                <span key={t} className="result-tag">
                  {t}
                </span>
              ))}
            </div>
            {outcome.seats && outcome.seats.length > 0 && (
              <div className="result-seats">
                {outcome.seats.map((s, i) => (
                  <span key={i}>
                    {/* 中文介面：第 7 席 · 座位 10；英文介面：Table 7 · Seat 10 */}
                    {lang === 'en'
                      ? s.resource.type === 'table'
                        ? `${s.resource.purpose === '晚餐' ? 'Meal ' : ''}Table ${s.resource.label}${s.seatLabel ? ` · Seat ${s.seatLabel}` : ''}`
                        : `Bus ${s.resource.label}${s.seatLabel ? ` · Seat ${s.seatLabel}` : ''}`
                      : s.resource.type === 'table'
                        ? `${s.resource.purpose === '晚餐' ? '餐席 ' : ''}第 ${s.resource.label.replace(/^0+(?=\d)/, '')} 席${s.seatLabel ? ` · 座位 ${s.seatLabel}` : ''}`
                        : `${s.resource.label} 車${s.seatLabel ? ` · 座位 ${s.seatLabel}` : ''}`}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {outcome.souvenir && (outcome.result === 'valid' || outcome.result === 'out_of_stock') && (
          <div className="result-souvenir">
            <Gift size={22} /> {outcome.souvenir.item.name} × {outcome.souvenir.quantity}
          </div>
        )}

        {outcome.reason && <div className="result-reason">{outcome.reason}</div>}
        {outcome.otherEventName && <div className="result-reason">此票屬於：{outcome.otherEventName}</div>}

        <div className="result-time">
          {outcome.result === 'duplicate' && outcome.previousTime
            ? `已於 ${formatTime(outcome.previousTime)} ${purpose === 'souvenir' ? '領取' : purpose === 'rollcall' ? '點名' : '簽到'}`
            : formatTime(outcome.time)}
        </div>

        {outcome.result === 'duplicate' && (onDetails || onReentry) && (
          <div className="result-actions" onClick={(e) => e.stopPropagation()}>
            {onDetails && (
              <button className="btn btn-lg btn-on-result" onClick={onDetails}>
                查看詳情
              </button>
            )}
            {onReentry && (
              <button className="btn btn-lg btn-on-result" onClick={onReentry}>
                再次簽到
              </button>
            )}
          </div>
        )}
        {outcome.result === 'duplicate' && !paused && (onDetails || onReentry) && delay > 0 && (
          <button className="result-pause" onClick={(e) => (e.stopPropagation(), setPaused(true))}>
            暫停自動返回
          </button>
        )}
      </div>

      {delay > 0 && !paused && (
        <div className="result-countdown">
          <span style={{ animationDuration: `${delay}ms` }} />
        </div>
      )}
      <div className="result-hint">點擊任何位置繼續 · Tap anywhere to continue</div>
    </div>
  )
}
