import type { AppDataClientPayload, AppDataExportResult, AppDataImportResult, AppSettings } from '@shared/types'
import { getRuntimeApi, requireRuntimeApi } from './client'

export async function getSettings(): Promise<AppSettings | undefined> {
  const api = getRuntimeApi()
  return api ? api.settings.get() : undefined
}

export async function updateSettings(input: Partial<AppSettings>): Promise<AppSettings> {
  return requireRuntimeApi().settings.update(input)
}

export async function initializeAppData(): Promise<AppSettings> {
  return requireRuntimeApi().settings.initializeAppData()
}

export async function exportAppData(clientData: AppDataClientPayload): Promise<AppDataExportResult> {
  return requireRuntimeApi().settings.exportAppData(clientData)
}

export async function importAppData(): Promise<AppDataImportResult> {
  return requireRuntimeApi().settings.importAppData()
}
