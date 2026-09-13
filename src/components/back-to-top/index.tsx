import { useEffect, useState, type RefObject } from 'react'
import { ArrowUp } from 'lucide-react'
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@/ui'

interface BackToTopProps {
  scrollRef: RefObject<HTMLElement | null>
}

/** 在指定容器滚动超过一屏后显示返回顶部按钮 */
export function BackToTop({ scrollRef }: BackToTopProps): React.JSX.Element | null {
  const [visible, setVisible] = useState(false)

  /** 根据滚动位置和容器尺寸同步显隐，并在卸载时释放监听 */
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return

    /** 根据当前可见高度判断是否已向下滚动超过一屏 */
    const updateVisibility = (): void => {
      setVisible(element.clientHeight > 0 && element.scrollTop > element.clientHeight)
    }

    const observer = new ResizeObserver(updateVisibility)
    observer.observe(element)
    element.addEventListener('scroll', updateVisibility, { passive: true })
    updateVisibility()

    return () => {
      observer.disconnect()
      element.removeEventListener('scroll', updateVisibility)
    }
  }, [scrollRef])

  /** 返回容器顶部，并遵循系统的减少动态效果偏好 */
  const scrollToTop = (): void => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    scrollRef.current?.scrollTo({ top: 0, behavior: reduceMotion ? 'instant' : 'smooth' })
  }

  if (!visible) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label="返回顶部"
          className="fixed right-6 bottom-6 z-30 size-11 cursor-pointer rounded-full shadow-lg motion-reduce:transition-none"
          size="icon"
          type="button"
          onClick={scrollToTop}
        >
          <ArrowUp aria-hidden="true" className="size-5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">返回顶部</TooltipContent>
    </Tooltip>
  )
}
