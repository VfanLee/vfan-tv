import type { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 返回 Vite 构建后的 preload 脚本路径 */
export function getPreloadPath(): string {
  return join(__dirname, 'preload.js')
}

/** 加载共享 renderer，并通过 hash 选择目标窗口路由 */
export function loadRendererRoute(window: BrowserWindow, route?: string): Promise<void> {
  const url = getRendererUrl()
  if (route) url.hash = route
  return window.loadURL(url.toString())
}

/** 返回开发服务器或打包 renderer 首页地址 */
function getRendererUrl(): URL {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) return new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  return pathToFileURL(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`))
}
