import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // для GitHub Pages сайт живёт в подпапке: https://<user>.github.io/<repo>/
  base: process.env.BASE_PATH ?? '/',
  server: { port: 5173 },
})
