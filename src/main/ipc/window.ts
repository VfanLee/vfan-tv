import { app, ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import type { SettingsSectionId } from '@shared/types'
import type { ApplicationContext } from '../app/composition-root'
import { showSettingsWindow } from '../windows/settings-window'
import {
  enterMiniWindowMode,
  exitMiniWindowMode,
  getMiniWindowAlwaysOnTop,
  getMiniWindowPlayback,
  hideMiniWindow,
  moveMiniWindow,
  resizeMiniWindow,
  setMiniWindowAlwaysOnTop,
  updateMiniWindowPlayback,
} from '../windows/mini-window-mode'

export function registerWindowIpc(context: ApplicationContext): void {
  ipcMain.handle(IPC_CHANNELS.window.openSettings, (_event, section?: unknown) => {
    showSettingsWindow(parseSettingsSection(section))
  })
  ipcMain.handle(IPC_CHANNELS.window.isMaximized, () => context.getMainWindow()?.isMaximized() ?? false)
  ipcMain.handle(IPC_CHANNELS.window.enterMiniWindowMode, (_event, playback) => {
    const window = context.getMainWindow()
    if (window) enterMiniWindowMode(window, playback)
  })
  ipcMain.handle(IPC_CHANNELS.window.getMiniWindowPlayback, (event) => {
    const window = context.getMainWindow()
    return window ? getMiniWindowPlayback(window, event.sender.id) : undefined
  })
  ipcMain.handle(IPC_CHANNELS.window.updateMiniWindowPlayback, (event, exit) => {
    const window = context.getMainWindow()
    if (window) updateMiniWindowPlayback(window, event.sender.id, exit)
  })
  ipcMain.handle(IPC_CHANNELS.window.resizeMiniWindow, (event, input) => {
    const window = context.getMainWindow()
    if (window) resizeMiniWindow(window, event.sender.id, input)
  })
  ipcMain.handle(IPC_CHANNELS.window.moveMiniWindow, (event, input) => {
    const window = context.getMainWindow()
    if (window) moveMiniWindow(window, event.sender.id, input)
  })
  ipcMain.handle(IPC_CHANNELS.window.hideMiniWindow, (event, sessionId) => {
    const window = context.getMainWindow()
    if (window) hideMiniWindow(window, event.sender.id, sessionId)
  })
  ipcMain.handle(IPC_CHANNELS.window.getMiniWindowAlwaysOnTop, (event, sessionId) => {
    const window = context.getMainWindow()
    return window ? getMiniWindowAlwaysOnTop(window, event.sender.id, sessionId) : false
  })
  ipcMain.handle(IPC_CHANNELS.window.setMiniWindowAlwaysOnTop, (event, sessionId, enabled) => {
    const window = context.getMainWindow()
    return window ? setMiniWindowAlwaysOnTop(window, event.sender.id, sessionId, enabled) : false
  })
  ipcMain.handle(IPC_CHANNELS.window.exitMiniWindowMode, (_event, exit) => {
    const window = context.getMainWindow()
    if (window) exitMiniWindowMode(window, exit)
  })
  ipcMain.handle(IPC_CHANNELS.window.toggleMaximize, () => {
    const window = context.getMainWindow()
    if (!window) return false
    if (window.isMaximized()) {
      window.unmaximize()
      return false
    }
    window.maximize()
    return true
  })
  ipcMain.handle(IPC_CHANNELS.window.quitApp, () => {
    app.quit()
  })
  ipcMain.handle(IPC_CHANNELS.window.restartApp, () => {
    if (!app.isPackaged) {
      setTimeout(() => context.getMainWindow()?.webContents.reloadIgnoringCache(), 100)
      return
    }
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 100)
  })
}

const SETTINGS_SECTIONS = new Set<SettingsSectionId>([
  'appearance',
  'subscriptions',
  'vod-sources',
  'iptv',
  'data-management',
  'about',
])

function parseSettingsSection(value: unknown): SettingsSectionId | undefined {
  if (value === 'network' || value === 'iptv-sources' || value === 'iptv-network') return 'iptv'
  return typeof value === 'string' && SETTINGS_SECTIONS.has(value as SettingsSectionId)
    ? (value as SettingsSectionId)
    : undefined
}
