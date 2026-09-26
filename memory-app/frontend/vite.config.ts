import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The browser only talks to Vite (port 5173). Requests to /api/* are forwarded
// to FastAPI on port 8000, so the backend needs no CORS setup.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
