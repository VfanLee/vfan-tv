import { useEffect, useRef, type RefObject } from 'react'
import type Artplayer from 'artplayer'
import type { Option } from 'artplayer'
import type { VideoMiniWindowPlaybackContext } from '@/types'
import { enterMiniWindowMode, onMiniWindowModeExit } from '@/platform/api'
import { artplayerControlIcons } from '@/utils'
import { reloadPlayback } from './playback-engine'
import type { BasicPlayerProps } from '../types'

/** 维护当前视频的小窗会话，退出时恢复主播放器 */
export function useVideoMiniWindow(
  artRef: RefObject<Artplayer | null>,
  callbacksRef: RefObject<Pick<BasicPlayerProps, 'onProgress'>>,
  isLive: boolean,
  miniWindowMode: boolean,
): RefObject<string | undefined> {
  const miniWindowSessionIdRef = useRef<string | undefined>(undefined)
  /** 监听迷你窗口退出事件并恢复播放进度 */
  useEffect(() => {
    if (miniWindowMode) return

    return onMiniWindowModeExit((exit) => {
      if (exit.variant === 'radio' || miniWindowSessionIdRef.current !== exit.sessionId) return
      miniWindowSessionIdRef.current = undefined
      const art = artRef.current
      if (!art) return

      if (isLive) {
        reloadPlayback(art)
        return
      }

      const resumedTime = Math.max(0, exit.currentTime)
      callbacksRef.current.onProgress?.({
        currentTime: Math.floor(resumedTime),
        duration: Number.isFinite(art.duration) ? Math.floor(art.duration) : 0,
        force: true,
      })
      art.currentTime = resumedTime
      void art.play().catch(() => undefined)
    })
  }, [artRef, callbacksRef, isLive, miniWindowMode])

  return miniWindowSessionIdRef
}

/** 创建小窗入口，点击时取得当前播放进度与设置 */
export function createMiniWindowControl(
  getPlayer: () => Artplayer,
  sessionRef: RefObject<string | undefined>,
  getPlayback: () => Omit<VideoMiniWindowPlaybackContext, 'sessionId'>,
): Option['controls'] {
  return [
    {
      name: 'vfan-mini-window-mode',
      position: 'right',
      index: 20,
      html: `<span class="vfan-mini-window-icon">${artplayerControlIcons.miniWindow}</span>`,
      tooltip: '小窗模式',
      /** 暂停主播放器并转交当前播放会话 */
      click: () => {
        if (sessionRef.current) return
        const art = getPlayer()
        const sessionId = crypto.randomUUID()
        sessionRef.current = sessionId
        art.pause()
        void enterMiniWindowMode({ ...getPlayback(), sessionId }).catch((error: unknown) => {
          sessionRef.current = undefined
          console.error('Failed to enter mini window mode:', error)
          art.notice.show = '进入小窗模式失败，请重启应用后重试'
          void art.play().catch(() => undefined)
        })
      },
    },
  ]
}
