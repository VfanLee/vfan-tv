import type Hls from 'hls.js'
import type { LoaderCallbacks, LoaderConfiguration, LoaderContext, LoaderResponse, LoaderStats } from 'hls.js'

type PlaylistLoaderContext = LoaderContext & { type?: string }

export function filterM3U8(content: string): string {
  if (!content) return ''

  return content
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('#EXT-X-DISCONTINUITY'))
    .join('\n')
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
