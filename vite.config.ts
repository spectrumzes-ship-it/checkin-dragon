import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 網址：https://spectrumzes-ship-it.github.io/checkin-dragon/
export default defineConfig({
  base: '/checkin-dragon/',
  plugins: [react()],
  server: { host: true },
  test: { environment: 'node' },
})
