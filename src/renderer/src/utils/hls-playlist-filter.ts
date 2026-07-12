import type Hls from 'hls.js'
import type { LoaderCallbacks, LoaderConfiguration, LoaderContext, LoaderResponse, LoaderStats } from 'hls.js'

type PlaylistLoaderContext = LoaderContext & { type?: string; url?: string }

export type HlsAdSkipReason = 'cue' | 'uri' | 'path' | 'behavior' | 'outlier'

export interface HlsAdSkipRange {
  start: number
  end: number
  reason: HlsAdSkipReason
}

export interface HlsAdFilterReport {
  removedGroups: number
  removedSegments: number
  removedDuration: number
  engines: string[]
  reasons: string[]
  reverted: boolean
  revertReason?: string
}

export interface HlsAdFilterResult {
  content: string
  report: HlsAdFilterReport
  removedRanges: HlsAdSkipRange[]
}

interface DiscontinuityGroup {
  lines: string[]
  duration: number
  segmentCount: number
  mediaUrls: string[]
  seqStart: number | null
  seqEnd: number | null
  pathBases: string[]
  isAd: boolean
  reason: string
  score: number
}

const PLAYABLE_MEDIA_PATTERN = /\.(ts|mp4|m4s|m4v|mkv|webm|flv|jpeg|jpg|png)(?:$|\?)/i
const AD_URI_PATTERN =
  /(^|[/?&._-])(ad|ads|advert|advertise|advertisement|commercial|preroll|midroll|sponsor)([/?&._=-]|$)/i
const SHORT_AD_MAX_DURATION = 35
const SHORT_AD_MAX_SEGMENTS = 20
const CONTEXT_LONG_DURATION = 60
const MIDROLL_PREV_DURATION = 120
const MIDROLL_CURR_DURATION = 45
const MAX_SOFT_AD_RATIO = 0.8
const MAX_REMOVED_DURATION_SOFT = 120

