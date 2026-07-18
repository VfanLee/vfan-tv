import { BrowserWindow } from 'electron'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { is } from '@electron-toolkit/utils'
import type { AppSettings } from '@shared/types'
import { APP_DISPLAY_NAME } from '@shared/constants'
import { isAllowedExternalUrl, openExternalUrl } from '../infrastructure/external/external-link'

const currentDirectory = dirname(fileURLToPath(import.meta.url))

// 主窗口及其导航边界。窗口创建后通过回调登记，避免 IPC 层保存全局窗口引用。
interface CreateMainWindowOptions {
  icon: string
  getSettings: () => AppSettings
  onCreated: (window: BrowserWindow) => void
}

export function createMainWindow({ icon, getSettings, onCreated }: CreateMainWindowOptions): void {
  const mainWindow = new BrowserWindow({
    title: APP_DISPLAY_NAME,
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: { preload: join(currentDirectory, '../preload/index.mjs'), sandbox: false },
  })
  onCreated(mainWindow)
  mainWindow.on('ready-to-show', () => {
    mainWindow.maximize()
    mainWindow.show()
  })
  // 阻止渲染页自行打开新窗口；合法外链仍需显式确认后交给系统浏览器。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url))
      void openExternalUrl(url, getSettings()).catch((error: unknown) =>
        console.error('Failed to open external URL:', url, error),
      )
    return { action: 'deny' }
  })
  // 只允许应用自身源内导航，防止远程页面接管 Electron 渲染进程。
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isSameAppOrigin(mainWindow, url)) return
    if (isAllowedExternalUrl(url)) {
      event.preventDefault()
      void openExternalUrl(url, getSettings()).catch((error: unknown) =>
        console.error('Failed to open external URL:', url, error),
      )
    }
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void mainWindow.loadFile(join(currentDirectory, '../renderer/index.html'))
}

function isSameAppOrigin(window: BrowserWindow, url: string): boolean {
  try {
    const currentUrl = window.webContents.getURL()
    return Boolean(currentUrl) && new URL(url).origin === new URL(currentUrl).origin
  } catch {
    return false
  }
}
