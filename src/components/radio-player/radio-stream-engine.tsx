import { useEffect, useRef } from 'react'
import Hls from 'hls.js'
import type { ErrorTypes } from 'hls.js'
import type { RadioChannel } from '@/types'
import { getRadioPlaybackTarget, releaseMediaPlaybackSession } from '@/platform/api'
import type { RadioPlaybackCommand, RadioPlaybackStatus } from '@/stores/radio-player'
import { createMediaPlaybackCoordinator } from '@/utils'

/** 电台 HLS 引擎连续恢复的次数上限 */
const MAX_RADIO_HLS_RECOVERY_ATTEMPTS = 3

/** 管理电台音频元素、HLS 引擎与媒体会话 */
export function RadioStreamEngine({
  channel,
  command,
  commandId,
  isMuted,
  onError,
  onStatusChange,
  volume,
}: {
  channel?: RadioChannel
  command: RadioPlaybackCommand
  commandId: number
  isMuted: boolean
  onError: (message: string) => void
  onStatusChange: (status: RadioPlaybackStatus) => void
  volume: number
}): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const loadedChannelIdRef = useRef<number | undefined>(undefined)
  const mediaSessionIdRef = useRef<string | undefined>(undefined)
  const statusRef = useRef<RadioPlaybackStatus>('idle')
  const channelRef = useRef(channel)
  const commandRef = useRef(command)
  const callbacksRef = useRef({ onError, onStatusChange })

  /** 同步当前频道、控制命令和事件回调引用 */
  useEffect(() => {
    channelRef.current = channel
    commandRef.current = command
    callbacksRef.current = { onError, onStatusChange }
  }, [channel, command, onError, onStatusChange])

  /** 同步音频状态并协调其他媒体播放 */
  const reportStatus = (status: RadioPlaybackStatus): void => {
    statusRef.current = status
    callbacksRef.current.onStatusChange(status)
  }

  /** 上报当前电台播放失败原因 */
  const reportError = (message: string): void => {
    statusRef.current = 'error'
    callbacksRef.current.onError(message)
  }

  /** 绑定电台音频事件和媒体播放协调器 */
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    /** 响应其他媒体播放并暂停电台 */
    const pauseForExternalMedia = (): void => {
      audio.pause()
      hlsRef.current?.stopLoad()
      reportStatus('paused')
    }
    const playbackCoordinator = createMediaPlaybackCoordinator('radio', pauseForExternalMedia)
    /** 上报音频开始播放 */
    const onPlaying = (): void => {
      if (!['play', 'retry'].includes(commandRef.current)) return
      reportStatus('playing')
      playbackCoordinator.announcePlaying()
    }
    /** 上报音频缓冲状态 */
    const onWaiting = (): void => {
      if (statusRef.current === 'playing') reportStatus('loading')
    }
    /** 同步音频暂停状态 */
    const onPause = (): void => {
      if (statusRef.current === 'playing') reportStatus('paused')
    }
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('pause', onPause)

    return () => {
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('pause', onPause)
      playbackCoordinator.dispose()
    }
  }, [])

  /** 同步音频音量和静音状态 */
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = volume
    audio.muted = isMuted
  }, [isMuted, volume])

  /** 执行最新的电台播放控制命令 */
  useEffect(() => {
    if (!commandId) return
    const audio = audioRef.current
    if (!audio) return
    const currentChannel = channelRef.current
    const currentCommand = commandRef.current

    if (currentCommand === 'pause') {
      audio.pause()
      reportStatus('paused')
      return
    }
    if (currentCommand === 'stop') {
      teardownPlayback(audio, hlsRef)
      releaseRadioSession(mediaSessionIdRef)
      loadedChannelIdRef.current = undefined
      reportStatus('paused')
      return
    }
    if (!currentChannel || !['play', 'retry'].includes(currentCommand)) return
    releaseRadioSession(mediaSessionIdRef)
    teardownPlayback(audio, hlsRef)
    loadedChannelIdRef.current = currentChannel.id
    reportStatus('loading')
    let active = true
    let recoveryAttempts = 0
    /** 按错误类别尝试恢复电台播放 */
    const recoverPlayback = (hls: Hls, errorType: ErrorTypes): boolean => {
      recoveryAttempts += 1
      if (recoveryAttempts > MAX_RADIO_HLS_RECOVERY_ATTEMPTS) return false
      if (errorType === Hls.ErrorTypes.NETWORK_ERROR) {
        hls.startLoad()
        return true
      }
      if (errorType === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError()
        return true
      }
      return false
    }
    /** 将音频元素错误转换为播放错误 */
    const onAudioError = (): void => {
      if (!hlsRef.current) reportError('播放失败，请重试。')
    }
    audio.addEventListener('error', onAudioError)
    void getRadioPlaybackTarget(currentChannel.id)
      .then((target) => {
        if (!active) {
          if (target.mediaSessionId) void releaseMediaPlaybackSession(target.mediaSessionId).catch(console.error)
          return
        }
        mediaSessionIdRef.current = target.mediaSessionId
        const playbackUrl = target.src
        if (Hls.isSupported()) {
          const hls = new Hls(createRadioHlsConfig())
          hlsRef.current = hls
          /** 判断 HLS 回调是否仍属于当前频道 */
          const isCurrentHls = (): boolean => active && hlsRef.current === hls
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (!isCurrentHls() || !['play', 'retry'].includes(commandRef.current)) return
            void audio.play().catch(() => reportError('无法开始播放，请重试。'))
          })
          hls.on(Hls.Events.LEVEL_LOADED, () => {
            if (!isCurrentHls()) return
            recoveryAttempts = 0
          })
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!isCurrentHls()) return
            if (!data.fatal || recoverPlayback(hls, data.type)) return
            reportError('播放失败，请重试。')
          })
          hls.loadSource(playbackUrl)
          hls.attachMedia(audio)
        } else {
          audio.src = playbackUrl
          void audio.play().catch(() => reportError('无法开始播放，请重试。'))
        }
      })
      .catch(() => {
        if (active) reportError('本地音频代理未就绪，请重试。')
      })
    return () => {
      active = false
      audio.removeEventListener('error', onAudioError)
    }
  }, [commandId])

  /** 组件卸载时销毁电台音频播放实例 */
  useEffect(() => {
    const audio = audioRef.current
    return () => {
      releaseRadioSession(mediaSessionIdRef)
      if (audio) teardownPlayback(audio, hlsRef)
    }
  }, [])

  return <audio ref={audioRef} aria-hidden="true" className="hidden" />
}

