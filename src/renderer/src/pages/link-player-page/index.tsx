import { useState } from 'react'
import { Link, Play, Sparkles } from 'lucide-react'
import type { MediaStreamType } from '@shared/types'
import { BasicPlayer } from '@renderer/components/media/basic-player'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { detectMediaStreamType, getMediaProxyBaseUrl } from '@renderer/services/api/media'

interface PlaybackSource {
  displayUrl: string
  sourceType: MediaStreamType
  url: string
}

export function LinkPlayerPage(): React.JSX.Element {
  const [inputUrl, setInputUrl] = useState('')
  const [playbackSource, setPlaybackSource] = useState<PlaybackSource>()
  const [errorMessage, setErrorMessage] = useState('')
  const [isResolving, setIsResolving] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    const displayUrl = normalizeHttpUrl(inputUrl)
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
      })
    } catch {
      setErrorMessage('链接解析失败，请检查地址后重试。')
    } finally {
      setIsResolving(false)
    }
  }

  return (
    <div className="bg-background text-foreground min-h-screen px-5 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <header>
          <div className="text-primary flex items-center gap-2">
            <Sparkles className="size-4" aria-hidden />
            <span className="text-xs font-semibold tracking-[0.16em]">DIRECT LINK</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">直链播放</h1>
          <p className="text-muted-foreground mt-1.5 text-sm">粘贴媒体地址，解析后立即播放。</p>
        </header>

        <form className="border-border bg-card rounded-xl border p-3 shadow-sm" onSubmit={handleSubmit}>
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
                onChange={(event) => setInputUrl(event.target.value)}
              />
            </div>
            <Button className="h-11 sm:min-w-28" disabled={isResolving} type="submit">
              <Play data-icon="inline-start" />
              {isResolving ? '解析中' : '播放'}
            </Button>
          </div>
          {errorMessage ? <p className="text-destructive mt-2 px-1 text-xs">{errorMessage}</p> : null}
        </form>

        <section className="aspect-video overflow-hidden rounded-xl bg-black shadow-sm">
          <BasicPlayer
            key={playbackSource?.url}
            autoPlay
            className="h-full"
            enableAutoNext={false}
            formatPlaybackUrl={() => playbackSource?.displayUrl ?? ''}
            persistPlaybackSettings={false}
            sourceType={playbackSource?.sourceType}
            src={playbackSource?.url}
            title="直链播放"
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
