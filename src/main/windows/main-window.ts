import { BrowserWindow } from 'electron'
import { APP_DISPLAY_NAME } from '@shared/constants'
import { isAllowedExternalUrl, openExternalUrl } from '../infrastructure/external/external-link'
import { getPreloadPath, loadRendererRoute } from './renderer-entry'

interface CreateMainWindowOptions {
  icon: string
  onCreated: (window: BrowserWindow) => void
}

/** 创建并加载应用主窗口 */
export function createMainWindow({ icon, onCreated }: CreateMainWindowOptions): void {
  const mainWindow = new BrowserWindow({
    title: APP_DISPLAY_NAME,
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: { preload: getPreloadPath(), sandbox: false },
  })
  onCreated(mainWindow)
  mainWindow.on('ready-to-show', () => {
    mainWindow.maximize()
    mainWindow.show()
  })
  configureWindowNavigation(mainWindow)
  void loadRendererRoute(mainWindow)
}

/** 限制窗口导航边界：应用内导航留在当前窗口，受信任外链交由系统浏览器处理 */
export function configureWindowNavigation(window: BrowserWindow): void {
  // 拦截新窗口请求，并将允许的外链交给系统浏览器。
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url))
      void openExternalUrl(url).catch((error: unknown) => console.error('Failed to open external URL:', url, error))
    return { action: 'deny' }
  })
  // 拦截跨源导航，并将允许的外链交给系统浏览器。
  window.webContents.on('will-navigate', (event, url) => {
    if (isSameAppOrigin(window, url)) return
    event.preventDefault()
    if (isAllowedExternalUrl(url)) {
      void openExternalUrl(url).catch((error: unknown) => console.error('Failed to open external URL:', url, error))
    }
  })
}

function isSameAppOrigin(window: BrowserWindow, url: string): boolean {
  try {
    const currentUrl = window.webContents.getURL()
    return Boolean(currentUrl) && new URL(url).origin === new URL(currentUrl).origin
  } catch {
    return false
  }
}
