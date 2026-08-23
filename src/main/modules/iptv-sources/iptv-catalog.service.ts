import type { IptvPlaylist, IptvSourceConfig } from '@shared/types'
import type { IptvCacheRepository } from './iptv-cache.repository'
import type { IptvPlaylistService } from './iptv-playlist.service'
import type { IptvSourceRepository } from './iptv-source.repository'

const PLAYLIST_FRESH_MS = 6 * 60 * 60 * 1_000

/** 加载 IPTV 频道目录并管理目录缓存 */
export class IptvCatalogService {
  private readonly refreshes = new Map<string, Promise<IptvPlaylist>>()

  constructor(
    private readonly sourceRepository: IptvSourceRepository,
    private readonly cacheRepository: IptvCacheRepository,
    private readonly playlistService: IptvPlaylistService,
  ) {}

  async get(sourceId: string, force = false): Promise<IptvPlaylist> {
    const source = this.sourceRepository.findById(sourceId)
    if (!source) throw new Error('IPTV 源不存在')
    const cached = this.cacheRepository.getPlaylist(sourceId)

    if (!force && cached) {
      const stale = Date.now() - cached.fetchedAt >= PLAYLIST_FRESH_MS
      if (stale) void this.refresh(source).catch(() => undefined)
      return { ...cached, sourceId, cached: true, stale }
    }

    try {
      return await this.refresh(source)
    } catch (error) {
      if (!force && cached) return { ...cached, sourceId, cached: true, stale: true }
      throw error
    }
  }

  invalidate(sourceId: string): void {
    this.cacheRepository.deletePlaylist(sourceId)
  }

  private refresh(source: IptvSourceConfig): Promise<IptvPlaylist> {
    const active = this.refreshes.get(source.id)
    if (active) return active
    const refresh = this.playlistService
      .load(source.url, source.headers)
      .then((playlist) => {
        const next = {
          ...playlist,
          sourceId: source.id,
          cached: false,
          stale: false,
        }
        this.cacheRepository.savePlaylist(source.id, next)
        return next
      })
      .finally(() => this.refreshes.delete(source.id))
    this.refreshes.set(source.id, refresh)
    return refresh
  }
}
