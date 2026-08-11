import type { IptvPlaybackTarget, IptvStreamRequestHeaders } from '@shared/types'
import type { MediaPlaybackTargetService } from '../media/media-playback-target.service'
import type { IptvCatalogService } from './iptv-catalog.service'
import type { IptvSourceRepository } from './iptv-source.repository'
import { resolveSourceRequestHeaders } from '../../infrastructure/http/source-request-headers'

const BLOCKED_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'range'])

/** 解析 IPTV 频道线路并创建播放目标 */
export class IptvPlaybackService {
  constructor(
    private readonly sourceRepository: IptvSourceRepository,
    private readonly catalogService: IptvCatalogService,
    private readonly mediaPlaybackTarget: MediaPlaybackTargetService,
  ) {}

  async getTarget(
    sourceId: string,
    channelId: string,
    streamId: string,
    requestId?: string,
  ): Promise<IptvPlaybackTarget> {
    const source = this.sourceRepository.findById(sourceId)
    if (!source) throw new Error('IPTV 源不存在')
    const playlist = await this.catalogService.get(sourceId)
    const channel = playlist.channels.find((item) => item.id === channelId)
    const stream = channel?.streams.find((item) => item.id === streamId)
    if (!channel || !stream) throw new Error('频道或线路不存在，请刷新 IPTV 源')
    const requestHeaders = mergeRequestHeaders(
      {
        headers: Object.fromEntries(
          Object.entries(resolveSourceRequestHeaders(source.url, stream.url, source.headers)),
        ),
      },
      stream.requestHeaders,
    )
    return this.mediaPlaybackTarget.resolveWithHeaders(stream.url, requestHeaders, requestId)
  }
}

/** 合并 IPTV 源与频道线路的请求头 */
export function mergeRequestHeaders(
  source: IptvStreamRequestHeaders,
  channel?: IptvStreamRequestHeaders,
): IptvStreamRequestHeaders {
  const headers = new Map<string, { name: string; value: string }>()
  for (const [name, value] of [...Object.entries(source.headers ?? {}), ...Object.entries(channel?.headers ?? {})]) {
    const normalized = name.trim().toLowerCase()
    if (!normalized || BLOCKED_HEADERS.has(normalized) || !value.trim()) continue
    headers.set(normalized, { name: name.trim(), value })
  }
  return { headers: Object.fromEntries([...headers.values()].map(({ name, value }) => [name, value])) }
}
