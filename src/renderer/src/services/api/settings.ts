import type { AppSettings } from '@shared/types'
import { getRuntimeApi, requireRuntimeApi } from './client'

export async function getSettings(): Promise<AppSettings | undefined> {
  const api = getRuntimeApi()
  return api ? api.settings.get() : undefined
}

export async function updateSettings(input: Partial<AppSettings>): Promise<AppSettings> {
  return requireRuntimeApi().settings.update(input)
}
