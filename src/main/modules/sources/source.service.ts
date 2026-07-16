import { randomUUID } from 'crypto'
import { vodSourceImportItemSchema, vodSourceInputSchema } from '@shared/schemas'
import type {
  SourceSubscriptionSectionResult,
  VodSourceConfig,
  VodSourceExportItem,
  VodSourceInput,
  VodSourceImportItem,
  VodSourceImportPreview,
  VodSourceImportResult,
  VodSourceSubscriptionItem,
} from '@shared/types'
import type { VodSourceRepository } from './vod-source.repository'

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
    const existing = this.repository.findByUrl(data.url)

    if (existing) {
      throw new Error('源路径已存在')
    }

    const now = Date.now()
    return this.repository.upsert({
      id: randomUUID(),
      name: data.name,
      url: data.url,
      referer: data.referer,
      enabled: data.enabled,
      sort: this.repository.list().length,
      origin: 'manual',
      createdAt: now,
      updatedAt: now,
    })
  }

  update(id: string, input: VodSourceInput): VodSourceConfig {
    const data = vodSourceInputSchema.parse(input)
    const existing = this.repository.findById(id)

    if (!existing) {
      throw new Error('数据源不存在')
    }

    const duplicated = this.repository.findByUrl(data.url)

    if (duplicated && duplicated.id !== id) {
      throw new Error('源路径已存在')
    }

    return this.repository.update({
      ...existing,
      name: data.name,
      url: data.url,
      referer: data.referer,
      enabled: data.enabled,
      updatedAt: Date.now(),
    })
  }

  reorder(sourceIds: string[]): VodSourceConfig[] {
    const sources = this.repository.list()
    const existingIds = new Set(sources.map((source) => source.id))
    const requestedIds = new Set(sourceIds)

    if (
      sourceIds.length !== sources.length ||
      requestedIds.size !== sourceIds.length ||
      sourceIds.some((id) => !existingIds.has(id))
    ) {
      throw new Error('数据源排序数据无效')
    }

    return this.repository.reorder(sourceIds)
  }

  delete(id: string): void {
    const existing = this.repository.findById(id)

    if (!existing) {
      throw new Error('数据源不存在')
    }

    this.repository.delete(id)
  }

  clear(): void {
    this.repository.clear()
  }

  exportItems(): VodSourceExportItem[] {
    return this.repository.list().map((source) => ({
      name: source.name,
      url: source.url,
      referer: source.referer,
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
      if (seen.has(item.url)) {
        skippedItems.push(item)
        continue
      }

      seen.add(item.url)

      if (this.repository.findByUrl(item.url)) {
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
      const existing = this.repository.findByUrl(item.url)
      const source: VodSourceConfig = {
        id: existing?.id ?? randomUUID(),
        name: item.name,
        url: item.url,
        referer: item.referer,
        enabled: item.enabled ?? false,
        sort: existing?.sort ?? nextSort + index,
        origin: 'manual',
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

  syncSubscription(items: VodSourceSubscriptionItem[]): SourceSubscriptionSectionResult {
    const uniqueItems = new Map(items.map((item) => [item.url, item]))
    const now = Date.now()
    let created = 0
    let updated = 0
    let unchanged = 0

    for (const item of uniqueItems.values()) {
      const existing = this.repository.findByUrl(item.url)
      const enabled = item.enabled ?? false

      if (!existing) {
        this.repository.upsert({
          id: randomUUID(),
          name: item.name,
          url: item.url,
          referer: item.referer,
          enabled,
          sort: this.repository.list().length,
          origin: 'subscription',
          createdAt: now,
          updatedAt: now,
        })
        created += 1
        continue
      }

      const changed =
        existing.name !== item.name ||
        existing.referer !== item.referer ||
        existing.enabled !== enabled ||
        existing.origin !== 'subscription'

      if (!changed) {
        unchanged += 1
        continue
      }

      this.repository.updateFromSubscription({
        ...existing,
        name: item.name,
        referer: item.referer,
        enabled,
        origin: 'subscription',
        updatedAt: now,
      })
      updated += 1
    }

    return { created, updated, unchanged }
  }
}
