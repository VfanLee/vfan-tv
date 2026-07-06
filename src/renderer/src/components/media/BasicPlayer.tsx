import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import Artplayer, { type Option } from 'artplayer'
import artplayerPluginAmbilight from 'artplayer-plugin-ambilight'
import artplayerPluginAudioTrack from 'artplayer-plugin-audio-track'
import artplayerPluginHlsControl from 'artplayer-plugin-hls-control'
import Hls, { type ErrorData } from 'hls.js'
import { HLS_AD_FILTER_STORAGE_KEY, PLAYER_AUTO_NEXT_STORAGE_KEY, PLAYER_LOOP_STORAGE_KEY } from '@shared/constants'
import { cn } from '@renderer/lib/utils'
import { createFilteredHlsLoader } from '@renderer/lib/hls-playlist-filter'
import { artplayerSettingIcons, artplayerSwitchIcons } from '@renderer/lib/artplayer-icons'

export type PlayerVariant = 'vod' | 'live'

export interface PlayerNavigationLabels {
  previous: string
  next: string
}

export interface BasicPlayerProps {
  enableAdFilter?: boolean
  enableAutoNext?: boolean
  autoPlay?: boolean
  audioTrackUrl?: string
  className?: string
  src?: string
  sourceType?: 'hls'
  title?: string
  initialTime?: number
  hasNextEpisode?: boolean
  hasPreviousEpisode?: boolean
  isTheaterMode?: boolean
  loop?: boolean
  persistPlaybackSettings?: boolean
  navigationLabels?: PlayerNavigationLabels
  formatPlaybackUrl?: (src: string) => string
  onNextEpisode?: () => void
  onEnded?: () => void
  onPreviousEpisode?: () => void
  onProgress?: (progress: { currentTime: number; duration: number }) => void
  onToggleTheaterMode?: () => void
  variant?: PlayerVariant
}

interface BasicPlayerCallbacks {
  onEnded?: () => void
  onProgress?: (progress: { currentTime: number; duration: number }) => void
}

