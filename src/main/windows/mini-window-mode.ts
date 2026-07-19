import { BrowserWindow, screen, type Rectangle } from 'electron'
import { is } from '@electron-toolkit/utils'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { IPC_CHANNELS } from '@shared/ipc'
import type {
  MiniWindowMoveInput,
  MiniWindowPlaybackContext,
  MiniWindowPlaybackExit,
  MiniWindowResizeInput,
  MiniWindowBounds,
} from '@shared/types'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const MINI_WINDOW_WIDTH = 360
const MINI_WINDOW_HEIGHT = 240
const MINI_WINDOW_MARGIN = 16
const MINI_WINDOW_MIN_WIDTH = 200
const MINI_WINDOW_MAX_WIDTH = 960
const MINI_WINDOW_ASPECT_RATIO = 16 / 9

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

export function enterMiniWindowMode(mainWindow: BrowserWindow, context: MiniWindowPlaybackContext): void {
  restoreMiniWindowMode(mainWindow)

  const mainWindowState: MainWindowState = {
    bounds: mainWindow.getNormalBounds(),
    isFullScreen: mainWindow.isFullScreen(),
    isMaximized: mainWindow.isMaximized(),
  }
  const display = screen.getDisplayMatching(mainWindow.getBounds())
  const { workArea } = display
  const width = Math.min(MINI_WINDOW_WIDTH, workArea.width)
  const height = Math.min(MINI_WINDOW_HEIGHT, workArea.height)
  const miniWindow = new BrowserWindow({
    width,
    height,
    x: Math.max(workArea.x, workArea.x + workArea.width - width - MINI_WINDOW_MARGIN),
    y: Math.max(workArea.y, workArea.y + workArea.height - height - MINI_WINDOW_MARGIN),
    show: false,
    frame: false,
    roundedCorners: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    backgroundColor: '#000000',
    webPreferences: { preload: join(currentDirectory, '../preload/index.mjs'), sandbox: false },
  })
  const state: MiniWindowModeState = {
    context,
    mainWindowState,
    miniWindow,
    exit: { sessionId: context.sessionId, currentTime: context.initialTime },
  }
  miniWindowModeStates.set(mainWindow, state)

  miniWindow.once('ready-to-show', () => {
    if (miniWindowModeStates.get(mainWindow) !== state || miniWindow.isDestroyed()) return
    mainWindow.hide()
    miniWindow.show()
    miniWindow.focus()
  })
  miniWindow.once('closed', () => restoreMiniWindowMode(mainWindow, state.exit))

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void miniWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/#/mini-window`)
  } else {
    void miniWindow.loadFile(join(currentDirectory, '../renderer/index.html'), { hash: 'mini-window' })
  }
}

export function getMiniWindowPlayback(
  mainWindow: BrowserWindow,
  senderId: number,
): MiniWindowPlaybackContext | undefined {
  const state = miniWindowModeStates.get(mainWindow)
  return state?.miniWindow.webContents.id === senderId ? state.context : undefined
}

export function exitMiniWindowMode(mainWindow: BrowserWindow, exit: MiniWindowPlaybackExit): void {
  const state = miniWindowModeStates.get(mainWindow)
  if (!state || state.context.sessionId !== exit.sessionId) return

  state.exit = exit
  state.miniWindow.close()
}

export function updateMiniWindowPlayback(
  mainWindow: BrowserWindow,
  senderId: number,
  exit: MiniWindowPlaybackExit,
): void {
  const state = miniWindowModeStates.get(mainWindow)
  if (state?.context.sessionId !== exit.sessionId || state.miniWindow.webContents.id !== senderId) return

  state.exit = exit
}

// 渲染层只提供拖动中的目标边界；最终尺寸与锚点始终在主进程校正，避免无边框窗口被任意 renderer 操作。
export function resizeMiniWindow(mainWindow: BrowserWindow, senderId: number, input: MiniWindowResizeInput): void {
  const state = miniWindowModeStates.get(mainWindow)
  if (state?.context.sessionId !== input.sessionId || state.miniWindow.webContents.id !== senderId) return
  if (!isValidMiniWindowBounds(input.bounds)) return

  state.miniWindow.setBounds(normalizeMiniWindowBounds(input))
}

export function moveMiniWindow(mainWindow: BrowserWindow, senderId: number, input: MiniWindowMoveInput): void {
  const state = miniWindowModeStates.get(mainWindow)
  if (state?.context.sessionId !== input.sessionId || state.miniWindow.webContents.id !== senderId) return
  if (!isValidMiniWindowPosition(input.position)) return

  state.miniWindow.setPosition(Math.round(input.position.x), Math.round(input.position.y))
}

export function getMiniWindowAlwaysOnTop(mainWindow: BrowserWindow, senderId: number, sessionId: string): boolean {
  const state = miniWindowModeStates.get(mainWindow)
  if (state?.context.sessionId !== sessionId || state.miniWindow.webContents.id !== senderId) return false

  return state.miniWindow.isAlwaysOnTop()
}

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

function normalizeMiniWindowBounds({ corner, bounds }: MiniWindowResizeInput): MiniWindowBounds {
  const width = clamp(Math.round(bounds.width), MINI_WINDOW_MIN_WIDTH, MINI_WINDOW_MAX_WIDTH)
  const height = Math.round(width / MINI_WINDOW_ASPECT_RATIO)
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
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
