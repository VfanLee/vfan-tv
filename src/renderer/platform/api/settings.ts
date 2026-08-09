import type {
  AppDataClearSelection,
  AppDataClientPayload,
  AppDataExportResult,
  AppDataImportResult,
  AppSettings,
  NetworkProxyTestInput,
  NetworkProxyTestResult,
  NetworkSettings,
  NetworkStatus,
} from '@shared/types'
import { getRuntimeApi, requireRuntimeApi } from './client'

export async function getSettings(): Promise<AppSettings | undefined> {
  const api = getRuntimeApi()
  return api ? api.settings.get() : undefined
}

export async function updateSettings(input: Partial<AppSettings>): Promise<AppSettings> {
  return requireRuntimeApi().settings.update(input)
}

export async function getNetworkStatus(): Promise<NetworkStatus> {
  return requireRuntimeApi().network.getStatus()
}

export async function saveNetworkSettings(settings: NetworkSettings): Promise<NetworkSettings> {
  return requireRuntimeApi().network.save(settings)
}

export async function testNetworkSettings(input: NetworkProxyTestInput): Promise<NetworkProxyTestResult> {
  return requireRuntimeApi().network.test(input)
}

export async function restoreFactorySettings(): Promise<void> {
  return requireRuntimeApi().settings.restoreFactorySettings()
}

export async function clearAppData(selection: AppDataClearSelection): Promise<void> {
  return requireRuntimeApi().settings.clearAppData(selection)
}

export async function exportAppData(clientData: AppDataClientPayload): Promise<AppDataExportResult> {
  return requireRuntimeApi().settings.exportAppData(clientData)
}

export async function importAppData(): Promise<AppDataImportResult> {
  return requireRuntimeApi().settings.importAppData()
}
