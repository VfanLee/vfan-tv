import type Hls from 'hls.js'
import type { LoaderCallbacks, LoaderConfiguration, LoaderContext, LoaderResponse, LoaderStats } from 'hls.js'

type PlaylistLoaderContext = LoaderContext & { type?: string }

export interface HlsAdSkipRange {
  start: number
  end: number
  reason: 'cue' | 'uri'
}

interface PendingSegment {
  duration: number
  uri: string
  start: number
  tags: string[]
}

export function collectAdSkipRangesFromM3U8(content: string): HlsAdSkipRange[] {
  if (!content) {
    return []
  }

  const lines = content.split(/\r?\n/)
  const ranges: HlsAdSkipRange[] = []
  const cueRanges: HlsAdSkipRange[] = []
  let currentTime = 0
  let pendingDuration: number | undefined
  let cueStart: number | undefined
  let pendingTags: string[] = []

  for (const line of lines) {
    const trimmedLine = line.trim()
    if (!trimmedLine) {
      continue
    }

    if (trimmedLine.startsWith('#EXTINF:')) {
      pendingDuration = parseExtinfDuration(trimmedLine)
      pendingTags.push(trimmedLine)
      continue
    }

    if (isAdBreakStart(trimmedLine)) {
      cueStart = currentTime
      pendingTags.push(trimmedLine)
      continue
    }

    if (isAdBreakEnd(trimmedLine)) {
      if (cueStart != null && currentTime > cueStart) {
        cueRanges.push({ start: cueStart, end: currentTime, reason: 'cue' })
      }
      cueStart = undefined
      pendingTags = []
      continue
    }

    if (trimmedLine.startsWith('#')) {
      pendingTags.push(trimmedLine)
      continue
    }

    if (pendingDuration == null) {
      pendingTags = []
      continue
    }

    const segment: PendingSegment = {
      duration: pendingDuration,
      uri: trimmedLine,
      start: currentTime,
      tags: pendingTags,
    }
    const segmentEnd = currentTime + pendingDuration

    if (cueStart != null || isAdSegment(segment)) {
      ranges.push({
        start: segment.start,
        end: segmentEnd,
        reason: cueStart != null ? 'cue' : 'uri',
      })
    }

    currentTime = segmentEnd
    pendingDuration = undefined
    pendingTags = []
  }

  if (cueStart != null && currentTime > cueStart) {
    cueRanges.push({ start: cueStart, end: currentTime, reason: 'cue' })
  }

  return mergeAdSkipRanges([...cueRanges, ...ranges])
}

function isAdBreakStart(line: string): boolean {
  return /^#EXT-X-CUE-OUT(?::|$)/.test(line) || /SCTE35-OUT/i.test(line)
}

function isAdBreakEnd(line: string): boolean {
  return line.startsWith('#EXT-X-CUE-IN') || /SCTE35-IN/i.test(line)
}

function parseExtinfDuration(line: string): number | undefined {
  const match = /^#EXTINF:([\d.]+)/.exec(line)
  if (!match) {
    return undefined
  }

  const duration = Number(match[1])
  return Number.isFinite(duration) && duration > 0 ? duration : undefined
}

function isAdSegment(segment: PendingSegment): boolean {
  const normalizedUri = segment.uri.toLowerCase()
  const normalizedTags = segment.tags.join('\n').toLowerCase()

  return (
    /(^|[/?&._-])(ad|ads|advert|advertise|advertisement|commercial|preroll|midroll|sponsor)([/?&._=-]|$)/.test(
      normalizedUri,
    ) ||
    normalizedUri.includes('doubleclick.net') ||
    normalizedUri.includes('googleads') ||
    normalizedTags.includes('cue-out') ||
    normalizedTags.includes('scte35-out')
  )
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
    if (previous.reason !== range.reason) {
      previous.reason = 'cue'
    }
  }

  return mergedRanges
}

export function createAdAwareHlsLoader(
  HlsConstructor: typeof Hls,
  onAdSkipRanges: (ranges: HlsAdSkipRange[]) => void,
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
            onAdSkipRanges(collectAdSkipRangesFromM3U8(response.data))
          }

          originalSuccess(response, stats, responseContext, networkDetails)
        },
      }

      super.load(context, config, filteredCallbacks)
    }
  }
}
