import type { PlayEpisode, PlayLine } from '../types/vod'

// 兼容 CMS 常见的 “线路$$$线路 / 集名$url#集名$url” 播放字段编码。
const lineSeparator = '$$$'
const episodeSeparator = '#'
const nameUrlSeparator = '$'

function parseEpisode(rawEpisode: string, fallbackIndex: number): PlayEpisode | null {
  const trimmed = rawEpisode.trim()

  if (!trimmed) {
    return null
  }

  const separatorIndex = trimmed.indexOf(nameUrlSeparator)
  const hasName = separatorIndex > -1
  const name = hasName ? trimmed.slice(0, separatorIndex).trim() : `第${fallbackIndex + 1}集`
  const url = hasName ? trimmed.slice(separatorIndex + 1).trim() : trimmed

  if (!url) {
    return null
  }

  return {
    name: name || `第${fallbackIndex + 1}集`,
    url,
  }
}

export function parseVodPlayUrl(playUrl: string, playFrom?: string): PlayLine[] {
  const rawLines = playUrl
    .split(lineSeparator)
    .map((line) => line.trim())
    .filter(Boolean)

  const lineNames = playFrom
    ?.split(lineSeparator)
    .map((line) => line.trim())
    .filter(Boolean)

  return rawLines
    .map((rawLine, lineIndex) => {
      const episodes = rawLine
        .split(episodeSeparator)
        .map((rawEpisode, episodeIndex) => parseEpisode(rawEpisode, episodeIndex))
        .filter((episode): episode is PlayEpisode => episode !== null)

      return {
        name: lineNames?.[lineIndex] || `线路 ${lineIndex + 1}`,
        episodes,
      }
    })
    .filter((line) => line.episodes.length > 0)
}
