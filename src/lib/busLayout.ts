// 巴士座位排列：參考香港常見旅遊巴士／中巴／小巴的座位數量
export type BusLayout = '2+1' | '2+2' | '3+2'

export const BUS_LAYOUTS: [BusLayout, string][] = [
  ['2+1', '2＋1（每排 3 個）'],
  ['2+2', '2＋2（每排 4 個）'],
  ['3+2', '3＋2（每排 5 個）'],
]

export const BUS_PRESETS: { seats: number; layout: BusLayout; zh: string }[] = [
  { seats: 19, layout: '2+1', zh: '小巴 19 座' },
  { seats: 24, layout: '2+1', zh: '中巴 24 座' },
  { seats: 29, layout: '2+1', zh: '中巴 29 座' },
  { seats: 45, layout: '2+2', zh: '旅遊巴 45 座' },
  { seats: 49, layout: '2+2', zh: '旅遊巴 49 座' },
  { seats: 53, layout: '2+2', zh: '旅遊巴 53 座' },
  { seats: 57, layout: '2+2', zh: '旅遊巴 57 座' },
  { seats: 61, layout: '3+2', zh: '大型旅遊巴 61 座' },
  { seats: 65, layout: '3+2', zh: '大型旅遊巴 65 座' },
]

// 沒有指定排列時按座位數估計
export const defaultLayout = (capacity: number): BusLayout => (capacity <= 29 ? '2+1' : capacity >= 58 ? '3+2' : '2+2')

// 每一排的座位號；null = 通道。座位數剛好時，最後一排是橫跨通道的長排（多一個座位）
export const busRows = (capacity: number, layout: BusLayout): (number | null)[][] => {
  const [a, b] = layout.split('+').map(Number)
  const per = a + b
  const bench = capacity > per + 1 && (capacity - (per + 1)) % per === 0
  const normal = bench ? (capacity - (per + 1)) / per : Math.ceil(capacity / per)
  const rows: (number | null)[][] = []
  let n = 1
  for (let r = 0; r < normal; r++) {
    const row: (number | null)[] = []
    for (let c = 0; c < per + 1; c++) {
      if (c === a) row.push(null)
      else row.push(n <= capacity ? n++ : 0)
    }
    rows.push(row)
  }
  if (bench) rows.push(Array.from({ length: per + 1 }, () => n++))
  return rows
}
