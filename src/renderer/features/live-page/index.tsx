import { BasicPlayer } from '@renderer/components'
import { cn } from '@/utils'
import { LiveSidebar } from './components/live-sidebar'
import { useLivePlayer } from './hooks/use-live-player'

export function LivePage(): React.JSX.Element {
  const player = useLivePlayer()

  return (
    <div
      className={cn(
        player.isTheaterMode
          ? 'fixed inset-0 z-50 flex flex-col bg-black'
          : 'text-foreground min-h-screen overflow-y-auto bg-transparent px-5 py-6 sm:px-8 sm:py-8 xl:h-screen xl:overflow-hidden',
      )}
    >
      <div
        className={cn(
          player.isTheaterMode
            ? 'flex min-h-0 flex-1 items-center justify-center'
            : 'grid min-h-[calc(100vh-3rem)] grid-cols-1 gap-3 sm:min-h-[calc(100vh-4rem)] sm:gap-4 xl:h-full xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_420px]',
        )}
      >
        <section
          className={cn(
            player.isTheaterMode
              ? 'aspect-video w-full max-w-[calc(100vh*16/9)]'
              : 'flex min-h-0 flex-col gap-3 sm:gap-4',
          )}
        >
          {!player.isTheaterMode ? (
            <h1 className="text-foreground min-h-11 shrink-0 truncate text-2xl font-semibold tracking-tight">
              {player.playerTitle ?? '选择频道'}
            </h1>
          ) : null}
          <div
            className={cn(
              'min-h-0 overflow-hidden bg-black',
              !player.isTheaterMode && 'aspect-video rounded-xl xl:aspect-auto xl:min-h-0 xl:flex-1',
              player.isTheaterMode && 'h-full',
            )}
          >
            <BasicPlayer
              autoPlay
              className={player.isTheaterMode ? undefined : 'h-full'}
              enableAutoNext={false}
              formatPlaybackUrl={player.formatPlaybackUrl}
              hasNextEpisode={player.hasNextStream}
              hasPreviousEpisode={player.hasPreviousStream}
              isResolvingSource={player.isResolvingStreamType}
              isTheaterMode={player.isTheaterMode}
              loop={player.variant !== 'live'}
              persistPlaybackSettings={false}
              navigationLabels={{ next: '下一线路', previous: '上一线路' }}
              sourceType={player.activeStreamType}
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
  )
}
