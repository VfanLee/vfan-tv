import type Artplayer from 'artplayer'

interface AmbilightOption {
  blur?: string
  duration?: number
  frequency?: number
  opacity?: number
}

/**
 * 跨域媒体源会污染 canvas，官方 ambilight 在 getImageData 时会抛 SecurityError。
 * 这里在采样失败时静默停用背光，避免打断播放与刷屏报错。
 */
export function createSafeAmbilightPlugin(option: AmbilightOption = {}) {
  return (art: Artplayer) => {
    const { $video } = art.template
    const { createElement, addClass, setStyles } = art.constructor.utils
    const { blur = '50px', opacity = 0.5, frequency = 10, duration = 0.3 } = option

    const $ambilight = createElement('div') as HTMLDivElement
    $ambilight.innerHTML = Array.from({ length: 9 }).fill('<div></div>').join('')
    const gridItems = Array.from($ambilight.children) as HTMLElement[]

    addClass($ambilight, 'artplayer-plugin-ambilight')
    $video.parentNode?.insertBefore($ambilight, $video)
    setStyles($ambilight, {
      position: 'absolute',
      top: 0,
      left: 0,
      zIndex: 9,
      inset: 0,
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gridTemplateRows: '1fr 1fr 1fr',
    })

    for (const $item of gridItems) {
      setStyles($item, {
        opacity,
        filter: `blur(${blur})`,
        transition: `background-color ${duration}s ease`,
      })
    }

    const canvas = createElement('canvas') as HTMLCanvasElement
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    canvas.width = 3
    canvas.height = 3

    let animationFrameId: number | null = null
    let lastUpdateTime = 0
    let disabled = false

    const sampleColor = (x: number, y: number, w: number, h: number): string | undefined => {
      if (!ctx || disabled || w <= 0 || h <= 0) return undefined
      try {
        ctx.drawImage($video, x, y, w, h, 0, 0, 1, 1)
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
        return `rgb(${r}, ${g}, ${b})`
      } catch {
        disabled = true
        stop()
        return undefined
      }
    }

    const updateColors = (): void => {
      if (disabled) return

      const now = performance.now()
      if (now - lastUpdateTime < 1000 / frequency || !art.playing) {
        animationFrameId = requestAnimationFrame(updateColors)
        return
      }

      lastUpdateTime = now
      const cellWidth = $video.videoWidth / 3
      const cellHeight = $video.videoHeight / 3
      if (!Number.isFinite(cellWidth) || !Number.isFinite(cellHeight) || cellWidth <= 0 || cellHeight <= 0) {
        animationFrameId = requestAnimationFrame(updateColors)
        return
      }

      const origins: Array<[number, number]> = [
        [0, 0],
        [cellWidth, 0],
        [2 * cellWidth, 0],
        [0, cellHeight],
        [cellWidth, cellHeight],
        [2 * cellWidth, cellHeight],
        [0, 2 * cellHeight],
        [cellWidth, 2 * cellHeight],
        [2 * cellWidth, 2 * cellHeight],
      ]

      for (const [index, [x, y]] of origins.entries()) {
        const color = sampleColor(x, y, cellWidth, cellHeight)
        if (disabled) return
        if (color) gridItems[index].style.backgroundColor = color
      }

      animationFrameId = requestAnimationFrame(updateColors)
    }

    function start(): void {
      if (disabled || animationFrameId) return
      updateColors()
    }

    function stop(): void {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
        animationFrameId = null
      }
    }

    art.on('ready', start)
    art.on('destroy', stop)

    return {
      name: 'artplayerPluginAmbilight',
      start,
      stop,
    }
  }
}
