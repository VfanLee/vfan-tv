import { BasicPlayer } from '@renderer/components'
import { cn } from '@renderer/utils/cn'
import { LiveSidebar, NowPlayingTitle } from './components/live-sidebar'
import { useLivePlayer } from './hooks/use-live-player'

export function LivePage(): React.JSX.Element {
  const player = useLivePlayer()

  return (
    <div
      className={cn(
        player.isTheaterMode
          ? 'fixed inset-0 z-50 flex flex-col bg-black'
          : 'bg-background text-foreground min-h-screen overflow-y-auto p-3 sm:p-4 xl:h-screen xl:overflow-hidden',
      )}
    >
      <div
        className={cn(
          player.isTheaterMode
            ? 'flex min-h-0 flex-1 items-center justify-center'
            : 'mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-[1760px] flex-col gap-3 sm:min-h-[calc(100vh-2rem)] sm:gap-4 xl:h-full xl:min-h-0',
        )}
      >
        {!player.isTheaterMode ? <NowPlayingTitle title={player.playerTitle} /> : null}
        <div
          className={cn(
            player.isTheaterMode
              ? 'aspect-video w-full max-w-[calc(100vh*16/9)]'
              : 'grid flex-1 grid-cols-1 gap-3 sm:gap-4 xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_420px]',
          )}
        >
          <section className={cn(player.isTheaterMode ? 'h-full w-full' : 'min-h-0')}>
            <div
              className={cn(
                'min-h-0 overflow-hidden bg-black',
                !player.isTheaterMode && 'aspect-video rounded-xl xl:aspect-auto xl:h-full',
                player.isTheaterMode && 'h-full',
              )}
            >
              <BasicPlayer
                autoPlay
                className={player.isTheaterMode ? undefined : 'h-full'}
                enableAdFilter={false}
                enableAutoNext={false}
                formatPlaybackUrl={player.formatPlaybackUrl}
                hasNextEpisode={player.hasNextStream}
                hasPreviousEpisode={player.hasPreviousStream}
                isTheaterMode={player.isTheaterMode}
                loop={player.variant !== 'live'}
                persistPlaybackSettings={false}
                navigationLabels={{ next: '下一线路', previous: '上一线路' }}
                sourceType={player.activeStreamIsHls ? 'hls' : player.activeStreamIsFlv ? 'flv' : undefined}
                src={player.playerSrc}
                title={player.playerTitle}
                variant={player.variant}
                onNextEpisode={() => player.selectStreamByOffset(1)}
                onPreviousEpisode={() => player.selectStreamByOffset(-1)}
                onToggleTheaterMode={() => player.setIsTheaterMode((current) => !current)}
              />
            </div>
          </section>

          {!player.isTheaterMode ? <LiveSidebar player={player} /> : null}
        </div>
      </div>
    </div>
  )
}
