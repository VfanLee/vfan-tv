import Artplayer from 'artplayer'
import Hls from 'hls.js'
import { useUiPreferencesStore } from '@/stores'
import type { CustomSliderInput, MediaTrackSelection } from '../types'
import { type ArtplayerWithHls } from './playback-engine'
import { formatBitsPerSecond } from './playback-format'

/** 移除已由自定义界面接管的原生菜单项 */
export function removeDefaultContextMenuItems(art: Artplayer): void {
  for (const name of ['playbackRate', 'aspectRatio', 'flip', 'info', 'version', 'close']) {
    try {
      art.contextmenu.remove(name)
    } catch {
      // Ignore missing built-in context menu entries.
    }
  }
}

/** 移除直播场景不适用的设置项 */
export function removeLiveSettingItems(art: Artplayer): void {
  for (const name of ['playback-rate', 'vfan-loop', 'vfan-auto-next', 'hls-ad-filter']) {
    try {
      art.setting.remove(name)
    } catch {
      // Ignore settings that were not mounted for this source.
    }
  }
}

/** 显示当前视频轨道或自动画质状态 */
export function getVideoTrackMenuLabel(art: Artplayer, hls?: Hls): string {
  if (!hls) return art.video.videoHeight ? `${art.video.videoHeight}p` : '当前流'
  if (hls.autoLevelEnabled) return '自动'
  const level = hls.levels[hls.currentLevel]
  return level?.name || (level?.height ? `${level.height}p` : `线路 ${hls.currentLevel + 1}`)
}

/** 显示当前音频轨道名称 */
export function getAudioTrackMenuLabel(hls?: Hls): string {
  if (!hls) return '当前音轨'
  const track = hls.audioTracks[hls.audioTrack] ?? hls.audioTracks[0]
  return track?.name || track?.lang || '当前音轨'
}

/** 构建视频轨道选项及其切换操作 */
export function createVideoTrackSelection(art: Artplayer, isHls: boolean, refresh: () => void): MediaTrackSelection {
  const hls = isHls ? (art as ArtplayerWithHls).hls : undefined
  if (!hls || !hls.levels.length) {
    const dimensions =
      art.video.videoWidth && art.video.videoHeight
        ? `${art.video.videoWidth} × ${art.video.videoHeight}`
        : '尚未识别视频参数'
    return {
      title: '视频',
      hint: '当前流不支持切换',
      options: [{ id: 'current', label: '当前视频', description: dimensions, selected: true, disabled: true }],
    }
  }

  return {
    title: '视频',
    options: [
      {
        id: 'auto',
        label: '自动',
        description: '根据网络状况自动选择清晰度',
        selected: hls.autoLevelEnabled,
        onSelect: () => {
          hls.currentLevel = -1
          refresh()
        },
      },
      ...hls.levels.map((level, index) => ({
        id: `level-${index}`,
        label: level.name || (level.height ? `${level.height}p` : `清晰度 ${index + 1}`),
        description: [
          level.videoCodec,
          level.width && level.height ? `${level.width} × ${level.height}` : undefined,
          level.bitrate ? formatBitsPerSecond(level.bitrate) : undefined,
        ]
          .filter(Boolean)
          .join(' · '),
        selected: !hls.autoLevelEnabled && hls.currentLevel === index,
        onSelect: () => {
          hls.currentLevel = index
          refresh()
        },
      })),
    ],
  }
}

/** 构建音频轨道选项及其切换操作 */
export function createAudioTrackSelection(art: Artplayer, isHls: boolean, refresh: () => void): MediaTrackSelection {
  const hls = isHls ? (art as ArtplayerWithHls).hls : undefined
  if (!hls || hls.audioTracks.length <= 1) {
    const track = hls?.audioTracks[0]
    return {
      title: '音频',
      hint: '当前流不支持切换',
      options: [
        {
          id: 'current',
          label: track?.name || track?.lang || '当前音轨',
          description: [track?.lang, track?.audioCodec].filter(Boolean).join(' · ') || '单音轨',
          selected: true,
          disabled: true,
        },
      ],
    }
  }

  return {
    title: '音频',
    options: hls.audioTracks.map((track, index) => ({
      id: `audio-${index}`,
      label: track.name || track.lang || `音轨 ${index + 1}`,
      description: [track.lang, track.audioCodec].filter(Boolean).join(' · '),
      selected: hls.audioTrack === index,
      onSelect: () => {
        hls.audioTrack = index
        refresh()
      },
    })),
  }
}