type ArtplayerWithHls = Artplayer & { hls?: Hls }

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
  isLive: boolean
  title?: string
  sourceType?: string
  autoPlay: boolean
  loop: boolean
  initialTime: number
  adFilterEnabled: boolean
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
  enableAdFilter = true,
  enableAutoNext = true,
  initialTime = 0,
  isTheaterMode = false,
  loop,
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
  const callbacksRef = useRef<BasicPlayerCallbacks>({})
  const formatPlaybackUrlRef = useRef(formatPlaybackUrl)
  const initialTimeRef = useRef(initialTime)
  const resumeTimeRef = useRef(0)
  const [adFilterEnabled, setAdFilterEnabled] = useState(() =>
    persistPlaybackSettings ? readAdFilterEnabled() : false,
  )

  const isLive = variant === 'live'
  const isHls = isHlsSource(src, sourceType)
  const canUseAdFilter = enableAdFilter && isHls && !isLive

  useEffect(() => {
    callbacksRef.current = {
      onEnded,
      onProgress,
    }
    formatPlaybackUrlRef.current = formatPlaybackUrl
    initialTimeRef.current = initialTime
  }, [formatPlaybackUrl, initialTime, onEnded, onProgress])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !src) {
      return
    }

    destroyHls(hlsRef)
    container.innerHTML = ''
    container.setAttribute('aria-label', title ?? 'Vfan TV 播放器')
    const displayPlaybackUrl = formatPlaybackUrlRef.current(src)
    const debugLog = new PlaybackDebugRecorder()

    if (!cachedAppVersion && window.api?.updates?.getCurrentVersion) {
      void window.api.updates.getCurrentVersion().then((version) => {
        cachedAppVersion = version
      })
    }

    let hlsControlUpdate: (() => void) | undefined
    let audioMenuItem: HTMLElement | undefined
    let loopEnabled = loop ?? (persistPlaybackSettings ? readLoopEnabled() : false)
    let autoNextEnabled = enableAutoNext && (persistPlaybackSettings ? readAutoNextEnabled() : true)

    const openSettingPanel = function (this: Artplayer, contextmenu: { show: boolean }): void {
      this.setting.show = true
      contextmenu.show = false
    }

    // https://artplayer.org/document/start/option.html
    const art = new Artplayer({
      container, // 播放器挂载的 DOM 容器
      url: src, // 当前实际播放地址
      type: isHls ? 'm3u8' : '', // 播放源类型，HLS 源交给 customType.m3u8 处理
      autoplay: autoPlay, // 是否自动播放
      loop: loopEnabled, // 是否循环播放
      isLive, // 是否启用直播模式（真直播无进度条、无倍速）
      setting: true, // 是否显示原生设置面板
      playbackRate: !isLive, // 是否显示倍速菜单，直播不显示
      aspectRatio: true, // 是否启用画面比例菜单
      flip: true, // 是否启用画面翻转菜单
      hotkey: true, // 是否启用 ArtPlayer 原生快捷键
      pip: true, // 是否启用画中画
      fullscreen: true, // 是否启用浏览器全屏
      fullscreenWeb: true, // 是否启用网页全屏
      miniProgressBar: false, // 关闭迷你进度条：其样式在本项目构建下会渲染异常（残留白竖线）
      screenshot: true, // 是否启用截图
      lock: true, // 是否启用移动端锁定按钮
      fastForward: true, // 是否启用长按快进
      autoOrientation: true, // 是否启用移动端全屏自动横屏
      airplay: true, // 是否启用 AirPlay
      playsInline: true, // 是否内联播放，避免移动端强制全屏
      mutex: true, // 是否与页面上的其他 ArtPlayer 实例互斥播放
      backdrop: true, // 是否显示控制栏背景遮罩
      theme: '#fff', // 主色：进度条、音量、选中等高亮统一为纯白
      icons: {
        switchOn: artplayerSwitchIcons.on, // 开关“开启”态：纯白实心
        switchOff: artplayerSwitchIcons.off, // 开关“关闭”态：暗色镂空
      },
      moreVideoAttr: {
        preload: 'metadata', // 只预加载媒体元信息
        playsInline: true, // 透传 video playsinline 属性
      },
      settings: [
        ...(!isLive
          ? [
              {
                name: 'vfan-loop',
                html: '循环播放',
                icon: artplayerSettingIcons.loop,
                tooltip: loopEnabled ? '开启' : '关闭',
                switch: loopEnabled,
                onSwitch(item) {
                  const nextEnabled = !item.switch
                  loopEnabled = nextEnabled
                  item.tooltip = nextEnabled ? '开启' : '关闭'
                  art.video.loop = nextEnabled
                  if (persistPlaybackSettings) {
                    window.localStorage.setItem(PLAYER_LOOP_STORAGE_KEY, String(nextEnabled))
                  }
                  return nextEnabled
                },
              },
              ...(enableAutoNext
                ? [
                    {
                      name: 'vfan-auto-next',
                      html: '自动续播',
                      icon: artplayerSettingIcons.autoNext,
                      tooltip: autoNextEnabled ? '开启' : '关闭',
                      switch: autoNextEnabled,
                      onSwitch(item) {
                        const nextEnabled = !item.switch
                        autoNextEnabled = nextEnabled
                        item.tooltip = nextEnabled ? '开启' : '关闭'
                        if (persistPlaybackSettings) {
                          window.localStorage.setItem(PLAYER_AUTO_NEXT_STORAGE_KEY, String(nextEnabled))
                        }
                        return nextEnabled
                      },
                    },
                  ]
                : []),
            ]
          : []),
        ...(canUseAdFilter
          ? [
              {
                name: 'hls-ad-filter',
                html: '去广告（试验性）',
                icon: artplayerSettingIcons.adFilter,
                tooltip: adFilterEnabled ? '开启' : '关闭',
                switch: adFilterEnabled,
                onSwitch(item) {
                  const nextEnabled = !item.switch
                  item.tooltip = nextEnabled ? '开启' : '关闭'
                  if (persistPlaybackSettings) {
                    window.localStorage.setItem(HLS_AD_FILTER_STORAGE_KEY, String(nextEnabled))
                  }
                  resumeTimeRef.current = art.currentTime
                  setAdFilterEnabled(nextEnabled)
                  return nextEnabled
                },
              },
            ]
          : []),
      ],
      plugins: [
        // 背光插件
        artplayerPluginAmbilight({
          blur: '30px', // 背光模糊半径
          opacity: 0.5, // 背光透明度
        }),
        // 独立外部音轨插件
        ...(audioTrackUrl
          ? [
              artplayerPluginAudioTrack({
                url: audioTrackUrl, // 独立外部音轨地址
              }),
            ]
          : []),
        ...(isHls
          ? [
              (art) => {
                const plugin = artplayerPluginHlsControl({
                  quality: {
                    control: true, // 在控制栏显示 HLS 清晰度入口
                    setting: false, // 在设置面板显示 HLS 清晰度入口
                    title: '清晰度', // HLS 清晰度菜单标题
                    auto: '自动', // HLS 自动清晰度文案
                    getName: (level) => getHlsQualityLabel(level, art.video),
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
      contextmenu: [
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
                adFilterEnabled: canUseAdFilter && adFilterEnabled,
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

          if (Hls.isSupported()) {
            const hls = new Hls(createHlsConfig(isLive, canUseAdFilter && adFilterEnabled))
            hlsRef.current = hls
            artInstance.hls = hls
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              debugLog.push('HLS', `清单已解析 · ${hls.levels.length} 档 · ${hls.audioTracks.length} 音轨`)
              syncHlsQualityUi(artInstance, hls, isLive, {
                updateHlsControl: () => hlsControlUpdate?.(),
              })
              if (hasHlsAudioTracks(hls)) {
                hlsControlUpdate?.()
                setContextMenuItemVisible(audioMenuItem, true)
              }
            })
            hls.on(Hls.Events.LEVEL_LOADED, () => {
              syncHlsQualityUi(artInstance, hls, isLive, {
                updateHlsControl: () => hlsControlUpdate?.(),
              })
            })
            hls.on(Hls.Events.ERROR, (_event, data) => {
              debugLog.push('HLS', formatHlsErrorBrief(data))
              if (data.fatal && isLive && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                debugLog.push('HLS', 'network fatal · 尝试重新加载清单')
                hls.startLoad()
                return
              }

              if (data.fatal) {
                artInstance.notice.show = `播放失败：${data.details}`
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
          artInstance.notice.show = '当前环境不支持 HLS 播放'
        },
      },
    } satisfies Option)

    artRef.current = art
    removeDefaultContextMenuItems(art)
    if (isLive) {
      removeLiveSettingItems(art)
    }
    injectPlayerChromeStyles(art)
    localizeInfoPanel(art, displayPlaybackUrl, isHls, isLive)
    const refreshHlsQualityUi = (): void => {
      const hls = (art as ArtplayerWithHls).hls
      if (!hls?.levels.length) {
        return
      }

      syncHlsQualityUi(art, hls, isLive, {
        updateHlsControl: () => hlsControlUpdate?.(),
      })
    }

    art.on('ready', () => {
      moveHlsQualityControl(art)
    })
    art.on('restart', () => moveHlsQualityControl(art))
    art.on('video:loadedmetadata', refreshHlsQualityUi)
    art.on('video:resize', refreshHlsQualityUi)

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
      }
    })
    art.on('error', (error) => {
      debugLog.push('Artplayer', error.message || '播放器加载失败')
      art.notice.show = error.message || '播放器加载失败'
    })

    return () => {
      destroyHls(hlsRef)
      art.destroy(false)
      if (artRef.current === art) {
        artRef.current = null
      }
      container.innerHTML = ''
    }
  }, [
    adFilterEnabled,
    audioTrackUrl,
    autoPlay,
    canUseAdFilter,
    enableAutoNext,
    isHls,
    isLive,
    loop,
    persistPlaybackSettings,
    sourceType,
    src,
    title,
  ])

  if (!src) {
    return (
      <div className={cn('relative w-full overflow-hidden bg-black', isTheaterMode && 'h-full', className)}>
        <div aria-hidden="true" className="pointer-events-none w-full pt-14 pb-16">
          <div className={cn('w-full', isTheaterMode ? 'h-full' : 'aspect-video')} />
        </div>
        <div
          className={cn(
            'absolute inset-x-0 flex items-center justify-center text-sm text-white/55',
            isTheaterMode ? 'inset-y-0' : 'top-14 bottom-16',
          )}
        >
          请选择一个可播放剧集
        </div>
      </div>
    )
  }

  return (
    <div className={cn('relative w-full overflow-hidden bg-black', isTheaterMode && 'h-full', className)}>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  )
}

function isHlsSource(src: string | undefined, sourceType: BasicPlayerProps['sourceType']): boolean {
  if (!src) {
    return false
  }

  return sourceType === 'hls' || /\.m3u8(?:$|[?#])/i.test(src)
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

function moveHlsQualityControl(art: Artplayer): void {
  const qualityControl = art.controls['hls-quality']
  const settingControl = art.controls['setting']
  if (!qualityControl || !settingControl || qualityControl.nextElementSibling === settingControl) {
    return
  }

  qualityControl.dataset.index = '25'
  settingControl.insertAdjacentElement('beforebegin', qualityControl)
}

function shouldShowHlsQualityControl(hls: Hls, isLive: boolean): boolean {
  if (!hls.levels.length) {
    return false
  }

  return isLive || hls.levels.length > 1
}

function setHlsQualityControlVisible(art: Artplayer, visible: boolean): void {
  const qualityControl = art.controls['hls-quality']
  if (qualityControl) {
    qualityControl.style.display = visible ? '' : 'none'
  }
}

function syncHlsQualityUi(
  art: Artplayer,
  hls: Hls,
  isLive: boolean,
  options: {
    updateHlsControl: () => void
  },
): void {
  const shouldShow = shouldShowHlsQualityControl(hls, isLive)
  setHlsQualityControlVisible(art, shouldShow)

  if (shouldShow) {
    options.updateHlsControl()
    moveHlsQualityControl(art)
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

function injectPlayerChromeStyles(art: Artplayer): void {
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
  `
  art.template.$player.appendChild(style)
}

function buildDebugInfoText(params: DebugInfoParams): string {
  const {
    art,
    rawSrc,
    displayUrl,
    isHls,
    isLive,
    title,
    sourceType,
    autoPlay,
    loop,
    initialTime,
    adFilterEnabled,
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
    `Artplayer: ${Artplayer.version}`,
    `HLS.js: ${Hls.version}`,
    '',
    '--- 播放配置 ---',
    `模式: ${isLive ? '直播' : '点播'}`,
    `源类型: ${sourceType || (isHls ? 'hls' : 'auto')}`,
    `原始地址: ${rawSrc}`,
    `实际地址: ${displayUrl}`,
    ...(rawSrc !== displayUrl ? ['地址转换: 是（可能与代理/格式化有关）'] : []),
    `自动播放: ${autoPlay ? '是' : '否'}`,
    `循环播放: ${loop ? '开启' : '关闭'}`,
    `自动续播: ${autoNextEnabled ? '开启' : '关闭'}`,
    `续播时间点: ${initialTime > 0 ? `${initialTime}s` : '无'}`,
    ...(isHls && !isLive ? [`去广告过滤: ${adFilterEnabled ? '开启' : '关闭'}`] : []),
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

function getDownloadSpeedText(art: Artplayer, isHls: boolean): string {
  if (!isHls) {
    return '-'
  }

  const estimate = (art as ArtplayerWithHls).hls?.bandwidthEstimate
  return formatBandwidthEstimate(estimate)
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

function localizeInfoPanel(art: Artplayer, playbackUrl: string, isHls: boolean, isLive: boolean): void {
  const { $info, $infoClose, $infoPanel } = art.template
  injectStatsStyles(art)
  $info.classList.add('vfan-stats-overlay')
  $infoClose.textContent = '×'
  $infoPanel.className = 'vfan-stats-panel'
  $infoPanel.innerHTML = `
    <div class="vfan-stats-heading">统计信息</div>
    <div class="vfan-stats-grid">
      <div class="vfan-stats-row"><span class="vfan-stats-label">播放器</span><span class="vfan-stats-value" data-vfan-info="player"></span></div>
      <div class="vfan-stats-row"><span class="vfan-stats-label">媒体类型</span><span class="vfan-stats-value" data-vfan-info="mime"></span></div>
      <div class="vfan-stats-row"><span class="vfan-stats-label">当前 / 最优</span><span class="vfan-stats-value" data-vfan-info="resolution"></span></div>
      <div class="vfan-stats-row"><span class="vfan-stats-label">清晰度</span><span class="vfan-stats-value" data-vfan-info="quality"></span></div>
      <div class="vfan-stats-row"><span class="vfan-stats-label">视口 / 帧</span><span class="vfan-stats-value" data-vfan-info="viewport"></span></div>
      <div class="vfan-stats-row"><span class="vfan-stats-label">音量</span><span class="vfan-stats-value" data-vfan-info="volume"></span></div>
      <div class="vfan-stats-row"><span class="vfan-stats-label">播放进度</span><span class="vfan-stats-value" data-vfan-info="progress"></span></div>
      <div class="vfan-stats-row vfan-stats-row-meter"><span class="vfan-stats-label">连接速度</span><span class="vfan-stats-value"><span data-vfan-info="download-speed"></span><span class="vfan-stats-meter" data-vfan-info="download-meter"><span></span></span></span></div>
      <div class="vfan-stats-row vfan-stats-row-meter"><span class="vfan-stats-label">缓冲健康</span><span class="vfan-stats-value"><span data-vfan-info="buffer-health"></span><span class="vfan-stats-meter" data-vfan-info="buffer-meter"><span></span></span></span></div>
      <div class="vfan-stats-row"><span class="vfan-stats-label">丢帧</span><span class="vfan-stats-value" data-vfan-info="dropped-frames"></span></div>
      <div class="vfan-stats-row vfan-stats-row-url"><span class="vfan-stats-label">视频地址</span><span class="vfan-stats-value" data-vfan-info="url" title="${escapeHtmlAttribute(playbackUrl)}"></span></div>
    </div>
  `

  const refresh = (): void => {
    const hls = (art as ArtplayerWithHls).hls
    const bufferHealth = getBufferHealth(art)
    const downloadSpeed = isHls ? (art as ArtplayerWithHls).hls?.bandwidthEstimate : undefined

    setInfoText($infoPanel, 'player', getPlayerEngineText(isHls))
    setInfoText($infoPanel, 'mime', getMimeTypeText(art, isHls, hls))
    setInfoText($infoPanel, 'resolution', getResolutionStatsText(art, isHls, hls))
    setInfoText($infoPanel, 'quality', getQualityText(art, isHls))
    setInfoText($infoPanel, 'viewport', getViewportStatsText(art))
    setInfoText($infoPanel, 'volume', `${Math.round(art.volume * 100)}%`)
    setInfoText($infoPanel, 'progress', getProgressStatsText(art, isLive))
    setInfoText($infoPanel, 'download-speed', getDownloadSpeedText(art, isHls))
    setInfoMeter($infoPanel, 'download-meter', getBitrateMeterPercent(downloadSpeed))
    setInfoText($infoPanel, 'buffer-health', bufferHealth.text)
    setInfoMeter($infoPanel, 'buffer-meter', getBufferMeterPercent(bufferHealth.seconds, art.duration, isLive))
    setInfoText($infoPanel, 'dropped-frames', getDroppedFramesText(art.video))
    setInfoText($infoPanel, 'url', shortenText(playbackUrl, 56))
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
    .vfan-stats-overlay .art-info-panel {
      width: min(460px, calc(100vw - 32px));
      max-height: calc(100vh - 48px);
      overflow: auto;
      background: rgba(18, 18, 18, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
    }
    .vfan-stats-panel {
      padding: 14px 16px 16px;
      color: rgba(255, 255, 255, 0.92);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      line-height: 1.45;
    }
    .vfan-stats-heading {
      margin-bottom: 12px;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .vfan-stats-grid {
      display: grid;
      gap: 8px;
    }
    .vfan-stats-row {
      display: grid;
      grid-template-columns: 92px minmax(0, 1fr);
      gap: 12px;
      align-items: start;
    }
    .vfan-stats-row-url {
      align-items: start;
    }
    .vfan-stats-label {
      color: rgba(255, 255, 255, 0.58);
      text-align: right;
      white-space: nowrap;
    }
    .vfan-stats-value {
      min-width: 0;
      word-break: break-all;
    }
    .vfan-stats-row-meter .vfan-stats-value {
      display: grid;
      gap: 4px;
    }
    .vfan-stats-meter {
      display: block;
      height: 4px;
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
      top: 10px;
      right: 12px;
      width: 28px;
      height: 28px;
      font-size: 18px;
      line-height: 28px;
    }
  `
  art.template.$player.appendChild(style)
}

function getPlayerEngineText(isHls: boolean): string {
  return `Artplayer ${Artplayer.version}${isHls ? ' · HLS.js' : ''}`
}

function getMimeTypeText(art: Artplayer, isHls: boolean, hls?: Hls): string {
  if (isHls && hls?.levels?.length) {
    const level = hls.levels[Math.max(0, hls.currentLevel)] ?? hls.levels[0]
    const codec = level.codecSet || level.videoCodec || level.attrs?.CODECS
    if (codec) {
      return `application/x-mpegURL · ${codec}`
    }
    return 'application/x-mpegURL'
  }

  const mimeType = art.video.currentSrc ? guessMimeType(art.video.currentSrc) : '-'
  return mimeType
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

function readAdFilterEnabled(): boolean {
  const stored = window.localStorage.getItem(HLS_AD_FILTER_STORAGE_KEY)
  if (stored === null) {
    return false
  }

  return stored === 'true'
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

function normalizePlaybackUrlForDisplay(src: string): string {
  try {
    const parsedUrl = new URL(src)
    const proxyTargetUrl = parsedUrl.searchParams.get('url')
    return proxyTargetUrl ? decodeURIComponent(proxyTargetUrl) : decodeURIComponent(src)
  } catch {
    return src
  }
}

function createHlsConfig(isLive: boolean, adFilterEnabled: boolean): ConstructorParameters<typeof Hls>[0] {
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
    ...(adFilterEnabled && !isLive ? { loader: createFilteredHlsLoader(Hls) } : undefined),
  }
}

function destroyHls(hlsRef: MutableRefObject<Hls | null>): void {
  hlsRef.current?.destroy()
  hlsRef.current = null
}