export function filterAdsFromM3U8(content: string, baseUrl = ''): HlsAdFilterResult {
  const emptyReport = createEmptyReport()
  if (!content?.trim()) {
    return { content: content ?? '', report: emptyReport, removedRanges: [] }
  }

  // Master playlist 只含清晰度变体，不做切片级过滤
  if (/#EXT-X-STREAM-INF/i.test(content)) {
    return { content, report: emptyReport, removedRanges: [] }
  }

  if (!content.includes('#EXT-X-DISCONTINUITY') && !hasCueOrAdUriHints(content)) {
    return { content, report: emptyReport, removedRanges: [] }
  }

  const lines = content.split(/\r?\n/)
  const { headerLines, groups } = splitPlaylistGroups(lines, baseUrl)
  if (groups.length === 0) {
    return { content, report: emptyReport, removedRanges: [] }
  }

  const engines = new Set<string>()
  const reasons: string[] = []

  // 1) URL 路径少数派关键词
  const pathKeywords = analyzeUrlPathKeywords(groups)
  if (pathKeywords.length > 0) {
    engines.add('path')
    for (const group of groups) {
      if (group.isAd) continue
      const matched = pathKeywords.filter((keyword) => group.mediaUrls.some((url) => url.includes(keyword)))
      if (matched.length > 0) {
        markGroupAsAd(group, `path:${matched.join(',')}`, reasons)
      }
    }
  }

  // 2) CUE / URI 关键词
  for (const group of groups) {
    if (group.isAd) continue
    const cueOrUriReason = detectCueOrUriAdReason(group)
    if (cueOrUriReason) {
      engines.add(cueOrUriReason.startsWith('cue') ? 'cue' : 'uri')
      markGroupAsAd(group, cueOrUriReason, reasons)
    }
  }

  // 3) 分片数众数离群：mixed 源正片常被切成固定 N 片一组，广告组明显更短
  markSegmentCountOutliers(groups, engines, reasons)

  // 4) 行为启发式：夹心短插播、序列号断层、片头片尾
  markBehavioralAdCandidates(groups, engines, reasons)

  const adGroups = groups.filter((group) => group.isAd)
  if (adGroups.length === 0) {
    return { content, report: emptyReport, removedRanges: [] }
  }

  const hardEvidenceCount = adGroups.filter((group) => isHardEvidenceReason(group.reason)).length
  const adRatio = adGroups.length / groups.length
  const removedDuration = adGroups.reduce((sum, group) => sum + group.duration, 0)

  if (hardEvidenceCount === 0 && adRatio > MAX_SOFT_AD_RATIO) {
    return {
      content,
      report: {
        ...emptyReport,
        reverted: true,
        revertReason: '疑似正片过于破碎且无硬证据，已放弃过滤',
      },
      removedRanges: [],
    }
  }

  if (hardEvidenceCount === 0 && removedDuration > MAX_REMOVED_DURATION_SOFT) {
    return {
      content,
      report: {
        ...emptyReport,
        reverted: true,
        revertReason: `软证据累计移除 ${removedDuration.toFixed(1)}s 过长，已放弃过滤`,
      },
      removedRanges: [],
    }
  }

  const keptGroups = groups.filter((group) => !group.isAd)
  const filteredLines = rebuildPlaylist(headerLines, keptGroups, lines)
  if (!hasPlayableMedia(filteredLines)) {
    return {
      content,
      report: {
        ...emptyReport,
        reverted: true,
        revertReason: '过滤后无可播放分片，已还原原始清单',
      },
      removedRanges: [],
    }
  }

  const removedRanges = buildRemovedRanges(groups)
  const report: HlsAdFilterReport = {
    removedGroups: adGroups.length,
    removedSegments: adGroups.reduce((sum, group) => sum + group.segmentCount, 0),
    removedDuration,
    engines: [...engines],
    reasons: [...new Set(reasons)],
    reverted: false,
  }

  return {
    content: filteredLines.join('\n'),
    report,
    removedRanges,
  }
}

/** 对净化后的清单做残留 CUE 扫描，供播放时兜底跳过 */
export function collectCueSkipRangesFromM3U8(content: string): HlsAdSkipRange[] {
  if (!content) {
    return []
  }

  const lines = content.split(/\r?\n/)
  const ranges: HlsAdSkipRange[] = []
  let currentTime = 0
  let pendingDuration: number | undefined
  let cueStart: number | undefined

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('#EXTINF:')) {
      pendingDuration = parseExtinfDuration(trimmed)
      continue
    }

    if (/^#EXT-X-CUE-OUT(?::|$)/.test(trimmed) || /SCTE35-OUT/i.test(trimmed)) {
      cueStart = currentTime
      continue
    }

    if (trimmed.startsWith('#EXT-X-CUE-IN') || /SCTE35-IN/i.test(trimmed)) {
      if (cueStart != null && currentTime > cueStart) {
        ranges.push({ start: cueStart, end: currentTime, reason: 'cue' })
      }
      cueStart = undefined
      continue
    }

    if (trimmed.startsWith('#')) {
      continue
    }

    if (pendingDuration == null) {
      continue
    }

    currentTime += pendingDuration
    pendingDuration = undefined
  }

  if (cueStart != null && currentTime > cueStart) {
    ranges.push({ start: cueStart, end: currentTime, reason: 'cue' })
  }

  return mergeAdSkipRanges(ranges)
}

/** @deprecated 使用 filterAdsFromM3U8 */
export function collectAdSkipRangesFromM3U8(content: string): HlsAdSkipRange[] {
  return filterAdsFromM3U8(content).removedRanges
}

