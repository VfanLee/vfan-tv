/** 可见频道停留后才开始请求封面，跳过快速滚动经过的卡片 */
const PREVIEW_DWELL_MS = 250

interface VisibilityEntry {
  intersecting: boolean
  active: boolean
  timer?: ReturnType<typeof setTimeout>
  onChange: (visible: boolean) => void
}

/** 当前频道墙共用的可视区域观察器与卡片订阅 */
const entries = new Map<Element, VisibilityEntry>()
let observer: IntersectionObserver | undefined

/** 根据卡片与页面可见性延迟启动或立即停止预览 */
function updateVisibility(entry: VisibilityEntry): void {
  if (entry.intersecting && document.visibilityState !== 'hidden') {
    if (entry.active || entry.timer !== undefined) return
    entry.timer = setTimeout(() => {
      entry.timer = undefined
      entry.active = true
      entry.onChange(true)
    }, PREVIEW_DWELL_MS)
  } else {
    clearTimeout(entry.timer)
    entry.timer = undefined
    if (entry.active) {
      entry.active = false
      entry.onChange(false)
    }
  }
}

/** 页面隐藏时暂停所有频道预览，恢复后重新计算停留时间 */
function handlePageVisibility(): void {
  entries.forEach(updateVisibility)
}

/** 观察卡片是否在可视区域持续停留，并在释放时撤销计时与订阅 */
export function observePreviewVisibility(element: Element, onChange: (visible: boolean) => void): () => void {
  if (!observer) {
    observer = new IntersectionObserver(
      (changes) => {
        for (const change of changes) {
          const entry = entries.get(change.target)
          if (!entry) continue
          entry.intersecting = change.isIntersecting && change.intersectionRatio >= 0.01
          updateVisibility(entry)
        }
      },
      { threshold: 0.01 },
    )
    document.addEventListener('visibilitychange', handlePageVisibility)
  }
  const entry: VisibilityEntry = { intersecting: false, active: false, onChange }
  entries.set(element, entry)
  observer.observe(element)
  return () => {
    clearTimeout(entry.timer)
    entries.delete(element)
    observer?.unobserve(element)
    if (entry.active) onChange(false)
    if (!entries.size) {
      observer?.disconnect()
      observer = undefined
      document.removeEventListener('visibilitychange', handlePageVisibility)
    }
  }
}
