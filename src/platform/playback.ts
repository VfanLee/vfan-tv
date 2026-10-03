import type { FavoriteItem, RecentPlayItem, VodSearchResult } from '@/types'

/** 从最新检查详情或观看快照恢复点播候选项 */
export function recentPlayToVodSearchResult(item: RecentPlayItem): VodSearchResult {
  if (item.updateInfo?.latestDetail) return item.updateInfo.latestDetail
  return {
    sourceId: item.sourceId,
    sourceName: item.sourceName,
    vodId: item.vodId,
    title: item.title,
    poster: item.poster,
    raw: parseRaw(item.rawJson) ?? {
      vod_play_from: item.lineName,
      vod_play_url: `${item.episodeName}$${item.episodeUrl}`,
    },
    rawJson: item.rawJson,
  }
}

/** 从收藏快照恢复点播候选项 */
export function favoriteToVodSearchResult(item: FavoriteItem): VodSearchResult {
  return {
    sourceId: item.sourceId,
    sourceName: item.sourceName,
    sourceUrl: item.sourceUrl,
    vodId: item.vodId,
    title: item.title,
    poster: item.poster,
    year: item.year,
    area: item.area,
    language: item.language,
    category: item.category,
    remarks: item.remarks,
    actor: item.actor,
    director: item.director,
    description: item.description,
    raw: parseRaw(item.rawJson),
    rawJson: item.rawJson,
  }
}

/** 解析保存的点播详情快照 */
function parseRaw(rawJson: string | undefined): unknown | undefined {
  if (!rawJson) {
    return undefined
  }

  try {
    return JSON.parse(rawJson)
  } catch {
    return undefined
  }
}
