import { randomUUID } from 'crypto'
import { liveSourceImportItemSchema, liveSourceInputSchema } from '@shared/schemas'
import type {
  LiveSourceConfig,
  LiveSourceExportItem,
  LiveSourceImportItem,
  LiveSourceImportPreview,
  LiveSourceImportResult,
  LiveSourceInput,
  SourceSubscriptionSectionResult,
} from '@shared/types'
import type { LiveSourceRepository } from './live-source.repository'

// 直播源与点播源共用导入语义，但保持独立模型，避免将播放列表能力耦合到点播源。
function toImportItems(payload: unknown): {
  validItems: LiveSourceImportItem[]
  invalidItems: LiveSourceImportPreview['invalidItems']
} {
  const rawItems = Array.isArray(payload) ? payload : [payload]
  const validItems: LiveSourceImportItem[] = []
  const invalidItems: LiveSourceImportPreview['invalidItems'] = []

  for (const [index, raw] of rawItems.entries()) {
    const result = liveSourceImportItemSchema.safeParse(raw)

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

export class LiveSourceService {
  constructor(private readonly repository: LiveSourceRepository) {}

  list(): LiveSourceConfig[] {
    return this.repository.list()
  }

  create(input: LiveSourceInput): LiveSourceConfig {
    const data = liveSourceInputSchema.parse(input)
    const existing = this.repository.findByUrl(data.url)

    if (existing) {
      throw new Error('直播源地址已存在')
    }

    const now = Date.now()
    return this.repository.upsert({
      id: randomUUID(),
      name: data.name,
      url: data.url,
      enabled: data.enabled,
      sort: this.repository.list().length,
      origin: 'manual',
      createdAt: now,
      updatedAt: now,
    })
  }

  update(id: string, input: LiveSourceInput): LiveSourceConfig {
    const data = liveSourceInputSchema.parse(input)
    const existing = this.repository.findById(id)

    if (!existing) {
      throw new Error('直播源不存在')
    }

    const duplicated = this.repository.findByUrl(data.url)

    if (duplicated && duplicated.id !== id) {
      throw new Error('直播源地址已存在')
    }

    return this.repository.update({
      ...existing,
      name: data.name,
      url: data.url,
      enabled: data.enabled,
      updatedAt: Date.now(),
    })
  }

  reorder(sourceIds: string[]): LiveSourceConfig[] {
    const sources = this.repository.list()
    const existingIds = new Set(sources.map((source) => source.id))
    const requestedIds = new Set(sourceIds)

    if (
      sourceIds.length !== sources.length ||
      requestedIds.size !== sourceIds.length ||
      sourceIds.some((id) => !existingIds.has(id))
    ) {
      throw new Error('直播源排序数据无效')
    }

    return this.repository.reorder(sourceIds)
  }

  delete(id: string): void {
    const existing = this.repository.findById(id)

    if (!existing) {
      throw new Error('直播源不存在')
    }

    this.repository.delete(id)
  }

  clear(): void {
    this.repository.clear()
  }

  exportItems(): LiveSourceExportItem[] {
    return this.repository.list().map((source) => ({
      name: source.name,
      url: source.url,
      enabled: source.enabled,
    }))
  }

  previewImport(payload: unknown): LiveSourceImportPreview {
    const { validItems, invalidItems } = toImportItems(payload)
    const seen = new Set<string>()
    const newItems: LiveSourceImportItem[] = []
    const overwriteItems: LiveSourceImportItem[] = []
    const skippedItems: LiveSourceImportItem[] = []

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

  confirmImport(payload: unknown): LiveSourceImportResult {
    const preview = this.previewImport(payload)
    const existingSources = this.repository.list()
    const nextSort = existingSources.length
    const now = Date.now()
    const created: LiveSourceConfig[] = []
    const overwritten: LiveSourceConfig[] = []

    for (const [index, item] of [...preview.newItems, ...preview.overwriteItems].entries()) {
      const existing = this.repository.findByUrl(item.url)
      const source: LiveSourceConfig = {
        id: existing?.id ?? randomUUID(),
        name: item.name,
        url: item.url,
        enabled: item.enabled ?? true,
        sort: existing?.sort ?? nextSort + index,
        origin: 'manual',
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

  syncSubscription(items: LiveSourceImportItem[]): SourceSubscriptionSectionResult {
    const uniqueItems = [...new Map(items.map((item) => [item.url, item])).values()]
    const now = Date.now()

    for (const item of uniqueItems) {
      const owner = this.repository.list().find((source) => source.origin === 'manual' && source.url === item.url)
      if (owner) throw new Error(`订阅地址已存在于手动直播源「${owner.name}」`)
    }

    this.repository.clearSubscription()

    for (const item of uniqueItems) {
      this.repository.upsert({
        id: randomUUID(),
        name: item.name,
        url: item.url,
        enabled: item.enabled ?? true,
        sort: this.repository.list().length,
        origin: 'subscription',
        createdAt: now,
        updatedAt: now,
      })
    }

    return { created: uniqueItems.length, updated: 0, unchanged: 0 }
  }
}
