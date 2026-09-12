import Hls from 'hls.js'
import mpegts from 'mpegts.js'
import type { MediaStreamType } from '@/types'

/** 从直播地址截取画面并转换为 JPEG Data URL */
export async function capturePreviewFrame(src: string, type: MediaStreamType, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.crossOrigin = 'anonymous'
  video.style.cssText = 'position:fixed;width:2px;height:2px;left:-100px;top:-100px;opacity:0;pointer-events:none'
  document.body.append(video)
  let hls: Hls | undefined
  let mpegtsPlayer: ReturnType<typeof mpegts.createPlayer> | undefined
  try {
    if (type === 'hls' && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: true, maxBufferLength: 4 })
      hls.loadSource(src)
      hls.attachMedia(video)
    } else if ((type === 'flv' || type === 'mpegts') && mpegts.isSupported()) {
      mpegtsPlayer = mpegts.createPlayer({ type: type === 'flv' ? 'flv' : 'mpegts', isLive: true, url: src })
      mpegtsPlayer.attachMediaElement(video)
      mpegtsPlayer.load()
    } else {
      video.src = src
    }
    await waitForFrame(video, signal)
    const width = video.videoWidth || 640
    const height = video.videoHeight || 360
    const canvas = document.createElement('canvas')
    canvas.width = Math.min(640, width)
    canvas.height = Math.round((canvas.width * height) / width)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建预览画布')
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.72)
  } finally {
    hls?.destroy()
    if (mpegtsPlayer) {
      try {
        mpegtsPlayer.unload()
        mpegtsPlayer.detachMediaElement()
        mpegtsPlayer.destroy()
      } catch {
        // 忽略关闭预览连接时的异常。
      }
    }
    video.pause()
    video.removeAttribute('src')
    video.load()
    video.remove()
  }
}

/** 等待视频加载首个可绘制画面 */
function waitForFrame(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const timeout = window.setTimeout(() => finish(new Error('预览超时')), 8_000)
    /** 移除画面监听器，并完成或拒绝等待任务 */
    const finish = (error?: Error): void => {
      window.clearTimeout(timeout)
      video.removeEventListener('loadeddata', ready)
      video.removeEventListener('canplay', ready)
      video.removeEventListener('error', failed)
      signal.removeEventListener('abort', aborted)
      error ? reject(error) : resolve()
    }
    /** 处理媒体帧已就绪事件 */
    const ready = (): void => {
      if (video.videoWidth > 0) finish()
      else void video.play().catch(() => undefined)
    }
    /** 处理媒体帧加载失败事件 */
    const failed = (): void => finish(new Error('无法生成频道预览'))
    /** 处理媒体帧捕获取消事件 */
    const aborted = (): void => finish(new DOMException('Aborted', 'AbortError'))
    video.addEventListener('loadeddata', ready)
    video.addEventListener('canplay', ready)
    video.addEventListener('error', failed)
    signal.addEventListener('abort', aborted, { once: true })
    if (video.readyState >= 2 && video.videoWidth > 0) ready()
    else void video.play().catch(() => undefined)
  })
}
