import { type MutableRefObject } from 'react'
import Artplayer from 'artplayer'
import Hls from 'hls.js'
import { clamp } from 'es-toolkit/math'
import type { MediaStreamType } from '@/types'
import { type ArtplayerWithHls, type MpegtsPlayer } from './playback-engine'
import { formatTimeRanges, formatBandwidthEstimate, formatBitsPerSecond } from './playback-format'
import { getQualityText } from './player-settings'

interface VideoPlaybackQualityInfo {
  droppedVideoFrames?: number
  totalVideoFrames?: number
}

/** 构建统计面板并随播放器更新指标 */
export function localizeInfoPanel(
  art: Artplayer,
  playbackUrlRef: MutableRefObject<string>,
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
      <div class="vfan-stats-row vfan-stats-row-url"><span class="vfan-stats-label">视频地址</span><span class="vfan-stats-value vfan-stats-value-copyable" data-vfan-info="url" data-vfan-copy-label="视频地址" title="点击复制"></span></div>
      <div class="vfan-stats-row vfan-stats-row-url"><span class="vfan-stats-label">最终播放地址</span><span class="vfan-stats-value vfan-stats-value-copyable" data-vfan-info="resolved-url" data-vfan-copy-label="最终播放地址" title="点击复制"></span></div>
      ${getProtocolStatsMarkup(streamType)}
    </div>
  `
  $infoPanel.appendChild($infoClose)

  bindCopyableUrlClicks($infoPanel, art)

  /** 刷新当前播放器展示状态 */
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
    setInfoTextWithTitle($infoPanel, 'url', playbackUrlRef.current)
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

/** 向播放器注入统计面板样式 */
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

/** 生成对应协议的统计字段布局 */
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

/** 显示媒体协议名称 */
function getStreamTypeText(streamType: MediaStreamType): string {
  return { hls: 'HLS / M3U8', flv: 'FLV', mpegts: 'MPEG-TS', native: '原生直链' }[streamType]
}

/** 显示当前媒体使用的播放引擎 */
function getPlayerEngineText(streamType: MediaStreamType): string {
  const engine =
    streamType === 'hls' ? 'HLS.js' : streamType === 'flv' || streamType === 'mpegts' ? 'mpegts.js' : '浏览器原生'
  return `Artplayer ${Artplayer.version} · ${engine}`
}

/** 读取媒体编解码类型 */
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

  return art.video.currentSrc ? '浏览器原生媒体' : '-'
}

/** 格式化流媒体下载速率 */
function formatMpegtsSpeed(speed: unknown): string {
  return typeof speed === 'number' && Number.isFinite(speed) && speed > 0 ? `${speed.toFixed(1)} KB/s` : '检测中'
}

/** 计算下载速率指示条的比例 */
function getMpegtsSpeedMeterPercent(speed: unknown): number {
  return typeof speed === 'number' && Number.isFinite(speed) ? Math.min(100, Math.round((speed / 1_250) * 100)) : 0
}

/** 读取流媒体引擎的统计数据 */
function getMpegtsStatistics(
  player: MpegtsPlayer | null,
): { speed?: unknown; loaderType?: unknown; currentSegmentIndex?: unknown; totalSegmentCount?: unknown } | undefined {
  if (!player?.statisticsInfo || player.statisticsInfo.playerType !== 'MSEPlayer') return undefined
  return player.statisticsInfo
}

/** 汇总流媒体分片数量 */
function formatMpegtsSegments(
  stats: { currentSegmentIndex?: unknown; totalSegmentCount?: unknown } | undefined,
): string {
  const current = stats?.currentSegmentIndex
  const total = stats?.totalSegmentCount
  return typeof current === 'number' && typeof total === 'number' && total > 0 ? `${current + 1} / ${total}` : '直播流'
}

/** 整理流媒体编解码和轨道信息 */
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

/** 汇总实际播放与所选画质分辨率 */
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

/** 描述播放器视口尺寸 */
function getViewportStatsText(art: Artplayer): string {
  const player = art.template.$player
  const dpr = window.devicePixelRatio || 1
  const quality = getVideoPlaybackQuality(art.video)
  const dropped = quality?.droppedVideoFrames ?? 0
  const total = quality?.totalVideoFrames ?? 0
  return `${player.clientWidth} x ${player.clientHeight}*${dpr.toFixed(2)} / ${dropped} dropped of ${total}`
}

/** 显示点播进度或直播状态 */
function getProgressStatsText(art: Artplayer, isLive: boolean): string {
  const current = formatInfoTime(art.currentTime)
  if (isLive || !Number.isFinite(art.duration) || art.duration <= 0) {
    return `${current} / LIVE`
  }

  return `${current} / ${formatInfoTime(art.duration)}`
}

/** 计算播放位置之后的可用缓冲时长 */
function getBufferHealth(art: Artplayer): { seconds: number; text: string } {
  const video = art.video
  if (!video.buffered.length) {
    return { seconds: 0, text: '0.00 s' }
  }

  const ahead = Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime)
  return { seconds: ahead, text: `${ahead.toFixed(2)} s` }
}

/** 计算码率指示条的比例 */
function getBitrateMeterPercent(bitsPerSecond: number | undefined): number {
  if (!bitsPerSecond || !Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) {
    return 0
  }

  return Math.min(100, Math.round((bitsPerSecond / 10_000_000) * 100))
}

/** 按直播或点播场景计算缓冲指示比例 */
function getBufferMeterPercent(bufferSeconds: number, duration: number, isLive: boolean): number {
  const maxSeconds = isLive || !Number.isFinite(duration) || duration <= 0 ? 30 : Math.min(duration, 120)
  return Math.min(100, Math.round((bufferSeconds / maxSeconds) * 100))
}

/** 读取 HLS 可用画质的最佳高度 */
function getOptimalHlsHeight(hls?: Hls): number {
  if (!hls?.levels?.length) {
    return 0
  }

  return hls.levels.reduce((max, level) => Math.max(max, level.height || 0), 0)
}

/** 从播放引擎读取视频帧率 */
export function getVideoFrameRate(art: Artplayer): number | undefined {
  const quality = getVideoPlaybackQuality(art.video)
  if (quality && 'totalVideoFrames' in quality && art.currentTime > 0 && quality.totalVideoFrames) {
    return quality.totalVideoFrames / art.currentTime
  }

  return undefined
}

/** 格式化丢帧统计 */
function getDroppedFramesText(video: HTMLVideoElement): string {
  const quality = getVideoPlaybackQuality(video)
  if (!quality) {
    return '-'
  }

  return `${quality.droppedVideoFrames ?? 0} / ${quality.totalVideoFrames ?? 0}`
}

/** 读取浏览器支持的视频播放质量指标 */
function getVideoPlaybackQuality(video: HTMLVideoElement): VideoPlaybackQualityInfo | undefined {
  const getter = (video as HTMLVideoElement & { getVideoPlaybackQuality?: () => VideoPlaybackQualityInfo })
    .getVideoPlaybackQuality
  return getter?.call(video)
}

/** 按最大长度缩短展示内容 */
function shortenText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  const head = Math.max(18, Math.floor(maxLength * 0.45))
  const tail = Math.max(12, maxLength - head - 1)
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

/** 更新统计字段内容 */
function setInfoText(panel: HTMLElement, name: string, value: string): void {
  const element = panel.querySelector(`[data-vfan-info="${name}"]`)
  if (element && element.textContent !== value) {
    element.textContent = value
  }
}

/** 同时更新统计字段和完整提示 */
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

/** 绑定统计面板地址复制交互 */
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

/** 显示复制操作反馈 */
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

/** 按健康度计算指示条颜色 */
function getHealthMeterBackground(percent: number): string {
  const clamped = clamp(percent, 0, 100)
  const hue = (clamped / 100) * 120

  return `linear-gradient(90deg, hsl(${hue} 68% 42%), hsl(${hue} 78% 54%))`
}

/** 更新统计指示条的填充和颜色 */
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

/** 格式化统计面板中的播放时间 */
function formatInfoTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '00:00'
  }

  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  /** 为时间字段补齐两位数字 */
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`
}