/** 更新指定右键菜单项的可见性 */
export function setContextMenuItemVisible(element: HTMLElement | undefined, visible: boolean): void {
  if (element) {
    element.style.display = visible ? '' : 'none'
  }
}

/** 应用播放器控制栏与小窗外观样式 */
export function injectPlayerChromeStyles(art: Artplayer, miniWindowMode = false): void {
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
    .art-video-player .vfan-mini-window-icon,
    .art-video-player .vfan-mini-window-icon svg {
      display: block;
      width: 19px;
      height: 19px;
    }
    .art-video-player .vfan-mini-window-icon svg,
    .art-video-player .vfan-mini-window-icon svg * {
      fill: none !important;
      stroke: currentColor !important;
    }
    .art-video-player:not(.art-control-show):not(.art-hover) .art-bottom .art-progress .art-progress-indicator {
      display: none !important;
    }
    .art-video-player .art-bottom {
      background-image: none;
    }
    .art-video-player.art-control-show .art-bottom,
    .art-video-player.art-hover .art-bottom {
      top: auto;
      height: auto;
      overflow: visible;
      background-image: none;
    }
    .art-video-player .vfan-player-top-overlay {
      position: absolute;
      top: 0;
      right: 0;
      left: 0;
      z-index: 190;
      pointer-events: none;
      opacity: 0;
      transform: translateY(-4px);
      transition: opacity 180ms ease, transform 180ms ease;
    }
    .art-video-player.art-control-show .vfan-player-top-overlay,
    .art-video-player.vfan-player-overlay-pinned .vfan-player-top-overlay,
    .art-video-player .vfan-player-top-overlay.vfan-player-top-overlay-pinned,
    .art-video-player .vfan-player-top-overlay:focus-within {
      opacity: 1;
      transform: translateY(0);
    }
    .art-video-player.art-control-show .vfan-player-top-overlay > *,
    .art-video-player.vfan-player-overlay-pinned .vfan-player-top-overlay > *,
    .art-video-player .vfan-player-top-overlay.vfan-player-top-overlay-pinned > *,
    .art-video-player .vfan-player-top-overlay:focus-within > * {
      pointer-events: auto;
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

/** 根据轨道名称和高度显示画质 */
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

/** 读取当前播放画质的展示文案 */
export function getQualityText(art: Artplayer, isHls: boolean): string {
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

/** 读取启动前已加载的循环播放偏好 */
export function readLoopEnabled(): boolean {
  return useUiPreferencesStore.getState().player.loop
}

/** 读取自动续集偏好 */
export function readAutoNextEnabled(): boolean {
  return useUiPreferencesStore.getState().player.autoNext
}

/** 播放倍速滑块的快捷预设 */
const PLAYBACK_RATE_OPTIONS = [0.5, 1, 1.25, 1.5, 2] as const

/** 方向键快进步长的快捷预设，单位为秒 */
const SEEK_STEP_OPTIONS = [3, 5, 10] as const

/** 构建倍速滑块及预设选项 */
export function createPlaybackRateSliderInput(
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

/** 构建快进步长滑块及预设选项 */
export function createSeekStepSliderInput(
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

/** 循环选择列表中的下一个值 */
export function nextFromList<T extends string>(current: T, values: readonly T[]): T {
  return values[(values.indexOf(current) + 1) % values.length] ?? values[0]
}

/** 读取倍速偏好 */
export function readPlaybackRate(): number {
  return useUiPreferencesStore.getState().player.playbackRate
}

/** 读取快进步长偏好 */
export function readSeekStep(): number {
  return useUiPreferencesStore.getState().player.seekStep
}

/** 格式化滑块数值 */
function formatSliderNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/** 识别不应触发播放器快捷键的输入元素 */
export function isTextInputTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
  )
}

/** 整理用于展示的播放地址 */
export function normalizePlaybackUrlForDisplay(src: string): string {
  return src
}
