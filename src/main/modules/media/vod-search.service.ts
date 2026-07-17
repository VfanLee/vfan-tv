import { randomUUID } from 'crypto'
import axios from 'axios'
import type { SearchEvent } from '@shared/types'
import type { HttpClient } from '../../infrastructure/http/http-client'
import type { SourceService } from '../sources/source.service'
import type { SearchTaskManager } from './search-task-manager'
import { buildVodSearchUrl, normalizeVodApiResponse } from './vod-api'

const SEARCH_CONCURRENCY = 6
const SOURCE_TIMEOUT_MS = 15_000

// 将多数据源搜索转换为增量 IPC 事件；结果不等待所有源完成才返回 renderer。
export class VodSearchService {
  constructor(
    private readonly sourceService: SourceService,
    private readonly httpClient: HttpClient,
    private readonly taskManager: SearchTaskManager,
    private readonly emit: (event: SearchEvent) => void,
  ) {}

  search(keyword: string): { searchId: string } {
    const searchId = randomUUID()
    const signal = this.taskManager.create(searchId)
    const sources = this.sourceService.list().filter((source) => source.enabled)

    void this.searchSources(searchId, keyword.trim(), signal, sources).finally(() => {
      this.emit({ type: 'done', searchId })
      this.taskManager.complete(searchId)
    })

    return { searchId }
  }

  cancel(searchId: string): void {
    this.taskManager.cancel(searchId)
  }

  private async searchSources(
    searchId: string,
    keyword: string,
    signal: AbortSignal,
    sources: ReturnType<SourceService['list']>,
  ): Promise<void> {
    const pendingSources = [...sources]
    // 多 worker 共享队列，限制并发避免大量源同时请求导致网络与 UI 事件拥塞。
    const workers = Array.from({ length: Math.min(SEARCH_CONCURRENCY, pendingSources.length) }, async () => {
      while (pendingSources.length > 0 && !signal.aborted) {
        const source = pendingSources.shift()

        if (source) {
          await this.searchSource(searchId, keyword, signal, source)
        }
      }
    })

    await Promise.all(workers)

    if (signal.aborted) {
      for (const source of pendingSources) {
        this.emit({
          type: 'source-cancelled',
          searchId,
          sourceId: source.id,
          sourceName: source.name,
        })
      }
    }
  }

  private async searchSource(
    searchId: string,
    keyword: string,
    signal: AbortSignal,
    source: ReturnType<SourceService['list']>[number],
  ): Promise<void> {
    if (signal.aborted) {
      this.emit({
        type: 'source-cancelled',
        searchId,
        sourceId: source.id,
        sourceName: source.name,
      })
      return
    }

    this.emit({
      type: 'source-start',
      searchId,
      sourceId: source.id,
      sourceName: source.name,
    })

    try {
      const response = await this.httpClient.get(buildVodSearchUrl(source.url, keyword), {
        headers: source.referer ? { Referer: source.referer } : undefined,
        signal,
        timeout: SOURCE_TIMEOUT_MS,
      })
      const items = normalizeVodApiResponse(response, source)

      this.emit({
        type: 'source-result',
        searchId,
        sourceId: source.id,
        sourceName: source.name,
        items,
      })
    } catch (error) {
      this.emitSearchError(searchId, source.id, source.name, error)
    }
  }

  private emitSearchError(searchId: string, sourceId: string, sourceName: string, error: unknown): void {
    if (axios.isCancel(error) || (axios.isAxiosError(error) && error.code === 'ERR_CANCELED')) {
      this.emit({
        type: 'source-cancelled',
        searchId,
        sourceId,
        sourceName,
      })
      return
    }

    const message = getErrorMessage(error)

    if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
      this.emit({
        type: 'source-timeout',
        searchId,
        sourceId,
        sourceName,
        message,
      })
      return
    }

    this.emit({
      type: 'source-error',
      searchId,
      sourceId,
      sourceName,
      message,
    })
  }
}

function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return error.response ? `HTTP ${error.response.status}: ${error.response.statusText || '请求失败'}` : error.message
  }

  return error instanceof Error ? error.message : String(error)
}
