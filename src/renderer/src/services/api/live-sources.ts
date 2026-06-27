import type {
  LiveSourceConfig,
  LiveSourceExportResult,
  LiveSourceFileResult,
  LiveSourceImportPreview,
  LiveSourceImportResult,
  LiveSourceInput,
} from '@shared/types'
import { getRuntimeApi, requireRuntimeApi } from './client'

export async function listLiveSources(): Promise<LiveSourceConfig[]> {
  const api = getRuntimeApi()
  return api ? api.liveSources.list() : []
}

export async function createLiveSource(input: LiveSourceInput): Promise<LiveSourceConfig> {
  return requireRuntimeApi().liveSources.create(input)
}

export async function updateLiveSource(id: string, input: LiveSourceInput): Promise<LiveSourceConfig> {
  return requireRuntimeApi().liveSources.update(id, input)
}

export async function reorderLiveSources(sourceIds: string[]): Promise<LiveSourceConfig[]> {
  return requireRuntimeApi().liveSources.reorder(sourceIds)
}

export async function deleteLiveSource(id: string): Promise<void> {
  await requireRuntimeApi().liveSources.delete(id)
}

export async function clearLiveSources(): Promise<void> {
  await requireRuntimeApi().liveSources.clear()
}

export async function previewLiveSourceImport(payload: unknown): Promise<LiveSourceImportPreview> {
  return requireRuntimeApi().liveSources.previewImport(payload)
}

export async function confirmLiveSourceImport(payload: unknown): Promise<LiveSourceImportResult> {
  return requireRuntimeApi().liveSources.confirmImport(payload)
}

export async function importLiveSourcesFromFile(): Promise<LiveSourceFileResult> {
  return requireRuntimeApi().liveSources.importFromFile()
}

export async function exportLiveSourcesToFile(): Promise<LiveSourceExportResult> {
  return requireRuntimeApi().liveSources.exportToFile()
}
