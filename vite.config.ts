import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    react(),
    cloudflare(process.env['SWARMS_STATE'] ? { persistState: { path: process.env['SWARMS_STATE'] } } : {}),
  ],
})
