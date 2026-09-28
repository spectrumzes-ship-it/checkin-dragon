// 空白狀態插畫：圓角線條、雙色、簡潔。全部自行繪畫，顏色跟隨主題。

const S = { stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
const soft = 'var(--mode-bg)'

const Face = ({ x, y }: { x: number; y: number }) => (
  <g>
    <circle cx={x - 6} cy={y} r="1.6" fill="currentColor" />
    <circle cx={x + 6} cy={y} r="1.6" fill="currentColor" />
    <path d={`M${x - 4} ${y + 6} q4 3 8 0`} {...S} strokeWidth={1.8} />
  </g>
)

export const CalendarArt = () => (
  <svg viewBox="0 0 120 110" width="120" height="110" fill="none" aria-hidden>
    <rect x="22" y="22" width="76" height="70" rx="14" fill={soft} {...S} />
    <path d="M22 42h76" {...S} />
    <path d="M42 14v16M78 14v16" {...S} />
    <Face x={60} y={62} />
    <circle cx="100" cy="24" r="3" fill="currentColor" opacity=".25" />
    <circle cx="16" cy="80" r="2" fill="currentColor" opacity=".25" />
  </svg>
)

export const BusArt = () => (
  <svg viewBox="0 0 120 110" width="120" height="110" fill="none" aria-hidden>
    <rect x="18" y="24" width="84" height="56" rx="14" fill={soft} {...S} />
    <path d="M18 52h84" {...S} />
    <rect x="28" y="32" width="26" height="14" rx="4" {...S} />
    <rect x="66" y="32" width="26" height="14" rx="4" {...S} />
    <circle cx="38" cy="84" r="7" fill="var(--surface)" {...S} />
    <circle cx="82" cy="84" r="7" fill="var(--surface)" {...S} />
    <Face x={60} y={62} />
  </svg>
)

export const TicketArt = () => (
  <svg viewBox="0 0 120 110" width="120" height="110" fill="none" aria-hidden>
    <path d="M20 34a8 8 0 0 1 8-8h64a8 8 0 0 1 8 8v8a10 10 0 0 0 0 20v8a8 8 0 0 1-8 8H28a8 8 0 0 1-8-8v-8a10 10 0 0 0 0-20z" fill={soft} {...S} />
    <path d="M78 30v50" {...S} strokeDasharray="3 6" />
    <Face x={49} y={52} />
  </svg>
)

export const TableArt = () => (
  <svg viewBox="0 0 120 110" width="120" height="110" fill="none" aria-hidden>
    <ellipse cx="60" cy="58" rx="34" ry="22" fill={soft} {...S} />
    <circle cx="60" cy="22" r="7" {...S} />
    <circle cx="20" cy="58" r="7" {...S} />
    <circle cx="100" cy="58" r="7" {...S} />
    <circle cx="60" cy="94" r="7" {...S} />
    <Face x={60} y={54} />
  </svg>
)

export const GiftArt = () => (
  <svg viewBox="0 0 120 110" width="120" height="110" fill="none" aria-hidden>
    <rect x="26" y="44" width="68" height="48" rx="10" fill={soft} {...S} />
    <rect x="22" y="32" width="76" height="16" rx="6" fill="var(--surface)" {...S} />
    <path d="M60 32v60" {...S} />
    <path d="M60 32c-6-12-22-12-20-2s20 2 20 2c6-12 22-12 20-2s-20 2-20 2" {...S} />
    <Face x={60} y={68} />
  </svg>
)

export const GuestsArt = () => (
  <svg viewBox="0 0 120 110" width="120" height="110" fill="none" aria-hidden>
    <circle cx="46" cy="42" r="14" fill={soft} {...S} />
    <path d="M22 88c2-16 12-24 24-24s22 8 24 24" fill={soft} {...S} />
    <circle cx="82" cy="48" r="11" {...S} />
    <path d="M70 70c4-3 8-4 12-4 10 0 18 7 19 22" {...S} />
    <circle cx="42" cy="41" r="1.4" fill="currentColor" />
    <circle cx="50" cy="41" r="1.4" fill="currentColor" />
  </svg>
)
