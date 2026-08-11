import { BrowserWindow, nativeTheme } from 'electron'
import type { SettingsSectionId } from '@shared/types'
import { IPC_CHANNELS } from '@shared/ipc'
import { APP_DISPLAY_NAME } from '@shared/constants'
import { configureWindowNavigation } from './main-window'

interface SettingsWindowManagerOptions {
  getMainWindow: () => BrowserWindow | null
  icon: string
}

let managerOptions: SettingsWindowManagerOptions | undefined
let settingsWindow: BrowserWindow | null = null
let pendingSection: SettingsSectionId | undefined

/** 配置设置窗口管理器 */
export function configureSettingsWindowManager(options: SettingsWindowManagerOptions): void {
  managerOptions = options
}

/** 打开或聚焦单例设置窗口，并把目标设置分区同步到已存在的窗口 */
export function showSettingsWindow(section?: SettingsSectionId): void {
  if (!managerOptions) throw new Error('Settings window manager is not configured')

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore()
    settingsWindow.show()
    settingsWindow.focus()
    if (section) {
      if (settingsWindow.webContents.isLoadingMainFrame()) pendingSection = section
      else settingsWindow.webContents.send(IPC_CHANNELS.window.settingsSectionChanged, section)
    }
    return
  }

  const initialSection = section ?? 'appearance'
  pendingSection = initialSection
  const window = new BrowserWindow({
    title: `设置 - ${APP_DISPLAY_NAME}`,
    width: 1080,
    height: 760,
    minWidth: 860,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    icon: managerOptions.icon,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#171717' : '#ffffff',
    webPreferences: { preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY, sandbox: false },
  })
  settingsWindow = window

  configureWindowNavigation(window)
  window.webContents.on('did-finish-load', () => {
    if (settingsWindow !== window || window.isDestroyed()) return
    if (!pendingSection) return
    window.webContents.send(IPC_CHANNELS.window.settingsSectionChanged, pendingSection)
    pendingSection = undefined
  })
  window.once('ready-to-show', () => {
    centerOverMainWindow(window, managerOptions?.getMainWindow() ?? null)
    window.show()
  })
  window.once('closed', () => {
    if (settingsWindow === window) settingsWindow = null
    pendingSection = undefined
  })
  void window.loadURL(`${MAIN_WINDOW_WEBPACK_ENTRY}#/settings?section=${encodeURIComponent(initialSection)}`)
}

/** 关闭设置窗口 */
export function closeSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close()
  settingsWindow = null
  pendingSection = undefined
}

/** 获取当前设置窗口 */
export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null
}

function centerOverMainWindow(window: BrowserWindow | null, mainWindow: BrowserWindow | null): void {
  if (!window || window.isDestroyed()) return
  if (!mainWindow || mainWindow.isDestroyed()) {
    window.center()
    return
  }
  const parentBounds = mainWindow.getBounds()
  const childBounds = window.getBounds()
  window.setPosition(
    Math.round(parentBounds.x + (parentBounds.width - childBounds.width) / 2),
    Math.round(parentBounds.y + (parentBounds.height - childBounds.height) / 2),
  )
}
