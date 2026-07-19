import type {
  MiniWindowMoveInput,
  MiniWindowPlaybackContext,
  MiniWindowPlaybackExit,
  MiniWindowResizeInput,
} from '@shared/types'
import { getRuntimeApi } from './client'

export async function isWindowMaximized(): Promise<boolean> {
  const api = getRuntimeApi()
  return api ? api.window.isMaximized() : false
}

export async function toggleWindowMaximize(): Promise<boolean> {
  const api = getRuntimeApi()
  return api ? api.window.toggleMaximize() : false
}

export async function enterMiniWindowMode(context: MiniWindowPlaybackContext): Promise<void> {
  const api = getRuntimeApi()
  if (api) await api.window.enterMiniWindowMode(context)
}

export async function getMiniWindowPlayback(): Promise<MiniWindowPlaybackContext | undefined> {
  const api = getRuntimeApi()
  return api?.window.getMiniWindowPlayback()
}

export async function updateMiniWindowPlayback(input: MiniWindowPlaybackExit): Promise<void> {
  const api = getRuntimeApi()
  if (api) await api.window.updateMiniWindowPlayback(input)
}

export async function resizeMiniWindow(input: MiniWindowResizeInput): Promise<void> {
  const api = getRuntimeApi()
  if (api) await api.window.resizeMiniWindow(input)
}

export async function moveMiniWindow(input: MiniWindowMoveInput): Promise<void> {
  const api = getRuntimeApi()
  if (api) await api.window.moveMiniWindow(input)
}

export async function getMiniWindowAlwaysOnTop(sessionId: string): Promise<boolean> {
  const api = getRuntimeApi()
  return api ? api.window.getMiniWindowAlwaysOnTop(sessionId) : false
}

export async function setMiniWindowAlwaysOnTop(sessionId: string, enabled: boolean): Promise<boolean> {
  const api = getRuntimeApi()
  return api ? api.window.setMiniWindowAlwaysOnTop(sessionId, enabled) : false
}

export async function exitMiniWindowMode(input: MiniWindowPlaybackExit): Promise<void> {
  const api = getRuntimeApi()
  if (api) await api.window.exitMiniWindowMode(input)
}

export function onMiniWindowModeExit(listener: (input: MiniWindowPlaybackExit) => void): () => void {
  const api = getRuntimeApi()
  return api ? api.window.onMiniWindowModeExit(listener) : () => {}
}
