import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { DEFAULT_GITHUB_PROXY_ROUTE_ID, GITHUB_PROXY_ROUTES } from '@shared/constants'
import type { GitHubProxyRouteId, GitHubProxyTestResult } from '@shared/types'
import { getSettings, syncSourceSubscription, testGitHubProxy, updateSettings } from '@renderer/services/api'
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
  speedResults: Record<GitHubProxyRouteId, GitHubProxySpeedState>
  subscriptionUrl: string
  subscriptionUpdatedAt?: number
  testingRouteId?: GitHubProxyRouteId
  resetSubscription: () => void
  saveGitHubProxy: (routeId?: GitHubProxyRouteId) => Promise<void>
  setSubscriptionUrl: (url: string) => void
  syncSubscription: () => Promise<void>
  testAllGitHubProxy: () => Promise<void>
  testSingleGitHubProxy: (routeId: GitHubProxyRouteId) => Promise<GitHubProxyTestResult>
}

export function useGeneralSettings({
  apiAvailable,
  refreshLiveSources,
  refreshVodSources,
}: GeneralSettingsOptions): GeneralSettingsState {
  const [subscriptionUrl, setSubscriptionUrl] = useState('')
  const [subscriptionUpdatedAt, setSubscriptionUpdatedAt] = useState<number>()
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
      setSubscriptionUrl(settings?.subscriptionUrl ?? '')
      setSubscriptionUpdatedAt(settings?.subscriptionUpdatedAt)
      setGithubProxyRoute(resolveVisibleGitHubProxyRoute(settings?.githubProxyRoute))
    })
    return () => {
      active = false
    }
  }, [])

  const syncSubscription = async (): Promise<void> => {
    const url = subscriptionUrl.trim()
    if (!apiAvailable || !url) return
    setIsSyncingSubscription(true)
    try {
      const result = await syncSourceSubscription(url)
      await updateSettings({ subscriptionUrl: url, subscriptionUpdatedAt: result.updatedAt })
      setSubscriptionUpdatedAt(result.updatedAt)
      await Promise.all([refreshVodSources(), refreshLiveSources()])
      toast.success('订阅同步完成', {
        description: `已替换订阅源：VOD ${result.vod.created} 个，直播 ${result.live.created} 个；手动源已保留。`,
      })
    } catch (error) {
      toast.error('订阅同步失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsSyncingSubscription(false)
    }
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
    speedResults,
    subscriptionUrl,
    subscriptionUpdatedAt,
    testingRouteId,
    resetSubscription: () => {
      setSubscriptionUrl('')
      setSubscriptionUpdatedAt(undefined)
    },
    saveGitHubProxy,
    setSubscriptionUrl,
    syncSubscription,
    testAllGitHubProxy,
    testSingleGitHubProxy,
  }
}
