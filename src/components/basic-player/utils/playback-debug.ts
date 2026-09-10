import Artplayer from 'artplayer'
import Hls, { type ErrorData } from 'hls.js'
import mpegts from 'mpegts.js'
import dayjs from 'dayjs'
import { getCurrentVersion, isApiAvailable } from '@/platform/api'
import { type ArtplayerWithHls } from './playback-engine'
import { formatBandwidthEstimate, formatTimeRanges, formatDebugTime } from './playback-format'

/** 调试信息使用的应用版本缓存 */
let cachedAppVersion = ''

/** 异步补齐调试信息中的应用版本 */
export function loadDebugAppVersion(): void {
  if (cachedAppVersion || !isApiAvailable()) return
  void getCurrentVersion()
    .then((version) => {
      cachedAppVersion = version
    })
    .catch(console.error)
}

interface PlaybackDebugLogEntry {
  at: string
  type: string
  message: string
}

export class PlaybackDebugRecorder {
  private entries: PlaybackDebugLogEntry[] = []

  /** 追加一条带时间戳的日志并限制保留条数 */
  push(type: string, message: string): void {
    this.entries.push({
      at: dayjs().format('HH:mm:ss'),
      type,
      message,
    })
    if (this.entries.length > 30) {
      this.entries.shift()
    }
  }

  /** 生成最近播放事件的调试文本 */
  format(): string {
    if (!this.entries.length) {
      return '（暂无记录）'
    }

    return this.entries.map((entry) => `[${entry.at}] ${entry.type}: ${entry.message}`).join('\n')
  }
}

export interface DebugInfoParams {
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

/** 汇总媒体、引擎和运行状态以便复制排查 */
export function buildDebugInfoText(params: DebugInfoParams): string {
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
    `时间: ${dayjs().toISOString()}`,
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

/** 说明当前 HLS 播放引擎与支持状态 */
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

/** 说明 FLV 播放引擎是否启用 */
function getFlvEngineText(isFlv: boolean): string {
  if (!isFlv) {
    return '未使用'
  }

  return mpegts.isSupported() ? 'mpegts.js' : '不支持'
}

/** 说明 MPEG-TS 播放引擎是否启用 */
function getMpegtsEngineText(isMpegts: boolean): string {
  if (!isMpegts) {
    return '未使用'
  }

  return mpegts.isSupported() ? 'mpegts.js' : '不支持'
}

/** 将播放器运行状态转为调试文案 */
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

/** 解释媒体就绪状态 */
function formatMediaReadyState(state: number): string {
  const labels = ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA']
  return `${labels[state] ?? 'UNKNOWN'} (${state})`
}

/** 解释媒体网络状态 */
function formatMediaNetworkState(state: number): string {
  const labels = ['NETWORK_EMPTY', 'NETWORK_IDLE', 'NETWORK_LOADING', 'NETWORK_NO_SOURCE']
  return `${labels[state] ?? 'UNKNOWN'} (${state})`
}

/** 读取媒体元素的错误详情 */
export function formatMediaElementError(video: HTMLVideoElement): string | undefined {
  const error = video.error
  if (!error) {
    return undefined
  }

  const codes = ['', 'MEDIA_ERR_ABORTED', 'MEDIA_ERR_NETWORK', 'MEDIA_ERR_DECODE', 'MEDIA_ERR_SRC_NOT_SUPPORTED']
  const codeLabel = codes[error.code] ?? `CODE_${error.code}`
  const message = error.message?.trim()
  return message ? `${codeLabel} · ${message}` : codeLabel
}

/** 生成媒体加载失败时的用户提示 */
export function getMediaPlaybackFailureReason(video: HTMLVideoElement): string {
  const error = video.error
  if (!error) return '浏览器无法加载该媒体资源'

  const reasons = ['', '媒体加载被中断', '媒体资源请求失败', '媒体解码失败', '浏览器不支持该媒体格式']
  const reason = reasons[error.code] ?? '浏览器无法加载该媒体资源'
  return error.message?.trim() ? `${reason}：${error.message.trim()}` : reason
}

/** 将未知引擎错误整理成可读文本 */
export function formatUnknownErrorInfo(errorInfo: unknown): string {
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

/** 概括 HLS 错误的类型和详情 */
export function formatHlsErrorBrief(data: ErrorData): string {
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

/** 生成 HLS 致命错误的用户提示 */
export function formatHlsPlaybackFailureReason(data: ErrorData): string {
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

/** 汇总 HLS 清单、轨道与缓冲信息 */
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

/** 说明 HLS 当前画质档位 */
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

/** 限制调试字段的显示长度 */
function truncateDebugText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength)}…`
}
