import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true
      },
      "/health": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true
      }
    }
  },
  resolve: {
    preserveSymlinks: true,
  },
  plugins: [react()],
})