export function createAdAwareHlsLoader(
  HlsConstructor: typeof Hls,
  onAdFiltered: (result: HlsAdFilterResult) => void,
): typeof Hls.DefaultConfig.loader {
  return class AdAwareHlsLoader extends HlsConstructor.DefaultConfig.loader {
    override load(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>,
    ): void {
      const playlistContext = context as PlaylistLoaderContext
      const isPlaylist = playlistContext.type === 'manifest' || playlistContext.type === 'level'

      if (!isPlaylist) {
        super.load(context, config, callbacks)
        return
      }

      const originalSuccess = callbacks.onSuccess
      const filteredCallbacks: LoaderCallbacks<LoaderContext> = {
        ...callbacks,
        onSuccess: (
          response: LoaderResponse,
          stats: LoaderStats,
          responseContext: LoaderContext,
          networkDetails: unknown,
        ): void => {
          if (typeof response.data === 'string') {
            const baseUrl = response.url || playlistContext.url || ''
            const result = filterAdsFromM3U8(response.data, baseUrl)
            response.data = result.content
            onAdFiltered(result)
          }

          originalSuccess(response, stats, responseContext, networkDetails)
        },
      }

      super.load(context, config, filteredCallbacks)
    }
  }
}

function createEmptyReport(): HlsAdFilterReport {
  return {
    removedGroups: 0,
    removedSegments: 0,
    removedDuration: 0,
    engines: [],
    reasons: [],
    reverted: false,
  }
}

function hasCueOrAdUriHints(content: string): boolean {
  return (
    /#EXT-X-CUE-OUT/i.test(content) ||
    /SCTE35-OUT/i.test(content) ||
    AD_URI_PATTERN.test(content) ||
    /doubleclick\.net|googleads/i.test(content)
  )
}

function splitPlaylistGroups(
  lines: string[],
  baseUrl: string,
): { headerLines: string[]; groups: DiscontinuityGroup[] } {
  const headerTags = [
    '#EXTM3U',
    '#EXT-X-VERSION',
    '#EXT-X-TARGETDURATION',
    '#EXT-X-PLAYLIST-TYPE',
    '#EXT-X-MEDIA-SEQUENCE',
    '#EXT-X-ALLOW-CACHE',
    '#EXT-X-INDEPENDENT-SEGMENTS',
    '#EXT-X-MAP',
  ]

  const uniqueHeaders = new Set<string>()
  const headerLines: string[] = []
  const rawGroups: string[][] = []
  let currentGroup: string[] = []
  let seenMedia = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const headerTag = headerTags.find((tag) => trimmed === tag || trimmed.startsWith(`${tag}:`))
    if (headerTag && !seenMedia) {
      if (!uniqueHeaders.has(headerTag)) {
        uniqueHeaders.add(headerTag)
        headerLines.push(line)
      }
      continue
    }

    if (trimmed.startsWith('#EXT-X-DISCONTINUITY')) {
      if (currentGroup.length > 0) {
        rawGroups.push(currentGroup)
        currentGroup = []
      }
      continue
    }

    if (!trimmed.startsWith('#') && PLAYABLE_MEDIA_PATTERN.test(trimmed)) {
      seenMedia = true
    }

    currentGroup.push(line)
  }

  if (currentGroup.length > 0) {
    rawGroups.push(currentGroup)
  }

  const groups = rawGroups
    .filter((group) => group.some((line) => !line.trim().startsWith('#') && PLAYABLE_MEDIA_PATTERN.test(line.trim())))
    .map((groupLines) => classifyGroup(groupLines, baseUrl))

  return { headerLines, groups }
}

