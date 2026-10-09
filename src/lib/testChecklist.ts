// 真機測試清單（測試工具包頁及 TESTING.md 共用內容）
// 每項：要做甚麼 → 應該看到甚麼
export interface TestItem {
  id: string
  do: string
  expect: string
}
export interface TestGroup {
  title: string
  note?: string
  items: TestItem[]
}

export const TEST_GROUPS: TestGroup[] = [
  {
    title: '一、安裝及離線',
    note: '用 iPhone、iPad、Android 各試一次',
    items: [
      { id: 'install', do: '用 Safari／Chrome 打開 ticket.sparky.hk →「加入主畫面」', expect: '主畫面出現點名熊圖示，打開時沒有網址列' },
      { id: 'offline', do: '開飛航模式，再打開 App，簽到一位嘉賓', expect: 'App 照常開啟，簽到成功' },
      { id: 'update', do: '「設定 → 關於」看更新時間', expect: '顯示最新的更新時間' },
    ],
  },
  {
    title: '二、QR 掃描（簽到／驗票）',
    note: '用本頁「QR Code 測試」的卡',
    items: [
      { id: 'qr-valid', do: '掃描「有效票」', expect: '綠色「有效」，嗶一聲；嘉賓變已到' },
      { id: 'qr-dup', do: '再掃同一張', expect: '「已簽到」，三聲短嗶' },
      { id: 'qr-hold', do: '把票一直放在鏡頭前', expect: '不會重複彈出結果；拿開再放才會再讀' },
      { id: 'qr-bad', do: '掃描「無效票」及「其他活動的票」', expect: '「無效」並說明原因，叮咚聲' },
      { id: 'qr-speed', do: '連續掃 10 張', expect: '每張約 1 秒內出結果' },
      { id: 'torch', do: '在暗處按手電筒', expect: '手電筒亮起（部分 iPhone 不支援，按鈕會隱藏）' },
    ],
  },
  {
    title: '三、文字辨識',
    note: '用本頁的名牌及證件測試卡',
    items: [
      { id: 'ocr-name', do: '掃描「文字」模式，對準名牌，按「立即識別」', expect: '畫面定格、掃描線移動，然後找到正確嘉賓' },
      { id: 'ocr-typo', do: '對準「認錯字」及「模糊」名牌', expect: '仍找到或列出可能的嘉賓' },
      { id: 'ocr-none', do: '對準「找不到」名牌', expect: '提示「找不到，是否新增？」，可修改文字、重拍或新增' },
      { id: 'ocr-hkid', do: '新增嘉賓 →「文字辨識 · 自動填寫」，對準身份證測試卡', expect: '姓名、英文名、出生日期、性別、身份證頭 4 位正確' },
      { id: 'ocr-hrp', do: '旅遊活動新增嘉賓，對準回鄉證測試卡', expect: '回鄉證號碼、有效期、簡體姓名正確；可在候選姓名中選擇' },
      { id: 'ocr-time', do: '記下證件辨識所需時間', expect: '大約 5–10 秒（太慢請告訴我）' },
    ],
  },
  {
    title: '四、活動（江戸紫）',
    note: '示範活動「會員講座 2026」',
    items: [
      { id: 'ev-stats', do: '打開統計頁', expect: '大數字卡（已入場）、十格進度、VIP／未到／重複' },
      { id: 'ev-scan', do: '按「掃描門票」掃門票標籤', expect: '簽到成功，最近入場出現「到」印章' },
      { id: 'ev-manual', do: '手動搜尋一位嘉賓，按左邊圓圈', expect: '簽到；再按要確認才取消' },
    ],
  },
  {
    title: '五、宴會（臙脂）',
    note: '示範活動「Annual Dinner 2026」',
    items: [
      { id: 'bq-tables', do: '圍席座位 → 圓桌總覽', expect: '摘要（已入席、滿座）、圓桌、圖例' },
      { id: 'bq-drag', do: '席位名單：按住名字半秒拖到另一座位', expect: '換位或對調；可復原' },
      { id: 'bq-card', do: '掃描座位卡上的 QR', expect: '簽到並顯示席號' },
      { id: 'bq-print', do: '列印每席名單及總名單', expect: 'A4 版面整齊，可存成 PDF' },
    ],
  },
  {
    title: '六、旅遊（浅葱）',
    note: '示範活動「Tokyo Tour · Day 3」',
    items: [
      { id: 'tr-seatmap', do: '點名 → 新點名 → A 車座位表，點幾個座位', expect: '座位變綠並蓋「到」印；嗶一聲' },
      { id: 'tr-swipe', do: '在名單上左右掃動', expect: '在 A 車、B 車、全員名單之間切換' },
      { id: 'tr-status', do: '按「⋯」把一人設為在途中、一人設為請假', expect: '全員名單分別顯示橙色、灰色' },
      { id: 'tr-select', do: '按「選擇」→「全選」→「請假」', expect: '整架車一次設為請假' },
      { id: 'tr-depart', do: '按「確認出發」', expect: '發車鐘聲＋10 秒倒數；可取消；倒數完未上車的人變「未到」' },
      { id: 'tr-late', do: '出發後點一位未到的人', expect: '變「已上車（遲到）」' },
      { id: 'tr-rooms', do: '房間 → 自動分房', expect: '同行人士同房、同性別配對、先用空房' },
      { id: 'tr-print', do: '座位 → 列印', expect: '每架車：一頁座位圖、一頁座位名單' },
    ],
  },
  {
    title: '七、禮品領取（山吹）',
    note: '示範活動「會員禮品派發日」',
    items: [
      { id: 'gf-member', do: '掃描會員卡 QR（禮品：會員紀念品）', expect: '派發成功；同一會員再掃提示已領取' },
      { id: 'gf-fcfs', do: '禮品：環保袋（先到先得）掃描不在名單的 QR', expect: '提示「此 QR 不在名單上」' },
      { id: 'gf-register', do: '領取登記 →「文字辨識 · 自動填寫」對準證件測試卡', expect: '資料填好，登記後派發一份' },
      { id: 'gf-stats', do: '總覽頁', expect: '已派發大數字、十格進度、最近領取「領」印章' },
    ],
  },
  {
    title: '八、聲音、震動及顯示',
    items: [
      { id: 'sound', do: '設定 → 試聽提示音', expect: '嗶、嗶嗶、三聲嗶、叮咚、發車鐘聲都聽得清楚' },
      { id: 'vibrate', do: 'Android 簽到時', expect: '有震動（iPhone 不支援）' },
      { id: 'sun', do: '在戶外陽光下看點名頁及座位表', expect: '文字、顏色仍看得清楚' },
      { id: 'tablet', do: '用 iPad 直放及橫放看首頁、統計、座位表', expect: '文字不跨行，座位格夠大' },
    ],
  },
]
