import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/health':   'http://localhost:5555',
      '/config':   'http://localhost:5555',
      '/browse':   'http://localhost:5555',
      '/save':     'http://localhost:5555',
      '/generate': 'http://localhost:5555',
      '/latest':   'http://localhost:5555',
    },
  },
})
