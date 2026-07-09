import { useEffect, useState } from 'react'
import { Check, Download, Gauge, GripVertical, Pencil, Plus, RefreshCw, Rss, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import {
  CUSTOM_GITHUB_PROXY_ROUTE_ID,
  DEFAULT_GITHUB_PROXY_ROUTE_ID,
  GITHUB_PROXY_ROUTES,
  SEARCH_HISTORY_STORAGE_KEY,
} from '@shared/constants'
import type {
  GitHubProxyRouteId,
  GitHubProxyTestResult,
  LiveSourceConfig,
  LiveSourceInput,
  VodSourceConfig,
  VodSourceInput,
} from '@shared/types'
import { ConfirmDialog, SettingsCard, ThemeSettings } from '@renderer/components'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import {
  clearLiveSources,
  clearSources,
  createLiveSource,
  createSource,
  deleteLiveSource,
  deleteSource,
  exportLiveSourcesToFile,
  exportSourcesToFile,
  exportAppData,
  getSettings,
  importAppData,
  importLiveSourcesFromFile,
  importSourcesFromFile,
  initializeAppData,
  isApiAvailable,
  listLiveSources,
  listSources,
  reorderLiveSources,
  reorderSources,
  syncSourceSubscription,
  testGitHubProxy,
  updateLiveSource,
  updateSettings,
  updateSource,
} from '@renderer/services/api'

type SourceDialogState = { mode: 'create' } | { mode: 'edit'; source: VodSourceConfig }
type LiveSourceDialogState = { mode: 'create' } | { mode: 'edit'; source: LiveSourceConfig }

interface GitHubProxySpeedState {
  elapsedMs?: number
  errorMessage?: string
  status: 'idle' | 'testing' | 'success' | 'error'
}

type ConfirmState =
  | { type: 'clearSources' }
  | { type: 'clearLiveSources' }
  | { type: 'initializeAppData' }
  | { type: 'importAppData' }
  | { type: 'deleteSource'; source: VodSourceConfig }
  | { type: 'deleteLiveSource'; source: LiveSourceConfig }

const emptySourceInput: VodSourceInput = {
  name: '',
  url: '',
  referer: undefined,
  enabled: false,
}

const emptyLiveSourceInput: LiveSourceInput = {
  name: '',
  url: '',
  enabled: true,
}

export function SettingsPage(): React.JSX.Element {
  const [sources, setSources] = useState<VodSourceConfig[]>([])
  const [liveSources, setLiveSources] = useState<LiveSourceConfig[]>([])
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(() => new Set())
  const [selectedLiveSourceIds, setSelectedLiveSourceIds] = useState<Set<string>>(() => new Set())
  const [isBatchUpdating, setIsBatchUpdating] = useState(false)
  const [isLiveBatchUpdating, setIsLiveBatchUpdating] = useState(false)
  const [isClearingSources, setIsClearingSources] = useState(false)
  const [isClearingLiveSources, setIsClearingLiveSources] = useState(false)
  const [isInitializingAppData, setIsInitializingAppData] = useState(false)
  const [isExportingAppData, setIsExportingAppData] = useState(false)
  const [isImportingAppData, setIsImportingAppData] = useState(false)
  const [draggedSourceId, setDraggedSourceId] = useState<string>()
  const [dragOverSourceId, setDragOverSourceId] = useState<string>()
  const [draggedLiveSourceId, setDraggedLiveSourceId] = useState<string>()
  const [dragOverLiveSourceId, setDragOverLiveSourceId] = useState<string>()
  const [isReordering, setIsReordering] = useState(false)
  const [isReorderingLiveSources, setIsReorderingLiveSources] = useState(false)
  const [subscriptionUrl, setSubscriptionUrl] = useState('')
  const [githubProxyRoute, setGithubProxyRoute] = useState<GitHubProxyRouteId>(DEFAULT_GITHUB_PROXY_ROUTE_ID)
  const [isSavingGitHubProxy, setIsSavingGitHubProxy] = useState(false)
  const [speedResults, setSpeedResults] = useState<Record<GitHubProxyRouteId, GitHubProxySpeedState>>(() =>
    createIdleGitHubProxySpeedResults(),
  )
  const [testingRouteId, setTestingRouteId] = useState<GitHubProxyRouteId>()
  const [isSyncingSubscription, setIsSyncingSubscription] = useState(false)
  const [dialog, setDialog] = useState<SourceDialogState>()
  const [liveSourceDialog, setLiveSourceDialog] = useState<LiveSourceDialogState>()
  const [confirmState, setConfirmState] = useState<ConfirmState>()
  const apiAvailable = isApiAvailable()
  const enabledCount = sources.filter((source) => source.enabled).length
  const liveEnabledCount = liveSources.filter((source) => source.enabled).length
  const allSelected = sources.length > 0 && selectedSourceIds.size === sources.length
  const allLiveSelected = liveSources.length > 0 && selectedLiveSourceIds.size === liveSources.length

  const applySources = (nextSources: VodSourceConfig[]): void => {
    const sourceIds = new Set(nextSources.map((source) => source.id))
    setSources(nextSources)
    setSelectedSourceIds((current) => new Set([...current].filter((id) => sourceIds.has(id))))
  }

  const applyLiveSources = (nextSources: LiveSourceConfig[]): void => {
    const sourceIds = new Set(nextSources.map((source) => source.id))
    setLiveSources(nextSources)
    setSelectedLiveSourceIds((current) => new Set([...current].filter((id) => sourceIds.has(id))))
  }

  const refreshSources = async (): Promise<void> => {
    applySources(await listSources())
  }

  const refreshLiveSources = async (): Promise<void> => {
    applyLiveSources(await listLiveSources())
  }

  useEffect(() => {
    let active = true

    void Promise.all([listSources(), listLiveSources(), getSettings()]).then(
      ([nextSources, nextLiveSources, settings]) => {
        if (!active) return
        applySources(nextSources)
        applyLiveSources(nextLiveSources)
        setSubscriptionUrl(settings?.subscriptionUrl ?? '')
        setGithubProxyRoute(resolveVisibleGitHubProxyRoute(settings?.githubProxyRoute))
      },
    )

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
      await Promise.all([refreshSources(), refreshLiveSources()])
      toast.success('订阅同步完成', {
        description: `VOD 新增 ${result.vod.created}，更新 ${result.vod.updated}；直播新增 ${result.live.created}，更新 ${result.live.updated}`,
      })
    } catch (error) {
      toast.error('订阅同步失败', {
        description: error instanceof Error ? error.message : String(error),
      })
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
      const settings = await updateSettings({
        githubProxyCustomPrefix: '',
        githubProxyRoute: routeToSave,
      })
      setGithubProxyRoute(resolveVisibleGitHubProxyRoute(settings.githubProxyRoute))
      toast.success('GitHub 代理设置已保存')
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
    const nextResults = results.reduce<Record<GitHubProxyRouteId, GitHubProxySpeedState>>(
      (current, result) => ({ ...current, [result.routeId]: result }),
      createIdleGitHubProxySpeedResults(),
    )
    const fastest = getFastestGitHubProxyResult(results)

    setSpeedResults(nextResults)
    setTestingRouteId(undefined)
    if (fastest) {
      await saveGitHubProxy(fastest.routeId)
      toast.success(`最快线路：${getGitHubProxyRouteLabel(fastest.routeId)}`)
    }
  }

  const importSources = async (): Promise<void> => {
    if (!apiAvailable) return

    try {
      const result = await importSourcesFromFile()
      if (result.cancelled) return

      toast.success('导入完成', {
        description: `新增 ${result.created.length}，覆盖 ${result.overwritten.length}，跳过 ${result.skipped.length}`,
      })
      await refreshSources()
    } catch (error) {
      toast.error('导入失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  const importLiveSources = async (): Promise<void> => {
    if (!apiAvailable) return

    try {
      const result = await importLiveSourcesFromFile()
      if (result.cancelled) return

      toast.success('导入完成', {
        description: `新增 ${result.created.length}，覆盖 ${result.overwritten.length}，跳过 ${result.skipped.length}`,
      })
      await refreshLiveSources()
    } catch (error) {
      toast.error('导入失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  const exportSources = async (): Promise<void> => {
    if (!apiAvailable) return

    try {
      const result = await exportSourcesToFile()
      if (result.cancelled) return
      toast.success('导出完成', { description: `已导出 ${result.count} 个点播源` })
    } catch (error) {
      toast.error('导出失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  const exportLiveSources = async (): Promise<void> => {
    if (!apiAvailable) return

    try {
      const result = await exportLiveSourcesToFile()
      if (result.cancelled) return
      toast.success('导出完成', { description: `已导出 ${result.count} 个直播源` })
    } catch (error) {
      toast.error('导出失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  const clearAllSources = async (): Promise<void> => {
    if (!apiAvailable || sources.length === 0) return

    setIsClearingSources(true)
    try {
      await clearSources()
      applySources([])
      toast.success('已清空全部点播源')
    } catch (error) {
      toast.error('清空失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsClearingSources(false)
    }
  }

  const clearAllLiveSources = async (): Promise<void> => {
    if (!apiAvailable || liveSources.length === 0) return

    setIsClearingLiveSources(true)
    try {
      await clearLiveSources()
      applyLiveSources([])
      toast.success('已清空全部直播源')
    } catch (error) {
      toast.error('清空失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsClearingLiveSources(false)
    }
  }

  const initializeData = async (): Promise<void> => {
    if (!apiAvailable) return

    setIsInitializingAppData(true)
    try {
      await initializeAppData()
      window.localStorage.clear()
      applySources([])
      applyLiveSources([])
      setSubscriptionUrl('')
      toast.success('初始化完成')
      window.setTimeout(() => window.location.reload(), 300)
    } catch (error) {
      toast.error('初始化失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsInitializingAppData(false)
    }
  }

  const exportData = async (): Promise<void> => {
    if (!apiAvailable) return

    setIsExportingAppData(true)
    try {
      const result = await exportAppData({ searchHistory: loadSearchHistoriesForBackup() })
      if (result.cancelled) return

      toast.success('导出完成', {
        description: `VOD ${result.counts.vod}，直播 ${result.counts.live}，最近观看 ${result.counts.recent}，收藏 ${result.counts.favorites}`,
      })
    } catch (error) {
      toast.error('导出失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsExportingAppData(false)
    }
  }

  const importData = async (): Promise<void> => {
    if (!apiAvailable) return

    setIsImportingAppData(true)
    try {
      const result = await importAppData()
      if (result.cancelled) return

      window.localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(result.searchHistory))
      toast.success('导入完成', {
        description: `VOD ${result.counts.vod}，直播 ${result.counts.live}，最近观看 ${result.counts.recent}，收藏 ${result.counts.favorites}`,
      })
      window.setTimeout(() => window.location.reload(), 300)
    } catch (error) {
      toast.error('导入失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsImportingAppData(false)
    }
  }

  const deleteSourceItem = async (source: VodSourceConfig): Promise<void> => {
    if (!apiAvailable) return

    try {
      await deleteSource(source.id)
      toast.success('已删除点播源')
      await refreshSources()
    } catch (error) {
      toast.error('删除失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  const deleteLiveSourceItem = async (source: LiveSourceConfig): Promise<void> => {
    if (!apiAvailable) return

    try {
      await deleteLiveSource(source.id)
      toast.success('已删除直播源')
      await refreshLiveSources()
    } catch (error) {
      toast.error('删除失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  const toggleSource = async (source: VodSourceConfig, enabled: boolean): Promise<void> => {
    if (!apiAvailable) return

    const previousSources = sources
    setSources((current) => current.map((item) => (item.id === source.id ? { ...item, enabled } : item)))

    try {
      await updateSource(source.id, {
        name: source.name,
        url: source.url,
        referer: source.referer,
        enabled,
      })
    } catch (error) {
      setSources(previousSources)
      toast.error('状态更新失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  const toggleLiveSource = async (source: LiveSourceConfig, enabled: boolean): Promise<void> => {
    if (!apiAvailable) return

    const previousSources = liveSources
    setLiveSources((current) => current.map((item) => (item.id === source.id ? { ...item, enabled } : item)))

    try {
      await updateLiveSource(source.id, {
        name: source.name,
        url: source.url,
        enabled,
      })
    } catch (error) {
      setLiveSources(previousSources)
      toast.error('状态更新失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  const toggleSourceSelection = (sourceId: string): void => {
    setSelectedSourceIds((current) => toggleId(current, sourceId))
  }

  const toggleLiveSourceSelection = (sourceId: string): void => {
    setSelectedLiveSourceIds((current) => toggleId(current, sourceId))
  }

  const toggleAllSources = (): void => {
    setSelectedSourceIds(allSelected ? new Set() : new Set(sources.map((source) => source.id)))
  }

  const toggleAllLiveSources = (): void => {
    setSelectedLiveSourceIds(allLiveSelected ? new Set() : new Set(liveSources.map((source) => source.id)))
  }

  const batchToggleSources = async (enabled: boolean): Promise<void> => {
    const selectedSources = sources.filter((source) => selectedSourceIds.has(source.id))
    if (!apiAvailable || selectedSources.length === 0) return

    setIsBatchUpdating(true)
    setSources((current) =>
      current.map((source) => (selectedSourceIds.has(source.id) ? { ...source, enabled } : source)),
    )

    const results = await Promise.allSettled(
      selectedSources.map((source) =>
        updateSource(source.id, {
          name: source.name,
          url: source.url,
          referer: source.referer,
          enabled,
        }),
      ),
    )
    const failedCount = results.filter((result) => result.status === 'rejected').length

    await refreshSources()
    setIsBatchUpdating(false)

    if (failedCount > 0) {
      toast.error('部分状态更新失败', { description: `${failedCount} 个点播源未能更新，请稍后重试。` })
    } else {
      toast.success(`已${enabled ? '开启' : '关闭'} ${selectedSources.length} 个点播源`)
    }
  }

  const batchToggleLiveSources = async (enabled: boolean): Promise<void> => {
    const selectedSources = liveSources.filter((source) => selectedLiveSourceIds.has(source.id))
    if (!apiAvailable || selectedSources.length === 0) return

    setIsLiveBatchUpdating(true)
    setLiveSources((current) =>
      current.map((source) => (selectedLiveSourceIds.has(source.id) ? { ...source, enabled } : source)),
    )

    const results = await Promise.allSettled(
      selectedSources.map((source) =>
        updateLiveSource(source.id, {
          name: source.name,
          url: source.url,
          enabled,
        }),
      ),
    )
    const failedCount = results.filter((result) => result.status === 'rejected').length

    await refreshLiveSources()
    setIsLiveBatchUpdating(false)

    if (failedCount > 0) {
      toast.error('部分状态更新失败', { description: `${failedCount} 个直播源未能更新，请稍后重试。` })
    } else {
      toast.success(`已${enabled ? '开启' : '关闭'} ${selectedSources.length} 个直播源`)
    }
  }

  const resetDragState = (): void => {
    setDraggedSourceId(undefined)
    setDragOverSourceId(undefined)
  }

  const resetLiveDragState = (): void => {
    setDraggedLiveSourceId(undefined)
    setDragOverLiveSourceId(undefined)
  }

  const dropSource = async (targetSourceId: string): Promise<void> => {
    const activeSourceId = draggedSourceId
    resetDragState()

    if (!activeSourceId || activeSourceId === targetSourceId) return

    const nextSources = moveItem(sources, activeSourceId, targetSourceId)
    if (!nextSources) return

    const previousSources = sources
    setSources(nextSources)
    setIsReordering(true)

    try {
      applySources(await reorderSources(nextSources.map((source) => source.id)))
    } catch (error) {
      setSources(previousSources)
      toast.error('排序保存失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsReordering(false)
    }
  }

  const dropLiveSource = async (targetSourceId: string): Promise<void> => {
    const activeSourceId = draggedLiveSourceId
    resetLiveDragState()

    if (!activeSourceId || activeSourceId === targetSourceId) return

    const nextSources = moveItem(liveSources, activeSourceId, targetSourceId)
    if (!nextSources) return

    const previousSources = liveSources
    setLiveSources(nextSources)
    setIsReorderingLiveSources(true)

    try {
      applyLiveSources(await reorderLiveSources(nextSources.map((source) => source.id)))
    } catch (error) {
      setLiveSources(previousSources)
      toast.error('排序保存失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsReorderingLiveSources(false)
    }
  }

  return (
    <div className="min-h-full px-8 py-8">
      <header className="mb-7 pr-16">
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <h1 className="text-foreground text-3xl font-semibold tracking-tight">设置</h1>
        </div>
      </header>

      <div className="grid gap-5">
        <ThemeSettings />

        <NetworkSettingsCard
          apiAvailable={apiAvailable}
          isSaving={isSavingGitHubProxy}
          route={githubProxyRoute}
          speedResults={speedResults}
          testingRouteId={testingRouteId}
          onRouteChange={(routeId) => void saveGitHubProxy(routeId)}
          onTestAll={() => void testAllGitHubProxy()}
          onTestSingle={(routeId) => void testSingleGitHubProxy(routeId)}
        />

        <SettingsCard description="同步订阅源后会更新点播源、直播源。" title="订阅源管理">
          <div className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1">
              <span className="text-foreground mb-2 block text-sm font-medium">订阅地址</span>
              <Input
                disabled={!apiAvailable || isSyncingSubscription}
                placeholder="https://example.com/subscription"
                type="url"
                value={subscriptionUrl}
                onChange={(event) => setSubscriptionUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void syncSubscription()
                }}
              />
            </label>
            <Button
              className="sm:min-w-24"
              disabled={!apiAvailable || !subscriptionUrl.trim() || isSyncingSubscription}
              onClick={() => void syncSubscription()}
            >
              {isSyncingSubscription ? <RefreshCw className="animate-spin" size={16} /> : <Rss size={16} />}
              {isSyncingSubscription ? '同步中' : '同步'}
            </Button>
          </div>
        </SettingsCard>

        <SourceTableCard
          allSelected={allSelected}
          apiAvailable={apiAvailable}
          enabledCount={enabledCount}
          isBatchUpdating={isBatchUpdating}
          isClearing={isClearingSources}
          isReordering={isReordering}
          sources={sources}
          selectedSourceIds={selectedSourceIds}
          draggedSourceId={draggedSourceId}
          dragOverSourceId={dragOverSourceId}
          onAdd={() => setDialog({ mode: 'create' })}
          onBatchToggle={(enabled) => void batchToggleSources(enabled)}
          onClear={() => setConfirmState({ type: 'clearSources' })}
          onDelete={(source) => setConfirmState({ type: 'deleteSource', source })}
          onDrop={(id) => void dropSource(id)}
          onDragEnd={resetDragState}
          onDragOver={setDragOverSourceId}
          onDragStart={setDraggedSourceId}
          onEdit={(source) => setDialog({ mode: 'edit', source })}
          onExport={() => void exportSources()}
          onImport={() => void importSources()}
          onToggle={toggleSource}
          onToggleAll={toggleAllSources}
          onToggleSelection={toggleSourceSelection}
        />

        <LiveSourceTableCard
          allSelected={allLiveSelected}
          apiAvailable={apiAvailable}
          enabledCount={liveEnabledCount}
          isBatchUpdating={isLiveBatchUpdating}
          isClearing={isClearingLiveSources}
          isReordering={isReorderingLiveSources}
          sources={liveSources}
          selectedSourceIds={selectedLiveSourceIds}
          draggedSourceId={draggedLiveSourceId}
          dragOverSourceId={dragOverLiveSourceId}
          onAdd={() => setLiveSourceDialog({ mode: 'create' })}
          onBatchToggle={(enabled) => void batchToggleLiveSources(enabled)}
          onClear={() => setConfirmState({ type: 'clearLiveSources' })}
          onDelete={(source) => setConfirmState({ type: 'deleteLiveSource', source })}
          onDrop={(id) => void dropLiveSource(id)}
          onDragEnd={resetLiveDragState}
          onDragOver={setDragOverLiveSourceId}
          onDragStart={setDraggedLiveSourceId}
          onEdit={(source) => setLiveSourceDialog({ mode: 'edit', source })}
          onExport={() => void exportLiveSources()}
          onImport={() => void importLiveSources()}
          onToggle={toggleLiveSource}
          onToggleAll={toggleAllLiveSources}
          onToggleSelection={toggleLiveSourceSelection}
        />

        <SettingsCard description="备份、恢复数据。" title="数据管理">
          <div className="flex items-center gap-4 px-5 py-5">
            <Button disabled={!apiAvailable || isExportingAppData} variant="outline" onClick={() => void exportData()}>
              <Download size={16} />
              {isExportingAppData ? '导出中' : '导出数据'}
            </Button>
            <Button
              disabled={!apiAvailable || isImportingAppData}
              variant="outline"
              onClick={() => setConfirmState({ type: 'importAppData' })}
            >
              <Upload size={16} />
              {isImportingAppData ? '导入中' : '导入数据'}
            </Button>

            <Button
              className="ml-auto"
              disabled={!apiAvailable || isInitializingAppData}
              variant="destructive"
              onClick={() => setConfirmState({ type: 'initializeAppData' })}
            >
              <Trash2 size={16} />
              {isInitializingAppData ? '初始化中' : '初始化'}
            </Button>
          </div>
        </SettingsCard>
      </div>

      {dialog ? (
        <SourceDialog
          dialog={dialog}
          onClose={() => setDialog(undefined)}
          onSaved={async () => {
            setDialog(undefined)
            await refreshSources()
          }}
        />
      ) : null}

      {liveSourceDialog ? (
        <LiveSourceDialog
          dialog={liveSourceDialog}
          onClose={() => setLiveSourceDialog(undefined)}
          onSaved={async () => {
            setLiveSourceDialog(undefined)
            await refreshLiveSources()
          }}
        />
      ) : null}

      {confirmState ? (
        <ConfirmDialog
          confirmText={
            confirmState.type === 'clearSources' || confirmState.type === 'clearLiveSources'
              ? '清空'
              : confirmState.type === 'initializeAppData'
                ? '初始化'
                : confirmState.type === 'importAppData'
                  ? '导入'
                  : '删除'
          }
          description={getConfirmDescription(confirmState, sources.length, liveSources.length)}
          title={getConfirmTitle(confirmState)}
          onCancel={() => setConfirmState(undefined)}
          onConfirm={async () => {
            if (confirmState.type === 'clearSources') {
              await clearAllSources()
            } else if (confirmState.type === 'clearLiveSources') {
              await clearAllLiveSources()
            } else if (confirmState.type === 'initializeAppData') {
              await initializeData()
            } else if (confirmState.type === 'importAppData') {
              await importData()
            } else if (confirmState.type === 'deleteSource') {
              await deleteSourceItem(confirmState.source)
            } else {
              await deleteLiveSourceItem(confirmState.source)
            }
            setConfirmState(undefined)
          }}
        />
      ) : null}
    </div>
  )
}

function SourceTableCard({
  allSelected,
  apiAvailable,
  draggedSourceId,
  dragOverSourceId,
  enabledCount,
  isBatchUpdating,
  isClearing,
  isReordering,
  selectedSourceIds,
  sources,
  onAdd,
  onBatchToggle,
  onClear,
  onDelete,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onEdit,
  onExport,
  onImport,
  onToggle,
  onToggleAll,
  onToggleSelection,
}: {
  allSelected: boolean
  apiAvailable: boolean
  draggedSourceId?: string
  dragOverSourceId?: string
  enabledCount: number
  isBatchUpdating: boolean
  isClearing: boolean
  isReordering: boolean
  selectedSourceIds: Set<string>
  sources: VodSourceConfig[]
  onAdd: () => void
  onBatchToggle: (enabled: boolean) => void
  onClear: () => void
  onDelete: (source: VodSourceConfig) => void
  onDragEnd: () => void
  onDragOver: (sourceId: string) => void
  onDragStart: (sourceId: string) => void
  onDrop: (sourceId: string) => void
  onEdit: (source: VodSourceConfig) => void
  onExport: () => void
  onImport: () => void
  onToggle: (source: VodSourceConfig, enabled: boolean) => void
  onToggleAll: () => void
  onToggleSelection: (sourceId: string) => void
}): React.JSX.Element {
  return (
    <SettingsCard
      description="管理应用的点播源。"
      headerActions={
        <div className="flex flex-wrap gap-2">
          <Badge>{sources.length} 个源</Badge>
          <Badge className="border-primary bg-accent text-primary">{enabledCount} 个启用</Badge>
        </div>
      }
      title="点播源"
    >
      <SourceToolbar
        addText="添加点播源"
        apiAvailable={apiAvailable}
        clearText={isClearing ? '清空中' : '清空'}
        hasItems={sources.length > 0}
        isBatchUpdating={isBatchUpdating}
        selectedCount={selectedSourceIds.size}
        onAdd={onAdd}
        onBatchToggle={onBatchToggle}
        onClear={onClear}
        onExport={onExport}
        onImport={onImport}
      />

      {sources.length > 0 ? (
        <div className="h-[460px] overflow-auto">
          <div className="min-w-[900px]">
            <TableHeader allSelected={allSelected} onToggleAll={onToggleAll} />
            {sources.map((source) => (
              <div
                key={source.id}
                className={rowClassName(draggedSourceId, dragOverSourceId, source.id)}
                onDragOver={(event) => {
                  if (!draggedSourceId || draggedSourceId === source.id) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  onDragOver(source.id)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  onDrop(source.id)
                }}
              >
                <DragHandle
                  disabled={isReordering}
                  label={`拖拽调整 ${source.name} 的顺序`}
                  onDragEnd={onDragEnd}
                  onDragStart={() => onDragStart(source.id)}
                />
                <SelectionCheckbox
                  checked={selectedSourceIds.has(source.id)}
                  label={`选择 ${source.name}`}
                  onChange={() => onToggleSelection(source.id)}
                />
                <StatusCell checked={source.enabled} onCheckedChange={(checked) => onToggle(source, checked)} />
                <OriginCell origin={source.origin} />
                <NameCell name={source.name} />
                <div className="text-muted-foreground min-w-0 truncate font-mono text-xs">{source.url}</div>
                <ActionCell onDelete={() => onDelete(source)} onEdit={() => onEdit(source)} />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyTableState text="暂无数据" />
      )}
    </SettingsCard>
  )
}

function NetworkSettingsCard({
  apiAvailable,
  isSaving,
  route,
  speedResults,
  testingRouteId,
  onRouteChange,
  onTestAll,
  onTestSingle,
}: {
  apiAvailable: boolean
  isSaving: boolean
  route: GitHubProxyRouteId
  speedResults: Record<GitHubProxyRouteId, GitHubProxySpeedState>
  testingRouteId?: GitHubProxyRouteId
  onRouteChange: (routeId: GitHubProxyRouteId) => void
  onTestAll: () => void
  onTestSingle: (routeId: GitHubProxyRouteId) => void
}): React.JSX.Element {
  const isTestingAll =
    testingRouteId === DEFAULT_GITHUB_PROXY_ROUTE_ID &&
    Object.values(speedResults).every((result) => result.status === 'testing')
  const selectedRoute = GITHUB_PROXY_ROUTES.find((item) => item.id === route)
  const selectedRouteLabel = selectedRoute?.label ?? getGitHubProxyRouteLabel(route)

  return (
    <SettingsCard description="管理应用内网络访问、代理与连接探测。" title="网络">
      <div className="flex flex-col gap-5 px-5 py-5">
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-foreground text-sm font-semibold">GitHub 代理</h3>
              <p className="text-muted-foreground mt-1 text-sm">用于 GitHub 链接、更新检查与更新下载。</p>
            </div>
            <Button disabled={!apiAvailable || isSaving || isTestingAll} variant="outline" onClick={onTestAll}>
              {isTestingAll ? <RefreshCw className="animate-spin" /> : <Gauge />}
              {isTestingAll ? '测速中' : '自动优选'}
            </Button>
          </div>

          <div className="grid items-center gap-x-6 gap-y-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <Select
              disabled={!apiAvailable || isSaving || isTestingAll}
              value={route}
              onValueChange={(value) => onRouteChange(value as GitHubProxyRouteId)}
            >
              <SelectTrigger className="bg-background w-full">
                <SelectValue placeholder="选择 GitHub 代理线路" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {GITHUB_PROXY_ROUTES.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <ProxySpeedAction
              disabled={!apiAvailable || isSaving || isTestingAll}
              result={speedResults[route]}
              testing={testingRouteId === route}
              onTest={() => onTestSingle(route)}
            />
          </div>

          <Alert className="border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            <AlertDescription className="font-medium text-current">当前线路：{selectedRouteLabel}</AlertDescription>
          </Alert>
        </section>
      </div>
    </SettingsCard>
  )
}

function ProxySpeedAction({
  className,
  disabled,
  result,
  testing,
  onTest,
}: {
  className?: string
  disabled: boolean
  result: GitHubProxySpeedState
  testing: boolean
  onTest: () => void
}): React.JSX.Element {
  return (
    <div className={`flex shrink-0 items-center justify-end gap-2 self-center ${className ?? ''}`}>
      <SpeedResultTag result={result} />
      <Button disabled={disabled || testing} variant="outline" onClick={onTest}>
        {testing ? <RefreshCw className="animate-spin" /> : <Gauge />}
        测速
      </Button>
    </div>
  )
}

function LiveSourceTableCard({
  allSelected,
  apiAvailable,
  draggedSourceId,
  dragOverSourceId,
  enabledCount,
  isBatchUpdating,
  isClearing,
  isReordering,
  selectedSourceIds,
  sources,
  onAdd,
  onBatchToggle,
  onClear,
  onDelete,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onEdit,
  onExport,
  onImport,
  onToggle,
  onToggleAll,
  onToggleSelection,
}: {
  allSelected: boolean
  apiAvailable: boolean
  draggedSourceId?: string
  dragOverSourceId?: string
  enabledCount: number
  isBatchUpdating: boolean
  isClearing: boolean
  isReordering: boolean
  selectedSourceIds: Set<string>
  sources: LiveSourceConfig[]
  onAdd: () => void
  onBatchToggle: (enabled: boolean) => void
  onClear: () => void
  onDelete: (source: LiveSourceConfig) => void
  onDragEnd: () => void
  onDragOver: (sourceId: string) => void
  onDragStart: (sourceId: string) => void
  onDrop: (sourceId: string) => void
  onEdit: (source: LiveSourceConfig) => void
  onExport: () => void
  onImport: () => void
  onToggle: (source: LiveSourceConfig, enabled: boolean) => void
  onToggleAll: () => void
  onToggleSelection: (sourceId: string) => void
}): React.JSX.Element {
  return (
    <SettingsCard
      description="管理应用的直播源。"
      headerActions={
        <div className="flex flex-wrap gap-2">
          <Badge>{sources.length} 个源</Badge>
          <Badge className="border-primary bg-accent text-primary">{enabledCount} 个启用</Badge>
        </div>
      }
      title="直播源"
    >
      <SourceToolbar
        addText="添加直播源"
        apiAvailable={apiAvailable}
        clearText={isClearing ? '清空中' : '清空'}
        hasItems={sources.length > 0}
        isBatchUpdating={isBatchUpdating}
        selectedCount={selectedSourceIds.size}
        onAdd={onAdd}
        onBatchToggle={onBatchToggle}
        onClear={onClear}
        onExport={onExport}
        onImport={onImport}
      />

      {sources.length > 0 ? (
        <div className="h-[360px] overflow-auto">
          <div className="min-w-[900px]">
            <TableHeader allSelected={allSelected} onToggleAll={onToggleAll} />
            {sources.map((source) => (
              <div
                key={source.id}
                className={rowClassName(draggedSourceId, dragOverSourceId, source.id)}
                onDragOver={(event) => {
                  if (!draggedSourceId || draggedSourceId === source.id) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  onDragOver(source.id)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  onDrop(source.id)
                }}
              >
                <DragHandle
                  disabled={isReordering}
                  label={`拖拽调整 ${source.name} 的顺序`}
                  onDragEnd={onDragEnd}
                  onDragStart={() => onDragStart(source.id)}
                />
                <SelectionCheckbox
                  checked={selectedSourceIds.has(source.id)}
                  label={`选择 ${source.name}`}
                  onChange={() => onToggleSelection(source.id)}
                />
                <StatusCell checked={source.enabled} onCheckedChange={(checked) => onToggle(source, checked)} />
                <OriginCell origin={source.origin} />
                <NameCell name={source.name} />
                <div className="text-muted-foreground min-w-0 truncate font-mono text-xs">{source.url}</div>
                <ActionCell onDelete={() => onDelete(source)} onEdit={() => onEdit(source)} />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyTableState text="暂无直播源" />
      )}
    </SettingsCard>
  )
}

function SourceToolbar({
  addText,
  apiAvailable,
  clearText,
  hasItems,
  isBatchUpdating,
  selectedCount,
  onAdd,
  onBatchToggle,
  onClear,
  onExport,
  onImport,
}: {
  addText: string
  apiAvailable: boolean
  clearText: string
  hasItems: boolean
  isBatchUpdating: boolean
  selectedCount: number
  onAdd: () => void
  onBatchToggle: (enabled: boolean) => void
  onClear: () => void
  onExport: () => void
  onImport: () => void
}): React.JSX.Element {
  return (
    <div className="border-border flex flex-wrap gap-2 border-b px-5 py-5">
      <Button
        disabled={!apiAvailable || selectedCount === 0 || isBatchUpdating}
        variant="outline"
        onClick={() => onBatchToggle(true)}
      >
        批量开启{selectedCount > 0 ? ` (${selectedCount})` : ''}
      </Button>
      <Button
        disabled={!apiAvailable || selectedCount === 0 || isBatchUpdating}
        variant="outline"
        onClick={() => onBatchToggle(false)}
      >
        批量关闭{selectedCount > 0 ? ` (${selectedCount})` : ''}
      </Button>

      <div className="ml-auto" />
      <Button disabled={!apiAvailable} variant="outline" onClick={onImport}>
        <Upload size={16} />
        批量导入
      </Button>
      <Button disabled={!apiAvailable} variant="outline" onClick={onExport}>
        <Download size={16} />
        批量导出
      </Button>
      <Button disabled={!apiAvailable} onClick={onAdd}>
        <Plus size={16} />
        {addText}
      </Button>
      <Button disabled={!apiAvailable || !hasItems || clearText === '清空中'} variant="destructive" onClick={onClear}>
        <Trash2 size={16} />
        {clearText}
      </Button>
    </div>
  )
}

function TableHeader({
  allSelected,
  onToggleAll,
}: {
  allSelected: boolean
  onToggleAll: () => void
}): React.JSX.Element {
  return (
    <div className="border-border bg-muted text-muted-foreground sticky top-0 z-10 grid grid-cols-[32px_40px_112px_80px_1.1fr_2fr_132px] items-center border-b px-5 py-3 font-medium">
      <div aria-hidden="true" />
      <SelectionCheckbox checked={allSelected} label={allSelected ? '取消全选' : '全选点播源'} onChange={onToggleAll} />
      <div>状态</div>
      <div>来源</div>
      <div>名称</div>
      <div>URL</div>
      <div className="text-right">操作</div>
    </div>
  )
}

function DragHandle({
  disabled,
  label,
  onDragEnd,
  onDragStart,
}: {
  disabled: boolean
  label: string
  onDragEnd: () => void
  onDragStart: () => void
}): React.JSX.Element {
  return (
    <button
      aria-label={label}
      className="text-muted-foreground hover:text-foreground flex size-7 cursor-grab items-center justify-center rounded-lg active:cursor-grabbing disabled:cursor-default"
      disabled={disabled}
      draggable={!disabled}
      title="拖拽调整顺序"
      type="button"
      onDragEnd={onDragEnd}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
    >
      <GripVertical size={16} />
    </button>
  )
}

function SelectionCheckbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: () => void
}): React.JSX.Element {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="border-input bg-background text-primary focus-visible:ring-ring flex size-5 items-center justify-center rounded-xl border outline-none focus-visible:ring-2"
      role="checkbox"
      type="button"
      onClick={onChange}
    >
      {checked ? <Check size={14} strokeWidth={3} /> : null}
    </button>
  )
}

function StatusCell({
  checked,
  onCheckedChange,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <Switch aria-label={checked ? '开启' : '关闭'} checked={checked} onCheckedChange={onCheckedChange} />
      <span className="text-muted-foreground text-xs">{checked ? '开启' : '关闭'}</span>
    </div>
  )
}

function OriginCell({ origin }: { origin: VodSourceConfig['origin'] | LiveSourceConfig['origin'] }): React.JSX.Element {
  return <Badge>{origin === 'subscription' ? '订阅' : '手动'}</Badge>
}

function NameCell({ name }: { name: string }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-foreground truncate text-sm font-medium">{name}</div>
    </div>
  )
}

function ActionCell({ onDelete, onEdit }: { onDelete: () => void; onEdit: () => void }): React.JSX.Element {
  return (
    <div className="flex justify-end gap-2">
      <Button className="h-8 px-2" title="编辑" variant="ghost" onClick={onEdit}>
        <Pencil size={15} />
      </Button>
      <Button className="h-8 px-2" title="删除" variant="destructive" onClick={onDelete}>
        <Trash2 size={15} />
      </Button>
    </div>
  )
}

function EmptyTableState({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="px-5 py-6">
      <div className="border-input rounded-xl p-10 text-center">
        <div className="text-muted-foreground text-sm font-semibold">{text}</div>
      </div>
    </div>
  )
}

function SourceDialog({
  dialog,
  onClose,
  onSaved,
}: {
  dialog: SourceDialogState
  onClose: () => void
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const [form, setForm] = useState<VodSourceInput>(() =>
    dialog.mode === 'edit'
      ? {
          name: dialog.source.name,
          url: dialog.source.url,
          referer: dialog.source.referer,
          enabled: dialog.source.enabled,
        }
      : emptySourceInput,
  )
  const [isSaving, setIsSaving] = useState(false)
  const title = dialog.mode === 'create' ? '添加点播源' : '编辑点播源'

  const save = async (): Promise<void> => {
    if (!isApiAvailable()) return

    setIsSaving(true)

    try {
      if (dialog.mode === 'create') {
        await createSource(form)
      } else {
        await updateSource(dialog.source.id, form)
      }

      toast.success(dialog.mode === 'create' ? '点播源已添加' : '点播源已更新')
      await onSaved()
    } catch (error) {
      toast.error('保存失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="bg-background/45 fixed inset-0 z-50 flex items-center justify-center px-4 backdrop-blur-sm">
      <div className="border-border bg-card w-full max-w-lg rounded-xl border p-5 shadow-sm">
        <div className="mb-5">
          <h2 className="text-foreground text-lg font-semibold">{title}</h2>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="text-foreground text-sm font-medium">名称</span>
            <Input
              className="mt-2"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </label>

          <label className="block">
            <span className="text-foreground text-sm font-medium">URL</span>
            <Input
              className="mt-2 font-mono text-xs"
              value={form.url}
              onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
            />
          </label>

          <label className="block">
            <span className="text-foreground text-sm font-medium">Referer</span>
            <Input
              className="mt-2 font-mono text-xs"
              placeholder="https://example.com"
              value={form.referer ?? ''}
              onChange={(event) => setForm((current) => ({ ...current, referer: event.target.value || undefined }))}
            />
          </label>

          <label className="border-border bg-muted flex items-center justify-between gap-4 rounded-xl border px-3 py-3">
            <span>
              <span className="text-foreground block text-sm font-medium">是否开启</span>
              <span className="text-muted-foreground text-xs">关闭后不会参与聚合搜索。</span>
            </span>
            <Switch
              checked={form.enabled ?? false}
              onCheckedChange={(checked) => setForm((current) => ({ ...current, enabled: checked }))}
            />
          </label>
        </div>

        <DialogActions isSaving={isSaving} onClose={onClose} onSave={() => void save()} />
      </div>
    </div>
  )
}

function LiveSourceDialog({
  dialog,
  onClose,
  onSaved,
}: {
  dialog: LiveSourceDialogState
  onClose: () => void
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const [form, setForm] = useState<LiveSourceInput>(() =>
    dialog.mode === 'edit'
      ? {
          name: dialog.source.name,
          url: dialog.source.url,
          enabled: dialog.source.enabled,
        }
      : emptyLiveSourceInput,
  )
  const [isSaving, setIsSaving] = useState(false)
  const title = dialog.mode === 'create' ? '添加直播源' : '编辑直播源'

  const save = async (): Promise<void> => {
    if (!isApiAvailable()) return

    setIsSaving(true)

    try {
      if (dialog.mode === 'create') {
        await createLiveSource(form)
      } else {
        await updateLiveSource(dialog.source.id, form)
      }

      toast.success(dialog.mode === 'create' ? '直播源已添加' : '直播源已更新')
      await onSaved()
    } catch (error) {
      toast.error('保存失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="bg-background/45 fixed inset-0 z-50 flex items-center justify-center px-4 backdrop-blur-sm">
      <div className="border-border bg-card w-full max-w-lg rounded-xl border p-5 shadow-sm">
        <div className="mb-5">
          <h2 className="text-foreground text-lg font-semibold">{title}</h2>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="text-foreground text-sm font-medium">名称</span>
            <Input
              className="mt-2"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </label>

          <label className="block">
            <span className="text-foreground text-sm font-medium">URL</span>
            <Input
              className="mt-2 font-mono text-xs"
              placeholder="https://example.com/live.m3u"
              type="url"
              value={form.url}
              onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void save()
              }}
            />
          </label>

          <label className="border-border bg-muted flex items-center justify-between gap-4 rounded-xl border px-3 py-3">
            <span>
              <span className="text-foreground block text-sm font-medium">是否开启</span>
              <span className="text-muted-foreground text-xs">关闭后不会在直播页选择。</span>
            </span>
            <Switch
              checked={form.enabled ?? true}
              onCheckedChange={(checked) => setForm((current) => ({ ...current, enabled: checked }))}
            />
          </label>
        </div>

        <DialogActions isSaving={isSaving} onClose={onClose} onSave={() => void save()} />
      </div>
    </div>
  )
}

function DialogActions({
  isSaving,
  onClose,
  onSave,
}: {
  isSaving: boolean
  onClose: () => void
  onSave: () => void
}): React.JSX.Element {
  return (
    <div className="mt-6 flex justify-end gap-2">
      <Button variant="ghost" onClick={onClose}>
        取消
      </Button>
      <Button disabled={isSaving} onClick={onSave}>
        {isSaving ? '保存中...' : '保存'}
      </Button>
    </div>
  )
}

function toggleId(current: Set<string>, id: string): Set<string> {
  const next = new Set(current)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

function moveItem<T extends { id: string }>(items: T[], activeId: string, targetId: string): T[] | undefined {
  const fromIndex = items.findIndex((item) => item.id === activeId)
  const toIndex = items.findIndex((item) => item.id === targetId)

  if (fromIndex < 0 || toIndex < 0) return undefined

  const nextItems = [...items]
  const [movedItem] = nextItems.splice(fromIndex, 1)

  if (!movedItem) return undefined

  nextItems.splice(toIndex, 0, movedItem)
  return nextItems
}

function createIdleGitHubProxySpeedResults(): Record<GitHubProxyRouteId, GitHubProxySpeedState> {
  const routeIds: GitHubProxyRouteId[] = [...GITHUB_PROXY_ROUTES.map((route) => route.id), CUSTOM_GITHUB_PROXY_ROUTE_ID]
  return Object.fromEntries(routeIds.map((routeId) => [routeId, { status: 'idle' }])) as Record<
    GitHubProxyRouteId,
    GitHubProxySpeedState
  >
}

function getFastestGitHubProxyResult(results: GitHubProxyTestResult[]): GitHubProxyTestResult | undefined {
  return results.reduce<GitHubProxyTestResult | undefined>((fastest, result) => {
    if (result.status !== 'success' || typeof result.elapsedMs !== 'number') return fastest
    if (!fastest || typeof fastest.elapsedMs !== 'number' || result.elapsedMs < fastest.elapsedMs) return result
    return fastest
  }, undefined)
}

function resolveVisibleGitHubProxyRoute(routeId: GitHubProxyRouteId | undefined): GitHubProxyRouteId {
  if (!routeId || routeId === CUSTOM_GITHUB_PROXY_ROUTE_ID) return DEFAULT_GITHUB_PROXY_ROUTE_ID
  return routeId
}
function getGitHubProxyRouteLabel(routeId: GitHubProxyRouteId): string {
  if (routeId === CUSTOM_GITHUB_PROXY_ROUTE_ID) return '自定义代理'

  return GITHUB_PROXY_ROUTES.find((item) => item.id === routeId)?.label ?? routeId
}

function formatSpeedResult(result: GitHubProxySpeedState | undefined): string {
  if (!result || result.status === 'idle') return '待测速'
  if (result.status === 'testing') return '测速中'
  if (result.status === 'error') return result.errorMessage ?? '不可用'
  return typeof result.elapsedMs === 'number' ? `${result.elapsedMs} ms` : '未知'
}

function SpeedResultTag({ result }: { result: GitHubProxySpeedState | undefined }): React.JSX.Element {
  return (
    <Badge className={getSpeedResultTagClassName(result)} variant="secondary">
      {formatSpeedResult(result)}
    </Badge>
  )
}

function getSpeedResultTagClassName(result: GitHubProxySpeedState | undefined): string {
  if (!result || result.status === 'idle') {
    return 'bg-muted text-muted-foreground'
  }

  if (result.status === 'testing') {
    return 'bg-primary/10 text-primary'
  }

  if (result.status === 'error') {
    return 'bg-destructive/10 text-destructive'
  }

  if (typeof result.elapsedMs !== 'number') {
    return 'bg-muted text-muted-foreground'
  }

  if (result.elapsedMs <= 800) {
    return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  }

  if (result.elapsedMs <= 2000) {
    return 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400'
  }

  return 'bg-orange-500/15 text-orange-700 dark:text-orange-400'
}

function rowClassName(draggedId: string | undefined, dragOverId: string | undefined, sourceId: string): string {
  const base =
    'border-border grid grid-cols-[32px_40px_112px_80px_1.1fr_2fr_132px] items-center border-b px-5 py-4 transition-colors last:border-b-0'

  if (draggedId === sourceId) return `${base} opacity-55`
  if (dragOverId === sourceId) return `${base} bg-accent/60`
  return `${base} hover:bg-muted`
}

function getConfirmTitle(confirmState: ConfirmState): string {
  if (confirmState.type === 'clearSources') return '清空点播源'
  if (confirmState.type === 'clearLiveSources') return '清空直播源'
  if (confirmState.type === 'initializeAppData') return '初始化应用数据'
  if (confirmState.type === 'importAppData') return '导入应用数据'
  if (confirmState.type === 'deleteSource') return '删除点播源'
  return '删除直播源'
}

function getConfirmDescription(confirmState: ConfirmState, sourceCount: number, liveSourceCount: number): string {
  if (confirmState.type === 'clearSources') {
    return `确定清空全部 ${sourceCount} 个点播源吗？此操作不可恢复。`
  }

  if (confirmState.type === 'clearLiveSources') {
    return `确定清空全部 ${liveSourceCount} 个直播源吗？此操作不可恢复。`
  }

  if (confirmState.type === 'initializeAppData') {
    return '确定初始化吗？这会清空设置、VOD 源、直播源、最近播放、收藏、搜索历史和本地缓存，回到新安装状态。此操作不可恢复。'
  }

  if (confirmState.type === 'importAppData') {
    return '确定导入应用数据吗？导入会覆盖当前订阅、VOD 源、直播源、最近播放、收藏和搜索历史，不会合并当前数据。'
  }

  if (confirmState.type === 'deleteSource') {
    return `确定删除点播源「${confirmState.source.name}」吗？`
  }

  return `确定删除直播源「${confirmState.source.name}」吗？`
}

function loadSearchHistoriesForBackup(): string[] {
  try {
    const raw = window.localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}
