import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniWindowPlaybackContext, RadioMiniWindowPlaybackExit } from '@/types'
import { type MiniWindowPlayerController, type MiniWindowPlayerState } from '@/components'
import {
  exitMiniWindowMode,
  getMiniWindowAlwaysOnTop,
  getMiniWindowPlayback,
  readyMiniWindow,
  setMiniWindowAlwaysOnTop,
} from '@/platform/api'
import { createInitialRadioExit } from '../utils'

/** 管理小窗播放上下文、进度、退出与置顶状态 */
export function useMiniWindowSession(): {
  playback: MiniWindowPlaybackContext | undefined
  currentTimeRef: React.RefObject<number>
  radioExitRef: React.RefObject<RadioMiniWindowPlaybackExit | undefined>
  lastReportedTimeRef: React.RefObject<number>
  playerControllerRef: React.RefObject<MiniWindowPlayerController | null>
  playerState: MiniWindowPlayerState
  setPlayerState: React.Dispatch<React.SetStateAction<MiniWindowPlayerState>>
  isAlwaysOnTop: boolean
  isAlwaysOnTopUpdating: boolean
  leaveMiniWindowMode: () => void
  toggleAlwaysOnTop: () => void
} {
  const [playback, setPlayback] = useState<MiniWindowPlaybackContext | undefined>(undefined)
  const currentTimeRef = useRef(0)
  const radioExitRef = useRef<RadioMiniWindowPlaybackExit | undefined>(undefined)
  const lastReportedTimeRef = useRef(-1)
  const playerControllerRef = useRef<MiniWindowPlayerController | null>(null)
  const [playerState, setPlayerState] = useState<MiniWindowPlayerState>({
    isPlaying: true,
    isMuted: false,
  })
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false)
  const [isAlwaysOnTopUpdating, setIsAlwaysOnTopUpdating] = useState(false)

  /** 设置迷你窗口透明背景并在卸载时恢复 */
  useEffect(() => {
    const root = document.getElementById('root')
    const previousHtmlBackground = document.documentElement.style.background
    const previousBodyBackground = document.body.style.background
    const previousRootBackground = root?.style.background ?? ''

    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    if (root) root.style.background = 'transparent'

    return () => {
      document.documentElement.style.background = previousHtmlBackground
      document.body.style.background = previousBodyBackground
      if (root) root.style.background = previousRootBackground
    }
  }, [])

  /** 加载迷你窗口播放内容和置顶状态 */
  useEffect(() => {
    void getMiniWindowPlayback().then((context) => {
      if (!context) return
      if (context.variant === 'radio') {
        radioExitRef.current = createInitialRadioExit(context)
      } else {
        currentTimeRef.current = context.initialTime
      }
      setPlayback(context)
      void getMiniWindowAlwaysOnTop(context.sessionId).then(setIsAlwaysOnTop)
    })
  }, [])

  /** 播放上下文就绪后显示小窗 */
  useEffect(() => {
    if (playback) void readyMiniWindow(playback.sessionId).catch(console.error)
  }, [playback])

  /** 退出迷你窗口模式 */
  const leaveMiniWindowMode = useCallback((): void => {
    if (!playback) return
    if (playback.variant === 'radio') {
      void exitMiniWindowMode(radioExitRef.current ?? createInitialRadioExit(playback))
      return
    }
    void exitMiniWindowMode({
      sessionId: playback.sessionId,
      variant: playback.variant,
      currentTime: currentTimeRef.current,
    })
  }, [playback])

  /** 绑定迷你窗口退出和视频快进快捷键 */
  useEffect(() => {
    /** 处理键盘按键事件 */
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        leaveMiniWindowMode()
        return
      }
      if (
        !playback ||
        playback.variant === 'radio' ||
        playback.variant === 'live' ||
        (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return
      }
      const controller = playerControllerRef.current
      if (!controller) return
      event.preventDefault()
      controller.seekBy(event.key === 'ArrowRight' ? 5 : -5)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [leaveMiniWindowMode, playback])

  /** 切换当前小窗置顶状态，并在失败时释放忙碌状态 */
  const toggleAlwaysOnTop = (): void => {
    if (!playback || isAlwaysOnTopUpdating) return
    setIsAlwaysOnTopUpdating(true)
    void setMiniWindowAlwaysOnTop(playback.sessionId, !isAlwaysOnTop)
      .then(setIsAlwaysOnTop)
      .catch(console.error)
      .finally(() => setIsAlwaysOnTopUpdating(false))
  }
  return {
    playback,
    currentTimeRef,
    radioExitRef,
    lastReportedTimeRef,
    playerControllerRef,
    playerState,
    setPlayerState,
    isAlwaysOnTop,
    isAlwaysOnTopUpdating,
    leaveMiniWindowMode,
    toggleAlwaysOnTop,
  }
}
