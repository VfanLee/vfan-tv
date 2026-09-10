import { type MutableRefObject } from 'react'
import Artplayer from 'artplayer'
import Hls from 'hls.js'
import mpegts from 'mpegts.js'
import type { MediaStreamType } from '@/types'
import type { BasicPlayerProps, PlayerRuntimeInfo } from '../types'
import {
  PlaybackDebugRecorder,
  formatUnknownErrorInfo,
  formatHlsErrorBrief,
  formatHlsPlaybackFailureReason,
} from './playback-debug'

export type ArtplayerWithHls = Artplayer & { hls?: Hls }

export type MpegtsPlayer = ReturnType<typeof mpegts.createPlayer>

/** 判断当前源是否使用 HLS 引擎 */
export function isHlsSource(src: string | undefined, sourceType: BasicPlayerProps['sourceType']): boolean {
  return Boolean(src && sourceType === 'hls')
}

/** 判断音轨是否已是本地或代理地址 */
export function isLocalPlaybackUrl(src: string | undefined): boolean {
  if (!src) return false
  try {
    const url = new URL(src)
    return !['http:', 'https:'].includes(url.protocol) || url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  } catch {
    return true
  }
}

/** 判断当前源是否使用 FLV 引擎 */
export function isFlvSource(src: string | undefined, sourceType: BasicPlayerProps['sourceType']): boolean {
  return Boolean(src && sourceType === 'flv')
}

/** 判断当前源是否使用 MPEG-TS 引擎 */
export function isMpegtsSource(src: string | undefined, sourceType: BasicPlayerProps['sourceType']): boolean {
  return Boolean(src && sourceType === 'mpegts')
}

/** 将播放引擎标记转换为媒体类型 */
export function getStreamType(isHls: boolean, isFlv: boolean, isMpegts: boolean): MediaStreamType {
  if (isHls) return 'hls'
  if (isFlv) return 'flv'
  if (isMpegts) return 'mpegts'
  return 'native'
}

/** 选择 ArtPlayer 的媒体类型处理器 */
export function getArtplayerType(src: string | undefined, sourceType: BasicPlayerProps['sourceType']): string {
  if (isHlsSource(src, sourceType)) {
    return 'm3u8'
  }

  if (isFlvSource(src, sourceType)) {
    return 'flv'
  }

  if (isMpegtsSource(src, sourceType)) {
    return 'mpegts'
  }

  return ''
}

/** 流媒体连续重连的次数上限 */
const MAX_MPEGTS_RECONNECT_ATTEMPTS = 6

/** 稳定播放后重置重连计数的等待时间 */
const MPEGTS_RECONNECT_RESET_DELAY_MS = 5_000

