import type { AppLogInfo } from '@shared/types'
import { requireRuntimeApi } from './client'

export async function getLogInfo(): Promise<AppLogInfo> {
  return requireRuntimeApi().diagnostics.getLogInfo()
}

export async function revealLogFile(): Promise<void> {
  return requireRuntimeApi().diagnostics.revealLogFile()
}

export async function clearLogs(): Promise<AppLogInfo> {
  return requireRuntimeApi().diagnostics.clearLogs()
}
