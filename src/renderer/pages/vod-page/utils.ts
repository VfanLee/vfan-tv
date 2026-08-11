import type { FavoriteInput, MediaPlaybackCandidate, PlayLine, RecentPlayInput, VodSearchResult } from '@shared/types'
import { parseVodPlayUrl } from '@shared/utils/vod-play-url'
import { keyBy, mapAsync, uniqBy } from 'es-toolkit/array'
import { clamp, sumBy } from 'es-toolkit/math'
import type { EpisodeSelection, PlayerLocationState } from './types'

/** 解析点播原始字段，并返回包含可播放剧集的线路 */
export function getPlayLines(item: VodSearchResult | undefined): PlayLine[] {
  if (!item || !isRecord(item.raw)) return []
  return parseVodPlayUrl(getString(item.raw.vod_play_url), getString(item.raw.vod_play_from))
    .map((line) => ({ ...line, episodes: line.episodes.filter((episode) => isPlayableUrl(episode.url)) }))
    .filter((line) => line.episodes.length > 0)
}

/** 返回第一条线路及其首个可播放剧集的索引 */
export function getDefaultSelection(lines: PlayLine[]): Pick<EpisodeSelection, 'lineIndex' | 'episodeIndex'> {
  const lineIndex = 0
  return { lineIndex, episodeIndex: lines[lineIndex] ? getPreferredEpisodeIndex(lines[lineIndex]) : 0 }
}

/** 获取指定剧集可尝试的播放候选地址 */
export function getEpisodePlaybackCandidates(
  lines: PlayLine[],
  selection: Pick<EpisodeSelection, 'lineIndex' | 'episodeIndex'>,
): MediaPlaybackCandidate[] {
  const selectedEpisode = lines[selection.lineIndex]?.episodes[selection.episodeIndex]
  if (!selectedEpisode) return []
  const selectedName = normalizeEpisodeName(selectedEpisode.name)

  return uniqBy(
    lines.flatMap((line, lineIndex) => {
      const matchingEpisode = line.episodes.find((episode) => normalizeEpisodeName(episode.name) === selectedName)
      const episode = matchingEpisode ?? line.episodes[selection.episodeIndex]
      return episode ? [{ id: String(lineIndex), name: line.name, url: episode.url }] : []
    }),
    (candidate) => candidate.url,
  )
}

/** 根据剧集地址反查播放线路和剧集选择 */
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

/** 根据线路及剧集索引获取播放选择 */
export function getSelectionByIndexes(
  lines: PlayLine[],
  resourceKey: string,
  lineIndex: number | undefined,
  episodeIndex: number | undefined,
): EpisodeSelection | undefined {
  if (lineIndex === undefined || episodeIndex === undefined || lines.length === 0) return undefined
  const nextLineIndex = clamp(lineIndex, 0, lines.length - 1)
  const line = lines[nextLineIndex]
  if (!line || line.episodes.length === 0) return undefined
  return {
    resourceKey,
    lineIndex: nextLineIndex,
    episodeIndex: clamp(episodeIndex, 0, line.episodes.length - 1),
  }
}

/** 判断是否应采用路由携带的初始播放时间 */
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

/** 统计点播内容在全部线路中的可播放剧集数 */
export function getEpisodeCount(item: VodSearchResult): number {
  return sumBy(getPlayLines(item), (line) => line.episodes.length)
}

/** 获取另一播放线路中对应剧集的地址 */
export function getCorrespondingEpisodeUrl(
  item: VodSearchResult,
  lineIndex: number,
  episodeIndex: number,
): string | undefined {
  const lines = getPlayLines(item)
  const targetLine = lines[clamp(lineIndex, 0, Math.max(0, lines.length - 1))]
  return targetLine?.episodes[clamp(episodeIndex, 0, targetLine.episodes.length - 1)]?.url
}

/** 按来源和资源 ID 去重点播候选项 */
export function dedupeCandidates(items: VodSearchResult[]): VodSearchResult[] {
  return Object.values(keyBy(items, getCandidateKey))
}

/** 将来源 ID 和资源 ID 组合为候选项键 */
export function getCandidateKey(item: VodSearchResult): string {
  return `${item.sourceId}:${item.vodId}`
}

/** 按指定并发数执行异步任务 */
export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  await mapAsync(items, task, { concurrency })
}

/** 将点播原始字段转换为详情标签和值 */
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

/** 获取豆瓣评分 */
export function getDoubanScore(item: VodSearchResult | undefined): string | undefined {
  if (!item || !isRecord(item.raw)) return undefined
  const value = getNumber(item.raw.vod_douban_score)
  return value > 0 ? value.toFixed(1) : undefined
}

/** 从点播原始数据中读取非空字符串字段 */
export function getVodField(item: VodSearchResult | undefined, key: string): string | undefined {
  if (!item || !isRecord(item.raw)) return undefined
  const value = getString(item.raw[key])
  return value.length > 0 ? value : undefined
}

/** 根据当前点播详情创建最近播放记录 */
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

/** 根据当前点播详情创建收藏记录 */
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

/** 移除标题空白并转换为小写 */
export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, '').toLocaleLowerCase()
}

/** 根据剧集名称选择首选剧集索引 */
function getPreferredEpisodeIndex(line: PlayLine): number {
  const index = line.episodes.findIndex((episode) => isPlayableUrl(episode.url))
  return index > -1 ? index : 0
}

/** 规范化剧集名称 */
function normalizeEpisodeName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, '')
    .replace(/第0*(\d+)集/gi, (_match, episodeNumber: string) => `第${Number(episodeNumber)}集`)
    .toLocaleLowerCase()
}

/** 判断目标是否为可播放 URL */
function isPlayableUrl(url: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}

/** 为本地媒体记录创建稳定标识 */
function createRecordId(...parts: string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join(':')
}

/** 将未知原始值安全序列化为字符串 */
function stringifyRaw(value: unknown): string | undefined {
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

/** 判断未知值是否为普通对象记录 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 从未知对象中读取字符串字段 */
function getString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/** 从未知对象中读取数值字段 */
function getNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}
