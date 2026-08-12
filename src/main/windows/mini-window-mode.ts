import { BrowserWindow, screen, type Rectangle } from 'electron'
import { clamp } from 'es-toolkit/math'
import { IPC_CHANNELS } from '@shared/ipc'
import type {
  MiniWindowMoveInput,
  MiniWindowPlaybackContext,
  MiniWindowPlaybackExit,
  MiniWindowResizeInput,
  MiniWindowBounds,
} from '@shared/types'
import { getPreloadPath, loadRendererRoute } from './renderer-entry'

const MINI_WINDOW_MARGIN = 16

interface MiniWindowConfig {
  width: number
  height: number
  minWidth: number
  maxWidth: number
  aspectRatio: number
}

const VIDEO_MINI_WINDOW_CONFIG: MiniWindowConfig = {
  width: 360,
  height: 240,
  minWidth: 200,
  maxWidth: 960,
  aspectRatio: 16 / 9,
}

const RADIO_MINI_WINDOW_CONFIG: MiniWindowConfig = {
  width: 184,
  height: 44,
  minWidth: 184,
  maxWidth: 184,
  aspectRatio: 184 / 44,
}

interface MainWindowState {
  bounds: Rectangle
  isFullScreen: boolean
  isMaximized: boolean
}

interface MiniWindowModeState {
  context: MiniWindowPlaybackContext
  mainWindowState: MainWindowState
  miniWindow: BrowserWindow
  exit: MiniWindowPlaybackExit
}

const miniWindowModeStates = new WeakMap<BrowserWindow, MiniWindowModeState>()

/** 进入画中画模式并保存主窗口状态 */
export function enterMiniWindowMode(mainWindow: BrowserWindow, context: MiniWindowPlaybackContext): void {
  restoreMiniWindowMode(mainWindow)

  const config = getMiniWindowConfig(context)
  const mainWindowState: MainWindowState = {
    bounds: mainWindow.getNormalBounds(),
    isFullScreen: mainWindow.isFullScreen(),
    isMaximized: mainWindow.isMaximized(),
  }
  const display = screen.getDisplayMatching(mainWindow.getBounds())
  const { workArea } = display
  const width = Math.min(config.width, workArea.width)
  const height = Math.min(config.height, workArea.height)
  const miniWindow = new BrowserWindow({
    width,
    height,
    x: Math.max(workArea.x, workArea.x + workArea.width - width - MINI_WINDOW_MARGIN),
    y: Math.max(workArea.y, workArea.y + workArea.height - height - MINI_WINDOW_MARGIN),
    show: false,
    frame: false,
    roundedCorners: false,
    transparent: context.variant === 'radio',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    backgroundColor: context.variant === 'radio' ? '#00000000' : '#000000',
    webPreferences: { preload: getPreloadPath(), sandbox: false },
  })
  const state: MiniWindowModeState = {
    context,
    mainWindowState,
    miniWindow,
    exit: createInitialMiniWindowExit(context),
  }
  miniWindowModeStates.set(mainWindow, state)

  miniWindow.once('ready-to-show', () => {
    if (miniWindowModeStates.get(mainWindow) !== state || miniWindow.isDestroyed()) return
    mainWindow.hide()
    miniWindow.show()
    miniWindow.focus()
  })
  miniWindow.once('closed', () => restoreMiniWindowMode(mainWindow, state.exit))

  void loadRendererRoute(miniWindow, '/mini-window')
}

/** 获取当前画中画窗口的播放上下文 */
export function getMiniWindowPlayback(
  mainWindow: BrowserWindow,
  senderId: number,
): MiniWindowPlaybackContext | undefined {
  const state = miniWindowModeStates.get(mainWindow)
  return state?.miniWindow.webContents.id === senderId ? state.context : undefined
}

/** 退出画中画模式并恢复主窗口 */
export function exitMiniWindowMode(mainWindow: BrowserWindow, exit: MiniWindowPlaybackExit): void {
  const state = miniWindowModeStates.get(mainWindow)
  if (!state || state.context.sessionId !== exit.sessionId || !isMatchingMiniWindowExit(state.context, exit)) return

  state.exit = exit
  state.miniWindow.close()
}

/** 更新画中画窗口的播放状态 */
export function updateMiniWindowPlayback(
  mainWindow: BrowserWindow,
  senderId: number,
  exit: MiniWindowPlaybackExit,
): void {
  const state = miniWindowModeStates.get(mainWindow)
  if (
    state?.context.sessionId !== exit.sessionId ||
    state.miniWindow.webContents.id !== senderId ||
    !isMatchingMiniWindowExit(state.context, exit)
  )
    return

  state.exit = exit
}

/** 调整画中画窗口的大小和位置 */
export function resizeMiniWindow(mainWindow: BrowserWindow, senderId: number, input: MiniWindowResizeInput): void {
  const state = miniWindowModeStates.get(mainWindow)
  if (state?.context.sessionId !== input.sessionId || state.miniWindow.webContents.id !== senderId) return
  if (!isValidMiniWindowBounds(input.bounds)) return

  state.miniWindow.setBounds(normalizeMiniWindowBounds(input, getMiniWindowConfig(state.context)))
}

