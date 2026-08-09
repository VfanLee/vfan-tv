import type {
  IptvSourceConfig,
  IptvSourceExportResult,
  IptvSourceFileResult,
  IptvSourceImportPreview,
  IptvSourceImportResult,
  IptvSourceInput,
} from '@shared/types'
import { getRuntimeApi, requireRuntimeApi } from './client'

export async function listIptvSources(): Promise<IptvSourceConfig[]> {
  const api = getRuntimeApi()
  return api ? api.iptvSources.list() : []
}

export async function createIptvSource(input: IptvSourceInput): Promise<IptvSourceConfig> {
  return requireRuntimeApi().iptvSources.create(input)
}

export async function updateIptvSource(id: string, input: IptvSourceInput): Promise<IptvSourceConfig> {
  return requireRuntimeApi().iptvSources.update(id, input)
}

export async function reorderIptvSources(sourceIds: string[]): Promise<IptvSourceConfig[]> {
  return requireRuntimeApi().iptvSources.reorder(sourceIds)
}

export async function deleteIptvSource(id: string): Promise<void> {
  await requireRuntimeApi().iptvSources.delete(id)
}

export async function clearIptvSources(): Promise<void> {
  await requireRuntimeApi().iptvSources.clear()
}

export async function previewIptvSourceImport(payload: unknown): Promise<IptvSourceImportPreview> {
  return requireRuntimeApi().iptvSources.previewImport(payload)
}

export async function confirmIptvSourceImport(payload: unknown): Promise<IptvSourceImportResult> {
  return requireRuntimeApi().iptvSources.confirmImport(payload)
}

export async function importIptvSourcesFromFile(): Promise<IptvSourceFileResult> {
  return requireRuntimeApi().iptvSources.importFromFile()
}

export async function exportIptvSourcesToFile(): Promise<IptvSourceExportResult> {
  return requireRuntimeApi().iptvSources.exportToFile()
}
