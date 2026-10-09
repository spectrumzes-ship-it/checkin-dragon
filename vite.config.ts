import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// 網址：https://ticket.sparky.hk/（GitHub Pages 自訂網域）
// 使用相對路徑（./），放在網域根目錄或任何子路徑都可以運作，日後搬到其他寄存空間亦不用修改
// 版本更新時間（香港時間），顯示在「設定 → 關於」，方便確認裝置已更新
const built = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')

export default defineConfig({
  base: './',
  define: { __BUILD_TIME__: JSON.stringify(built) },
  plugins: [
    react(),
    // 可「加到主畫面」及離線使用的網頁 App
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: '點名熊 Check-In Bear',
        short_name: '點名熊',
        description: '活動・宴會・旅遊・禮品領取的簽到及點名',
        lang: 'zh-Hant',
        start_url: './',
        scope: './',
        id: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#FAF9F6',
        theme_color: '#FAF9F6',
        icons: [
          { src: 'icons/icon-192.png?v=bear', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png?v=bear', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png?v=bear', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App 本身（包括 QR 辨識程式）全部預先保存；文字辨識檔案較大，第一次使用時才保存
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,wasm}'],
        globIgnores: ['vendor/**'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/vendor/'),
            handler: 'CacheFirst',
            options: { cacheName: 'ocr-vendor', expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
  server: { host: true },
  test: { environment: 'node' },
})
