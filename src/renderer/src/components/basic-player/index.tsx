import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
import Artplayer, { type Option } from 'artplayer'
import artplayerPluginAmbilight from 'artplayer-plugin-ambilight'
import artplayerPluginAudioTrack from 'artplayer-plugin-audio-track'
import artplayerPluginHlsControl from 'artplayer-plugin-hls-control'
import Hls, { type ErrorData } from 'hls.js'
import mpegts from 'mpegts.js'
import {
  PLAYER_AUTO_NEXT_STORAGE_KEY,
  PLAYER_LOOP_STORAGE_KEY,
  PLAYER_PLAYBACK_RATE_STORAGE_KEY,
  PLAYER_SEEK_STEP_STORAGE_KEY,
} from '@shared/constants'
import type { MediaStreamType } from '@shared/types'
import { enterMiniWindowMode, isApiAvailable, onMiniWindowModeExit } from '@renderer/services/api'
import { artplayerControlIcons, artplayerSwitchIcons, cn } from '@/utils'
import { CustomSliderDialog, DisplaySettingsMenu } from './components/display-settings-dialogs'
import { createSettingsPositionTracker } from './utils/settings-position'
import type { BasicPlayerProps, CustomSliderInput, DisplaySettingsState, MiniWindowPlayerController } from './types'

// 播放器适配层：统一 ArtPlayer、HLS.js 与 mpegts.js 的生命周期及持久化播放设置。
export type {
  BasicPlayerProps,
  MiniWindowPlayerController,
  MiniWindowPlayerState,
  PlayerNavigationLabels,
  PlayerVariant,
} from './types'

interface BasicPlayerCallbacks {
  onEnded?: () => void
  onProgress?: (progress: { currentTime: number; duration: number; force?: boolean }) => void
}

type ArtplayerWithHls = Artplayer & { hls?: Hls }
type MpegtsPlayer = ReturnType<typeof mpegts.createPlayer>

let cachedAppVersion = ''

interface PlaybackDebugLogEntry {
  at: string
  type: string
  message: string
}

class PlaybackDebugRecorder {
  private entries: PlaybackDebugLogEntry[] = []

  push(type: string, message: string): void {
    this.entries.push({
      at: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      type,
      message,
    })
    if (this.entries.length > 30) {
      this.entries.shift()
    }
  }

  format(): string {
    if (!this.entries.length) {
      return '（暂无记录）'
    }

    return this.entries.map((entry) => `[${entry.at}] ${entry.type}: ${entry.message}`).join('\n')
  }
}

interface DebugInfoParams {
  art: Artplayer
  rawSrc: string
  displayUrl: string
  isHls: boolean
  isFlv: boolean
  isMpegts: boolean
  isLive: boolean
  title?: string
  sourceType?: string
  autoPlay: boolean
  loop: boolean
  initialTime: number
  audioTrackUrl?: string
  debugLog: PlaybackDebugRecorder
  autoNextEnabled: boolean
}

interface VideoPlaybackQualityInfo {
  droppedVideoFrames?: number
  totalVideoFrames?: number
}

