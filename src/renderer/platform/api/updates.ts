import type { UpdateCheckResult, UpdateEvent } from '@shared/types'
import { requireRuntimeApi } from './client'

export function getCurrentVersion(): Promise<string> {
  return requireRuntimeApi().updates.getCurrentVersion()
}

export function checkForUpdates(): Promise<UpdateCheckResult> {
  return requireRuntimeApi().updates.check()
}

export function downloadUpdate(): Promise<void> {
  return requireRuntimeApi().updates.download()
}

export function installUpdate(): Promise<void> {
  return requireRuntimeApi().updates.install()
}

export function onUpdateEvent(listener: (event: UpdateEvent) => void): () => void {
  return requireRuntimeApi().updates.onUpdateEvent(listener)
}
