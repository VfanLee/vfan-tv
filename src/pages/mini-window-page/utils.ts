import type { MiniWindowResizeCorner, RadioMiniWindowPlaybackContext, RadioMiniWindowPlaybackExit } from '@/types'

/** 创建电台迷你窗口的初始退出状态 */
export function createInitialRadioExit(playback: RadioMiniWindowPlaybackContext): RadioMiniWindowPlaybackExit {
  return {
    sessionId: playback.sessionId,
    variant: 'radio',
    channel: playback.channel,
    isPlaying: true,
    isMuted: playback.isMuted,
    volume: playback.volume,
  }
}

/** 获取窗口缩放手柄的定位样式 */
export function getResizeHandleClassName(corner: MiniWindowResizeCorner): string {
  const positions: Record<MiniWindowResizeCorner, string> = {
    'top-left': 'top-0 left-0 cursor-nwse-resize',
    'top-right': 'top-0 right-0 cursor-nesw-resize',
    'bottom-left': 'bottom-0 left-0 cursor-nesw-resize',
    'bottom-right': 'right-0 bottom-0 cursor-nwse-resize',
  }
  return `absolute z-40 size-3 [-webkit-app-region:no-drag] ${positions[corner]}`
}