/** 创建流媒体引擎并管理断线重连 */
export function createMpegtsPlayback(
  video: HTMLVideoElement,
  url: string,
  art: Artplayer,
  type: 'flv' | 'mpegts',
  isLive: boolean,
  mpegtsRef: MutableRefObject<MpegtsPlayer | null>,
  hlsRef: MutableRefObject<Hls | null>,
  debugLog: PlaybackDebugRecorder,
  reportPlaybackFailure: (art: Artplayer, reason: string) => void,
  reportRuntimeInfo: (info: Partial<PlayerRuntimeInfo>) => void,
): void {
  destroyHls(hlsRef)
  destroyMpegts(mpegtsRef)

  const label = type === 'flv' ? 'FLV' : 'MPEG-TS'
  if (!mpegts.isSupported()) {
    debugLog.push(label, '当前环境不支持播放')
    reportPlaybackFailure(art, `当前环境不支持 ${label} 播放`)
    return
  }

  const treatAsLive = isLive || type === 'flv'
  let reconnectAttempts = 0
  let resetAttemptsTimer: number | undefined

  /** 取消重连计数重置任务 */
  const clearResetAttemptsTimer = (): void => {
    if (resetAttemptsTimer !== undefined) {
      window.clearTimeout(resetAttemptsTimer)
      resetAttemptsTimer = undefined
    }
  }

  // 一段时间内没有再次触发重连，说明这次重连已经稳定住了，重置计数器，
  // 避免「断了很多次」这个历史状态一直压着最大重试次数不放。
  /** 稳定播放后重置连续重连计数 */
  const scheduleResetAttempts = (): void => {
    clearResetAttemptsTimer()
    resetAttemptsTimer = window.setTimeout(() => {
      reconnectAttempts = 0
    }, MPEGTS_RECONNECT_RESET_DELAY_MS)
  }

  /** 挂载流媒体引擎并注册播放事件 */
  const startPlayer = (): MpegtsPlayer => {
    const player = mpegts.createPlayer(
      { type, url, isLive: treatAsLive },
      {
        enableWorker: true,
        enableStashBuffer: !treatAsLive,
        stashInitialSize: treatAsLive ? 128 * 1024 : 384 * 1024,
        liveBufferLatencyChasing: treatAsLive,
        // 直播必须关闭 lazyLoad：默认 true 会在缓冲足够后主动断开 HTTP，
        // 推流一断就只剩已缓冲的一小段，表现为播几秒暂停、点播放又重播同一段。
        // IPTV 场景下 FLV 基本都是推流，即使被标成录播也按直播处理。
        lazyLoad: !treatAsLive,
        deferLoadAfterSourceOpen: !treatAsLive,
        autoCleanupSourceBuffer: treatAsLive,
      },
    )

    // 用 ref 是否仍指向当前 player 实例判断回调是否过期：
    // 组件卸载/切换源会替换或清空 mpegtsRef，此后旧 player 的异步事件应被忽略。
    /** 判断回调所属引擎是否已被替换 */
    const isStale = (): boolean => mpegtsRef.current !== player

    player.on(mpegts.Events.ERROR, (errorType: string, errorDetail: string, errorInfo: unknown) => {
      if (isStale()) return
      debugLog.push(label, `${errorType} · ${errorDetail} · ${formatUnknownErrorInfo(errorInfo)}`)
      if (treatAsLive) {
        reconnect(player, `${errorDetail || errorType}`)
        return
      }
      reportPlaybackFailure(art, `${label} 播放失败：${errorDetail || errorType}`)
    })
    player.on(mpegts.Events.MEDIA_INFO, () => {
      if (isStale()) return
      debugLog.push(label, '媒体信息已解析')
      const mediaInfo = player.mediaInfo
      const codecInfo = mediaInfo as typeof mediaInfo & {
        fps?: number
        videoCodec?: string
        audioCodec?: string
      }
      reportRuntimeInfo({
        width: mediaInfo?.width,
        height: mediaInfo?.height,
        fps: codecInfo?.fps,
        videoCodec: codecInfo?.videoCodec,
        audioCodec: codecInfo?.audioCodec,
      })
    })
    player.on(mpegts.Events.LOADING_COMPLETE, () => {
      if (isStale() || !treatAsLive) return
      // 直播推流被上游正常关闭（无报错的 HTTP 响应结束）时，mpegts.js 会直接判定为播放
      // 完毕并调用 endOfStream，表现为播一会儿就停、点播放又重播同一小段。
      // 直播场景下这其实等价于断线，需要自动重新拉流，而不是当作播放结束处理。
      reconnect(player, '上游连接正常关闭')
    })
    player.attachMediaElement(video)
    player.load()
    return player
  }

  // reason 参数携带触发重连的原 player 实例：定时器触发时需要重新核对
  // mpegtsRef 是否仍指向它，避免组件卸载/切换播放源后，过期的重连定时器
  // 反而把新播放源刚创建好的 player 顶掉。
  /** 释放失效引擎并按重试间隔重新连接 */
  const reconnect = (fromPlayer: MpegtsPlayer, reason: string): void => {
    reconnectAttempts += 1
    clearResetAttemptsTimer()
    if (reconnectAttempts > MAX_MPEGTS_RECONNECT_ATTEMPTS) {
      reportPlaybackFailure(art, `${label} 直播连接反复中断（${reason}），已停止自动重连`)
      return
    }

    const delayMs = Math.min(500 * 2 ** (reconnectAttempts - 1), 5_000)
    debugLog.push(label, `直播连接中断 · ${reason} · ${delayMs}ms 后第 ${reconnectAttempts} 次重连`)
    window.setTimeout(() => {
      if (mpegtsRef.current !== fromPlayer) return
      try {
        fromPlayer.unload()
        fromPlayer.detachMediaElement()
        fromPlayer.destroy()
      } catch {
        // Ignore teardown errors from the previous, already-broken player instance.
      }
      const nextPlayer = startPlayer()
      mpegtsRef.current = nextPlayer
      scheduleResetAttempts()
      void nextPlayer.play()?.catch(() => undefined)
    }, delayMs)
  }

  mpegtsRef.current = startPlayer()
}

/** 读取当前 HLS 视频和音频轨道信息 */
export function getHlsRuntimeInfo(hls: Hls, video: HTMLVideoElement): Partial<PlayerRuntimeInfo> {
  const levelIndex = hls.currentLevel >= 0 ? hls.currentLevel : hls.loadLevel
  const level = hls.levels[levelIndex] ?? hls.levels[0]
  const audioTrack = hls.audioTracks[hls.audioTrack] ?? hls.audioTracks[0]
  return {
    width: video.videoWidth || level?.width || undefined,
    height: video.videoHeight || level?.height || undefined,
    fps: level?.frameRate || undefined,
    videoCodec: level?.videoCodec || undefined,
    audioCodec: audioTrack?.audioCodec || level?.audioCodec || undefined,
  }
}

