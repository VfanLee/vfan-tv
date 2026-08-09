import { randomUUID } from 'crypto'
import { iptvSourceImportItemSchema, iptvSourceInputSchema } from '@shared/schemas'
import type {
  IptvSourceConfig,
  IptvSourceExportItem,
  IptvSourceImportItem,
  IptvSourceImportPreview,
  IptvSourceImportResult,
  IptvSourceInput,
  SourceSubscriptionSectionResult,
} from '@shared/types'
import type { IptvSourceRepository } from './iptv-source.repository'
import type { IptvCacheRepository } from './iptv-cache.repository'

// IPTV 源与 VOD 源共用导入语义，但保持独立模型，避免将播放列表能力耦合到 VOD 源。
function toImportItems(payload: unknown): {
  validItems: IptvSourceImportItem[]
  invalidItems: IptvSourceImportPreview['invalidItems']
} {
  const rawItems = Array.isArray(payload) ? payload : [payload]
  const validItems: IptvSourceImportItem[] = []
  const invalidItems: IptvSourceImportPreview['invalidItems'] = []

  for (const [index, raw] of rawItems.entries()) {
    const result = iptvSourceImportItemSchema.safeParse(raw)

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

export class IptvSourceService {
  constructor(
    private readonly repository: IptvSourceRepository,
    private readonly cacheRepository?: IptvCacheRepository,
  ) {}

  list(): IptvSourceConfig[] {
    return this.repository.list()
  }

  create(input: IptvSourceInput): IptvSourceConfig {
    const data = iptvSourceInputSchema.parse(input)
    const existing = this.repository.findByUrl(data.url)

    if (existing) {
      throw new Error('IPTV 源地址已存在')
    }

    const now = Date.now()
    return this.repository.upsert({
      id: randomUUID(),
      name: data.name,
      url: data.url,
      disabled: data.disabled,
      headers: data.headers,
      sort: this.repository.list().length,
      origin: 'manual',
      createdAt: now,
      updatedAt: now,
    })
  }

  update(id: string, input: IptvSourceInput): IptvSourceConfig {
    const data = iptvSourceInputSchema.parse(input)
    const existing = this.repository.findById(id)

    if (!existing) {
      throw new Error('IPTV 源不存在')
    }

    const duplicated = this.repository.findByUrl(data.url)

    if (duplicated && duplicated.id !== id) {
      throw new Error('IPTV 源地址已存在')
    }

    const updated = this.repository.update({
      ...existing,
      name: data.name,
      url: data.url,
      disabled: data.disabled,
      headers: data.headers,
      updatedAt: Date.now(),
    })
    if (existing.url !== updated.url) this.cacheRepository?.deletePlaylist(id)
    return updated
  }

  reorder(sourceIds: string[]): IptvSourceConfig[] {
    const sources = this.repository.list()
    const existingIds = new Set(sources.map((source) => source.id))
    const requestedIds = new Set(sourceIds)

    if (
      sourceIds.length !== sources.length ||
      requestedIds.size !== sourceIds.length ||
      sourceIds.some((id) => !existingIds.has(id))
    ) {
      throw new Error('IPTV 源排序数据无效')
    }

    return this.repository.reorder(sourceIds)
  }

  delete(id: string): void {
    const existing = this.repository.findById(id)

    if (!existing) {
      throw new Error('IPTV 源不存在')
    }

    this.repository.delete(id)
    this.cacheRepository?.deletePlaylist(id)
  }

  clear(): void {
    this.repository.clear()
    this.cacheRepository?.clearAll()
  }

  exportItems(): IptvSourceExportItem[] {
    return this.repository.list().map((source) => ({
      name: source.name,
      url: source.url,
      disabled: source.disabled,
      headers: source.headers,
    }))
  }

  previewImport(payload: unknown): IptvSourceImportPreview {
    const { validItems, invalidItems } = toImportItems(payload)
    const seen = new Set<string>()
    const newItems: IptvSourceImportItem[] = []
    const overwriteItems: IptvSourceImportItem[] = []
    const skippedItems: IptvSourceImportItem[] = []

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

  confirmImport(payload: unknown): IptvSourceImportResult {
    const preview = this.previewImport(payload)
    const existingSources = this.repository.list()
    const nextSort = existingSources.length
    const now = Date.now()
    const created: IptvSourceConfig[] = []
    const overwritten: IptvSourceConfig[] = []

    for (const [index, item] of [...preview.newItems, ...preview.overwriteItems].entries()) {
      const existing = this.repository.findByUrl(item.url)
      const source: IptvSourceConfig = {
        id: existing?.id ?? randomUUID(),
        name: item.name,
        url: item.url,
        disabled: item.disabled ?? false,
        headers: item.headers ?? {},
        sort: existing?.sort ?? nextSort + index,
        origin: 'manual',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      const saved = this.repository.upsert(source)
      if (existing) this.cacheRepository?.deletePlaylist(existing.id)

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

  syncSubscription(items: IptvSourceImportItem[]): SourceSubscriptionSectionResult {
    const uniqueItems = [...new Map(items.map((item) => [item.url, item])).values()]
    const now = Date.now()
    const manualOwner = this.repository
      .list()
      .find((source) => source.origin === 'manual' && uniqueItems.some((item) => item.url === source.url))

    if (manualOwner) throw new Error(`订阅源地址与手动源「${manualOwner.name}」冲突`)
    for (const source of this.repository.list().filter((item) => item.origin === 'subscription')) {
      this.cacheRepository?.deletePlaylist(source.id)
    }
    this.repository.clearSubscription()

    for (const item of uniqueItems) {
      this.repository.upsert({
        id: randomUUID(),
        name: item.name,
        url: item.url,
        disabled: item.disabled ?? false,
        headers: item.headers ?? {},
        sort: this.repository.list().length,
        origin: 'subscription',
        createdAt: now,
        updatedAt: now,
      })
    }

    return {
      created: uniqueItems.length,
      updated: 0,
      unchanged: 0,
    }
  }
}
