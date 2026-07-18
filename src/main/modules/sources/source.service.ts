import { randomUUID } from 'crypto'
import axios from 'axios'
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
  VodSourceSpeedResult,
} from '@shared/types'
import type { HttpClient } from '../../infrastructure/http/http-client'
import type { VodSourceRepository } from './vod-source.repository'

// 点播源领域服务：将外部导入数据校验为可持久化的源配置，并维护排序与唯一性约束。
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
  constructor(
    private readonly repository: VodSourceRepository,
    private readonly httpClient: HttpClient,
  ) {}

  list(): VodSourceConfig[] {
    return this.repository.list()
  }

  create(input: VodSourceInput): VodSourceConfig {
    const data = vodSourceInputSchema.parse(input)
    this.assertEndpointUrlsAvailable(data.url, data.backups)

    const now = Date.now()
    return this.repository.upsert({
      id: randomUUID(),
      name: data.name,
      url: data.url,
      referer: data.referer,
      backups: data.backups,
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

    this.assertEndpointUrlsAvailable(data.url, data.backups, id)

    return this.repository.update({
      ...existing,
      name: data.name,
      url: data.url,
      referer: data.referer,
      backups: data.backups,
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

  switchBackup(id: string, backupUrl: string): VodSourceConfig {
    const existing = this.repository.findById(id)
    if (!existing) throw new Error('数据源不存在')

    const backupIndex = existing.backups.findIndex((backup) => backup.url === backupUrl)
    if (backupIndex === -1) throw new Error('备用地址不存在')

    const next = existing.backups[backupIndex]
    const backups = [...existing.backups]
    backups[backupIndex] = { url: existing.url, referer: existing.referer }
    return this.repository.update({
      ...existing,
      url: next.url,
      referer: next.referer,
      backups,
      updatedAt: Date.now(),
    })
  }

  async testSpeed(id: string): Promise<VodSourceSpeedResult> {
    const source = this.repository.findById(id)
    if (!source) return { status: 'error', errorMessage: '点播源不存在' }

    try {
      const startedAt = performance.now()
      await this.httpClient.get(buildVodSourceProbeUrl(source.url), {
        headers: source.referer ? { Referer: source.referer } : undefined,
        timeout: 5_000,
      })
      return { status: 'success', elapsedMs: Math.max(1, Math.round(performance.now() - startedAt)) }
    } catch (error) {
      return { status: 'error', errorMessage: getSpeedTestErrorMessage(error) }
    }
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
      backups: source.backups,
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
      this.assertEndpointUrlsAvailable(item.url, item.backups ?? [], existing?.id)
      const source: VodSourceConfig = {
        id: existing?.id ?? randomUUID(),
        name: item.name,
        url: item.url,
        referer: item.referer,
        backups: item.backups ?? [],
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
    const uniqueItems = [...new Map(items.map((item) => [item.name, item])).values()]
    const now = Date.now()

    this.assertSubscriptionEndpointUrlsAvailable(uniqueItems)
    this.repository.clearSubscription()

    for (const item of uniqueItems) {
      this.repository.upsert({
        id: randomUUID(),
        name: item.name,
        url: item.url,
        referer: item.referer,
        backups: item.backups ?? [],
        enabled: item.enabled ?? false,
        sort: this.repository.list().length,
        origin: 'subscription',
        createdAt: now,
        updatedAt: now,
      })
    }

    return { created: uniqueItems.length, updated: 0, unchanged: 0 }
  }

  private assertEndpointUrlsAvailable(url: string, backups: Array<{ url: string }>, excludedSourceId?: string): void {
    for (const endpointUrl of [url, ...backups.map((backup) => backup.url)]) {
      const owner = this.repository
        .list()
        .find(
          (source) =>
            source.id !== excludedSourceId &&
            (source.url === endpointUrl || source.backups.some((backup) => backup.url === endpointUrl)),
        )
      if (owner) throw new Error(`源路径已存在于「${owner.name}」`)
    }
  }

  private assertSubscriptionEndpointUrlsAvailable(items: VodSourceSubscriptionItem[]): void {
    const manualSources = this.repository.list().filter((source) => source.origin === 'manual')
    const endpointUrls = new Set<string>()

    for (const item of items) {
      for (const endpointUrl of [item.url, ...(item.backups ?? []).map((backup) => backup.url)]) {
        if (endpointUrls.has(endpointUrl)) throw new Error(`订阅中存在重复的源地址：${endpointUrl}`)
        endpointUrls.add(endpointUrl)

        const owner = manualSources.find(
          (source) => source.url === endpointUrl || source.backups.some((backup) => backup.url === endpointUrl),
        )
        if (owner) throw new Error(`订阅地址已存在于手动源「${owner.name}」`)
      }
    }
  }
}

/** 构造最小化的 CMS 列表请求，用于测量点播源 API 响应速度。 */
function buildVodSourceProbeUrl(sourceUrl: string): string {
  const url = new URL(sourceUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 HTTP 或 HTTPS 地址')
  url.searchParams.set('ac', 'list')
  url.searchParams.set('pg', '1')
  url.searchParams.set('limit', '1')
  return url.toString()
}

/** 将测速异常转换为适合在设置页展示的简短原因。 */
function getSpeedTestErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNABORTED') return '请求超时'
    if (error.response) return `HTTP ${error.response.status}`
    return error.message || '连接失败'
  }
  return error instanceof Error ? error.message : '请求失败'
}