function classifyGroup(lines: string[], baseUrl: string): DiscontinuityGroup {
  const mediaUrls: string[] = []
  let duration = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#EXTINF:')) {
      duration += parseExtinfDuration(trimmed) ?? 0
      continue
    }
    if (!trimmed.startsWith('#') && PLAYABLE_MEDIA_PATTERN.test(trimmed)) {
      mediaUrls.push(trimmed)
    }
  }

  const pathBases = mediaUrls
    .map((url) => extractPathBase(url, baseUrl))
    .filter((value): value is string => Boolean(value))

  const seqStart = extractSequenceNumber(mediaUrls[0])
  const seqEnd = extractSequenceNumber(mediaUrls.at(-1))

  let score = 0
  if (mediaUrls.length > 0 && mediaUrls.length <= SHORT_AD_MAX_SEGMENTS && duration <= SHORT_AD_MAX_DURATION) {
    score += 20
  }

  return {
    lines,
    duration,
    segmentCount: mediaUrls.length,
    mediaUrls,
    seqStart,
    seqEnd,
    pathBases,
    isAd: false,
    reason: '',
    score,
  }
}

function analyzeUrlPathKeywords(groups: DiscontinuityGroup[]): string[] {
  const pathStats = new Map<string, number>()
  for (const group of groups) {
    for (const pathBase of group.pathBases) {
      pathStats.set(pathBase, (pathStats.get(pathBase) ?? 0) + 1)
    }
  }

  if (pathStats.size <= 1) {
    return []
  }

  const sorted = [...pathStats.entries()].toSorted((a, b) => b[1] - a[1])
  const [mainPath, mainCount] = sorted[0]
  const suggestions = new Set<string>()

  for (let index = 1; index < sorted.length; index += 1) {
    const [suspectPath, suspectCount] = sorted[index]
    if (suspectCount >= mainCount / 2) {
      continue
    }
    const keyword = extractDistinctPathKeyword(mainPath, suspectPath)
    if (keyword) {
      suggestions.add(keyword)
    }
  }

  return [...suggestions]
}

function extractDistinctPathKeyword(mainPath: string, suspectPath: string): string | null {
  const mainParts = mainPath.split('/').filter(Boolean)
  const suspectParts = suspectPath.split('/').filter(Boolean)

  for (let index = 0; index < Math.min(mainParts.length, suspectParts.length); index += 1) {
    if (mainParts[index] === suspectParts[index]) {
      continue
    }
    const part = suspectParts[index]
    if (/^\d+$/.test(part) || /^(2160|1440|1080|720|480|360|240)p?$/i.test(part)) {
      continue
    }
    return part
  }

  return null
}

function detectCueOrUriAdReason(group: DiscontinuityGroup): string | undefined {
  const text = group.lines.join('\n')
  if (/#EXT-X-CUE-OUT/i.test(text) || /SCTE35-OUT/i.test(text)) {
    return 'cue-out'
  }

  for (const url of group.mediaUrls) {
    const normalized = url.toLowerCase()
    if (AD_URI_PATTERN.test(normalized) || normalized.includes('doubleclick.net') || normalized.includes('googleads')) {
      return `uri:${url.split('/').pop() ?? url}`
    }
  }

  // 极短且 EXTINF 全部相同：常见片头贴片
  const extinfs = group.lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith('#EXTINF:'))
    .map((line) => parseExtinfDuration(line))
    .filter((value): value is number => value != null)

  if (
    extinfs.length > 0 &&
    new Set(extinfs.map((value) => value.toFixed(3))).size === 1 &&
    group.duration > 0 &&
    group.duration < 10
  ) {
    return `uniform-short:${group.duration.toFixed(1)}s`
  }

  return undefined
}

function markSegmentCountOutliers(groups: DiscontinuityGroup[], engines: Set<string>, reasons: string[]): void {
  // 样本太少时众数不可靠
  if (groups.length < 8) {
    return
  }

  const countFrequency = new Map<number, number>()
  for (const group of groups) {
    countFrequency.set(group.segmentCount, (countFrequency.get(group.segmentCount) ?? 0) + 1)
  }

  let modeCount = 0
  let modeFrequency = 0
  for (const [segmentCount, frequency] of countFrequency) {
    if (frequency > modeFrequency || (frequency === modeFrequency && segmentCount > modeCount)) {
      modeCount = segmentCount
      modeFrequency = frequency
    }
  }

  // 需要存在占优的“常规打包”（如 ffzy mixed 常见 5 片一组）
  if (modeCount < 4 || modeFrequency / groups.length < 0.45) {
    return
  }

  const outlierMax = Math.max(2, Math.floor(modeCount * 0.6))

  for (const group of groups) {
    if (group.isAd) {
      continue
    }
    if (group.segmentCount < modeCount && group.segmentCount <= outlierMax) {
      engines.add('outlier')
      markGroupAsAd(group, `seg-outlier:${group.segmentCount}of${modeCount}`, reasons)
    }
  }
}

