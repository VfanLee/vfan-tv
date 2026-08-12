import { ipcMain, shell } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { clearAppLogs, getAppLogInfo } from '../../infrastructure/logging/app-logger'

/** 注册日志状态、目录定位和清空 IPC 处理器 */
export function registerDiagnosticsIpc(): void {
  ipcMain.handle(IPC_CHANNELS.diagnostics.getLogInfo, () => getAppLogInfo())
  ipcMain.handle(IPC_CHANNELS.diagnostics.revealLogFile, () => {
    shell.showItemInFolder(getAppLogInfo().filePath)
  })
  ipcMain.handle(IPC_CHANNELS.diagnostics.clearLogs, () => clearAppLogs())
}
