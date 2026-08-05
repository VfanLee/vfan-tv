import type {
  MediaProbeInput,
  MediaProbeResult,
  SearchEvent,
  VodCatalogPage,
  VodCatalogRequest,
  VodSearchResult,
} from '@shared/types'
import { getRuntimeApi } from './client'

export async function searchVod(keyword: string): Promise<{ searchId: string } | undefined> {
  const api = getRuntimeApi()
  return api ? api.vod.search(keyword) : undefined
}

export async function cancelVodSearch(searchId: string): Promise<void> {
  const api = getRuntimeApi()
  if (api) {
    await api.vod.cancelSearch(searchId)
  }
}

export function getVodCatalogPage(input: VodCatalogRequest): Promise<VodCatalogPage> {
  const api = getRuntimeApi()
  if (!api) return Promise.reject(new Error('当前环境不支持点播源浏览'))
  return api.vod.getCatalogPage(input)
}

export function getVodDetail(sourceId: string, vodId: string): Promise<VodSearchResult> {
  const api = getRuntimeApi()
  if (!api) return Promise.reject(new Error('当前环境不支持点播详情'))
  return api.vod.getDetail(sourceId, vodId)
}

export async function probeMediaSource(input: MediaProbeInput): Promise<MediaProbeResult | undefined> {
  const api = getRuntimeApi()
  return api?.vod.probeMedia(input)
}

export function onVodSearchEvent(listener: (event: SearchEvent) => void): () => void {
  const api = getRuntimeApi()
  return api ? api.vod.onSearchEvent(listener) : () => {}
}
