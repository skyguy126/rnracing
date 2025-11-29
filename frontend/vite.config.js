import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../static',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    proxy: {
      '/data': {
        target: `http://localhost:${process.env.PORT || 5000}`,
        changeOrigin: true,
      },
      '/events': {
        target: `http://localhost:${process.env.PORT || 5000}`,
        changeOrigin: true,
      },
      '/tiles': {
        target: `http://localhost:${process.env.PORT || 5000}`,
        changeOrigin: true,
      },
    },
  },
})

