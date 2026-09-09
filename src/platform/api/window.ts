import type { AppDataChangeDomain } from './types'
import type {
  MiniWindowMoveInput,
  MiniWindowPlaybackContext,
  MiniWindowPlaybackExit,
  MiniWindowResizeInput,
  SettingsSectionId,
} from '@/types'

import { invoke } from '@tauri-apps/api/core'
import { isDesktopRuntime, subscribeDesktopEvent } from '../tauri'

/** 打开或聚焦设置窗口 */
export async function openSettingsWindow(section?: SettingsSectionId): Promise<void> {
  if (isDesktopRuntime()) return invoke('open_settings_window', { section })
  throw new Error('当前运行环境不支持此操作')
}

/** 监听设置窗口分区切换 */
export function onSettingsSectionChange(listener: (section: SettingsSectionId) => void): () => void {
  if (isDesktopRuntime()) return subscribeDesktopEvent('settings-section-changed', listener)
  return () => {}
}

/** 订阅持久化业务数据变更 */
export function onAppDataChange(listener: (domain: AppDataChangeDomain) => void): () => void {
  if (isDesktopRuntime()) return subscribeDesktopEvent<AppDataChangeDomain>('app-data-changed', listener)
  return () => {}
}

/** 读取当前窗口最大化状态 */
export async function isWindowMaximized(): Promise<boolean> {
  if (isDesktopRuntime()) return invoke('is_window_maximized')
  throw new Error('当前运行环境不支持此操作')
}

/** 切换当前窗口最大化状态 */
export async function toggleWindowMaximize(): Promise<boolean> {
  if (isDesktopRuntime()) return invoke('toggle_window_maximize')
  throw new Error('当前运行环境不支持此操作')
}

/** 退出桌面应用 */
export async function quitApp(): Promise<void> {
  if (isDesktopRuntime()) return invoke('quit_app')
  throw new Error('当前运行环境不支持此操作')
}

/** 重启桌面应用 */
export async function restartApp(): Promise<void> {
  if (isDesktopRuntime()) return invoke('restart_app')
  throw new Error('当前运行环境不支持此操作')
}

/** 创建小窗并交接播放上下文 */
export async function enterMiniWindowMode(context: MiniWindowPlaybackContext): Promise<void> {
  if (isDesktopRuntime()) return invoke('enter_mini_window_mode', { context })
  throw new Error('当前运行环境不支持此操作')
}

/** 读取当前小窗播放上下文 */
export async function getMiniWindowPlayback(): Promise<MiniWindowPlaybackContext | undefined> {
  if (isDesktopRuntime()) return invoke('get_mini_window_playback')
  return undefined
}

/** 保存小窗播放快照 */
export async function updateMiniWindowPlayback(input: MiniWindowPlaybackExit): Promise<void> {
  if (isDesktopRuntime()) return invoke('update_mini_window_playback', { input })
  throw new Error('当前运行环境不支持此操作')
}

/** 调整小窗大小 */
export async function resizeMiniWindow(input: MiniWindowResizeInput): Promise<void> {
  if (isDesktopRuntime()) return invoke('resize_mini_window', { input })
  throw new Error('当前运行环境不支持此操作')
}

/** 移动小窗 */
export async function moveMiniWindow(input: MiniWindowMoveInput): Promise<void> {
  if (isDesktopRuntime()) return invoke('move_mini_window', { input })
  throw new Error('当前运行环境不支持此操作')
}

/** 隐藏小窗 */
export async function hideMiniWindow(sessionId: string): Promise<void> {
  if (isDesktopRuntime()) return invoke('hide_mini_window', { sessionId })
  throw new Error('当前运行环境不支持此操作')
}

/** 读取小窗置顶状态 */
export async function getMiniWindowAlwaysOnTop(sessionId: string): Promise<boolean> {
  if (isDesktopRuntime()) return invoke('get_mini_window_always_on_top', { sessionId })
  throw new Error('当前运行环境不支持此操作')
}

/** 设置小窗置顶状态 */
export async function setMiniWindowAlwaysOnTop(sessionId: string, enabled: boolean): Promise<boolean> {
  if (isDesktopRuntime()) return invoke('set_mini_window_always_on_top', { sessionId, enabled })
  throw new Error('当前运行环境不支持此操作')
}

/** 退出小窗并恢复主窗口 */
export async function exitMiniWindowMode(input: MiniWindowPlaybackExit): Promise<void> {
  if (isDesktopRuntime()) return invoke('exit_mini_window_mode', { input })
  throw new Error('当前运行环境不支持此操作')
}

/** 订阅小窗退出状态 */
export function onMiniWindowModeExit(listener: (input: MiniWindowPlaybackExit) => void): () => void {
  if (isDesktopRuntime()) return subscribeDesktopEvent('mini-window-mode-exit', listener)
  return () => {}
}

/** 小窗页面初始化完成后显示原生窗口 */
export async function readyMiniWindow(sessionId: string): Promise<void> {
  if (isDesktopRuntime()) await invoke('ready_mini_window', { sessionId })
}

/** 按用户操作通过系统浏览器打开外链 */
export async function openExternal(url: string): Promise<void> {
  if (isDesktopRuntime()) return invoke('open_external_url', { url })
  throw new Error('当前运行环境不支持此操作')
}
