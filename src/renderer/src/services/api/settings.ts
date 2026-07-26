import type {
  AppDataClientPayload,
  AppDataExportResult,
  AppDataImportResult,
  AppDataSelection,
  AppSettings,
  GitHubProxyRouteId,
  GitHubProxyTestResult,
} from '@shared/types'
import { getRuntimeApi, requireRuntimeApi } from './client'

export async function getSettings(): Promise<AppSettings | undefined> {
  const api = getRuntimeApi()
  return api ? api.settings.get() : undefined
}

export async function updateSettings(input: Partial<AppSettings>): Promise<AppSettings> {
  return requireRuntimeApi().settings.update(input)
}

export async function testGitHubProxy(
  routeId: GitHubProxyRouteId,
  customPrefix?: string,
): Promise<GitHubProxyTestResult> {
  return requireRuntimeApi().settings.testGitHubProxy(routeId, customPrefix)
}

export async function initializeAppData(options: AppDataSelection): Promise<void> {
  return requireRuntimeApi().settings.initializeAppData(options)
}

export async function clearAppCache(): Promise<void> {
  return requireRuntimeApi().settings.clearAppCache()
}

export async function exportAppData(clientData: AppDataClientPayload): Promise<AppDataExportResult> {
  return requireRuntimeApi().settings.exportAppData(clientData)
}

export async function importAppData(): Promise<AppDataImportResult> {
  return requireRuntimeApi().settings.importAppData()
}
