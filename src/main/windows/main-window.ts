import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import type { AppSettings } from '@shared/types'
import { APP_DISPLAY_NAME } from '@shared/constants'
import { isAllowedExternalUrl, openExternalUrl } from '../infrastructure/external/external-link'

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
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false },
  })
  onCreated(mainWindow)
  mainWindow.on('ready-to-show', () => {
    mainWindow.maximize()
    mainWindow.show()
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url))
      void openExternalUrl(url, getSettings()).catch((error: unknown) =>
        console.error('Failed to open external URL:', url, error),
      )
    return { action: 'deny' }
  })
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
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

function isSameAppOrigin(window: BrowserWindow, url: string): boolean {
  try {
    const currentUrl = window.webContents.getURL()
    return Boolean(currentUrl) && new URL(url).origin === new URL(currentUrl).origin
  } catch {
    return false
  }
}
