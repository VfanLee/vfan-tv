import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const DEVELOPMENT_CSP =
  "default-src 'self' data:; script-src 'self' 'unsafe-eval' 'unsafe-inline' data:; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http://127.0.0.1:*; connect-src 'self' ws: wss: https: http://127.0.0.1:*; media-src 'self' https: http://127.0.0.1:* blob:; worker-src 'self' blob:"
const PRODUCTION_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http://127.0.0.1:*; connect-src 'self' https: http://127.0.0.1:*; media-src 'self' https: http://127.0.0.1:* blob:; worker-src 'self' blob:"

/** 根据 Vite 运行模式写入对应的内容安全策略 */
function createContentSecurityPolicyPlugin(isDevelopment: boolean): Plugin {
  return {
    name: 'vfan-tv-content-security-policy',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html.replace('__VFTV_CONTENT_SECURITY_POLICY__', isDevelopment ? DEVELOPMENT_CSP : PRODUCTION_CSP),
    },
  }
}

export default defineConfig(({ command }) => ({
  root: resolve('src/renderer'),
  base: './',
  build: {
    outDir: resolve('.vite/renderer/main_window'),
  },
  css: {
    postcss: resolve('.'),
  },
  resolve: {
    alias: {
      '@': resolve('src/renderer'),
      '@renderer': resolve('src/renderer'),
      '@shared': resolve('src/shared'),
    },
  },
  plugins: [createContentSecurityPolicyPlugin(command === 'serve'), react()],
}))
