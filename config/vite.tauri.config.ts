import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve('src'),
  base: './',
  clearScreen: false,
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  build: {
    outDir: resolve('dist/tauri'),
    emptyOutDir: true,
    target: ['es2021', 'safari17'],
  },
  css: { postcss: resolve('.') },
  resolve: {
    alias: {
      '@': resolve('src'),
    },
  },
  plugins: [react()],
})