/** 移动画中画窗口 */
export function moveMiniWindow(mainWindow: BrowserWindow, senderId: number, input: MiniWindowMoveInput): void {
  const state = miniWindowModeStates.get(mainWindow)
  if (state?.context.sessionId !== input.sessionId || state.miniWindow.webContents.id !== senderId) return
  if (!isValidMiniWindowPosition(input.position)) return

  state.miniWindow.setPosition(Math.round(input.position.x), Math.round(input.position.y))
}

/** 隐藏画中画窗口 */
export function hideMiniWindow(mainWindow: BrowserWindow, senderId: number, sessionId: string): void {
  const state = miniWindowModeStates.get(mainWindow)
  if (state?.context.sessionId !== sessionId || state.miniWindow.webContents.id !== senderId) return

  state.miniWindow.hide()
}

/** 显示并聚焦当前画中画窗口 */
export function showActiveMiniWindow(mainWindow: BrowserWindow): boolean {
  const state = miniWindowModeStates.get(mainWindow)
  if (!state || state.miniWindow.isDestroyed()) return false

  state.miniWindow.show()
  state.miniWindow.focus()
  return true
}

/** 获取画中画窗口的置顶状态 */
export function getMiniWindowAlwaysOnTop(mainWindow: BrowserWindow, senderId: number, sessionId: string): boolean {
  const state = miniWindowModeStates.get(mainWindow)
  if (state?.context.sessionId !== sessionId || state.miniWindow.webContents.id !== senderId) return false

  return state.miniWindow.isAlwaysOnTop()
}

/** 设置画中画窗口的置顶状态 */
export function setMiniWindowAlwaysOnTop(
  mainWindow: BrowserWindow,
  senderId: number,
  sessionId: string,
  enabled: boolean,
): boolean {
  const state = miniWindowModeStates.get(mainWindow)
  if (state?.context.sessionId !== sessionId || state.miniWindow.webContents.id !== senderId) return false

  state.miniWindow.setAlwaysOnTop(enabled)
  return state.miniWindow.isAlwaysOnTop()
}

function normalizeMiniWindowBounds(
  { corner, bounds }: MiniWindowResizeInput,
  config: MiniWindowConfig,
): MiniWindowBounds {
  const width = clamp(Math.round(bounds.width), config.minWidth, config.maxWidth)
  const height = Math.round(width / config.aspectRatio)
  const right = bounds.x + bounds.width
  const bottom = bounds.y + bounds.height

  switch (corner) {
    case 'top-left':
      return { x: right - width, y: bottom - height, width, height }
    case 'top-right':
      return { x: bounds.x, y: bottom - height, width, height }
    case 'bottom-left':
      return { x: right - width, y: bounds.y, width, height }
    case 'bottom-right':
      return { x: bounds.x, y: bounds.y, width, height }
  }
}

function getMiniWindowConfig(context: MiniWindowPlaybackContext): MiniWindowConfig {
  return context.variant === 'radio' ? RADIO_MINI_WINDOW_CONFIG : VIDEO_MINI_WINDOW_CONFIG
}

function createInitialMiniWindowExit(context: MiniWindowPlaybackContext): MiniWindowPlaybackExit {
  return context.variant === 'radio'
    ? {
        sessionId: context.sessionId,
        variant: 'radio',
        channel: context.channel,
        isPlaying: true,
        isMuted: context.isMuted,
        volume: context.volume,
      }
    : {
        sessionId: context.sessionId,
        variant: context.variant,
        currentTime: context.initialTime,
      }
}

function isMatchingMiniWindowExit(context: MiniWindowPlaybackContext, exit: MiniWindowPlaybackExit): boolean {
  if (context.variant === 'radio') return exit.variant === 'radio'
  return exit.variant === context.variant
}

function isValidMiniWindowBounds(bounds: MiniWindowBounds): boolean {
  return Object.values(bounds).every(Number.isFinite)
}

function isValidMiniWindowPosition(position: MiniWindowMoveInput['position']): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.y)
}

function restoreMiniWindowMode(mainWindow: BrowserWindow, exit?: MiniWindowPlaybackExit): void {
  const state = miniWindowModeStates.get(mainWindow)
  if (!state) return

  miniWindowModeStates.delete(mainWindow)
  const { mainWindowState } = state
  if (!mainWindow.isDestroyed()) {
    if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false)
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    mainWindow.setBounds(mainWindowState.bounds)
    if (mainWindowState.isMaximized) mainWindow.maximize()
    if (mainWindowState.isFullScreen) mainWindow.setFullScreen(true)
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send(IPC_CHANNELS.window.miniWindowModeExit, exit ?? state.exit)
  }

  if (!state.miniWindow.isDestroyed()) state.miniWindow.destroy()
}