export function BasicPlayer({
  autoPlay = false,
  audioTrackUrl,
  className,
  enableAutoNext = true,
  initialTime = 0,
  isResolvingSource = false,
  isTheaterMode = false,
  loop,
  miniWindowMode = false,
  onMiniWindowControllerReady,
  onMiniWindowPlayerStateChange,
  persistPlaybackSettings = true,
  formatPlaybackUrl = normalizePlaybackUrlForDisplay,
  onEnded,
  onProgress,
  sourceType,
  src,
  title,
  variant = 'vod',
}: BasicPlayerProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const artRef = useRef<Artplayer | null>(null)
  const hlsRef = useRef<Hls | null>(null)
  const mpegtsRef = useRef<MpegtsPlayer | null>(null)
  const callbacksRef = useRef<BasicPlayerCallbacks>({})
  const formatPlaybackUrlRef = useRef(formatPlaybackUrl)
  const initialTimeRef = useRef(initialTime)
  const resumeTimeRef = useRef(0)
  const resolvedUrlRef = useRef('检测中…')
  const restoreFullscreenWebRef = useRef(false)
  const miniWindowSessionIdRef = useRef<string | undefined>(undefined)
  const miniWindowControllerReadyRef = useRef(onMiniWindowControllerReady)
  const miniWindowPlayerStateChangeRef = useRef(onMiniWindowPlayerStateChange)
  const [customNumberInput, setCustomNumberInput] = useState<CustomSliderInput | undefined>(undefined)
  const [displaySettings, setDisplaySettings] = useState<DisplaySettingsState | undefined>(undefined)
  const [isDisplaySettingsClosing, setIsDisplaySettingsClosing] = useState(false)
  const [settingsPortalContainer, setSettingsPortalContainer] = useState<HTMLElement | undefined>(undefined)
  const [settingsBottomOffset, setSettingsBottomOffset] = useState(64)

  const isLive = variant === 'live'
  const isHls = isHlsSource(src, sourceType)
  const isFlv = isFlvSource(src, sourceType)
  const isMpegts = isMpegtsSource(src, sourceType)
  const canEnterMiniWindowMode = !miniWindowMode && isApiAvailable()

  useEffect(() => {
    setCustomNumberInput(undefined)
    setDisplaySettings(undefined)
    setIsDisplaySettingsClosing(false)
    setSettingsPortalContainer(undefined)
    setSettingsBottomOffset(64)
  }, [sourceType, src])

  useEffect(() => {
    callbacksRef.current = {
      onEnded,
      onProgress,
    }
    formatPlaybackUrlRef.current = formatPlaybackUrl
    initialTimeRef.current = initialTime
    miniWindowControllerReadyRef.current = onMiniWindowControllerReady
    miniWindowPlayerStateChangeRef.current = onMiniWindowPlayerStateChange
  }, [formatPlaybackUrl, initialTime, onEnded, onMiniWindowControllerReady, onMiniWindowPlayerStateChange, onProgress])

  useEffect(() => {
    if (miniWindowMode) return

    return onMiniWindowModeExit(({ sessionId, currentTime }) => {
      if (miniWindowSessionIdRef.current !== sessionId) return
      miniWindowSessionIdRef.current = undefined
      const art = artRef.current
      if (!art) return

      if (isLive) {
        reloadPlayback(art)
        return
      }

      const resumedTime = Math.max(0, currentTime)
      callbacksRef.current.onProgress?.({
        currentTime: Math.floor(resumedTime),
        duration: Number.isFinite(art.duration) ? Math.floor(art.duration) : 0,
        force: true,
      })
      art.currentTime = resumedTime
      void art.play().catch(() => undefined)
    })
  }, [isLive, miniWindowMode])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !src) {
      return
    }

    destroyHls(hlsRef)
    destroyMpegts(mpegtsRef)
    container.innerHTML = ''
    container.setAttribute('aria-label', title ?? 'Vfan TV 播放器')
    const displayPlaybackUrl = formatPlaybackUrlRef.current(src)
    const debugLog = new PlaybackDebugRecorder()

    const resolveAbortController = new AbortController()
    let isResolveActive = true
    // FLV/TS 直播源必须跳过二次解析探测：这类 CDN 常用 URL 里的 session token（seqid/stream_key 等）
    // 做单连接鉴权，哪怕探测请求只读头就断开，服务端一旦收到同 token 的新请求就可能判定为「重连」，
    // 把正在播放的那条连接踢掉——表现为播一小段就卡住，点播放又重复同一小段。
    if (isLive || isFlv || isMpegts) {
      resolvedUrlRef.current = extractProxiedTargetUrl(src) ?? displayPlaybackUrl
    } else {
      resolvedUrlRef.current = '检测中…'
      void resolvePlaybackAddress(src, resolveAbortController.signal).then((resolvedUrl) => {
        if (isResolveActive) {
          resolvedUrlRef.current = resolvedUrl
        }
      })
    }

    if (!cachedAppVersion && window.api?.updates?.getCurrentVersion) {
      void window.api.updates.getCurrentVersion().then((version) => {
        cachedAppVersion = version
      })
    }

    let hlsControlUpdate: (() => void) | undefined
    let audioMenuItem: HTMLElement | undefined
    let loopEnabled = loop ?? (persistPlaybackSettings ? readLoopEnabled() : false)
    let autoNextEnabled = enableAutoNext && (persistPlaybackSettings ? readAutoNextEnabled() : true)
    let playbackRate = persistPlaybackSettings ? readPlaybackRate() : 1
    let seekStep = persistPlaybackSettings ? readSeekStep() : 5
    let hasReportedPlaybackFailure = false
    let hlsNetworkRecoveryAttempts = 0

    const reportPlaybackFailure = (artInstance: Artplayer, reason: string): void => {
      if (hasReportedPlaybackFailure) return
      hasReportedPlaybackFailure = true
      debugLog.push('FAIL', reason)
      artInstance.notice.show = `无法播放：${reason}`
    }

    const openSettingPanel = function (this: Artplayer, contextmenu: { show: boolean }): void {
      this.setting.show = true
      contextmenu.show = false
    }

    // https://artplayer.org/document/start/option.html
    const art = new Artplayer({
      container, // 播放器挂载的 DOM 容器
      url: src, // 当前实际播放地址
      type: getArtplayerType(src, sourceType), // 自定义媒体类型交给 customType 处理
      lang: 'zh-cn', // 使用 ArtPlayer 内置简体中文文案
      autoplay: autoPlay, // 是否自动播放
      loop: loopEnabled, // 是否循环播放
      isLive, // 是否启用直播模式（真直播无进度条、无倍速）
      setting: !miniWindowMode, // 保留原生齿轮入口，面板由项目自定义 UI 接管
      playbackRate: false, // 使用项目自定义的倍速选项
      aspectRatio: false, // 使用项目自定义的画面比例项
      flip: false, // 使用项目自定义的画面翻转项
      hotkey: !miniWindowMode, // 是否启用 ArtPlayer 原生快捷键
      pip: false, // 不提供画中画功能与入口
      fullscreen: !miniWindowMode, // 是否启用浏览器全屏
      fullscreenWeb: !miniWindowMode, // 是否启用窗口全屏
      miniProgressBar: !miniWindowMode, // 控制栏收起时保留播放进度提示
      screenshot: !miniWindowMode, // 是否启用截图
      lock: !miniWindowMode, // 是否启用移动端锁定按钮
      fastForward: !miniWindowMode, // 是否启用长按快进
      autoOrientation: !miniWindowMode, // 是否启用移动端全屏自动横屏
      airplay: !miniWindowMode, // 是否启用 AirPlay
      playsInline: true, // 是否内联播放，避免移动端强制全屏
      mutex: true, // 是否与页面上的其他 ArtPlayer 实例互斥播放
      backdrop: !miniWindowMode, // 是否显示控制栏背景遮罩
      theme: '#fff', // 主色：进度条、音量、选中等高亮统一为纯白
      icons: {
        switchOn: artplayerSwitchIcons.on, // 开关“开启”态：纯白实心
        switchOff: artplayerSwitchIcons.off, // 开关“关闭”态：暗色镂空
      },
      moreVideoAttr: {
        preload: 'metadata', // 只预加载媒体元信息
        playsInline: true, // 透传 video playsinline 属性
      },
      settings: [], // 原生设置项全部改由自定义菜单渲染
      i18n: {
        'zh-cn': {
          'Web Fullscreen': '窗口全屏',
          'Exit Web Fullscreen': '退出窗口全屏',
        },
      },
      controls: canEnterMiniWindowMode
        ? [
            {
              name: 'vfan-mini-window-mode',
              position: 'right',
              index: 20,
              html: artplayerControlIcons.miniWindow,
              tooltip: '小窗模式',
              click: () => {
                if (!src) return
                const sessionId = crypto.randomUUID()
                miniWindowSessionIdRef.current = sessionId
                art.pause()
                void enterMiniWindowMode({
                  sessionId,
                  src,
                  sourceType,
                  title,
                  variant,
                  initialTime: isLive ? 0 : art.currentTime,
                  loop: loopEnabled,
                  audioTrackUrl,
                }).catch((error: unknown) => {
                  miniWindowSessionIdRef.current = undefined
                  console.error('Failed to enter mini window mode:', error)
                  art.notice.show = '进入小窗模式失败，请重启应用后重试'
                  void art.play().catch(() => undefined)
                })
              },
            },
          ]
        : [],
      plugins: [
        // 背光插件
        ...(!miniWindowMode
          ? [
              artplayerPluginAmbilight({
                blur: '30px', // 背光模糊半径
                opacity: 0.5, // 背光透明度
              }),
            ]
          : []),
        // 独立外部音轨插件
        ...(audioTrackUrl
          ? [
              artplayerPluginAudioTrack({
                url: audioTrackUrl, // 独立外部音轨地址
              }),
            ]
          : []),
        ...(!miniWindowMode && isHls
          ? [
              (art) => {
                const plugin = artplayerPluginHlsControl({
                  quality: {
                    control: false,
                    setting: false,
                  },
                  audio: {
                    control: false,
                    setting: true,
                    title: '音效',
                    auto: '自动',
                  },
                })(art)
                hlsControlUpdate = plugin.update
                return plugin
              },
            ]
          : []),
      ],
      contextmenu: miniWindowMode
        ? []
        : [
            {
              name: 'vfan-copy-url',
              html: '复制视频地址',
              click: (contextmenu) => {
                void navigator.clipboard.writeText(displayPlaybackUrl)
                art.notice.show = '视频地址已复制'
                contextmenu.show = false
              },
              mounted(element) {
                element.title = displayPlaybackUrl
              },
            },
            {
              name: 'vfan-audio',
              html: '音效调节',
              style: { display: 'none' },
              click: openSettingPanel,
              mounted(element: HTMLElement) {
                audioMenuItem = element
              },
            },
            {
              name: 'vfan-copy-debug',
              html: '复制调试信息',
              click: (contextmenu) => {
                void navigator.clipboard.writeText(
                  buildDebugInfoText({
                    art,
                    rawSrc: src,
                    displayUrl: displayPlaybackUrl,
                    isHls,
                    isLive,
                    title,
                    sourceType,
                    autoPlay,
                    loop: loopEnabled,
                    initialTime: initialTimeRef.current,
                    isFlv,
                    isMpegts,
                    audioTrackUrl,
                    debugLog,
                    autoNextEnabled,
                  }),
                )
                art.notice.show = '调试信息已复制'
                contextmenu.show = false
              },
            },
            {
              name: 'vfan-stats',
              html: '统计信息',
              click: (contextmenu) => {
                art.info.show = true
                contextmenu.show = false
              },
            },
            {
              name: 'vfan-refresh',
              html: '刷新',
              click: (contextmenu) => {
                reloadPlayback(art)
                contextmenu.show = false
              },
            },
          ],
      customType: {
        // 自定义媒体类型处理器
        m3u8(video, url, artInstance) {
          destroyHls(hlsRef)
          destroyMpegts(mpegtsRef)

          if (Hls.isSupported()) {
            const hls = new Hls(createHlsConfig(isLive))
            hlsRef.current = hls
            artInstance.hls = hls
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              debugLog.push('HLS', `清单已解析 · ${hls.levels.length} 档 · ${hls.audioTracks.length} 音轨`)
              if (hasHlsAudioTracks(hls)) {
                hlsControlUpdate?.()
                setContextMenuItemVisible(audioMenuItem, true)
              }
            })
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
        },
        flv(video, url, artInstance) {
          createMpegtsPlayback(
            video,
            url,
            artInstance,
            'flv',
            isLive,
            mpegtsRef,
            hlsRef,
            debugLog,
            reportPlaybackFailure,
          )
        },
        mpegts(video, url, artInstance) {
          createMpegtsPlayback(
            video,
            url,
            artInstance,
            'mpegts',
            isLive,
            mpegtsRef,
            hlsRef,
            debugLog,
            reportPlaybackFailure,
          )
        },
      },
    } satisfies Option)

    artRef.current = art
    const reportMiniWindowPlayerState = (): void => {
      miniWindowPlayerStateChangeRef.current?.({
        isPlaying: !art.video.paused && !art.video.ended,
        isMuted: art.video.muted,
      })
    }
    const miniWindowController: MiniWindowPlayerController = {
      togglePlayback: () => {
        if (art.video.paused) void art.play().catch(() => undefined)
        else art.pause()
      },
      toggleMuted: () => {
        art.muted = !art.muted
        reportMiniWindowPlayerState()
      },
      seekBy: (seconds) => {
        if (isLive || !Number.isFinite(seconds) || seconds === 0) return
        if (seconds > 0) art.forward = seconds
        else art.backward = Math.abs(seconds)
      },
    }
    if (miniWindowMode) {
      miniWindowControllerReadyRef.current?.(miniWindowController)
      reportMiniWindowPlayerState()
      art.on('video:play', reportMiniWindowPlayerState)
      art.on('video:pause', reportMiniWindowPlayerState)
      art.on('video:volumechange', reportMiniWindowPlayerState)
    }
    if (!miniWindowMode) setSettingsPortalContainer(art.template.$player)
    const settingsPosition = createSettingsPositionTracker(art, (nextOffset) => {
      setSettingsBottomOffset((current) => (current === nextOffset ? current : nextOffset))
    })
    settingsPosition.schedule()
    if (!isLive) {
      art.playbackRate = playbackRate
      art.template.$player.tabIndex = 0
    }
    if (!miniWindowMode) removeDefaultContextMenuItems(art)
    if (isLive) {
      removeLiveSettingItems(art)
    }
    injectPlayerChromeStyles(art, miniWindowMode)
    localizeInfoPanel(art, displayPlaybackUrl, resolvedUrlRef, getStreamType(isHls, isFlv, isMpegts), isLive, mpegtsRef)
    const openDisplaySettings = (): void => {
      settingsPosition.refreshAfterControlTransition()
      const refresh = (): void => openDisplaySettings()
      const hls = (art as ArtplayerWithHls).hls
      const audioTrack =
        hls && hls.audioTracks.length > 1
          ? {
              label: hls.audioTracks[hls.audioTrack]?.name || `音轨 ${hls.audioTrack + 1}`,
              onClick: () => {
                hls.audioTrack = (hls.audioTrack + 1) % hls.audioTracks.length
                refresh()
              },
            }
          : undefined
      setDisplaySettings({
        aspectRatio: art.aspectRatio,
        flip: art.flip,
        audioTrack,
        playbackRate,
        seekStep,
        loop: loopEnabled,
        autoNext: autoNextEnabled,
        showPlaybackSettings: !isLive,
        showAutoNext: !isLive && enableAutoNext,
        onAspectRatio: () => {
          art.aspectRatio = nextFromList(art.aspectRatio, ['default', '4:3', '16:9'])
          refresh()
        },
        onFlip: () => {
          art.flip = nextFromList(art.flip, ['normal', 'horizontal', 'vertical'])
          refresh()
        },
        onPlaybackRate: () => {
          setCustomNumberInput(
            createPlaybackRateSliderInput(art, playbackRate, (nextRate) => {
              playbackRate = nextRate
              if (persistPlaybackSettings)
                window.localStorage.setItem(PLAYER_PLAYBACK_RATE_STORAGE_KEY, String(nextRate))
            }),
          )
        },
        onSeekStep: () => {
          setCustomNumberInput(
            createSeekStepSliderInput(art, seekStep, (nextStep) => {
              seekStep = nextStep
              if (persistPlaybackSettings) window.localStorage.setItem(PLAYER_SEEK_STEP_STORAGE_KEY, String(nextStep))
            }),
          )
        },
        onLoop: () => {
          loopEnabled = !loopEnabled
          art.video.loop = loopEnabled
          if (persistPlaybackSettings) window.localStorage.setItem(PLAYER_LOOP_STORAGE_KEY, String(loopEnabled))
          refresh()
        },
        onAutoNext: () => {
          autoNextEnabled = !autoNextEnabled
          if (persistPlaybackSettings)
            window.localStorage.setItem(PLAYER_AUTO_NEXT_STORAGE_KEY, String(autoNextEnabled))
          refresh()
        },
      })
    }
    art.on('setting', (visible) => {
      if (miniWindowMode) return
      if (!visible) return
      art.setting.show = false
      openDisplaySettings()
    })
    art.on('ready', () => {
      settingsPosition.schedule()
      // 换源等必要重建时，恢复销毁前的窗口全屏状态
      if (restoreFullscreenWebRef.current) {
        restoreFullscreenWebRef.current = false
        art.fullscreenWeb = true
      }
    })
    art.on('fullscreen', settingsPosition.schedule)
    art.on('fullscreenWeb', settingsPosition.schedule)

    const focusPlayer = (): void => art.template.$player.focus()
    const handleSeekShortcut = (event: KeyboardEvent): void => {
      if (
        isLive ||
        (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        !art.template.$player.contains(document.activeElement) ||
        isTextInputTarget(event.target)
      ) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'ArrowRight') {
        art.forward = seekStep
        art.notice.show = `快进 ${seekStep} 秒`
      } else {
        art.backward = seekStep
        art.notice.show = `回退 ${seekStep} 秒`
      }
    }
    const preventMiniWindowContextMenu = (event: Event): void => event.preventDefault()
    art.template.$player.addEventListener('pointerdown', focusPlayer)
    if (miniWindowMode) art.template.$player.addEventListener('contextmenu', preventMiniWindowContextMenu)
    document.addEventListener('keydown', handleSeekShortcut, true)

    let startTimeApplied = false

    const applyStartTime = (): void => {
      if (startTimeApplied || isLive) {
        return
      }

      const requestedTime = resumeTimeRef.current > 0 ? resumeTimeRef.current : initialTimeRef.current
      if (requestedTime <= 0) {
        startTimeApplied = true
        resumeTimeRef.current = 0
        return
      }

      const duration = art.duration
      if (!Number.isFinite(duration) || duration <= 0 || requestedTime >= duration) {
        return
      }

      startTimeApplied = true
      resumeTimeRef.current = 0
      art.currentTime = requestedTime

      if (autoPlay) {
        void art.play().catch(() => undefined)
      }
    }

    art.on('ready', applyStartTime)
    art.on('video:loadedmetadata', applyStartTime)
    art.on('video:canplay', applyStartTime)
    art.on('video:timeupdate', () => {
      callbacksRef.current.onProgress?.({
        currentTime: Math.floor(art.currentTime),
        duration: Number.isFinite(art.duration) ? Math.floor(art.duration) : 0,
      })
    })
    art.on('video:ended', () => {
      if (enableAutoNext && autoNextEnabled) {
        callbacksRef.current.onEnded?.()
      }
    })
    art.on('video:stalled', () => debugLog.push('video', 'stalled · 数据获取停滞'))
    art.on('video:waiting', () => debugLog.push('video', 'waiting · 缓冲不足'))
    art.on('video:abort', () => debugLog.push('video', 'abort · 加载被中断'))
    art.on('video:emptied', () => debugLog.push('video', 'emptied · 媒体被清空'))
    art.on('video:error', () => {
      const mediaError = formatMediaElementError(art.video)
      if (mediaError) {
        debugLog.push('video:error', mediaError)
        reportPlaybackFailure(art, getMediaPlaybackFailureReason(art.video))
      }
    })
    art.on('error', (error) => {
      debugLog.push('Artplayer', error.message || '播放器加载失败')
      reportPlaybackFailure(art, error.message || '播放器加载失败')
    })

    return () => {
      settingsPosition.destroy()
      setSettingsPortalContainer((current) => (current === art.template.$player ? undefined : current))
      isResolveActive = false
      resolveAbortController.abort()
      art.template.$player.removeEventListener('pointerdown', focusPlayer)
      art.template.$player.removeEventListener('contextmenu', preventMiniWindowContextMenu)
      document.removeEventListener('keydown', handleSeekShortcut, true)
      destroyHls(hlsRef)
      destroyMpegts(mpegtsRef)
      // ArtPlayer 窗口全屏会把 $player 挂到 body，销毁前需先退出，否则残留遮罩会卡住页面
      try {
        if (art.fullscreenWeb) {
          restoreFullscreenWebRef.current = true
          art.fullscreenWeb = false
        }
        if (art.fullscreen) {
          art.fullscreen = false
        }
      } catch {
        // Ignore teardown errors while leaving fullscreen states.
      }
      art.destroy(false)
      if (miniWindowMode) miniWindowControllerReadyRef.current?.(null)
      if (artRef.current === art) {
        artRef.current = null
      }
      container.innerHTML = ''
    }
  }, [
    audioTrackUrl,
    autoPlay,
    enableAutoNext,
    isHls,
    isFlv,
    isMpegts,
    isLive,
    loop,
    miniWindowMode,
    canEnterMiniWindowMode,
    persistPlaybackSettings,
    sourceType,
    src,
    title,
    variant,
  ])

  const displaySettingsOverlay = customNumberInput ? (
    <CustomSliderDialog
      key={`${customNumberInput.title}-${customNumberInput.initialValue}`}
      input={customNumberInput}
      closing={isDisplaySettingsClosing}
      bottomOffset={settingsBottomOffset}
      onBack={() => setCustomNumberInput(undefined)}
    />
  ) : displaySettings ? (
    <DisplaySettingsMenu
      state={displaySettings}
      closing={isDisplaySettingsClosing}
      bottomOffset={settingsBottomOffset}
    />
  ) : null

  return (
    <div
      className={cn(
        'relative w-full overflow-hidden bg-black',
        (isTheaterMode || miniWindowMode) && 'h-full',
        className,
      )}
      onPointerDownCapture={(event) => {
        if (miniWindowMode) return
        if (!displaySettings || !(event.target instanceof Element) || event.target.closest('[data-display-settings]'))
          return
        const isControlInteraction = Boolean(event.target.closest('.art-bottom'))
        if (!isControlInteraction) {
          event.preventDefault()
          event.stopPropagation()
        }
        if (isDisplaySettingsClosing) return
        setIsDisplaySettingsClosing(true)
        window.setTimeout(() => {
          setCustomNumberInput(undefined)
          setDisplaySettings(undefined)
          setIsDisplaySettingsClosing(false)
        }, 150)
      }}
    >
      <div ref={containerRef} aria-hidden={!src ? true : undefined} className="h-full w-full" />
      {!src ? (
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 flex items-center justify-center text-sm text-white/55',
            isTheaterMode ? 'inset-y-0' : 'top-14 bottom-16',
          )}
        >
          {isResolvingSource ? '正在识别播放源…' : '请先选择要播放的内容'}
        </div>
      ) : null}
      {!miniWindowMode &&
        (settingsPortalContainer
          ? createPortal(displaySettingsOverlay, settingsPortalContainer)
          : displaySettingsOverlay)}
    </div>
  )
}

