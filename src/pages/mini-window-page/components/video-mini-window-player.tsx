import type { VideoMiniWindowPlaybackContext } from '@/types'
import { BasicPlayer, type MiniWindowPlayerController, type MiniWindowPlayerState } from '@/components'

/** 渲染视频迷你窗口播放器 */
export function VideoMiniWindowPlayer({
  playback,
  playerControllerRef,
  onPlayerStateChange,
  onProgress,
}: {
  playback: VideoMiniWindowPlaybackContext
  playerControllerRef: React.MutableRefObject<MiniWindowPlayerController | null>
  onPlayerStateChange: (state: MiniWindowPlayerState) => void
  onProgress: (currentTime: number) => void
}): React.JSX.Element {
  return (
    <BasicPlayer
      autoPlay
      audioTrackUrl={playback.audioTrackUrl}
      className="h-full"
      enableAutoNext={false}
      initialTime={playback.initialTime}
      loop={playback.loop}
      mediaSessionId={playback.mediaSessionId}
      miniWindowMode
      persistPlaybackSettings={false}
      sourceType={playback.sourceType}
      src={playback.src}
      title={playback.title}
      variant={playback.variant}
      onMiniWindowControllerReady={(controller) => {
        playerControllerRef.current = controller
      }}
      onMiniWindowPlayerStateChange={onPlayerStateChange}
      onProgress={({ currentTime }) => onProgress(currentTime)}
    />
  )
}
