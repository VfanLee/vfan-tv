import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { DEFAULT_GITHUB_PROXY_ROUTE_ID, GITHUB_PROXY_ROUTES } from '@shared/constants'
import type { GitHubProxyRouteId, GitHubProxyTestResult, SubscriptionConfig } from '@shared/types'
import {
  deleteSourceSubscription,
  getSettings,
  syncSourceSubscription,
  testGitHubProxy,
  updateSettings,
} from '@renderer/services/api'
import type { GitHubProxySpeedState } from '../types'
import {
  createIdleGitHubProxySpeedResults,
  getFastestGitHubProxyResult,
  getGitHubProxyRouteLabel,
  resolveVisibleGitHubProxyRoute,
} from '../utils'

interface GeneralSettingsOptions {
  apiAvailable: boolean
  refreshLiveSources: () => Promise<void>
  refreshVodSources: () => Promise<void>
}

export interface GeneralSettingsState {
  githubProxyRoute: GitHubProxyRouteId
  isSavingGitHubProxy: boolean
  isSyncingSubscription: boolean
  subscriptions: SubscriptionConfig[]
  activeSubscriptionId?: string
  speedResults: Record<GitHubProxyRouteId, GitHubProxySpeedState>
  testingRouteId?: GitHubProxyRouteId
  resetSubscription: () => void
  addSubscription: (url: string) => Promise<void>
  deleteSubscription: (id: string) => Promise<void>
  selectSubscription: (id: string) => Promise<void>
  saveGitHubProxy: (routeId?: GitHubProxyRouteId) => Promise<void>
  syncSubscription: () => Promise<void>
  testAllGitHubProxy: () => Promise<void>
  testSingleGitHubProxy: (routeId: GitHubProxyRouteId) => Promise<GitHubProxyTestResult>
}

