import type { UpdateCheckResult } from '@shared/types'
import { requireRuntimeApi } from './client'

export function getCurrentVersion(): Promise<string> {
  return requireRuntimeApi().updates.getCurrentVersion()
}

export function checkForUpdates(): Promise<UpdateCheckResult> {
  return requireRuntimeApi().updates.check()
}
