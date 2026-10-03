import type { MediaPlaybackCandidate, PlayEpisode, PlayLine, VodSearchResult } from '@/types'
import type { EpisodeSelection, PlayerLocationState } from './types'
import { getEpisodePlaybackCandidates, getPlayLines, getSelectionByEpisodeUrl } from './utils'

export interface VodPlaybackSession {
  requestKey: string
  item: VodSearchResult
  lines: PlayLine[]
  selection: EpisodeSelection
  candidates: MediaPlaybackCandidate[]
  initialTime: number
}

/** 按剧集地址及名称在刷新后的列表中定位原剧集，避免索引重排造成跳集 */
export function locateEpisode(
  lines: PlayLine[],
  resourceKey: string,
  episode?: PlayEpisode,
  lineName?: string,
): EpisodeSelection | undefined {
  if (!episode) return undefined
  const byUrl = getSelectionByEpisodeUrl(lines, resourceKey, episode.url)
  if (byUrl) return byUrl
  const preferredLine = lines.findIndex((line) => line.name === lineName)
  const ordered = [...lines.keys()].sort(
    (left, right) => Number(right === preferredLine) - Number(left === preferredLine),
  )
  for (const lineIndex of ordered) {
    const episodeIndex = lines[lineIndex].episodes.findIndex(
      (candidate) => normalizeEpisode(candidate.name) === normalizeEpisode(episode.name),
    )
    if (episodeIndex >= 0) return { resourceKey, lineIndex, episodeIndex }
  }
  return undefined
}

/** 在含当前剧集的线路中优先展示集数最多的选集，媒体会话仍使用原线路 */
export function locateEpisodePanel(
  lines: PlayLine[],
  resourceKey: string,
  episode?: PlayEpisode,
  lineName?: string,
): EpisodeSelection | undefined {
  const ordered = [...lines.keys()].sort(
    (left, right) =>
      lines[right].episodes.length - lines[left].episodes.length ||
      Number(lines[right].name === lineName) - Number(lines[left].name === lineName),
  )
  for (const lineIndex of ordered) {
    const matched = locateEpisode([lines[lineIndex]], resourceKey, episode, lineName)
    if (matched) return { ...matched, lineIndex }
  }
  return undefined
}

/** 规范化集名以匹配空白及数字前导零变化 */
function normalizeEpisode(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, '')
    .replace(/第0*(\d+)集/gi, (_match, number: string) => `第${Number(number)}集`)
    .toLocaleLowerCase()
}

/** 固定一次主动播放请求的媒体候选与初始进度，详情刷新不修改此快照 */
export function createVodPlaybackSession(
  requestKey: string,
  item: VodSearchResult,
  selection: EpisodeSelection,
  locationState: PlayerLocationState | null,
): VodPlaybackSession {
  const lines = getPlayLines(item)
  const candidates = getEpisodePlaybackCandidates(lines, selection)
  const episode = lines[selection.lineIndex]?.episodes[selection.episodeIndex]
  const resumed = locationState?.episodeUrl
    ? candidates.some((candidate) => candidate.url === locationState.episodeUrl) ||
      Boolean(
        episode &&
        locationState.episodeName &&
        normalizeEpisode(episode.name) === normalizeEpisode(locationState.episodeName),
      )
    : locationState?.preferredLineIndex === selection.lineIndex &&
      locationState?.preferredEpisodeIndex === selection.episodeIndex
  return {
    requestKey,
    item,
    lines,
    selection,
    candidates,
    initialTime: resumed ? Math.max(0, Math.floor(locationState?.initialTime ?? 0)) : 0,
  }
}