function isHlsSource(src: string | undefined, sourceType: BasicPlayerProps['sourceType']): boolean {
  if (!src) {
    return false
  }

  return sourceType === 'hls' || /\.m3u8(?:$|[?#])/i.test(src)
}

function isFlvSource(src: string | undefined, sourceType: BasicPlayerProps['sourceType']): boolean {
  if (!src) {
    return false
  }

  return sourceType === 'flv' || /\.flv(?:$|[?#])/i.test(src)
}

function isMpegtsSource(src: string | undefined, sourceType: BasicPlayerProps['sourceType']): boolean {
  if (!src) {
    return false
  }

  return sourceType === 'mpegts' || /\.(?:ts|m2ts)(?:$|[?#])/i.test(src)
}

function getStreamType(isHls: boolean, isFlv: boolean, isMpegts: boolean): MediaStreamType {
  if (isHls) return 'hls'
  if (isFlv) return 'flv'
  if (isMpegts) return 'mpegts'
  return 'native'
}

function getArtplayerType(src: string | undefined, sourceType: BasicPlayerProps['sourceType']): string {
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

const MAX_MPEGTS_RECONNECT_ATTEMPTS = 6
const MPEGTS_RECONNECT_RESET_DELAY_MS = 5_000

function createMpegtsPlayback(
  video: HTMLVideoElement,
  url: string,
  art: Artplayer,
  type: 'flv' | 'mpegts',
  isLive: boolean,
  mpegtsRef: MutableRefObject<MpegtsPlayer | null>,
  hlsRef: MutableRefObject<Hls | null>,
  debugLog: PlaybackDebugRecorder,
  reportPlaybackFailure: (art: Artplayer, reason: string) => void,
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

  const clearResetAttemptsTimer = (): void => {
    if (resetAttemptsTimer !== undefined) {
      window.clearTimeout(resetAttemptsTimer)
      resetAttemptsTimer = undefined
    }
  }

  // 一段时间内没有再次触发重连，说明这次重连已经稳定住了，重置计数器，
  // 避免「断了很多次」这个历史状态一直压着最大重试次数不放。
  const scheduleResetAttempts = (): void => {
    clearResetAttemptsTimer()
    resetAttemptsTimer = window.setTimeout(() => {
      reconnectAttempts = 0
    }, MPEGTS_RECONNECT_RESET_DELAY_MS)
  }

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

function removeDefaultContextMenuItems(art: Artplayer): void {
  for (const name of ['playbackRate', 'aspectRatio', 'flip', 'info', 'version', 'close']) {
    try {
      art.contextmenu.remove(name)
    } catch {
      // Ignore missing built-in context menu entries.
    }
  }
}

function removeLiveSettingItems(art: Artplayer): void {
  for (const name of ['playback-rate', 'vfan-loop', 'vfan-auto-next', 'hls-ad-filter']) {
    try {
      art.setting.remove(name)
    } catch {
      // Ignore settings that were not mounted for this source.
    }
  }
}

function hasHlsAudioTracks(hls: Hls): boolean {
  return hls.audioTracks.length > 1
}

function setContextMenuItemVisible(element: HTMLElement | undefined, visible: boolean): void {
  if (element) {
    element.style.display = visible ? '' : 'none'
  }
}

function injectPlayerChromeStyles(art: Artplayer, miniWindowMode = false): void {
  if (art.template.$player.querySelector('[data-vfan-player-style]')) {
    return
  }

  const style = document.createElement('style')
  style.dataset.vfanPlayerStyle = 'true'
  // 主色（进度条 / 音量 / 选中项等）统一由 Artplayer 的 theme 选项驱动为纯白，
  // 这里只补充 theme 覆盖不到的部分，避免重复覆盖产生残留元素。
  style.textContent = `
    .art-video-player .art-settings .art-setting-panel .art-setting-item.art-current,
    .art-video-player .art-settings .art-setting-panel span.art-current {
      font-weight: 700;
    }
    .art-video-player .art-setting-panel .art-setting-item-left-icon svg {
      display: block;
      width: 22px;
      height: 22px;
    }
    .art-video-player:not(.art-control-show):not(.art-hover) .art-bottom .art-progress .art-progress-indicator {
      display: none !important;
    }
    .art-video-player.vfan-mini-window-player .art-top,
    .art-video-player.vfan-mini-window-player .art-bottom,
    .art-video-player.vfan-mini-window-player .art-center,
    .art-video-player.vfan-mini-window-player .art-state,
    .art-video-player.vfan-mini-window-player .art-notice {
      display: none !important;
    }
  `
  if (miniWindowMode) art.template.$player.classList.add('vfan-mini-window-player')
  art.template.$player.appendChild(style)
}

function buildDebugInfoText(params: DebugInfoParams): string {
  const {
    art,
    rawSrc,
    displayUrl,
    isHls,
    isFlv,
    isMpegts,
    isLive,
    title,
    sourceType,
    autoPlay,
    loop,
    initialTime,
    audioTrackUrl,
    debugLog,
    autoNextEnabled,
  } = params
  const hls = (art as ArtplayerWithHls).hls
  const video = art.video
  const sections: string[] = [
    '=== Vfan TV 调试信息 ===',
    `时间: ${new Date().toISOString()}`,
    `应用版本: ${cachedAppVersion || '-'}`,
    `页面: ${window.location.hash || window.location.pathname}`,
    ...(title ? [`标题: ${title}`] : []),
    '',
    '--- 环境 ---',
    `User-Agent: ${navigator.userAgent}`,
    `HLS 引擎: ${getHlsEngineText(isHls, hls, video)}`,
    `FLV 引擎: ${getFlvEngineText(isFlv)}`,
    `MPEG-TS 引擎: ${getMpegtsEngineText(isMpegts)}`,
    `Artplayer: ${Artplayer.version}`,
    `HLS.js: ${Hls.version}`,
    `mpegts.js: ${mpegts.version}`,
    '',
    '--- 播放配置 ---',
    `模式: ${isLive ? '直播' : '点播'}`,
    `源类型: ${sourceType || (isHls ? 'hls' : isFlv ? 'flv' : isMpegts ? 'mpegts' : 'native')}`,
    `原始地址: ${rawSrc}`,
    `最终播放地址: ${displayUrl}`,
    ...(rawSrc !== displayUrl ? ['地址转换: 是（可能与代理/格式化有关）'] : []),
    `自动播放: ${autoPlay ? '是' : '否'}`,
    `循环播放: ${loop ? '开启' : '关闭'}`,
    `自动续播: ${autoNextEnabled ? '开启' : '关闭'}`,
    `续播时间点: ${initialTime > 0 ? `${initialTime}s` : '无'}`,
    `外部音轨: ${audioTrackUrl ? audioTrackUrl : '无'}`,
    '',
    '--- 当前状态 ---',
    `播放状态: ${getPlaybackStateText(art)}`,
    `就绪状态: ${formatMediaReadyState(video.readyState)}`,
    `网络状态: ${formatMediaNetworkState(video.networkState)}`,
    `当前时间: ${formatDebugTime(art.currentTime)}`,
    ...(Number.isFinite(art.duration) && art.duration > 0 ? [`总时长: ${formatDebugTime(art.duration)}`] : []),
    `静音: ${art.muted || video.muted ? '是' : '否'}`,
    `倍速: ${art.playbackRate}x`,
    `当前源: ${video.currentSrc || art.url || '-'}`,
    '',
    '--- 缓冲 / 跳转 ---',
    `缓冲区间: ${formatTimeRanges(video.buffered)}`,
    `可跳转区间: ${formatTimeRanges(video.seekable)}`,
    '',
    ...(isHls ? ['--- HLS 详情 ---', ...formatHlsDebugLines(hls, isLive), ''] : []),
    '--- 媒体错误 ---',
    formatMediaElementError(video) || '无',
    '',
    '--- 事件日志 ---',
    debugLog.format(),
  ]

  return sections.join('\n')
}

function getHlsEngineText(isHls: boolean, hls: Hls | undefined, video: HTMLVideoElement): string {
  if (!isHls) {
    return '未使用'
  }

  if (hls) {
    return 'hls.js'
  }

  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    return 'Safari 原生'
  }

  return '不支持'
}

function getFlvEngineText(isFlv: boolean): string {
  if (!isFlv) {
    return '未使用'
  }

  return mpegts.isSupported() ? 'mpegts.js' : '不支持'
}

function getMpegtsEngineText(isMpegts: boolean): string {
  if (!isMpegts) {
    return '未使用'
  }

  return mpegts.isSupported() ? 'mpegts.js' : '不支持'
}

function getPlaybackStateText(art: Artplayer): string {
  const video = art.video
  const flags = [
    art.playing ? '播放中' : '未播放',
    video.paused ? '暂停' : '未暂停',
    video.ended ? '已结束' : null,
    video.seeking ? '跳转中' : null,
  ].filter(Boolean)

  return flags.join(' · ')
}

function formatMediaReadyState(state: number): string {
  const labels = ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA']
  return `${labels[state] ?? 'UNKNOWN'} (${state})`
}

function formatMediaNetworkState(state: number): string {
  const labels = ['NETWORK_EMPTY', 'NETWORK_IDLE', 'NETWORK_LOADING', 'NETWORK_NO_SOURCE']
  return `${labels[state] ?? 'UNKNOWN'} (${state})`
}

function formatMediaElementError(video: HTMLVideoElement): string | undefined {
  const error = video.error
  if (!error) {
    return undefined
  }

  const codes = ['', 'MEDIA_ERR_ABORTED', 'MEDIA_ERR_NETWORK', 'MEDIA_ERR_DECODE', 'MEDIA_ERR_SRC_NOT_SUPPORTED']
  const codeLabel = codes[error.code] ?? `CODE_${error.code}`
  const message = error.message?.trim()
  return message ? `${codeLabel} · ${message}` : codeLabel
}

function getMediaPlaybackFailureReason(video: HTMLVideoElement): string {
  const error = video.error
  if (!error) return '浏览器无法加载该媒体资源'

  const reasons = ['', '媒体加载被中断', '媒体资源请求失败', '媒体解码失败', '浏览器不支持该媒体格式']
  const reason = reasons[error.code] ?? '浏览器无法加载该媒体资源'
  return error.message?.trim() ? `${reason}：${error.message.trim()}` : reason
}

function formatUnknownErrorInfo(errorInfo: unknown): string {
  if (!errorInfo) {
    return '-'
  }

  if (errorInfo instanceof Error) {
    return errorInfo.message
  }

  if (typeof errorInfo === 'string') {
    return errorInfo
  }

  try {
    return JSON.stringify(errorInfo)
  } catch {
    return String(errorInfo)
  }
}

function formatTimeRanges(ranges: TimeRanges): string {
  if (!ranges.length) {
    return '无'
  }

  return Array.from({ length: ranges.length }, (_, index) => {
    const start = ranges.start(index)
    const end = ranges.end(index)
    return `${formatDebugTime(start)}-${formatDebugTime(end)}`
  }).join(', ')
}

function formatDebugTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '-'
  }

  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    const remain = Math.floor(seconds % 60)
    const fraction = Math.round((seconds % 1) * 10)
    return `${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}.${fraction}`
  }

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remain = Math.floor(seconds % 60)
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}`
}

function formatHlsErrorBrief(data: ErrorData): string {
  const parts = [
    data.fatal ? 'fatal' : 'non-fatal',
    data.type,
    data.details,
    data.url ? `url=${data.url}` : null,
    data.response?.code ? `http=${data.response.code}` : null,
    data.response?.text ? `body=${truncateDebugText(data.response.text, 120)}` : null,
    data.reason ? `reason=${data.reason}` : null,
    data.error?.message ? `error=${data.error.message}` : null,
  ].filter(Boolean)

  return parts.join(' · ')
}

function formatHlsPlaybackFailureReason(data: ErrorData): string {
  if (data.response?.code) {
    return `HLS 资源请求失败（HTTP ${data.response.code}）`
  }

  const labels: Partial<Record<ErrorData['details'], string>> = {
    manifestLoadError: 'HLS 播放列表加载失败',
    manifestParsingError: 'HLS 播放列表解析失败',
    levelLoadError: 'HLS 清晰度列表加载失败',
    fragLoadError: 'HLS 视频分片加载失败',
    fragParsingError: 'HLS 视频分片解析失败',
  }
  return labels[data.details] ?? `HLS 播放失败（${data.details}）`
}

function formatHlsDebugLines(hls: Hls | undefined, isLive: boolean): string[] {
  if (!hls) {
    return ['未初始化 hls.js 实例']
  }

  const levels = hls.levels
    .map((level, index) => {
      const label = level.name || (level.height ? `${level.height}p` : `level-${index}`)
      const bitrate = level.bitrate ? `${Math.round(level.bitrate / 1000)}kbps` : 'unknown'
      return `${index}:${label}@${bitrate}`
    })
    .join(', ')

  const lines = [
    `清单 URL: ${hls.url || '-'}`,
    `档位 (${hls.levels.length}): ${levels || '无'}`,
    `当前档位: ${formatHlsLevelLabel(hls)}`,
    `加载档位: ${hls.loadLevel}`,
    `下一档位: ${hls.nextLoadLevel}`,
    `自动档位: ${hls.autoLevelEnabled ? '是' : '否'}`,
    `音轨数: ${hls.audioTracks.length}`,
    `带宽估计: ${formatBandwidthEstimate(hls.bandwidthEstimate)}`,
  ]

  if (isLive) {
    lines.push(`直播延迟: ${Number.isFinite(hls.latency) ? `${hls.latency.toFixed(2)}s` : '-'}`)
    lines.push(
      `直播同步点: ${Number.isFinite(hls.liveSyncPosition) ? formatDebugTime(hls.liveSyncPosition ?? 0) : '-'}`,
    )
  }

  return lines
}

function formatHlsLevelLabel(hls: Hls): string {
  const currentLevel = hls.currentLevel
  if (currentLevel < 0) {
    return '自动 (-1)'
  }

  const level = hls.levels[currentLevel]
  if (!level) {
    return String(currentLevel)
  }

  const label = level.name || (level.height ? `${level.height}p` : `level-${currentLevel}`)
  return `${label} (${currentLevel})`
}

function truncateDebugText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength)}…`
}

function getHlsQualityLabel(level: { name?: string; height?: number } | undefined, video?: HTMLVideoElement): string {
  const levelName = level?.name?.trim()
  if (levelName) {
    return levelName
  }

  const levelHeight = level?.height ?? 0
  if (levelHeight > 0) {
    return `${levelHeight}P`
  }

  const videoHeight = video?.videoHeight ?? 0
  if (videoHeight > 0) {
    return `${videoHeight}P`
  }

  return '检测中'
}

function getQualityText(art: Artplayer, isHls: boolean): string {
  if (isHls) {
    const hls = (art as ArtplayerWithHls).hls
    if (!hls) {
      return '-'
    }

    if (hls.currentLevel < 0) {
      const videoHeight = art.video.videoHeight
      return videoHeight > 0 ? `自动 · ${videoHeight}P` : '自动'
    }

    const level = hls.levels[hls.currentLevel]
    return getHlsQualityLabel(level, art.video)
  }

  const height = art.video.videoHeight
  return height > 0 ? `${height}P` : '-'
}

function formatBandwidthEstimate(bitsPerSecond: number | undefined): string {
  if (!bitsPerSecond || !Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) {
    return '检测中'
  }

  if (bitsPerSecond >= 1_000_000) {
    return `${(bitsPerSecond / 1_000_000).toFixed(2)} Mbps`
  }

  return `${Math.round(bitsPerSecond / 1000)} Kbps`
}

function reloadPlayback(art: Artplayer): void {
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

function localizeInfoPanel(
  art: Artplayer,
  playbackUrl: string,
  resolvedUrlRef: MutableRefObject<string>,
  streamType: MediaStreamType,
  isLive: boolean,
  mpegtsRef: MutableRefObject<MpegtsPlayer | null>,
): void {
  const { $info, $infoClose, $infoPanel } = art.template
  injectStatsStyles(art)
  $info.classList.add('vfan-stats-overlay')
  $info.style.setProperty('background', 'transparent', 'important')
  $info.style.setProperty('background-color', 'transparent', 'important')
  $info.style.setProperty('border', '0', 'important')
  $info.style.setProperty('box-shadow', 'none', 'important')
  $info.style.setProperty('backdrop-filter', 'none', 'important')
  $info.style.setProperty('padding', '16px', 'important')
  $infoClose.textContent = '×'
  $infoPanel.className = 'vfan-stats-panel'
  $infoPanel.innerHTML = `
    <div class="vfan-stats-heading">统计信息</div>
    <div class="vfan-stats-grid">
      <div class="vfan-stats-heading">通用信息</div>
      <div class="vfan-stats-row"><span class="vfan-stats-label">播放器</span><span class="vfan-stats-value" data-vfan-info="player"></span></div>
      <div class="vfan-stats-row"><span class="vfan-stats-label">流类型</span><span class="vfan-stats-value" data-vfan-info="stream-type"></span></div>
      <div class="vfan-stats-row"><span class="vfan-stats-label">媒体信息</span><span class="vfan-stats-value" data-vfan-info="mime"></span></div>
      <div class="vfan-stats-row"><span class="vfan-stats-label">当前 / 最优</span><span class="vfan-stats-value" data-vfan-info="resolution"></span></div>
      <div class="vfan-stats-row"><span class="vfan-stats-label">视口 / 帧</span><span class="vfan-stats-value" data-vfan-info="viewport"></span></div>
      <div class="vfan-stats-row"><span class="vfan-stats-label">音量</span><span class="vfan-stats-value" data-vfan-info="volume"></span></div>
      <div class="vfan-stats-row"><span class="vfan-stats-label">播放进度</span><span class="vfan-stats-value" data-vfan-info="progress"></span></div>
      <div class="vfan-stats-row vfan-stats-row-meter"><span class="vfan-stats-label">缓冲健康</span><span class="vfan-stats-value"><span data-vfan-info="buffer-health"></span><span class="vfan-stats-meter" data-vfan-info="buffer-meter"><span></span></span></span></div>
      <div class="vfan-stats-row"><span class="vfan-stats-label">丢帧</span><span class="vfan-stats-value" data-vfan-info="dropped-frames"></span></div>
      <div class="vfan-stats-row vfan-stats-row-url"><span class="vfan-stats-label">视频地址</span><span class="vfan-stats-value vfan-stats-value-copyable" data-vfan-info="url" data-vfan-copy-label="视频地址" data-vfan-copy="${escapeHtmlAttribute(playbackUrl)}" title="点击复制：${escapeHtmlAttribute(playbackUrl)}"></span></div>
      <div class="vfan-stats-row vfan-stats-row-url"><span class="vfan-stats-label">最终播放地址</span><span class="vfan-stats-value vfan-stats-value-copyable" data-vfan-info="resolved-url" data-vfan-copy-label="最终播放地址" title="点击复制"></span></div>
      ${getProtocolStatsMarkup(streamType)}
    </div>
  `
  $infoPanel.appendChild($infoClose)

  bindCopyableUrlClicks($infoPanel, art)

  const refresh = (): void => {
    const isHls = streamType === 'hls'
    const hls = (art as ArtplayerWithHls).hls
    const mpegtsPlayer = mpegtsRef.current
    const bufferHealth = getBufferHealth(art)
    const downloadSpeed = isHls ? hls?.bandwidthEstimate : undefined

    setInfoText($infoPanel, 'stream-type', getStreamTypeText(streamType))
    setInfoText($infoPanel, 'player', getPlayerEngineText(streamType))
    setInfoText($infoPanel, 'mime', getMimeTypeText(art, streamType, hls, mpegtsPlayer))
    setInfoText($infoPanel, 'resolution', getResolutionStatsText(art, isHls, hls))
    setInfoText($infoPanel, 'viewport', getViewportStatsText(art))
    setInfoText($infoPanel, 'volume', `${Math.round(art.volume * 100)}%`)
    setInfoText($infoPanel, 'progress', getProgressStatsText(art, isLive))
    setInfoText($infoPanel, 'buffer-health', bufferHealth.text)
    setInfoMeter($infoPanel, 'buffer-meter', getBufferMeterPercent(bufferHealth.seconds, art.duration, isLive))
    setInfoText($infoPanel, 'dropped-frames', getDroppedFramesText(art.video))
    setInfoText($infoPanel, 'url', shortenText(playbackUrl, 56))
    setInfoTextWithTitle($infoPanel, 'resolved-url', resolvedUrlRef.current)
    if (isHls) {
      setInfoText($infoPanel, 'quality', getQualityText(art, true))
      setInfoText($infoPanel, 'download-speed', formatBandwidthEstimate(downloadSpeed))
      setInfoMeter($infoPanel, 'download-meter', getBitrateMeterPercent(downloadSpeed))
      setInfoText($infoPanel, 'track-count', `${hls?.levels.length ?? 0} 档 · ${hls?.audioTracks.length ?? 0} 音轨`)
    }
    if (streamType === 'flv' || streamType === 'mpegts') {
      const stats = getMpegtsStatistics(mpegtsPlayer)
      const mediaInfo = mpegtsPlayer?.mediaInfo
      setInfoText($infoPanel, 'download-speed', formatMpegtsSpeed(stats?.speed))
      setInfoMeter($infoPanel, 'download-meter', getMpegtsSpeedMeterPercent(stats?.speed))
      setInfoText($infoPanel, 'loader', typeof stats?.loaderType === 'string' ? stats.loaderType : '-')
      setInfoText($infoPanel, 'segments', formatMpegtsSegments(stats))
      setInfoText($infoPanel, 'codec', formatMpegtsMediaInfo(mediaInfo))
    }
    if (streamType === 'native') {
      setInfoText($infoPanel, 'buffered-ranges', formatTimeRanges(art.video.buffered))
    }
  }

  refresh()
  const timer = window.setInterval(refresh, 1000)
  art.on('destroy', () => window.clearInterval(timer))
}

function injectStatsStyles(art: Artplayer): void {
  if (art.template.$player.querySelector('[data-vfan-stats-style]')) {
    return
  }

  const style = document.createElement('style')
  style.dataset.vfanStatsStyle = 'true'
  style.textContent = `
    .art-video-player .vfan-stats-overlay {
      box-sizing: border-box !important;
      padding: 16px !important;
      background: transparent !important;
      border: 0 !important;
      box-shadow: none !important;
      backdrop-filter: none !important;
      pointer-events: none;
    }
    .vfan-stats-overlay .vfan-stats-panel {
      position: relative;
      width: min(480px, calc(100vw - 32px));
      max-height: calc(100vh - 48px);
      overflow: auto;
      background: rgba(24, 24, 27, 0.98);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(4px);
      pointer-events: auto;
    }
    .vfan-stats-panel {
      padding: 14px 16px 16px;
      color: rgba(255, 255, 255, 0.92);
      font-size: 14px;
      line-height: 1.5;
    }
    .vfan-stats-heading {
      margin: 0 0 12px;
      color: rgba(255, 255, 255, 0.96);
      font-size: 16px;
      font-weight: 600;
    }
    .vfan-stats-panel > .vfan-stats-heading {
      padding-bottom: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    .vfan-stats-grid {
      display: grid;
      gap: 8px;
    }
    .vfan-stats-grid .vfan-stats-heading {
      margin: 12px 0 1px;
      color: rgba(255, 255, 255, 0.72);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.08em;
    }
    .vfan-stats-grid .vfan-stats-heading:first-child {
      margin-top: 0;
    }
    .vfan-stats-grid .vfan-stats-section-heading {
      margin-top: 10px;
      padding-top: 14px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
    }
    .vfan-stats-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.45fr);
      gap: 12px;
      align-items: start;
    }
    .vfan-stats-row-url {
      align-items: start;
    }
    .vfan-stats-value-copyable {
      cursor: pointer;
      color: rgba(147, 197, 253, 0.95);
      text-decoration: underline;
      text-decoration-color: rgba(147, 197, 253, 0.35);
      text-underline-offset: 2px;
      transition: color 0.15s ease, text-decoration-color 0.15s ease;
    }
    .vfan-stats-value-copyable:hover {
      color: rgba(191, 219, 254, 1);
      text-decoration-color: rgba(191, 219, 254, 0.7);
    }
    .vfan-stats-label {
      color: rgba(255, 255, 255, 0.62);
      text-align: left;
      white-space: nowrap;
    }
    .vfan-stats-value {
      min-width: 0;
      word-break: break-all;
      text-align: right;
    }
    .vfan-stats-row-meter .vfan-stats-value {
      display: grid;
      gap: 4px;
    }
    .vfan-stats-meter {
      display: block;
      height: 5px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.12);
    }
    .vfan-stats-meter > span {
      display: block;
      height: 100%;
      border-radius: inherit;
      transition: width 0.35s ease, background 0.35s ease;
    }
    .vfan-stats-overlay .art-info-close {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 28px;
      height: 28px;
      font-size: 18px;
      line-height: 28px;
    }
    .vfan-copy-feedback {
      position: absolute;
      top: 16px;
      right: 16px;
      z-index: 100;
      padding: 9px 12px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      background: rgba(24, 24, 27, 0.95);
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.35);
      color: rgba(255, 255, 255, 0.95);
      font-size: 14px;
      opacity: 0;
      pointer-events: none;
      transform: translateY(-6px);
      transition: opacity 0.15s ease, transform 0.15s ease;
    }
    .vfan-copy-feedback.is-visible {
      opacity: 1;
      transform: translateY(0);
    }
    .art-video-player .art-contextmenus {
      padding: 4px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      background: rgba(24, 24, 27, 0.98) !important;
      box-shadow: 0 18px 36px rgba(0, 0, 0, 0.42);
      backdrop-filter: blur(4px);
      font-size: 14px;
    }
    .art-video-player .art-contextmenus .art-contextmenu {
      align-items: center;
      min-height: 40px;
      padding: 0 10px;
      border: 0;
      border-radius: 8px;
      color: rgba(255, 255, 255, 0.92);
      transition: background-color 0.15s ease;
    }
    .art-video-player .art-contextmenus .art-contextmenu:hover {
      background-color: rgba(255, 255, 255, 0.1);
    }
  `
  art.template.$player.appendChild(style)
}

function getProtocolStatsMarkup(streamType: MediaStreamType): string {
  if (streamType === 'hls') {
    return `
      <div class="vfan-stats-heading vfan-stats-section-heading">HLS 详情</div>
      <div class="vfan-stats-row"><span class="vfan-stats-label">清晰度</span><span class="vfan-stats-value" data-vfan-info="quality"></span></div>
      <div class="vfan-stats-row"><span class="vfan-stats-label">档位 / 音轨</span><span class="vfan-stats-value" data-vfan-info="track-count"></span></div>
      <div class="vfan-stats-row vfan-stats-row-meter"><span class="vfan-stats-label">带宽预估</span><span class="vfan-stats-value"><span data-vfan-info="download-speed"></span><span class="vfan-stats-meter" data-vfan-info="download-meter"><span></span></span></span></div>
    `
  }
  if (streamType === 'flv' || streamType === 'mpegts') {
    return `
      <div class="vfan-stats-heading vfan-stats-section-heading">${streamType === 'flv' ? 'FLV' : 'MPEG-TS'} 详情</div>
      <div class="vfan-stats-row vfan-stats-row-meter"><span class="vfan-stats-label">传输速度</span><span class="vfan-stats-value"><span data-vfan-info="download-speed"></span><span class="vfan-stats-meter" data-vfan-info="download-meter"><span></span></span></span></div>
      <div class="vfan-stats-row"><span class="vfan-stats-label">加载器</span><span class="vfan-stats-value" data-vfan-info="loader"></span></div>
      <div class="vfan-stats-row"><span class="vfan-stats-label">分段进度</span><span class="vfan-stats-value" data-vfan-info="segments"></span></div>
      <div class="vfan-stats-row"><span class="vfan-stats-label">音视频信息</span><span class="vfan-stats-value" data-vfan-info="codec"></span></div>
    `
  }
  return `
    <div class="vfan-stats-heading vfan-stats-section-heading">原生媒体详情</div>
    <div class="vfan-stats-row"><span class="vfan-stats-label">缓冲区间</span><span class="vfan-stats-value" data-vfan-info="buffered-ranges"></span></div>
  `
}

function getStreamTypeText(streamType: MediaStreamType): string {
  return { hls: 'HLS / M3U8', flv: 'FLV', mpegts: 'MPEG-TS', native: '原生直链' }[streamType]
}

function getPlayerEngineText(streamType: MediaStreamType): string {
  const engine =
    streamType === 'hls' ? 'HLS.js' : streamType === 'flv' || streamType === 'mpegts' ? 'mpegts.js' : '浏览器原生'
  return `Artplayer ${Artplayer.version} · ${engine}`
}

function getMimeTypeText(
  art: Artplayer,
  streamType: MediaStreamType,
  hls?: Hls,
  mpegtsPlayer?: MpegtsPlayer | null,
): string {
  if (streamType === 'hls' && hls?.levels?.length) {
    const level = hls.levels[Math.max(0, hls.currentLevel)] ?? hls.levels[0]
    const codec = level.codecSet || level.videoCodec || level.attrs?.CODECS
    if (codec) {
      return `application/x-mpegURL · ${codec}`
    }
    return 'application/x-mpegURL'
  }

  if (streamType === 'flv' || streamType === 'mpegts') {
    return formatMpegtsMediaInfo(mpegtsPlayer?.mediaInfo)
  }

  const mimeType = art.video.currentSrc ? guessMimeType(art.video.currentSrc) : '-'
  return mimeType
}

function formatMpegtsSpeed(speed: unknown): string {
  return typeof speed === 'number' && Number.isFinite(speed) && speed > 0 ? `${speed.toFixed(1)} KB/s` : '检测中'
}

function getMpegtsSpeedMeterPercent(speed: unknown): number {
  return typeof speed === 'number' && Number.isFinite(speed) ? Math.min(100, Math.round((speed / 1_250) * 100)) : 0
}

function getMpegtsStatistics(
  player: MpegtsPlayer | null,
): { speed?: unknown; loaderType?: unknown; currentSegmentIndex?: unknown; totalSegmentCount?: unknown } | undefined {
  if (!player?.statisticsInfo || player.statisticsInfo.playerType !== 'MSEPlayer') return undefined
  return player.statisticsInfo
}

function formatMpegtsSegments(
  stats: { currentSegmentIndex?: unknown; totalSegmentCount?: unknown } | undefined,
): string {
  const current = stats?.currentSegmentIndex
  const total = stats?.totalSegmentCount
  return typeof current === 'number' && typeof total === 'number' && total > 0 ? `${current + 1} / ${total}` : '直播流'
}

function formatMpegtsMediaInfo(
  mediaInfo:
    | {
        mimeType?: unknown
        videoCodec?: unknown
        audioCodec?: unknown
        videoDataRate?: unknown
        audioDataRate?: unknown
      }
    | undefined,
): string {
  if (!mediaInfo) return '-'
  const codecs = [mediaInfo.videoCodec, mediaInfo.audioCodec].filter(
    (value): value is string => typeof value === 'string',
  )
  const rates = [
    typeof mediaInfo.videoDataRate === 'number' ? `视频 ${formatBitsPerSecond(mediaInfo.videoDataRate)}` : undefined,
    typeof mediaInfo.audioDataRate === 'number' ? `音频 ${formatBitsPerSecond(mediaInfo.audioDataRate)}` : undefined,
  ].filter(Boolean)
  return [mediaInfo.mimeType, codecs.join(' / '), rates.join(' · ')].filter(Boolean).join(' · ') || '-'
}

function formatBitsPerSecond(bitsPerSecond: number): string {
  return bitsPerSecond >= 1_000_000
    ? `${(bitsPerSecond / 1_000_000).toFixed(2)} Mbps`
    : `${Math.round(bitsPerSecond / 1_000)} Kbps`
}

function getResolutionStatsText(art: Artplayer, isHls: boolean, hls?: Hls): string {
  const currentWidth = art.video.videoWidth
  const currentHeight = art.video.videoHeight
  const optimalHeight = isHls ? getOptimalHlsHeight(hls) : currentHeight
  const fps = getVideoFrameRate(art)

  if (currentWidth <= 0 || currentHeight <= 0) {
    return optimalHeight > 0 ? `- / ${optimalHeight}P` : '-'
  }

  const fpsLabel = fps ? `@${fps.toFixed(3)}` : ''
  const currentLabel = `${currentWidth} x ${currentHeight}${fpsLabel}`
  const optimalLabel = optimalHeight > 0 ? `${optimalHeight}P` : `${currentWidth} x ${currentHeight}${fpsLabel}`
  return `${currentLabel} / ${optimalLabel}`
}

function getViewportStatsText(art: Artplayer): string {
  const player = art.template.$player
  const dpr = window.devicePixelRatio || 1
  const quality = getVideoPlaybackQuality(art.video)
  const dropped = quality?.droppedVideoFrames ?? 0
  const total = quality?.totalVideoFrames ?? 0
  return `${player.clientWidth} x ${player.clientHeight}*${dpr.toFixed(2)} / ${dropped} dropped of ${total}`
}

function getProgressStatsText(art: Artplayer, isLive: boolean): string {
  const current = formatInfoTime(art.currentTime)
  if (isLive || !Number.isFinite(art.duration) || art.duration <= 0) {
    return `${current} / LIVE`
  }

  return `${current} / ${formatInfoTime(art.duration)}`
}

function getBufferHealth(art: Artplayer): { seconds: number; text: string } {
  const video = art.video
  if (!video.buffered.length) {
    return { seconds: 0, text: '0.00 s' }
  }

  const ahead = Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime)
  return { seconds: ahead, text: `${ahead.toFixed(2)} s` }
}

function getBitrateMeterPercent(bitsPerSecond: number | undefined): number {
  if (!bitsPerSecond || !Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) {
    return 0
  }

  return Math.min(100, Math.round((bitsPerSecond / 10_000_000) * 100))
}

function getBufferMeterPercent(bufferSeconds: number, duration: number, isLive: boolean): number {
  const maxSeconds = isLive || !Number.isFinite(duration) || duration <= 0 ? 30 : Math.min(duration, 120)
  return Math.min(100, Math.round((bufferSeconds / maxSeconds) * 100))
}

function getOptimalHlsHeight(hls?: Hls): number {
  if (!hls?.levels?.length) {
    return 0
  }

  return hls.levels.reduce((max, level) => Math.max(max, level.height || 0), 0)
}

function getVideoFrameRate(art: Artplayer): number | undefined {
  const quality = getVideoPlaybackQuality(art.video)
  if (quality && 'totalVideoFrames' in quality && art.currentTime > 0 && quality.totalVideoFrames) {
    return quality.totalVideoFrames / art.currentTime
  }

  return undefined
}

function getDroppedFramesText(video: HTMLVideoElement): string {
  const quality = getVideoPlaybackQuality(video)
  if (!quality) {
    return '-'
  }

  return `${quality.droppedVideoFrames ?? 0} / ${quality.totalVideoFrames ?? 0}`
}

function getVideoPlaybackQuality(video: HTMLVideoElement): VideoPlaybackQualityInfo | undefined {
  const getter = (video as HTMLVideoElement & { getVideoPlaybackQuality?: () => VideoPlaybackQualityInfo })
    .getVideoPlaybackQuality
  return getter?.call(video)
}

function guessMimeType(url: string): string {
  const normalized = url.toLowerCase()
  if (normalized.includes('.m3u8')) return 'application/x-mpegURL'
  if (normalized.includes('.mp4')) return 'video/mp4'
  if (normalized.includes('.webm')) return 'video/webm'
  if (normalized.includes('.mkv')) return 'video/x-matroska'
  return '-'
}

function shortenText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  const head = Math.max(18, Math.floor(maxLength * 0.45))
  const tail = Math.max(12, maxLength - head - 1)
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}

function setInfoText(panel: HTMLElement, name: string, value: string): void {
  const element = panel.querySelector(`[data-vfan-info="${name}"]`)
  if (element && element.textContent !== value) {
    element.textContent = value
  }
}

function setInfoTextWithTitle(panel: HTMLElement, name: string, value: string): void {
  const element = panel.querySelector(`[data-vfan-info="${name}"]`)
  if (!(element instanceof HTMLElement)) {
    return
  }
  const shortValue = shortenText(value, 56)
  if (element.textContent !== shortValue) {
    element.textContent = shortValue
  }
  if (element.dataset.vfanCopy !== value) {
    element.dataset.vfanCopy = value
  }
  const nextTitle = `点击复制：${value}`
  if (element.title !== nextTitle) {
    element.title = nextTitle
  }
}

function bindCopyableUrlClicks(panel: HTMLElement, art: Artplayer): void {
  for (const element of panel.querySelectorAll<HTMLElement>('.vfan-stats-value-copyable')) {
    element.addEventListener('click', () => {
      const value = element.dataset.vfanCopy?.trim()
      const label = element.dataset.vfanCopyLabel || '链接'
      if (!value || value === '检测中…') {
        return
      }
      void navigator.clipboard.writeText(value).then(
        () => {
          showCopyFeedback(art, `${label}已复制`)
        },
        () => {
          showCopyFeedback(art, '复制失败')
        },
      )
    })
  }
}

function showCopyFeedback(art: Artplayer, message: string): void {
  const player = art.template.$player
  let feedback = player.querySelector<HTMLElement>('[data-vfan-copy-feedback]')
  if (!feedback) {
    feedback = document.createElement('div')
    feedback.className = 'vfan-copy-feedback'
    feedback.dataset.vfanCopyFeedback = 'true'
    player.appendChild(feedback)
  }

  const previousTimer = Number(feedback.dataset.vfanCopyFeedbackTimer)
  if (previousTimer) window.clearTimeout(previousTimer)
  feedback.textContent = message
  feedback.classList.remove('is-visible')
  window.requestAnimationFrame(() => feedback?.classList.add('is-visible'))
  feedback.dataset.vfanCopyFeedbackTimer = String(
    window.setTimeout(() => feedback?.classList.remove('is-visible'), 1800),
  )
}

/**
 * 探测播放地址在跳转（HTTP 重定向）后实际解析到的最终地址，用于统计信息面板展示排查。
 * 本地代理地址会走 `/resolve`（只跟跳转、不拉流）。
 * 注意：仅用于非直播源。FLV/TS 直播源由调用方直接跳过，不要在此对同一 URL 发起二次请求，
 * 否则会被 CDN 的单连接 session 鉴权判定为重连，导致正在播放的连接被踢断。
 */
async function resolvePlaybackAddress(url: string, signal: AbortSignal): Promise<string> {
  try {
    const resolveUrl = createResolveProbeUrl(url)
    const response = await fetch(resolveUrl, {
      method: 'GET',
      redirect: 'follow',
      signal,
    })

    if (resolveUrl !== url) {
      const payload = (await response.json()) as { url?: unknown }
      return typeof payload.url === 'string' && payload.url ? payload.url : extractProxiedTargetUrl(url) || url
    }

    void response.body?.cancel().catch(() => {})
    return response.url || url
  } catch {
    return extractProxiedTargetUrl(url) || url
  }
}

function createResolveProbeUrl(playbackUrl: string): string {
  try {
    const parsed = new URL(playbackUrl)
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      return playbackUrl
    }
    if (parsed.pathname !== '/media') {
      return playbackUrl
    }

    const targetUrl = parsed.searchParams.get('url')
    if (!targetUrl) {
      return playbackUrl
    }

    const resolveUrl = new URL('/resolve', parsed.origin)
    resolveUrl.searchParams.set('url', targetUrl)
    const referer = parsed.searchParams.get('referer')
    const userAgent = parsed.searchParams.get('user-agent')
    if (referer) {
      resolveUrl.searchParams.set('referer', referer)
    }
    if (userAgent) {
      resolveUrl.searchParams.set('user-agent', userAgent)
    }
    return resolveUrl.toString()
  } catch {
    return playbackUrl
  }
}

function extractProxiedTargetUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      return undefined
    }
    const target = parsed.searchParams.get('url')
    return target || undefined
  } catch {
    return undefined
  }
}

