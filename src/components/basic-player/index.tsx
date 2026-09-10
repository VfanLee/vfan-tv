import { useVideoMiniWindow, createMiniWindowControl } from './utils/mini-window'
import { createPlayerContextMenu } from './utils/context-menu'
import { isDesktopRuntime } from '@/platform/tauri'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Artplayer, { type Option } from 'artplayer'
import artplayerPluginAudioTrack from 'artplayer-plugin-audio-track'
import Hls from 'hls.js'
import { useUiPreferencesStore } from '@/stores'
import {
  getAssociatedAudioUrl,
  getMediaPlaybackSessionInfo,
  isApiAvailable,
  reportMediaPlaybackEvent,
} from '@/platform/api'
import { artplayerSwitchIcons, cn, createMediaPlaybackCoordinator, type MediaPlaybackCoordinator } from '@/utils'
import { CustomSliderDialog, DisplaySettingsMenu, MediaTrackDialog } from './components/display-settings-dialogs'
import { createSafeAmbilightPlugin } from './utils/safe-ambilight-plugin'
import { createSettingsPositionTracker } from './utils/settings-position'
import type {
  BasicPlayerProps,
  CustomSliderInput,
  DisplaySettingsState,
  MediaTrackSelection,
  MiniWindowPlayerController,
  PlayerRuntimeInfo,
} from './types'
import {
  type ArtplayerWithHls,
  type MpegtsPlayer,
  isHlsSource,
  isLocalPlaybackUrl,
  isFlvSource,
  isMpegtsSource,
  getStreamType,
  getArtplayerType,
  createMpegtsPlayback,
  createHlsPlayback,
  destroyHls,
  destroyMpegts,
} from './utils/playback-engine'
import {
  PlaybackDebugRecorder,
  loadDebugAppVersion,
  formatMediaElementError,
  getMediaPlaybackFailureReason,
} from './utils/playback-debug'
import { localizeInfoPanel, getVideoFrameRate } from './utils/playback-stats'
import {
  removeDefaultContextMenuItems,
  removeLiveSettingItems,
  getVideoTrackMenuLabel,
  getAudioTrackMenuLabel,
  createVideoTrackSelection,
  createAudioTrackSelection,
  setContextMenuItemVisible,
  injectPlayerChromeStyles,
  readLoopEnabled,
  readAutoNextEnabled,
  createPlaybackRateSliderInput,
  createSeekStepSliderInput,
  nextFromList,
  readPlaybackRate,
  readSeekStep,
  isTextInputTarget,
  normalizePlaybackUrlForDisplay,
} from './utils/player-settings'

// 播放器适配层：统一 ArtPlayer、HLS.js 与 mpegts.js 的生命周期及持久化播放设置。
export type {
  BasicPlayerProps,
  MiniWindowPlayerController,
  MiniWindowPlayerState,
  PlayerNavigationLabels,
  PlayerRuntimeInfo,
  PlayerVariant,
} from './types'

interface BasicPlayerCallbacks {
  onEnded?: () => void
  onProgress?: (progress: { currentTime: number; duration: number; force?: boolean }) => void
  onPlaybackReady?: () => void
  onPlaybackError?: (reason: string) => void
  onRuntimeInfoChange?: (info: PlayerRuntimeInfo) => void
  onSettingsVisibilityChange?: (visible: boolean) => void
}

