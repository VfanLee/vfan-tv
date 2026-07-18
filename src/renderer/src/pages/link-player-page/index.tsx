import { useState } from 'react'
import { Link, Play } from 'lucide-react'
import type { MediaStreamType } from '@shared/types'
import { BasicPlayer } from '@renderer/components'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { detectMediaStreamType, getMediaProxyBaseUrl } from '@renderer/services/api'

type LinkPlaybackVariant = 'vod' | 'live'

const DEFAULT_LINK_PLAYBACK_URL = 'https://artplayer.org/assets/sample/video.mp4'

interface PlaybackSource {
  displayUrl: string
  sourceType: MediaStreamType
  url: string
  variant: LinkPlaybackVariant
}

const DEFAULT_PLAYBACK_SOURCE: PlaybackSource = {
  displayUrl: DEFAULT_LINK_PLAYBACK_URL,
  sourceType: 'native',
  url: DEFAULT_LINK_PLAYBACK_URL,
  variant: 'vod',
}

export function LinkPlayerPage(): React.JSX.Element {
  const [inputUrl, setInputUrl] = useState(DEFAULT_LINK_PLAYBACK_URL)
  const [playbackVariant, setPlaybackVariant] = useState<LinkPlaybackVariant>('vod')
  const [playbackSource, setPlaybackSource] = useState<PlaybackSource>(DEFAULT_PLAYBACK_SOURCE)
  const [errorMessage, setErrorMessage] = useState('')
  const [isResolving, setIsResolving] = useState(false)

  const resolvePlayback = async (rawUrl: string, variant: LinkPlaybackVariant): Promise<void> => {
    const displayUrl = normalizeHttpUrl(rawUrl)
    if (!displayUrl) {
      setErrorMessage('请输入有效的 http 或 https 播放链接。')
      return
    }

    setErrorMessage('')
    setIsResolving(true)

    try {
      const knownType = getKnownStreamType(displayUrl)
      const [detection, proxyBaseUrl] = await Promise.all([
        knownType ? undefined : detectMediaStreamType({ url: displayUrl }),
        getMediaProxyBaseUrl(),
      ])

      setPlaybackSource({
        displayUrl,
        sourceType: knownType ?? detection?.type ?? 'native',
        url: createMediaProxyUrl(proxyBaseUrl, displayUrl),
        variant,
      })
    } catch {
      setErrorMessage('链接解析失败，请检查地址后重试。')
    } finally {
      setIsResolving(false)
    }
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    await resolvePlayback(inputUrl, playbackVariant)
  }

  return (
    <div className="bg-background text-foreground h-screen overflow-hidden px-5 py-6 sm:px-8 sm:py-8">
      <div className="flex h-full min-h-0 w-full flex-col gap-5">
        <header className="shrink-0">
          <div className="flex items-center gap-2">
            <Link className="text-primary size-5" aria-hidden />
            <h1 className="text-2xl font-semibold tracking-tight">直链播放</h1>
          </div>
          <p className="text-muted-foreground mt-1.5 text-sm">粘贴媒体地址，解析后立即播放。</p>
        </header>

        <form className="flex shrink-0 flex-col gap-2" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="playback-url">
            播放链接
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Link
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                aria-hidden
              />
              <Input
                id="playback-url"
                className="h-11 pl-9"
                placeholder="输入或粘贴 http(s) 播放链接"
                value={inputUrl}
                onChange={(event) => setInputUrl(event.target.value.trim())}
              />
            </div>
            <Select value={playbackVariant} onValueChange={(value) => setPlaybackVariant(value as LinkPlaybackVariant)}>
              <SelectTrigger aria-label="播放类型" className="!h-11 w-full sm:w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="vod">点播</SelectItem>
                  <SelectItem value="live">直播</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button className="h-11 sm:min-w-28" disabled={isResolving} type="submit">
              <Play data-icon="inline-start" />
              {isResolving ? '解析中' : '播放'}
            </Button>
          </div>
          {errorMessage ? <p className="text-destructive px-1 text-xs">{errorMessage}</p> : null}
        </form>

        <section className="min-h-0 flex-1 overflow-hidden rounded-xl bg-black shadow-sm">
          <BasicPlayer
            key={`${playbackSource?.url}-${playbackSource?.variant}`}
            autoPlay
            className="h-full"
            enableAutoNext={false}
            formatPlaybackUrl={() => playbackSource?.displayUrl ?? ''}
            persistPlaybackSettings={false}
            sourceType={playbackSource?.sourceType}
            src={playbackSource?.url}
            title="直链播放"
            variant={playbackSource?.variant}
          />
        </section>
      </div>
    </div>
  )
}

function normalizeHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function getKnownStreamType(url: string): Exclude<MediaStreamType, 'native'> | undefined {
  if (/\.m3u8(?:$|[?#])/i.test(url) || /(?:^|[/?&=])(?:m3u8|hls|iptv|tvod)(?:$|[/?&=])/i.test(url)) {
    return 'hls'
  }
  if (/\.flv(?:$|[?#])/i.test(url)) return 'flv'
  if (/\.(?:ts|m2ts)(?:$|[?#])/i.test(url)) return 'mpegts'
  return undefined
}

function createMediaProxyUrl(proxyBaseUrl: string, sourceUrl: string): string {
  if (!proxyBaseUrl) return sourceUrl

  const proxyUrl = new URL('/media', proxyBaseUrl)
  proxyUrl.searchParams.set('url', sourceUrl)
  proxyUrl.searchParams.set('referer', `${new URL(sourceUrl).origin}/`)
  return proxyUrl.toString()
}
