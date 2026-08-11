import type { VodCatalogPage, VodCatalogRequest, VodSearchResult, VodSourceConfig } from '@shared/types'
import { chunk, keyBy } from 'es-toolkit/array'
import type { HttpClient } from '../../infrastructure/http/http-client'
import type { SourceService } from '../sources/source.service'
import { buildVodCatalogUrl, buildVodDetailUrl, normalizeVodApiResponse, normalizeVodCatalogPage } from './vod-api'

const CATALOG_TIMEOUT_MS = 15_000
const MAX_DETAIL_IDS_PER_REQUEST = 50

/** 加载单个点播源的分类与详情，并用批量详情请求补全缺失海报 */
export class VodCatalogService {
  constructor(
    private readonly sourceService: SourceService,
    private readonly httpClient: HttpClient,
  ) {}

  async getPage(input: VodCatalogRequest): Promise<VodCatalogPage> {
    const source = this.getEnabledSource(input.sourceId)
    const request: VodCatalogRequest = {
      sourceId: source.id,
      page: Math.max(1, Math.floor(input.page || 1)),
      categoryId: input.categoryId?.trim() || undefined,
      keyword: input.keyword?.trim() || undefined,
    }
    const response = await this.httpClient.get(buildVodCatalogUrl(source.url, request), this.getRequestOptions(source))
    const page = normalizeVodCatalogPage(response, source)
    return this.enrichMissingPosters(page, source)
  }

  async getDetail(sourceId: string, vodId: string): Promise<VodSearchResult> {
    const source = this.getEnabledSource(sourceId)
    const normalizedVodId = vodId.trim()
    if (!normalizedVodId) throw new Error('视频 ID 不能为空')
    const response = await this.httpClient.get(
      buildVodDetailUrl(source.url, [normalizedVodId]),
      this.getRequestOptions(source),
    )
    const items = normalizeVodApiResponse(response, source)
    const detail = items.find((item) => item.vodId === normalizedVodId) ?? items[0]
    if (!detail) throw new Error('未找到该视频详情')
    return detail
  }

  private getEnabledSource(sourceId: string): VodSourceConfig {
    const source = this.sourceService.list().find((item) => item.id === sourceId)
    if (!source) throw new Error('点播源不存在')
    if (source.disabled) throw new Error('点播源未启用')
    return source
  }

  private async enrichMissingPosters(page: VodCatalogPage, source: VodSourceConfig): Promise<VodCatalogPage> {
    const missingPosterIds = page.items.filter((item) => !item.poster && item.vodId).map((item) => item.vodId)
    if (missingPosterIds.length === 0) return page

    const idGroups = chunk(missingPosterIds, MAX_DETAIL_IDS_PER_REQUEST)
    const responses = await Promise.allSettled(
      idGroups.map((ids) => this.httpClient.get(buildVodDetailUrl(source.url, ids), this.getRequestOptions(source))),
    )
    const details = responses.flatMap((result) =>
      result.status === 'fulfilled' ? normalizeVodApiResponse(result.value, source) : [],
    )
    if (details.length === 0) return page

    const detailsById = keyBy(details, (item) => item.vodId)
    return {
      ...page,
      items: page.items.map((item) => {
        const detail = detailsById[item.vodId]
        return detail ? mergeCatalogItem(item, detail) : item
      }),
    }
  }

  private getRequestOptions(source: VodSourceConfig): {
    headers: VodSourceConfig['headers']
    requestLabel: string
    timeout: number
  } {
    return {
      headers: source.headers,
      requestLabel: '点播 API',
      timeout: CATALOG_TIMEOUT_MS,
    }
  }
}

function mergeCatalogItem(summary: VodSearchResult, detail: VodSearchResult): VodSearchResult {
  return {
    ...summary,
    ...detail,
    sourceId: summary.sourceId,
    sourceName: summary.sourceName,
    sourceUrl: summary.sourceUrl,
    vodId: summary.vodId,
    title: detail.title || summary.title,
    subtitle: detail.subtitle ?? summary.subtitle,
    poster: detail.poster ?? summary.poster,
    year: detail.year ?? summary.year,
    area: detail.area ?? summary.area,
    language: detail.language ?? summary.language,
    category: detail.category ?? summary.category,
    remarks: detail.remarks ?? summary.remarks,
    actor: detail.actor ?? summary.actor,
    director: detail.director ?? summary.director,
    description: detail.description ?? summary.description,
    rawJson: detail.rawJson ?? summary.rawJson,
  }
}
