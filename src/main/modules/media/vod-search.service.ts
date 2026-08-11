import { randomUUID } from 'crypto'
import { mapAsync, uniq } from 'es-toolkit/array'
import type { SearchEvent } from '@shared/types'
import { isHttpRequestError, type HttpClient } from '../../infrastructure/http/http-client'
import type { SourceService } from '../sources/source.service'
import type { SearchTaskManager } from './search-task-manager'
import { buildVodDetailUrl, buildVodSearchUrl, normalizeVodApiResponse } from './vod-api'

const SEARCH_CONCURRENCY = 6
const SOURCE_TIMEOUT_MS = 15_000

/** 并发搜索所有已启用点播源，并把各源进度与结果增量发送给 renderer */
export class VodSearchService {
  constructor(
    private readonly sourceService: SourceService,
    private readonly httpClient: HttpClient,
    private readonly taskManager: SearchTaskManager,
    private readonly emit: (event: SearchEvent) => void,
  ) {}

  search(keyword: string): { searchId: string } {
    if (!keyword.trim()) throw new Error('搜索关键词不能为空')
    const searchId = randomUUID()
    const signal = this.taskManager.create(searchId)
    const sources = this.sourceService.list().filter((source) => !source.disabled)

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
    await mapAsync(sources, (source) => this.searchSource(searchId, keyword, signal, source), {
      concurrency: SEARCH_CONCURRENCY,
    })
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
      const requestOptions = {
        headers: source.headers,
        requestLabel: '点播 API',
        signal,
        timeout: SOURCE_TIMEOUT_MS,
      }
      const listResponse = await this.httpClient.get(buildVodSearchUrl(source.url, keyword), requestOptions)
      const listItems = normalizeVodApiResponse(listResponse, source)
      const vodIds = uniq(listItems.map((item) => item.vodId).filter(Boolean))
      const detailResponse =
        vodIds.length > 0 ? await this.httpClient.get(buildVodDetailUrl(source.url, vodIds), requestOptions) : undefined
      const items = detailResponse ? normalizeVodApiResponse(detailResponse, source) : []

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
    if (isHttpRequestError(error) && error.code === 'ERR_CANCELED') {
      this.emit({
        type: 'source-cancelled',
        searchId,
        sourceId,
        sourceName,
      })
      return
    }

    const message = getErrorMessage(error)

    if (isHttpRequestError(error) && error.code === 'ECONNABORTED') {
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
  if (isHttpRequestError(error)) {
    return error.status ? `HTTP ${error.status}: 请求失败` : error.message
  }

  return error instanceof Error ? error.message : String(error)
}