/** 组装视频播放器、播放资源生命周期与设置浮层 */
export function BasicPlayer({
  autoPlay = false,
  audioTrackUrl: inputAudioTrackUrl,
  className,
  enableAutoNext = true,
  hidePlaybackSettings = false,
  initialTime = 0,
  isResolvingSource = false,
  isTheaterMode = false,
  loop,
  mediaSessionId,
  miniWindowMode = false,
  playerOverlay,
  playerOverlayPinned = false,
  showMediaTrackSettings = false,
  onMiniWindowControllerReady,
  onMiniWindowPlayerStateChange,
  persistPlaybackSettings = true,
  formatPlaybackUrl = normalizePlaybackUrlForDisplay,
  onEnded,
  onProgress,
  onPlaybackReady,
  onPlaybackError,
  onRuntimeInfoChange,
  onSettingsVisibilityChange,
  sourceType,
  src: inputSrc,
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
  const originalUrlRef = useRef('检测中…')
  const restoreFullscreenWebRef = useRef(false)
  const miniWindowControllerReadyRef = useRef(onMiniWindowControllerReady)
  const miniWindowPlayerStateChangeRef = useRef(onMiniWindowPlayerStateChange)
  const playbackCoordinatorRef = useRef<MediaPlaybackCoordinator | null>(null)
  const [customNumberInput, setCustomNumberInput] = useState<CustomSliderInput | undefined>(undefined)
  const [mediaTrackSelection, setMediaTrackSelection] = useState<MediaTrackSelection | undefined>(undefined)
  const [displaySettings, setDisplaySettings] = useState<DisplaySettingsState | undefined>(undefined)
  const [isDisplaySettingsClosing, setIsDisplaySettingsClosing] = useState(false)
  const [settingsPortalContainer, setSettingsPortalContainer] = useState<HTMLElement | undefined>(undefined)
  const [settingsBottomOffset, setSettingsBottomOffset] = useState(64)
  const src = inputSrc && sourceType ? inputSrc : undefined
  const [resolvedAudioTrack, setResolvedAudioTrack] = useState<{ input: string; sessionId: string; url?: string }>()
  const audioTrackUrl = isLocalPlaybackUrl(inputAudioTrackUrl)
    ? inputAudioTrackUrl
    : resolvedAudioTrack &&
        resolvedAudioTrack.input === inputAudioTrackUrl &&
        resolvedAudioTrack.sessionId === mediaSessionId
      ? resolvedAudioTrack.url
      : undefined

  /** 解析外挂音轨的代理播放地址 */
  useEffect(() => {
    let active = true
    if (!inputAudioTrackUrl || isLocalPlaybackUrl(inputAudioTrackUrl) || !mediaSessionId) {
      return () => {
        active = false
      }
    }
    void getAssociatedAudioUrl(mediaSessionId, inputAudioTrackUrl)
      .then((url) => {
        if (active) setResolvedAudioTrack({ input: inputAudioTrackUrl, sessionId: mediaSessionId, url })
      })
      .catch(() => {
        if (active) setResolvedAudioTrack({ input: inputAudioTrackUrl, sessionId: mediaSessionId, url: undefined })
      })
    return () => {
      active = false
    }
  }, [inputAudioTrackUrl, mediaSessionId])

  const isLive = variant === 'live'
  const isHls = isHlsSource(src, sourceType)
  const isFlv = isFlvSource(src, sourceType)
  const isMpegts = isMpegtsSource(src, sourceType)
  const canEnterMiniWindowMode =
    !miniWindowMode && Boolean(sourceType && mediaSessionId) && (isDesktopRuntime() || isApiAvailable())

  const miniWindowSessionIdRef = useVideoMiniWindow(artRef, callbacksRef, isLive, miniWindowMode)

  /** 创建视频播放协调器，并在组件卸载时释放 */
  useEffect(() => {
    const coordinator = createMediaPlaybackCoordinator('video', () => {
      artRef.current?.pause()
    })
    playbackCoordinatorRef.current = coordinator

    return () => {
      coordinator.dispose()
      if (playbackCoordinatorRef.current === coordinator) {
        playbackCoordinatorRef.current = null
      }
    }
  }, [])

  /** 播放源变化时在当前组件渲染中关闭旧源的设置面板 */
  const [settingsSource, setSettingsSource] = useState({ src, sourceType })
  if (settingsSource.src !== src || settingsSource.sourceType !== sourceType) {
    setSettingsSource({ src, sourceType })
    setCustomNumberInput(undefined)
    setMediaTrackSelection(undefined)
    setDisplaySettings(undefined)
    setIsDisplaySettingsClosing(false)
    setSettingsPortalContainer(undefined)
    setSettingsBottomOffset(64)
  }

  /** 同步播放器回调、初始时间和迷你窗口控制引用 */
  useEffect(() => {
    callbacksRef.current = {
      onEnded,
      onProgress,
      onPlaybackReady,
      onPlaybackError,
      onRuntimeInfoChange,
      onSettingsVisibilityChange,
    }
    formatPlaybackUrlRef.current = formatPlaybackUrl
    initialTimeRef.current = initialTime
    miniWindowControllerReadyRef.current = onMiniWindowControllerReady
    miniWindowPlayerStateChangeRef.current = onMiniWindowPlayerStateChange
  }, [
    formatPlaybackUrl,
    initialTime,
    onEnded,
    onMiniWindowControllerReady,
    onMiniWindowPlayerStateChange,
    onPlaybackError,
    onPlaybackReady,
    onProgress,
    onRuntimeInfoChange,
    onSettingsVisibilityChange,
  ])

  /** 同步播放器设置浮层的固定状态和可见性 */
  useEffect(() => {
    const visible = Boolean(displaySettings || customNumberInput || mediaTrackSelection)
    artRef.current?.template.$player.classList.toggle('vfan-player-overlay-pinned', visible)
    callbacksRef.current.onSettingsVisibilityChange?.(visible)
  }, [customNumberInput, displaySettings, mediaTrackSelection])

  /** 根据播放地址和配置创建或销毁播放器实例 */
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
    originalUrlRef.current = displayPlaybackUrl
    const debugLog = new PlaybackDebugRecorder()
    resolvedUrlRef.current = '检测中…'
    if (mediaSessionId) {
      void getMediaPlaybackSessionInfo(mediaSessionId)
        .then((info) => {
          originalUrlRef.current = info.originalUrl
          resolvedUrlRef.current = info.finalUrl ?? '等待首次媒体请求…'
        })
        .catch(() => {
          resolvedUrlRef.current = '媒体会话已失效'
        })
    } else {
      resolvedUrlRef.current = displayPlaybackUrl
    }

    loadDebugAppVersion()

    let audioMenuItem: HTMLElement | undefined
    let loopEnabled = loop ?? (persistPlaybackSettings ? readLoopEnabled() : false)
    let autoNextEnabled = enableAutoNext && (persistPlaybackSettings ? readAutoNextEnabled() : true)
    let playbackRate = persistPlaybackSettings ? readPlaybackRate() : 1
    let seekStep = persistPlaybackSettings ? readSeekStep() : 5
    let hasReportedPlaybackFailure = false
    let hasReportedPlaybackReady = false
    const playbackStartedAt = performance.now()
    let runtimeInfo: PlayerRuntimeInfo = {}
    let hasReportedFirstFrame = false

    /** 合并并上报当前媒体的运行参数 */
    const reportRuntimeInfo = (patch: Partial<PlayerRuntimeInfo>): void => {
      runtimeInfo = { ...runtimeInfo, ...patch }
      callbacksRef.current.onRuntimeInfoChange?.(runtimeInfo)
    }

    /** 记录首次出画耗时并更新媒体最终地址 */
    const reportFirstFrame = (): void => {
      if (hasReportedFirstFrame) return
      hasReportedFirstFrame = true
      const elapsedMs = Math.max(1, Math.round(performance.now() - playbackStartedAt))
      reportRuntimeInfo({ firstFrameMs: elapsedMs })
      if (mediaSessionId) {
        void reportMediaPlaybackEvent({ mediaSessionId, type: 'first-frame', elapsedMs })
        void getMediaPlaybackSessionInfo(mediaSessionId).then((info) => {
          resolvedUrlRef.current = info.finalUrl ?? resolvedUrlRef.current
        })
      }
    }

    callbacksRef.current.onRuntimeInfoChange?.({})

    /** 展示并上报首次不可恢复的播放错误 */
    const reportPlaybackFailure = (artInstance: Artplayer, reason: string): void => {
      if (hasReportedPlaybackFailure) return
      hasReportedPlaybackFailure = true
      debugLog.push('FAIL', reason)
      artInstance.notice.show = `无法播放：${reason}`
      if (mediaSessionId) void reportMediaPlaybackEvent({ mediaSessionId, type: 'player-error', message: reason })
      callbacksRef.current.onPlaybackError?.(reason)
    }

    /** 通知页面当前媒体已可播放 */
    const reportPlaybackReady = (): void => {
      if (hasReportedPlaybackReady) return
      hasReportedPlaybackReady = true
      callbacksRef.current.onPlaybackReady?.()
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
        ? createMiniWindowControl(
            () => art,
            miniWindowSessionIdRef,
            () => ({
              src,
              sourceType: sourceType!,
              mediaSessionId: mediaSessionId!,
              title,
              variant,
              initialTime: isLive ? 0 : art.currentTime,
              loop: loopEnabled,
              audioTrackUrl,
            }),
          )
        : [],
      plugins: [
        // 背光插件（跨域源采样失败时会自动停用，避免打断播放）
        ...(!miniWindowMode
          ? [
              createSafeAmbilightPlugin({
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
      ],
      contextmenu: miniWindowMode
        ? []
        : createPlayerContextMenu(
            () => ({
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
            displayPlaybackUrl,
            (element) => {
              audioMenuItem = element
            },
          ),
      customType: {
        // 自定义媒体类型处理器
        /** 为 HLS 媒体创建播放引擎 */
        m3u8(video, url, artInstance) {
          createHlsPlayback(
            video,
            url,
            artInstance,
            isLive,
            hlsRef,
            mpegtsRef,
            debugLog,
            reportPlaybackFailure,
            reportRuntimeInfo,
            (available) => {
              if (available) setContextMenuItemVisible(audioMenuItem, true)
            },
          )
        },
        /** 为 FLV 媒体创建播放引擎 */
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
            (info) => reportRuntimeInfo(info),
          )
        },
        /** 为 MPEG-TS 媒体创建播放引擎 */
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
            (info) => reportRuntimeInfo(info),
          )
        },
      },
    } satisfies Option)

    artRef.current = art
    art.on('video:play', () => playbackCoordinatorRef.current?.announcePlaying())
    art.on('video:playing', reportFirstFrame)
    art.on('video:canplay', reportPlaybackReady)
    art.on('video:loadedmetadata', () => {
      reportRuntimeInfo({
        width: art.video.videoWidth || undefined,
        height: art.video.videoHeight || undefined,
        fps: getVideoFrameRate(art),
      })
    })
    /** 同步小窗的播放与静音状态 */
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
    localizeInfoPanel(art, originalUrlRef, resolvedUrlRef, getStreamType(isHls, isFlv, isMpegts), isLive, mpegtsRef)
    /** 根据当前播放状态构建设置浮层 */
    const openDisplaySettings = (): void => {
      settingsPosition.refreshAfterControlTransition()
      /** 刷新当前播放器展示状态 */
      const refresh = (): void => openDisplaySettings()
      const hls = (art as ArtplayerWithHls).hls
      /** 打开视频轨道选择列表 */
      const openVideoTracks = (): void => setMediaTrackSelection(createVideoTrackSelection(art, isHls, openVideoTracks))
      /** 打开音频轨道选择列表 */
      const openAudioTracks = (): void => setMediaTrackSelection(createAudioTrackSelection(art, isHls, openAudioTracks))
      const videoTrack =
        showMediaTrackSettings && hls && hls.levels.length > 1
          ? { label: getVideoTrackMenuLabel(art, hls), onClick: openVideoTracks }
          : undefined
      const audioTrack = showMediaTrackSettings
        ? hls && hls.audioTracks.length > 1
          ? { label: getAudioTrackMenuLabel(hls), onClick: openAudioTracks }
          : undefined
        : hls && hls.audioTracks.length > 1
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
        videoTrack,
        audioTrack,
        playbackRate,
        seekStep,
        loop: loopEnabled,
        autoNext: autoNextEnabled,
        showPlaybackSettings: !isLive && !hidePlaybackSettings,
        showAutoNext: !isLive && !hidePlaybackSettings && enableAutoNext,
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
                useUiPreferencesStore.getState().setPlayerPreference('playbackRate', nextRate)
            }),
          )
        },
        onSeekStep: () => {
          setCustomNumberInput(
            createSeekStepSliderInput(art, seekStep, (nextStep) => {
              seekStep = nextStep
              if (persistPlaybackSettings) useUiPreferencesStore.getState().setPlayerPreference('seekStep', nextStep)
            }),
          )
        },
        onLoop: () => {
          loopEnabled = !loopEnabled
          art.video.loop = loopEnabled
          if (persistPlaybackSettings) useUiPreferencesStore.getState().setPlayerPreference('loop', loopEnabled)
          refresh()
        },
        onAutoNext: () => {
          autoNextEnabled = !autoNextEnabled
          if (persistPlaybackSettings) useUiPreferencesStore.getState().setPlayerPreference('autoNext', autoNextEnabled)
          refresh()
        },
      })
    }
    art.on('setting', (visible) => {
      if (miniWindowMode) return
      if (!visible) return
      art.setting.show = false
      callbacksRef.current.onSettingsVisibilityChange?.(true)
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

    /** 将键盘焦点移到当前播放器 */
    const focusPlayer = (): void => art.template.$player.focus()
    /** 在播放器聚焦时处理方向键跳转 */
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
    /** 阻止小窗显示浏览器右键菜单 */
    const preventMiniWindowContextMenu = (event: Event): void => event.preventDefault()
    art.template.$player.addEventListener('pointerdown', focusPlayer)
    if (miniWindowMode) art.template.$player.addEventListener('contextmenu', preventMiniWindowContextMenu)
    document.addEventListener('keydown', handleSeekShortcut, true)

    let startTimeApplied = false

    /** 媒体时长就绪后恢复指定播放进度 */
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
    hidePlaybackSettings,
    isHls,
    isFlv,
    isMpegts,
    isLive,
    loop,
    mediaSessionId,
    miniWindowMode,
    canEnterMiniWindowMode,
    miniWindowSessionIdRef,
    persistPlaybackSettings,
    showMediaTrackSettings,
    sourceType,
    src,
    title,
    variant,
  ])

  const displaySettingsOverlay = mediaTrackSelection ? (
    <MediaTrackDialog
      input={mediaTrackSelection}
      closing={isDisplaySettingsClosing}
      bottomOffset={settingsBottomOffset}
      onBack={() => setMediaTrackSelection(undefined)}
    />
  ) : customNumberInput ? (
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
        const isPlayerOverlayInteraction = Boolean(event.target.closest('[data-player-overlay]'))
        const isControlInteraction = Boolean(event.target.closest('.art-bottom'))
        if (!isControlInteraction && !isPlayerOverlayInteraction) {
          event.preventDefault()
          event.stopPropagation()
        }
        if (isDisplaySettingsClosing) return
        setIsDisplaySettingsClosing(true)
        window.setTimeout(() => {
          setCustomNumberInput(undefined)
          setMediaTrackSelection(undefined)
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
          {isResolvingSource ? '正在连接播放源…' : '请先选择要播放的内容'}
        </div>
      ) : null}
      {!miniWindowMode &&
        (settingsPortalContainer
          ? createPortal(
              <>
                {playerOverlay ? (
                  <div
                    className={cn('vfan-player-top-overlay', playerOverlayPinned && 'vfan-player-top-overlay-pinned')}
                    data-player-overlay
                  >
                    {playerOverlay}
                  </div>
                ) : null}
                {displaySettingsOverlay}
              </>,
              settingsPortalContainer,
            )
          : displaySettingsOverlay)}
    </div>
  )
}
