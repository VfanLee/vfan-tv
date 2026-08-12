import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { AppLogInfo } from '@shared/types'
import { clearLogs, getLogInfo, revealLogFile } from '@renderer/platform/api'

export interface DiagnosticsState {
  info?: AppLogInfo
  isClearing: boolean
  isLoading: boolean
  clear: () => Promise<boolean>
  reveal: () => Promise<void>
}

/** 加载诊断日志状态，并执行目录定位和日志清空 */
export function useDiagnostics(apiAvailable: boolean): DiagnosticsState {
  const [info, setInfo] = useState<AppLogInfo>()
  const [isLoading, setIsLoading] = useState(apiAvailable)
  const [isClearing, setIsClearing] = useState(false)

  /** 首次进入数据管理页时读取日志状态 */
  useEffect(() => {
    if (!apiAvailable) return
    let active = true
    void getLogInfo()
      .then((value) => {
        if (active) setInfo(value)
      })
      .catch((error: unknown) => {
        if (active) toast.error('读取日志状态失败', { description: toErrorMessage(error) })
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [apiAvailable])

  /** 在系统文件管理器中定位当前日志文件 */
  const reveal = async (): Promise<void> => {
    if (!apiAvailable) return
    try {
      await revealLogFile()
    } catch (error) {
      toast.error('打开日志目录失败', { description: toErrorMessage(error) })
    }
  }

  /** 清空当前日志与历史日志，并刷新占用空间 */
  const clear = async (): Promise<boolean> => {
    if (!apiAvailable || isClearing) return false
    setIsClearing(true)
    try {
      setInfo(await clearLogs())
      toast.success('诊断日志已清空')
      return true
    } catch (error) {
      toast.error('清空诊断日志失败', { description: toErrorMessage(error) })
      return false
    } finally {
      setIsClearing(false)
    }
  }

  return { info, isClearing, isLoading, clear, reveal }
}

/** 将未知异常转换为可展示的错误信息 */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
