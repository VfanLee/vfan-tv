import { useState } from 'react'
import { Link, Play } from 'lucide-react'
import { BasicPlayer, PageHeader } from '@renderer/components'
import { useMediaPlaybackTarget } from '@renderer/hooks'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'

type LinkPlaybackVariant = 'vod' | 'live'

const DEFAULT_LINK_PLAYBACK_URL = 'https://artplayer.org/assets/sample/video.mp4'

interface PlaybackRequest {
  url: string
  variant: LinkPlaybackVariant
}

const DEFAULT_PLAYBACK_REQUEST: PlaybackRequest = {
  url: DEFAULT_LINK_PLAYBACK_URL,
  variant: 'vod',
}

export function LinkPlayerPage(): React.JSX.Element {
  const [inputUrl, setInputUrl] = useState(DEFAULT_LINK_PLAYBACK_URL)
  const [playbackVariant, setPlaybackVariant] = useState<LinkPlaybackVariant>('vod')
  const [playbackRequest, setPlaybackRequest] = useState<PlaybackRequest>(DEFAULT_PLAYBACK_REQUEST)
  const [validationError, setValidationError] = useState('')
  const playbackResolution = useMediaPlaybackTarget({
    candidates: [{ id: 'direct-link', name: '直链', url: playbackRequest.url }],
    diagnostics: { sourceName: '直链播放' },
  })
  const playbackTarget = playbackResolution.target
  const errorMessage = validationError || playbackResolution.errorMessage

  const resolvePlayback = (rawUrl: string, variant: LinkPlaybackVariant): void => {
    const displayUrl = normalizeHttpUrl(rawUrl)
    if (!displayUrl) {
      setValidationError('请输入有效的 http 或 https 播放链接。')
      return
    }

    setValidationError('')
    setPlaybackRequest({ url: displayUrl, variant })
    playbackResolution.retry()
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    resolvePlayback(inputUrl, playbackVariant)
  }

  return (
    <div className="text-foreground h-full overflow-hidden bg-transparent px-5 py-6 sm:px-8 sm:py-8">
      <div className="flex h-full min-h-0 w-full flex-col gap-5">
        <PageHeader className="mb-0 shrink-0" title="直链播放" />

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
            <Button className="h-11 sm:min-w-28" disabled={playbackResolution.isLoading} type="submit">
              <Play data-icon="inline-start" />
              {playbackResolution.isLoading ? '解析中' : '播放'}
            </Button>
          </div>
          {errorMessage ? <p className="text-destructive px-1 text-xs">{errorMessage}</p> : null}
        </form>

        <section className="min-h-0 flex-1 overflow-hidden rounded-xl bg-black shadow-sm">
          <BasicPlayer
            key={`${playbackTarget?.src}-${playbackRequest.variant}`}
            autoPlay
            className="h-full"
            enableAutoNext={false}
            formatPlaybackUrl={() => playbackRequest.url}
            isResolvingSource={playbackResolution.isLoading}
            mediaSessionId={playbackTarget?.mediaSessionId}
            persistPlaybackSettings={false}
            sourceType={playbackTarget?.streamType}
            src={playbackTarget?.src}
            title="直链播放"
            variant={playbackRequest.variant}
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
