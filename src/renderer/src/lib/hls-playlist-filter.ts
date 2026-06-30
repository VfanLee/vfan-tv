import type Hls from 'hls.js'
import type { LoaderCallbacks, LoaderConfiguration, LoaderContext, LoaderResponse, LoaderStats } from 'hls.js'

type PlaylistLoaderContext = LoaderContext & { type?: string }

export function filterM3U8(content: string): string {
  if (!content) {
    return ''
  }

  return filterDiscontinuityAds(filterCueAdBlocks(content))
}

function filterCueAdBlocks(content: string): string {
  const lines = content.split(/\r?\n/)
  const filteredLines: string[] = []
  let isSkippingAdBreak = false

  for (const line of lines) {
    const trimmedLine = line.trim()

    if (isAdBreakStart(trimmedLine)) {
      isSkippingAdBreak = true
      continue
    }

    if (isAdBreakEnd(trimmedLine)) {
      isSkippingAdBreak = false
      continue
    }

    if (!isSkippingAdBreak) {
      filteredLines.push(line)
    }
  }

  return filteredLines.join('\n')
}

function filterDiscontinuityAds(content: string): string {
  const lines = content.split(/\r?\n/)
  const filteredLines: string[] = []

  for (const line of lines) {
    const trimmedLine = line.trim()

    if (!trimmedLine.includes('#EXT-X-DISCONTINUITY')) {
      filteredLines.push(line)
      continue
    }

    // 常见点播广告：广告分片在 discontinuity 之前（EXTINF + ts）
    if (filteredLines.length >= 2) {
      const uriLine = filteredLines[filteredLines.length - 1]?.trim() ?? ''
      const extinfLine = filteredLines[filteredLines.length - 2]?.trim() ?? ''
      if (extinfLine.startsWith('#EXTINF') && uriLine && !uriLine.startsWith('#')) {
        filteredLines.pop()
        filteredLines.pop()
      }
    }
  }

  return filteredLines.join('\n')
}

function isAdBreakStart(line: string): boolean {
  return /^#EXT-X-CUE-OUT(?::|$)/.test(line)
}

function isAdBreakEnd(line: string): boolean {
  return line.startsWith('#EXT-X-CUE-IN')
}

export function createFilteredHlsLoader(HlsConstructor: typeof Hls): typeof Hls.DefaultConfig.loader {
  return class FilteredHlsLoader extends HlsConstructor.DefaultConfig.loader {
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
            response.data = filterM3U8(response.data)
          }

          originalSuccess(response, stats, responseContext, networkDetails)
        },
      }

      super.load(context, config, filteredCallbacks)
    }
  }
}