function getHealthMeterBackground(percent: number): string {
  const clamped = Math.max(0, Math.min(100, percent))
  const hue = (clamped / 100) * 120

  return `linear-gradient(90deg, hsl(${hue} 68% 42%), hsl(${hue} 78% 54%))`
}

function setInfoMeter(panel: HTMLElement, name: string, percent: number): void {
  const element = panel.querySelector(`[data-vfan-info="${name}"] > span`)
  if (element instanceof HTMLElement) {
    const nextWidth = `${percent}%`
    const nextBackground = getHealthMeterBackground(percent)

    if (element.style.width !== nextWidth) {
      element.style.width = nextWidth
    }

    if (element.style.background !== nextBackground) {
      element.style.background = nextBackground
    }
  }
}

function formatInfoTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '00:00'
  }

  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`
}

function readLoopEnabled(): boolean {
  return window.localStorage.getItem(PLAYER_LOOP_STORAGE_KEY) === 'true'
}

function readAutoNextEnabled(): boolean {
  const stored = window.localStorage.getItem(PLAYER_AUTO_NEXT_STORAGE_KEY)
  if (stored === null) {
    return true
  }

  return stored !== 'false'
}

const PLAYBACK_RATE_OPTIONS = [0.5, 1, 1.25, 1.5, 2] as const
const SEEK_STEP_OPTIONS = [3, 5, 10] as const

function createPlaybackRateSliderInput(
  art: Artplayer,
  current: number,
  setRate: (rate: number) => void,
): CustomSliderInput {
  return {
    title: '播放速度',
    initialValue: current,
    min: 0.25,
    max: 3,
    step: 0.05,
    suffix: '倍',
    presets: PLAYBACK_RATE_OPTIONS,
    normalPreset: 1,
    formatValue: (rate) => `${rate.toFixed(2)}倍`,
    onChange: (rate) => {
      setRate(rate)
      art.playbackRate = rate
      art.notice.show = `播放速度 ${rate}倍`
    },
  }
}

function createSeekStepSliderInput(
  art: Artplayer,
  current: number,
  setStep: (step: number) => void,
): CustomSliderInput {
  return {
    title: '跳转步长',
    initialValue: current,
    min: 1,
    max: 30,
    step: 0.5,
    suffix: '秒',
    presets: SEEK_STEP_OPTIONS,
    normalPreset: 5,
    formatValue: (step) => `${formatSliderNumber(step)} 秒`,
    onChange: (step) => {
      setStep(step)
      art.notice.show = `跳转步长 ${step} 秒`
    },
  }
}

function nextFromList<T extends string>(current: T, values: readonly T[]): T {
  return values[(values.indexOf(current) + 1) % values.length] ?? values[0]
}

function readPlaybackRate(): number {
  return readStoredNumber(PLAYER_PLAYBACK_RATE_STORAGE_KEY, 1, 0.25, 3)
}

function readSeekStep(): number {
  return readStoredNumber(PLAYER_SEEK_STEP_STORAGE_KEY, 5, 1, 30)
}

function formatSliderNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function readStoredNumber(key: string, fallback: number, min: number, max: number): number {
  const value = Number(window.localStorage.getItem(key))
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback
}

function isTextInputTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
  )
}

function normalizePlaybackUrlForDisplay(src: string): string {
  try {
    const parsedUrl = new URL(src)
    const proxyTargetUrl = parsedUrl.searchParams.get('url')
    return proxyTargetUrl ? decodeURIComponent(proxyTargetUrl) : decodeURIComponent(src)
  } catch {
    return src
  }
}

function createHlsConfig(isLive: boolean): ConstructorParameters<typeof Hls>[0] {
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

function destroyHls(hlsRef: MutableRefObject<Hls | null>): void {
  hlsRef.current?.destroy()
  hlsRef.current = null
}

function destroyMpegts(mpegtsRef: MutableRefObject<MpegtsPlayer | null>): void {
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