export function useGeneralSettings({
  apiAvailable,
  refreshLiveSources,
  refreshVodSources,
}: GeneralSettingsOptions): GeneralSettingsState {
  const [subscriptions, setSubscriptions] = useState<SubscriptionConfig[]>([])
  const [activeSubscriptionId, setActiveSubscriptionId] = useState<string>()
  const [githubProxyRoute, setGithubProxyRoute] = useState<GitHubProxyRouteId>(DEFAULT_GITHUB_PROXY_ROUTE_ID)
  const [isSavingGitHubProxy, setIsSavingGitHubProxy] = useState(false)
  const [speedResults, setSpeedResults] = useState<Record<GitHubProxyRouteId, GitHubProxySpeedState>>(() =>
    createIdleGitHubProxySpeedResults(),
  )
  const [testingRouteId, setTestingRouteId] = useState<GitHubProxyRouteId>()
  const [isSyncingSubscription, setIsSyncingSubscription] = useState(false)

  useEffect(() => {
    let active = true
    void getSettings().then((settings) => {
      if (!active) return
      setSubscriptions(settings?.subscriptions ?? [])
      setActiveSubscriptionId(settings?.activeSubscriptionId)
      setGithubProxyRoute(resolveVisibleGitHubProxyRoute(settings?.githubProxyRoute))
    })
    return () => {
      active = false
    }
  }, [])

  const syncSubscription = async (): Promise<void> => {
    if (!apiAvailable || !activeSubscriptionId) return
    await syncSubscriptionById(activeSubscriptionId)
  }

  const syncSubscriptionById = async (subscriptionId: string): Promise<void> => {
    if (!apiAvailable || !subscriptions.some((item) => item.id === subscriptionId)) return
    setIsSyncingSubscription(true)
    try {
      const result = await syncSourceSubscription(subscriptionId)
      await Promise.all([refreshVodSources(), refreshLiveSources()])
      toast.success('订阅同步完成', {
        description: `已更新订阅点播源和直播源：点播 ${result.vod.created + result.vod.updated} 个，直播 ${result.live.created + result.live.updated} 个。`,
      })
    } catch (error) {
      toast.error('订阅同步失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsSyncingSubscription(false)
    }
  }

  const addSubscription = async (rawUrl: string): Promise<void> => {
    const url = rawUrl.trim()
    if (!apiAvailable || !url) return
    try {
      const parsedUrl = new URL(url)
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('订阅地址仅支持 HTTP 或 HTTPS')
      if (subscriptions.some((item) => item.url === url)) throw new Error('该订阅地址已存在')
      const item = { id: crypto.randomUUID(), url }
      const next = [...subscriptions, item]
      await updateSettings({ subscriptions: next, activeSubscriptionId: item.id })
      setSubscriptions(next)
      setActiveSubscriptionId(item.id)
      toast.success('订阅源已添加')
    } catch (error) {
      toast.error('添加失败', { description: error instanceof Error ? error.message : '订阅地址无效' })
    }
  }

  const selectSubscription = async (id: string): Promise<void> => {
    if (!apiAvailable || id === activeSubscriptionId || !subscriptions.some((item) => item.id === id)) return
    setIsSyncingSubscription(true)
    try {
      const result = await syncSourceSubscription(id)
      await updateSettings({ activeSubscriptionId: id })
      setActiveSubscriptionId(id)
      await Promise.all([refreshVodSources(), refreshLiveSources()])
      toast.success('订阅源已切换', {
        description: `已更新订阅点播源和直播源：点播 ${result.vod.created + result.vod.updated} 个，直播 ${result.live.created + result.live.updated} 个。`,
      })
    } catch (error) {
      toast.error('切换失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsSyncingSubscription(false)
    }
  }

  const deleteSubscription = async (id: string): Promise<void> => {
    if (!apiAvailable) return
    await deleteSourceSubscription(id)
    const next = subscriptions.filter((item) => item.id !== id)
    setSubscriptions(next)
    setActiveSubscriptionId((current) => (current === id ? next[0]?.id : current))
    await Promise.all([refreshVodSources(), refreshLiveSources()])
    toast.success('订阅源已删除')
  }

  const saveGitHubProxy = async (nextRoute = githubProxyRoute): Promise<void> => {
    if (!apiAvailable) return
    const routeToSave = resolveVisibleGitHubProxyRoute(nextRoute)
    setGithubProxyRoute(routeToSave)
    setIsSavingGitHubProxy(true)
    try {
      const settings = await updateSettings({ githubProxyCustomPrefix: '', githubProxyRoute: routeToSave })
      setGithubProxyRoute(resolveVisibleGitHubProxyRoute(settings.githubProxyRoute))
      toast.success('GitHub 加速设置已保存')
    } catch (error) {
      toast.error('保存失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsSavingGitHubProxy(false)
    }
  }

  const testSingleGitHubProxy = async (routeId: GitHubProxyRouteId): Promise<GitHubProxyTestResult> => {
    setTestingRouteId(routeId)
    setSpeedResults((current) => ({ ...current, [routeId]: { status: 'testing' } }))
    const result = await testGitHubProxy(routeId, '')
    setSpeedResults((current) => ({ ...current, [routeId]: result }))
    setTestingRouteId(undefined)
    return result
  }

  const testAllGitHubProxy = async (): Promise<void> => {
    if (!apiAvailable) return
    const routeIds: GitHubProxyRouteId[] = GITHUB_PROXY_ROUTES.map((route) => route.id)
    setTestingRouteId(DEFAULT_GITHUB_PROXY_ROUTE_ID)
    setSpeedResults(
      Object.fromEntries(routeIds.map((routeId) => [routeId, { status: 'testing' }])) as Record<
        GitHubProxyRouteId,
        GitHubProxySpeedState
      >,
    )
    const results = await Promise.all(routeIds.map((routeId) => testGitHubProxy(routeId, '')))
    setSpeedResults(
      results.reduce<Record<GitHubProxyRouteId, GitHubProxySpeedState>>(
        (current, result) => ({ ...current, [result.routeId]: result }),
        createIdleGitHubProxySpeedResults(),
      ),
    )
    setTestingRouteId(undefined)
    const fastest = getFastestGitHubProxyResult(results)
    if (fastest) {
      await saveGitHubProxy(fastest.routeId)
      toast.success(`最快线路：${getGitHubProxyRouteLabel(fastest.routeId)}`)
    }
  }

  return {
    githubProxyRoute,
    isSavingGitHubProxy,
    isSyncingSubscription,
    subscriptions,
    activeSubscriptionId,
    speedResults,
    testingRouteId,
    resetSubscription: () => {
      setSubscriptions([])
      setActiveSubscriptionId(undefined)
    },
    addSubscription,
    deleteSubscription,
    saveGitHubProxy,
    selectSubscription,
    syncSubscription,
    testAllGitHubProxy,
    testSingleGitHubProxy,
  }
}