/** 暂停音频并销毁所属 HLS 引擎 */
function teardownPlayback(audio: HTMLAudioElement, hlsRef: React.MutableRefObject<Hls | null>): void {
  audio.pause()
  hlsRef.current?.destroy()
  hlsRef.current = null
  audio.removeAttribute('src')
  audio.load()
}

/** 创建适用于直播电台的 HLS 加载与重试配置 */
function createRadioHlsConfig(): ConstructorParameters<typeof Hls>[0] {
  return {
    enableWorker: true,
    lowLatencyMode: false,
    manifestLoadingMaxRetry: 6,
    manifestLoadingRetryDelay: 1_000,
    manifestLoadingMaxRetryTimeout: 64_000,
    levelLoadingMaxRetry: 4,
    levelLoadingRetryDelay: 1_000,
    fragLoadingMaxRetry: 6,
    fragLoadingRetryDelay: 1_000,
    fragLoadingMaxRetryTimeout: 64_000,
    liveSyncDurationCount: 4,
    liveMaxLatencyDurationCount: 10,
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    backBufferLength: 30,
  }
}

/** 释放当前电台会话，重复清理不会影响后续播放 */
function releaseRadioSession(ref: { current: string | undefined }): void {
  const id = ref.current
  ref.current = undefined
  if (id) void releaseMediaPlaybackSession(id).catch(console.error)
}
