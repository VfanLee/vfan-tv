import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { NetworkProxyTestResult, NetworkRouteKey, NetworkSettings, NetworkStatus } from '@shared/types'
import {
  clearSourceImageUrlCache,
  getNetworkStatus,
  getSettings,
  saveNetworkSettings,
  testNetworkSettings,
} from '@renderer/platform/api'

/** 网络设置页面的默认配置 */
const DEFAULT_NETWORK_SETTINGS: NetworkSettings = {
  profiles: [],
  iptv: { mode: 'direct' },
  epg: { mode: 'direct' },
}

export interface NetworkSettingsState {
  settings: NetworkSettings
  status?: NetworkStatus
  testResults: Partial<Record<NetworkRouteKey, NetworkProxyTestResult>>
  isLoading: boolean
  isSaving: boolean
  testingRoute?: NetworkRouteKey
  refreshStatus: () => Promise<void>
  save: (settings: NetworkSettings) => Promise<void>
  test: (route: NetworkRouteKey, settings?: NetworkSettings) => Promise<NetworkProxyTestResult | undefined>
}

/** 加载、保存并测试各业务路由的网络配置 */
export function useNetworkSettings(apiAvailable: boolean): NetworkSettingsState {
  const [settings, setSettings] = useState<NetworkSettings>(DEFAULT_NETWORK_SETTINGS)
  const [status, setStatus] = useState<NetworkStatus>()
  const [testResults, setTestResults] = useState<Partial<Record<NetworkRouteKey, NetworkProxyTestResult>>>({})
  const [isLoading, setIsLoading] = useState(apiAvailable)
  const [isSaving, setIsSaving] = useState(false)
  const [testingRoute, setTestingRoute] = useState<NetworkRouteKey>()

  /** 重新读取当前网络状态 */
  const refreshStatus = useCallback(async (): Promise<void> => {
    if (!apiAvailable) return
    try {
      setStatus(await getNetworkStatus())
    } catch {
      setStatus(undefined)
    }
  }, [apiAvailable])

  /** 加载网络配置和状态，并监听网络连接变化 */
  useEffect(() => {
    if (!apiAvailable) return
    let active = true
    void Promise.all([getSettings(), getNetworkStatus()])
      .then(([appSettings, networkStatus]) => {
        if (!active) return
        setSettings(appSettings?.network ?? DEFAULT_NETWORK_SETTINGS)
        setStatus(networkStatus)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    /** 处理网络变更 */
    const handleNetworkChange = (): void => void refreshStatus()
    window.addEventListener('online', handleNetworkChange)
    window.addEventListener('offline', handleNetworkChange)
    const timer = window.setInterval(handleNetworkChange, 30_000)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('online', handleNetworkChange)
      window.removeEventListener('offline', handleNetworkChange)
    }
  }, [apiAvailable, refreshStatus])

  /** 保存网络配置并刷新网络状态 */
  const save = useCallback(
    async (nextSettings: NetworkSettings): Promise<void> => {
      if (!apiAvailable) return
      setIsSaving(true)
      try {
        const saved = await saveNetworkSettings(nextSettings)
        setSettings(saved)
        setTestResults({})
        clearSourceImageUrlCache()
        await refreshStatus()
        toast.success('网络设置已保存')
      } catch (error) {
        toast.error('保存失败', { description: error instanceof Error ? error.message : String(error) })
      } finally {
        setIsSaving(false)
      }
    },
    [apiAvailable, refreshStatus],
  )

  /** 测试指定业务路由的网络配置 */
  const test = useCallback(
    async (route: NetworkRouteKey, candidate = settings): Promise<NetworkProxyTestResult | undefined> => {
      if (!apiAvailable) return undefined
      setTestingRoute(route)
      setTestResults((current) => ({ ...current, [route]: undefined }))
      try {
        const result = await testNetworkSettings({ route, settings: candidate })
        setTestResults((current) => ({ ...current, [route]: result }))
        if (result.status === 'success') toast.success(`${getRouteLabel(route)}测试成功`)
        else toast.warning(`${getRouteLabel(route)}测试失败`, { description: result.errorMessage })
        return result
      } catch (error) {
        toast.error(`${getRouteLabel(route)}测试失败`, {
          description: error instanceof Error ? error.message : String(error),
        })
        return undefined
      } finally {
        setTestingRoute(undefined)
      }
    },
    [apiAvailable, settings],
  )

  return { settings, status, testResults, isLoading, isSaving, testingRoute, refreshStatus, save, test }
}

/** 获取路由标签 */
function getRouteLabel(route: NetworkRouteKey): string {
  return route === 'iptv' ? 'IPTV 直播网络' : 'EPG 节目单网络'
}
