import Hls from 'hls.js'
import mpegts from 'mpegts.js'
import type { MediaStreamType } from '@shared/types'

const MAX_PREVIEWS = 120
const MAX_CONCURRENT = 3
const cache = new Map<string, string>()
const waiters: Array<() => void> = []
let activeCount = 0

export function clearIptvPreviewCache(): void {
  cache.clear()
}

export async function getLivePreview(
  key: string,
  target: { src: string; type: MediaStreamType },
  signal: AbortSignal,
): Promise<string> {
  const cached = cache.get(key)
  if (cached) {
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }
  await acquire(signal)
  try {
    const image = await captureFrame(target.src, target.type, signal)
    cache.set(key, image)
    while (cache.size > MAX_PREVIEWS) cache.delete(cache.keys().next().value as string)
    return image
  } finally {
    release()
  }
}

async function acquire(signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  if (activeCount < MAX_CONCURRENT) {
    activeCount += 1
    return
  }
  await new Promise<void>((resolve, reject) => {
    const grant = (): void => {
      signal.removeEventListener('abort', abort)
      activeCount += 1
      resolve()
    }
    const abort = (): void => {
      const index = waiters.indexOf(grant)
      if (index >= 0) waiters.splice(index, 1)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    waiters.push(grant)
    signal.addEventListener('abort', abort, { once: true })
  })
}

function release(): void {
  activeCount = Math.max(0, activeCount - 1)
  waiters.shift()?.()
}

async function captureFrame(src: string, type: MediaStreamType, signal: AbortSignal): Promise<string> {
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
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.72)
  } finally {
    hls?.destroy()
    if (mpegtsPlayer) {
      try {
        mpegtsPlayer.unload()
        mpegtsPlayer.detachMediaElement()
        mpegtsPlayer.destroy()
      } catch {
        // The preview connection may already be closed.
      }
    }
    video.pause()
    video.removeAttribute('src')
    video.load()
    video.remove()
  }
}

function waitForFrame(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error('预览超时')), 8_000)
    const finish = (error?: Error): void => {
      window.clearTimeout(timeout)
      video.removeEventListener('loadeddata', ready)
      video.removeEventListener('canplay', ready)
      video.removeEventListener('error', failed)
      signal.removeEventListener('abort', aborted)
      error ? reject(error) : resolve()
    }
    const ready = (): void => {
      if (video.videoWidth > 0) finish()
      else void video.play().catch(() => undefined)
    }
    const failed = (): void => finish(new Error('无法生成频道预览'))
    const aborted = (): void => finish(new DOMException('Aborted', 'AbortError'))
    video.addEventListener('loadeddata', ready)
    video.addEventListener('canplay', ready)
    video.addEventListener('error', failed)
    signal.addEventListener('abort', aborted, { once: true })
    void video.play().catch(() => undefined)
  })
}
