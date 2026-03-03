import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Restrict to localhost only — prevents DNS rebinding attacks and
    // eliminates "wildcard allows all origins" security warnings.
    host: '127.0.0.1',
    allowedHosts: ['localhost', '127.0.0.1'],
    cors: {
      origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/],
    },
  },
})
