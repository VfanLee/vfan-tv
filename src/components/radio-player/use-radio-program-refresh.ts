import { useEffect, useRef } from 'react'
import { getRadioLivePrograms } from '@/platform/api'

/** 当前电台节目名称的刷新间隔 */
const PROGRAM_REFRESH_INTERVAL = 45_000

/** 定时刷新当前电台节目并在卸载时停止 */
export function useRadioProgramRefresh(channelId: number | undefined, onProgram: (title: string) => void): void {
  const onProgramRef = useRef(onProgram)

  /** 同步节目更新回调引用 */
  useEffect(() => {
    onProgramRef.current = onProgram
  }, [onProgram])

  /** 加载当前直播节目并定时刷新 */
  useEffect(() => {
    if (!channelId) return
    let active = true
    /** 请求当前电台的直播节目 */
    const refreshProgram = (): void => {
      void getRadioLivePrograms([channelId])
        .then(([program]) => {
          if (active && program?.title) onProgramRef.current(program.title)
        })
        .catch(() => undefined)
    }
    refreshProgram()
    const timer = window.setInterval(refreshProgram, PROGRAM_REFRESH_INTERVAL)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [channelId])
}
