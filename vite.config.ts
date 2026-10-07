import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  // Lets `cloudflared tunnel --url http://localhost:5173` reach the dev server (phones need HTTPS).
  server: { allowedHosts: ['.trycloudflare.com'] },
})