function markBehavioralAdCandidates(groups: DiscontinuityGroup[], engines: Set<string>, reasons: string[]): void {
  // 片头：首段短、随后正片长
  if (groups.length >= 2) {
    const first = groups[0]
    const second = groups[1]
    if (!first.isAd && first.score >= 20 && second.duration > CONTEXT_LONG_DURATION) {
      engines.add('behavior')
      markGroupAsAd(first, `preroll:${first.duration.toFixed(1)}s`, reasons)
    }
  }

  // 片尾：末段短、前一段正片长
  if (groups.length >= 2) {
    const last = groups[groups.length - 1]
    const prev = groups[groups.length - 2]
    if (!last.isAd && last.score >= 20 && prev.duration > CONTEXT_LONG_DURATION) {
      engines.add('behavior')
      markGroupAsAd(last, `postroll:${last.duration.toFixed(1)}s`, reasons)
    }
  }

  for (let index = 1; index < groups.length - 1; index += 1) {
    const prev = groups[index - 1]
    const curr = groups[index]
    const next = groups[index + 1]
    if (curr.isAd || curr.duration > 180) {
      continue
    }

    if (markSequenceBridge(prev, curr, next)) {
      engines.add('behavior')
      markGroupAsAd(curr, curr.reason, reasons)
      continue
    }

    // 长正片后的短少片组：mixed 源插播常见形态
    const isAfterLongSparse =
      prev.duration > CONTEXT_LONG_DURATION && curr.segmentCount <= 3 && curr.duration < MIDROLL_CURR_DURATION

    if (curr.score < 20 && !isAfterLongSparse) {
      continue
    }

    const isSandwiched = prev.duration > CONTEXT_LONG_DURATION && next.duration > CONTEXT_LONG_DURATION
    const isMidRoll = prev.duration > MIDROLL_PREV_DURATION && curr.duration < MIDROLL_CURR_DURATION
    if (isSandwiched || isMidRoll || isAfterLongSparse) {
      engines.add('behavior')
      markGroupAsAd(curr, `contextual-short:${curr.duration.toFixed(1)}s`, reasons)
    }
  }
}

function markSequenceBridge(prev: DiscontinuityGroup, curr: DiscontinuityGroup, next: DiscontinuityGroup): boolean {
  if (prev.seqEnd == null || next.seqStart == null || curr.seqStart == null) {
    return false
  }

  const mainGap = next.seqStart - prev.seqEnd
  if (mainGap < 1 || mainGap > 10) {
    return false
  }

  const currGap = Math.abs(curr.seqStart - prev.seqEnd)
  if (currGap <= 100) {
    return false
  }

  curr.reason = `sequence-bridge:${mainGap}/${currGap}`
  return true
}

function markGroupAsAd(group: DiscontinuityGroup, reason: string, reasons: string[]): void {
  group.isAd = true
  group.reason = reason
  reasons.push(reason)
}

function isHardEvidenceReason(reason: string): boolean {
  return (
    reason.startsWith('cue') ||
    reason.startsWith('uri:') ||
    reason.startsWith('path:') ||
    reason.startsWith('sequence-bridge') ||
    reason.startsWith('seg-outlier')
  )
}

