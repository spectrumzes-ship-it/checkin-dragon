import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages 網址：https://spectrumzes-ship-it.github.io/checkin-dragon/
// 版本更新時間（香港時間），顯示在「設定 → 關於」，方便確認裝置已更新
const built = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')

export default defineConfig({
  base: '/checkin-dragon/',
  define: { __BUILD_TIME__: JSON.stringify(built) },
  plugins: [
    react(),
    // 可「加到主畫面」及離線使用的網頁 App
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Check-In Dragon 點名龍',
        short_name: '點名龍',
        description: '活動・宴會・巴士出席管理',
        lang: 'zh-Hant',
        start_url: '/checkin-dragon/',
        scope: '/checkin-dragon/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#FAF9F6',
        theme_color: '#FAF9F6',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
