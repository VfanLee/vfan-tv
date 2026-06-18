import { randomUUID } from 'crypto'
import { vodSourceImportItemSchema, vodSourceInputSchema } from '@shared/schemas'
import type {
  VodSourceConfig,
  VodSourceInput,
  VodSourceImportItem,
  VodSourceImportPreview,
  VodSourceImportResult,
} from '@shared/types'
import type { VodSourceRepository } from '../repositories/vod-source.repository'

function toImportItems(payload: unknown): {
  validItems: VodSourceImportItem[]
  invalidItems: VodSourceImportPreview['invalidItems']
} {
  const rawItems = Array.isArray(payload) ? payload : [payload]
  const validItems: VodSourceImportItem[] = []
  const invalidItems: VodSourceImportPreview['invalidItems'] = []

  for (const [index, raw] of rawItems.entries()) {
    const result = vodSourceImportItemSchema.safeParse(raw)

    if (result.success) {
      validItems.push(result.data)
    } else {
      invalidItems.push({
        index,
        reason: result.error.issues.map((issue) => issue.message).join('; '),
        raw,
      })
    }
  }

  return { validItems, invalidItems }
}

export class SourceService {
  constructor(private readonly repository: VodSourceRepository) {}

  list(): VodSourceConfig[] {
    return this.repository.list()
  }

  create(input: VodSourceInput): VodSourceConfig {
    const data = vodSourceInputSchema.parse(input)
    const existing = this.repository.findByBaseUrl(data.baseUrl)

    if (existing) {
      throw new Error('源路径已存在')
    }

    const now = Date.now()
    return this.repository.upsert({
      id: randomUUID(),
      name: data.name,
      baseUrl: data.baseUrl,
      enabled: data.enabled,
      sort: this.repository.list().length,
      headers: {},
      createdAt: now,
      updatedAt: now,
    })
  }

  update(id: string, input: VodSourceInput): VodSourceConfig {
    const data = vodSourceInputSchema.parse(input)
    const existing = this.repository.findById(id)

    if (!existing) {
      throw new Error('播放源不存在')
    }

    const duplicated = this.repository.findByBaseUrl(data.baseUrl)

    if (duplicated && duplicated.id !== id) {
      throw new Error('源路径已存在')
    }

    return this.repository.update({
      ...existing,
      name: data.name,
      baseUrl: data.baseUrl,
      enabled: data.enabled,
      updatedAt: Date.now(),
    })
  }

  delete(id: string): void {
    const existing = this.repository.findById(id)

    if (!existing) {
      throw new Error('播放源不存在')
    }

    this.repository.delete(id)
  }

  exportItems(): VodSourceImportItem[] {
    return this.repository.list().map((source) => ({
      name: source.name,
      baseUrl: source.baseUrl,
      enabled: source.enabled,
    }))
  }

  previewImport(payload: unknown): VodSourceImportPreview {
    const { validItems, invalidItems } = toImportItems(payload)
    const seen = new Set<string>()
    const newItems: VodSourceImportItem[] = []
    const overwriteItems: VodSourceImportItem[] = []
    const skippedItems: VodSourceImportItem[] = []

    for (const item of validItems) {
      if (seen.has(item.baseUrl)) {
        skippedItems.push(item)
        continue
      }

      seen.add(item.baseUrl)

      if (this.repository.findByBaseUrl(item.baseUrl)) {
        overwriteItems.push(item)
      } else {
        newItems.push(item)
      }
    }

    return {
      validItems,
      invalidItems,
      newItems,
      overwriteItems,
      skippedItems,
    }
  }

  confirmImport(payload: unknown): VodSourceImportResult {
    const preview = this.previewImport(payload)
    const existingSources = this.repository.list()
    const nextSort = existingSources.length
    const now = Date.now()
    const created: VodSourceConfig[] = []
    const overwritten: VodSourceConfig[] = []

    for (const [index, item] of [...preview.newItems, ...preview.overwriteItems].entries()) {
      const existing = this.repository.findByBaseUrl(item.baseUrl)
      const source: VodSourceConfig = {
        id: existing?.id ?? randomUUID(),
        name: item.name,
        baseUrl: item.baseUrl,
        enabled: item.enabled ?? false,
        sort: existing?.sort ?? nextSort + index,
        headers: item.headers ?? {},
        remark: existing?.remark,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      const saved = this.repository.upsert(source)

      if (existing) {
        overwritten.push(saved)
      } else {
        created.push(saved)
      }
    }

    return {
      created,
      overwritten,
      skipped: preview.skippedItems,
      invalid: preview.invalidItems,
    }
  }
}
