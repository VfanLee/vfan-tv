import type {
  VodSourceConfig,
  VodSourceExportResult,
  VodSourceFileResult,
  VodSourceImportPreview,
  VodSourceImportResult,
  VodSourceInput,
} from '@shared/types'
import { getRuntimeApi, requireRuntimeApi } from './client'

export async function listSources(): Promise<VodSourceConfig[]> {
  const api = getRuntimeApi()
  return api ? api.sources.list() : []
}

export async function createSource(input: VodSourceInput): Promise<VodSourceConfig> {
  return requireRuntimeApi().sources.create(input)
}

export async function updateSource(id: string, input: VodSourceInput): Promise<VodSourceConfig> {
  return requireRuntimeApi().sources.update(id, input)
}

export async function deleteSource(id: string): Promise<void> {
  await requireRuntimeApi().sources.delete(id)
}

export async function previewSourceImport(payload: unknown): Promise<VodSourceImportPreview> {
  return requireRuntimeApi().sources.previewImport(payload)
}

export async function confirmSourceImport(payload: unknown): Promise<VodSourceImportResult> {
  return requireRuntimeApi().sources.confirmImport(payload)
}

export async function importSourcesFromFile(): Promise<VodSourceFileResult> {
  return requireRuntimeApi().sources.importFromFile()
}

export async function exportSourcesToFile(): Promise<VodSourceExportResult> {
  return requireRuntimeApi().sources.exportToFile()
}