/** 重新加载媒体并恢复有效的播放进度 */
export function reloadPlayback(art: Artplayer): void {
  const currentTime = art.currentTime
  void art
    .switchUrl(art.url)
    .then(() => {
      if (currentTime > 0 && Number.isFinite(art.duration) && currentTime < art.duration) {
        art.currentTime = currentTime
      }
      return art.play()
    })
    .catch((error: unknown) => {
      art.notice.show = error instanceof Error ? error.message : '刷新失败'
    })
}

/** 配置 HLS 加载重试与直播缓冲 */
export function createHlsConfig(isLive: boolean): ConstructorParameters<typeof Hls>[0] {
  return {
    startLevel: -1,
    manifestLoadingMaxRetry: 6,
    manifestLoadingRetryDelay: 1000,
    manifestLoadingMaxRetryTimeout: 64_000,
    levelLoadingMaxRetry: 4,
    levelLoadingRetryDelay: 1000,
    fragLoadingMaxRetry: 6,
    fragLoadingMaxRetryTimeout: 64_000,
    fragLoadingRetryDelay: 1000,
    ...(isLive
      ? {
          lowLatencyMode: false,
          liveSyncDurationCount: 4,
          liveMaxLatencyDurationCount: 10,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          backBufferLength: 30,
        }
      : {}),
  }
}

/** 销毁 HLS 引擎并清空引用 */
export function destroyHls(hlsRef: MutableRefObject<Hls | null>): void {
  hlsRef.current?.destroy()
  hlsRef.current = null
}

/** 卸载并销毁流媒体引擎 */
export function destroyMpegts(mpegtsRef: MutableRefObject<MpegtsPlayer | null>): void {
  if (!mpegtsRef.current) {
    return
  }

  try {
    mpegtsRef.current.unload()
    mpegtsRef.current.detachMediaElement()
  } catch {
    // Ignore teardown errors from partially initialized FLV players.
  }

  mpegtsRef.current.destroy()
  mpegtsRef.current = null
}

/** 创建 HLS 引擎并上报轨道、运行状态和不可恢复的错误 */
export function createHlsPlayback(
  video: HTMLVideoElement,
  url: string,
  artInstance: Artplayer,
  isLive: boolean,
  hlsRef: MutableRefObject<Hls | null>,
  mpegtsRef: MutableRefObject<MpegtsPlayer | null>,
  debugLog: PlaybackDebugRecorder,
  reportPlaybackFailure: (art: Artplayer, reason: string) => void,
  reportRuntimeInfo: (info: Partial<PlayerRuntimeInfo>) => void,
  onAudioTracks: (available: boolean) => void,
): void {
  let hlsNetworkRecoveryAttempts = 0
  destroyHls(hlsRef)
  destroyMpegts(mpegtsRef)

  if (Hls.isSupported()) {
    const hls = new Hls(createHlsConfig(isLive))
    hlsRef.current = hls
    artInstance.hls = hls
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      debugLog.push('HLS', `清单已解析 · ${hls.levels.length} 档 · ${hls.audioTracks.length} 音轨`)
      onAudioTracks(hls.audioTracks.length > 1)
      reportRuntimeInfo(getHlsRuntimeInfo(hls, video))
    })
    hls.on(Hls.Events.LEVEL_SWITCHED, () => reportRuntimeInfo(getHlsRuntimeInfo(hls, video)))
    hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, () => reportRuntimeInfo(getHlsRuntimeInfo(hls, video)))
    hls.on(Hls.Events.LEVEL_LOADED, () => {
      hlsNetworkRecoveryAttempts = 0
    })
    hls.on(Hls.Events.ERROR, (_event, data) => {
      debugLog.push('HLS', formatHlsErrorBrief(data))
      if (data.fatal && isLive && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        hlsNetworkRecoveryAttempts += 1
        if (hlsNetworkRecoveryAttempts <= 2) {
          debugLog.push('HLS', `network fatal · 第 ${hlsNetworkRecoveryAttempts} 次尝试重新加载清单`)
          hls.startLoad()
          return
        }
        reportPlaybackFailure(artInstance, 'HLS 网络连接持续失败，自动恢复未成功')
        return
      }

      if (data.fatal) {
        reportPlaybackFailure(artInstance, formatHlsPlaybackFailureReason(data))
      }
    })
    hls.loadSource(url)
    hls.attachMedia(video)
    return
  }

  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    debugLog.push('HLS', '使用 Safari 原生 HLS')
    video.src = url
    return
  }

  debugLog.push('HLS', '当前环境不支持 HLS 播放')
  reportPlaybackFailure(artInstance, '当前环境不支持 HLS 播放')
}
