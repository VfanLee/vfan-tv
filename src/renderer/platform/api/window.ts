import type {
  AppDataChangeDomain,
  MiniWindowMoveInput,
  MiniWindowPlaybackContext,
  MiniWindowPlaybackExit,
  MiniWindowResizeInput,
  SettingsSectionId,
} from '@shared/types'
import { getRuntimeApi } from './client'

export async function openSettingsWindow(section?: SettingsSectionId): Promise<void> {
  const api = getRuntimeApi()
  if (api) await api.window.openSettingsWindow(section)
}

export function onSettingsSectionChange(listener: (section: SettingsSectionId) => void): () => void {
  const api = getRuntimeApi()
  return api ? api.window.onSettingsSectionChange(listener) : () => {}
}

export function onAppDataChange(listener: (domain: AppDataChangeDomain) => void): () => void {
  const api = getRuntimeApi()
  return api ? api.window.onAppDataChange(listener) : () => {}
}

export async function isWindowMaximized(): Promise<boolean> {
  const api = getRuntimeApi()
  return api ? api.window.isMaximized() : false
}

export async function toggleWindowMaximize(): Promise<boolean> {
  const api = getRuntimeApi()
  return api ? api.window.toggleMaximize() : false
}

export async function quitApp(): Promise<void> {
  const api = getRuntimeApi()
  if (api) await api.window.quitApp()
}

export async function restartApp(): Promise<void> {
  const api = getRuntimeApi()
  if (api) await api.window.restartApp()
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

export async function hideMiniWindow(sessionId: string): Promise<void> {
  const api = getRuntimeApi()
  if (api) await api.window.hideMiniWindow(sessionId)
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
