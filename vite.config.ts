import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // для GitHub Pages сайт живёт в подпапке: https://<user>.github.io/<repo>/
  base: process.env.BASE_PATH ?? '/',
  // usePolling: на этой машине Vite иногда пропускает изменения файлов и показывает устаревший код
  server: { port: 5173, watch: { usePolling: true, interval: 300 } },
})
