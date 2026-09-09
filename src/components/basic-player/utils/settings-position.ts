import type Artplayer from 'artplayer'

export interface SettingsPositionTracker {
  destroy: () => void
  refreshAfterControlTransition: () => void
  schedule: () => void
}

export function createSettingsPositionTracker(
  art: Artplayer,
  onOffsetChange: (offset: number) => void,
  gap = 4,
): SettingsPositionTracker {
  let frame: number | undefined
  let timer: number | undefined

  const update = (): void => {
    const playerRect = art.template.$player.getBoundingClientRect()
    const progressRect = art.template.$progress.getBoundingClientRect()
    if (playerRect.height <= 0 || progressRect.height <= 0) return

    onOffsetChange(Math.max(16, Math.round(playerRect.bottom - progressRect.top + gap)))
  }
  const schedule = (): void => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = undefined
      update()
    })
  }
  const refreshAfterControlTransition = (): void => {
    schedule()
    if (timer !== undefined) window.clearTimeout(timer)
    timer = window.setTimeout(schedule, 220)
  }
  const observer = new ResizeObserver(schedule)
  observer.observe(art.template.$player)
  observer.observe(art.template.$progress)
  window.addEventListener('resize', schedule)
  document.addEventListener('fullscreenchange', schedule)

  return {
    schedule,
    refreshAfterControlTransition,
    destroy: () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      if (timer !== undefined) window.clearTimeout(timer)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      document.removeEventListener('fullscreenchange', schedule)
    },
  }
}
