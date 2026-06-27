import type { FavoriteItem, RecentPlayItem, VodSearchResult } from '@shared/types'

export function recentPlayToVodSearchResult(item: RecentPlayItem): VodSearchResult {
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