function rebuildPlaylist(headerLines: string[], keptGroups: DiscontinuityGroup[], originalLines: string[]): string[] {
  const finalLines = [...headerLines]
  keptGroups.forEach((group, index) => {
    if (index > 0) {
      finalLines.push('#EXT-X-DISCONTINUITY')
    }
    finalLines.push(...group.lines)
  })

  const hadEndlist = originalLines.some((line) => line.trim() === '#EXT-X-ENDLIST')
  if (hadEndlist && !finalLines.some((line) => line.trim() === '#EXT-X-ENDLIST')) {
    finalLines.push('#EXT-X-ENDLIST')
  }

  return finalLines.filter((line, index, array) => {
    // 去掉连续空行
    if (!line.trim()) {
      return index === 0 || Boolean(array[index - 1]?.trim())
    }
    return true
  })
}

function buildRemovedRanges(groups: DiscontinuityGroup[]): HlsAdSkipRange[] {
  const ranges: HlsAdSkipRange[] = []
  let timeline = 0

  for (const group of groups) {
    const start = timeline
    const end = timeline + group.duration
    if (group.isAd && group.duration >= 1) {
      ranges.push({
        start,
        end,
        reason: reasonToSkipReason(group.reason),
      })
    }
    timeline = end
  }

  return mergeAdSkipRanges(ranges)
}

function reasonToSkipReason(reason: string): HlsAdSkipReason {
  if (reason.startsWith('cue')) return 'cue'
  if (reason.startsWith('uri') || reason.startsWith('uniform-short')) return 'uri'
  if (reason.startsWith('path')) return 'path'
  if (reason.startsWith('seg-outlier')) return 'outlier'
  return 'behavior'
}

function hasPlayableMedia(lines: string[]): boolean {
  return lines.some((line) => {
    const trimmed = line.trim()
    return !trimmed.startsWith('#') && PLAYABLE_MEDIA_PATTERN.test(trimmed)
  })
}

function extractPathBase(rawUrl: string, baseUrl: string): string | null {
  try {
    const url = new URL(rawUrl, baseUrl || 'https://placeholder.local/')
    const path = url.pathname
    const lastSlash = path.lastIndexOf('/')
    return lastSlash >= 0 ? path.slice(0, lastSlash + 1) : '/'
  } catch {
    return null
  }
}

function extractSequenceNumber(value: string | undefined): number | null {
  if (!value) {
    return null
  }

  try {
    const filename = value.split('?')[0]?.split('/').pop() ?? ''
    const dotIndex = filename.lastIndexOf('.')
    const basename = dotIndex > 0 ? filename.slice(0, dotIndex) : filename

    if (
      /^[a-f0-9]{16}$/i.test(basename) ||
      /^[a-f0-9]{32}$/i.test(basename) ||
      /^[a-f0-9]{8}-[a-f0-9]{4}-/i.test(basename)
    ) {
      return null
    }

    const match = filename.match(/(\d+)\.(?:ts|mp4|m4s|mkv|jpeg|jpg|png|image)$/i)
    return match ? Number.parseInt(match[1], 10) : null
  } catch {
    return null
  }
}

function parseExtinfDuration(line: string): number | undefined {
  const match = /^#EXTINF:([\d.]+)/.exec(line.trim())
  if (!match) {
    return undefined
  }

  const duration = Number(match[1])
  return Number.isFinite(duration) && duration > 0 ? duration : undefined
}

function mergeAdSkipRanges(ranges: HlsAdSkipRange[]): HlsAdSkipRange[] {
  const sortedRanges = ranges
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end - range.start >= 1)
    .toSorted((a, b) => a.start - b.start)
  const mergedRanges: HlsAdSkipRange[] = []

  for (const range of sortedRanges) {
    const previous = mergedRanges.at(-1)
    if (!previous || range.start > previous.end + 0.25) {
      mergedRanges.push({ ...range })
      continue
    }

    previous.end = Math.max(previous.end, range.end)
  }

  return mergedRanges
}
