import type { FavoriteInput, PlayLine, RecentPlayInput, VodSearchResult } from '@shared/types'
import { parseVodPlayUrl } from '@shared/utils/vod-play-url'
import type { EpisodeSelection, PlayerLocationState } from './types'

// 点播详情页的纯数据转换：将不同来源的原始字段规整为选集、收藏和播放记录模型。
export function getPlayLines(item: VodSearchResult | undefined): PlayLine[] {
  if (!item || !isRecord(item.raw)) return []
  return parseVodPlayUrl(getString(item.raw.vod_play_url), getString(item.raw.vod_play_from))
    .map((line) => ({ ...line, episodes: line.episodes.filter((episode) => isPlayableUrl(episode.url)) }))
    .filter((line) => line.episodes.length > 0)
}

export function getDefaultSelection(lines: PlayLine[]): Pick<EpisodeSelection, 'lineIndex' | 'episodeIndex'> {
  const lineIndex = 0
  return { lineIndex, episodeIndex: lines[lineIndex] ? getPreferredEpisodeIndex(lines[lineIndex]) : 0 }
}

export function getSelectionByEpisodeUrl(
  lines: PlayLine[],
  resourceKey: string,
  episodeUrl: string | undefined,
): EpisodeSelection | undefined {
  if (!episodeUrl) return undefined
  for (const [lineIndex, line] of lines.entries()) {
    const episodeIndex = line.episodes.findIndex((episode) => episode.url === episodeUrl)
    if (episodeIndex > -1) return { resourceKey, lineIndex, episodeIndex }
  }
  return undefined
}

export function getSelectionByIndexes(
  lines: PlayLine[],
  resourceKey: string,
  lineIndex: number | undefined,
  episodeIndex: number | undefined,
): EpisodeSelection | undefined {
  if (lineIndex === undefined || episodeIndex === undefined || lines.length === 0) return undefined
  const nextLineIndex = Math.min(Math.max(0, lineIndex), lines.length - 1)
  const line = lines[nextLineIndex]
  if (!line || line.episodes.length === 0) return undefined
  return {
    resourceKey,
    lineIndex: nextLineIndex,
    episodeIndex: Math.min(Math.max(0, episodeIndex), line.episodes.length - 1),
  }
}

export function shouldApplyLocationInitialTime(
  locationState: PlayerLocationState | null,
  activeSelection: EpisodeSelection,
  playerSrc: string | undefined,
): boolean {
  if (!locationState || !playerSrc) return false
  if (locationState.episodeUrl) return locationState.episodeUrl === playerSrc
  return (
    locationState.preferredLineIndex === activeSelection.lineIndex &&
    locationState.preferredEpisodeIndex === activeSelection.episodeIndex
  )
}

export function getEpisodeCount(item: VodSearchResult): number {
  return getPlayLines(item).reduce((total, line) => total + line.episodes.length, 0)
}

export function getCorrespondingEpisodeUrl(
  item: VodSearchResult,
  lineIndex: number,
  episodeIndex: number,
): string | undefined {
  const lines = getPlayLines(item)
  const targetLine = lines[Math.min(Math.max(0, lineIndex), Math.max(0, lines.length - 1))]
  return targetLine?.episodes[Math.min(Math.max(0, episodeIndex), targetLine.episodes.length - 1)]?.url
}

export function dedupeCandidates(items: VodSearchResult[]): VodSearchResult[] {
  const map = new Map<string, VodSearchResult>()
  for (const item of items) map.set(getCandidateKey(item), item)
  return Array.from(map.values())
}

export function getCandidateKey(item: VodSearchResult): string {
  return `${item.sourceId}:${item.vodId}`
}

export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  // 共享索引由单线程 JavaScript 事件循环递增，worker 不会处理同一个条目。
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex]
      nextIndex += 1
      if (item) await task(item)
    }
  })
  await Promise.all(workers)
}

export function getVodDetailItems(item: VodSearchResult | undefined): Array<{ label: string; value: string }> {
  const details: Array<{ label: string; value: string }> = []
  const fields: Array<[string, string[]]> = [
    ['类型', ['vod_class']],
    ['演员', ['vod_actor']],
    ['导演', ['vod_director']],
    ['编剧', ['vod_writer']],
    ['上映日期', ['vod_pubdate']],
    ['地区', ['vod_area']],
    ['语言', ['vod_lang']],
    ['年份', ['vod_year', 'vod_yea']],
  ]
  fields.forEach(([label, keys]) => {
    const value = keys.map((key) => getVodField(item, key)).find(Boolean)
    if (value) details.push({ label, value })
  })
  return details
}

export function getDoubanScore(item: VodSearchResult | undefined): string | undefined {
  if (!item || !isRecord(item.raw)) return undefined
  const value = getNumber(item.raw.vod_douban_score)
  return value > 0 ? value.toFixed(1) : undefined
}

export function getVodField(item: VodSearchResult | undefined, key: string): string | undefined {
  if (!item || !isRecord(item.raw)) return undefined
  const value = getString(item.raw[key])
  return value.length > 0 ? value : undefined
}

export function createRecentPlayInput(
  item: VodSearchResult,
  lineName: string,
  episodeName: string,
  episodeUrl: string,
  progress: { currentTime: number; duration: number },
): RecentPlayInput {
  return {
    id: createRecordId('recent', normalizeTitle(item.title)),
    sourceId: item.sourceId,
    sourceName: item.sourceName,
    vodId: item.vodId,
    title: item.title,
    poster: item.poster,
    lineName,
    episodeName,
    episodeUrl,
    currentTime: Math.max(0, Math.floor(progress.currentTime)),
    duration: Math.max(0, Math.floor(progress.duration)),
    rawJson: item.rawJson ?? stringifyRaw(item.raw),
    playedAt: Date.now(),
  }
}

export function createFavoriteInput(item: VodSearchResult): FavoriteInput {
  return {
    id: createRecordId(item.sourceId, item.vodId),
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
    rawJson: item.rawJson ?? stringifyRaw(item.raw),
  }
}

export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, '').toLocaleLowerCase()
}

function getPreferredEpisodeIndex(line: PlayLine): number {
  const index = line.episodes.findIndex((episode) => isPlayableUrl(episode.url))
  return index > -1 ? index : 0
}

function isPlayableUrl(url: string): boolean {
  return /^https?:\/\//.test(url) && /\.m3u8(?:[?#]|$)/i.test(url)
}

function createRecordId(...parts: string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join(':')
}

function stringifyRaw(value: unknown): string | undefined {
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function getNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}
