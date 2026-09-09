import { isDesktopRuntime } from '@/platform/tauri'
import { useEffect } from 'react'
import { create } from 'zustand'
import { toast } from 'sonner'
import { applyReleaseDownloadRoute } from '@/constants'
import type { ReleaseDownloadRouteId, UpdateCheckResult, UpdateDownloadProgress } from '@/types'
import {
  checkForUpdates,
  downloadUpdate,
  getCurrentVersion,
  installUpdate,
  isApiAvailable,
  onUpdateEvent,
} from '@/platform/api'
import { openExternalUrl } from '@/utils'

interface AppUpdateState {
  currentVersion: string
  downloadProgress?: UpdateDownloadProgress
  isChecking: boolean
  isDownloaded: boolean
  isDownloading: boolean
  result?: UpdateCheckResult
  check: (silent?: boolean) => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
  openManualDownload: (routeId: ReleaseDownloadRouteId) => Promise<void>
  setCurrentVersion: (version: string) => void
}

/** 提取更新失败时可展示的错误信息 */
function getDisplayErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.trim()
}

export const useAppUpdateStore = create<AppUpdateState>((set, get) => ({
  currentVersion: '',
  isChecking: false,
  isDownloaded: false,
  isDownloading: false,
  setCurrentVersion: (version) => set({ currentVersion: version }),
  check: async (silent = false) => {
    if (get().isChecking || get().isDownloading) return
    set({ isChecking: true })
    try {
      const result = await checkForUpdates()
      set({ result, isChecking: false })
    } catch (error) {
      set({ isChecking: false })
      if (!silent) toast.error('检查更新失败', { description: getDisplayErrorMessage(error) })
    }
  },
  download: async () => {
    set({ isDownloading: true, downloadProgress: undefined })
    try {
      await downloadUpdate()
    } catch (error) {
      set({ isDownloading: false })
      toast.error('下载更新失败', { description: getDisplayErrorMessage(error) })
    }
  },
  install: async () => {
    try {
      await installUpdate()
    } catch (error) {
      toast.error('安装更新失败', { description: getDisplayErrorMessage(error) })
    }
  },
  openManualDownload: async (routeId) => {
    const result = get().result
    if (!result) return
    const url = result.manualDownloadUrl
      ? applyReleaseDownloadRoute(result.manualDownloadUrl, routeId)
      : result.releaseUrl
    try {
      await openExternalUrl(url)
    } catch (error) {
      toast.error('无法打开下载地址', { description: getDisplayErrorMessage(error) })
    }
  },
}))

/** 订阅应用更新事件，并在窗口加载时按配置静默检查更新 */
export function useAppUpdateSync(checkOnMount = true): void {
  const check = useAppUpdateStore((state) => state.check)
  const setCurrentVersion = useAppUpdateStore((state) => state.setCurrentVersion)

  /** 加载应用版本、订阅更新事件并执行启动检查 */
  useEffect(() => {
    if (!isDesktopRuntime() && !isApiAvailable()) return

    let active = true
    const unsubscribe = onUpdateEvent((event) => {
      if (!active) return

      if (event.status === 'checking') {
        useAppUpdateStore.setState({ isChecking: true })
        return
      }

      if (event.status === 'download-progress') {
        useAppUpdateStore.setState({ isDownloading: true, downloadProgress: event.progress })
        return
      }

      if (event.status === 'available' || event.status === 'not-available') {
        useAppUpdateStore.setState({
          result: event.result,
          isChecking: false,
        })
        return
      }

      if (event.status === 'downloaded') {
        useAppUpdateStore.setState({
          result: event.result,
          isDownloading: false,
          isDownloaded: true,
          downloadProgress: { bytesPerSecond: 0, percent: 100, total: 0, transferred: 0 },
        })
        return
      }

      if (event.status === 'error') {
        useAppUpdateStore.setState({
          isChecking: false,
          isDownloading: false,
          ...(event.result ? { result: event.result } : {}),
        })
      }
    })

    void getCurrentVersion()
      .then((version) => {
        if (!active) return
        setCurrentVersion(version)
        if (checkOnMount) void check(true)
      })
      .catch(console.error)

    return () => {
      active = false
      unsubscribe()
    }
  }, [check, checkOnMount, setCurrentVersion])
}
