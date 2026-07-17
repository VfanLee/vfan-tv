import { useState } from 'react'
import { ConfirmDialog, ThemeSettings } from '@renderer/components'
import { isApiAvailable } from '@renderer/services/api'
import { DataManagementCard, NetworkSettingsCard, SubscriptionSettingsCard } from './components/settings-cards'
import { LiveSourceDialog, SourceDialog } from './components/source-dialogs'
import { SourceTableCard } from './components/source-table-card'
import { useAppData } from './hooks/use-app-data'
import { useGeneralSettings } from './hooks/use-general-settings'
import { useLiveSources } from './hooks/use-live-sources'
import { useVodSources } from './hooks/use-vod-sources'
import type { ConfirmState, LiveSourceDialogState, SourceDialogState } from './types'
import { getConfirmDescription, getConfirmTitle } from './utils'

// 设置页负责协调各设置领域 hook；具体数据读写仍由对应 hook 和 main IPC 完成。
export function SettingsPage(): React.JSX.Element {
  const apiAvailable = isApiAvailable()
  const vod = useVodSources(apiAvailable)
  const live = useLiveSources(apiAvailable)
  const general = useGeneralSettings({
    apiAvailable,
    refreshLiveSources: live.refresh,
    refreshVodSources: vod.refresh,
  })
  const appData = useAppData({
    apiAvailable,
    resetLiveSources: () => live.applySources([]),
    resetSubscription: general.resetSubscription,
    resetVodSources: () => vod.applySources([]),
  })
  const [dialog, setDialog] = useState<SourceDialogState>()
  const [liveSourceDialog, setLiveSourceDialog] = useState<LiveSourceDialogState>()
  const [confirmState, setConfirmState] = useState<ConfirmState>()

  const confirm = async (): Promise<void> => {
    if (!confirmState) return
    if (confirmState.type === 'clearSources') await vod.clearAll()
    else if (confirmState.type === 'clearLiveSources') await live.clearAll()
    else if (confirmState.type === 'initializeAppData') await appData.initializeData()
    else if (confirmState.type === 'importAppData') await appData.importData()
    else if (confirmState.type === 'deleteSource') await vod.deleteItem(confirmState.source)
    else await live.deleteItem(confirmState.source)
    setConfirmState(undefined)
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
          isSaving={general.isSavingGitHubProxy}
          route={general.githubProxyRoute}
          speedResults={general.speedResults}
          testingRouteId={general.testingRouteId}
          onRouteChange={(routeId) => void general.saveGitHubProxy(routeId)}
          onTestAll={() => void general.testAllGitHubProxy()}
          onTestSingle={(routeId) => void general.testSingleGitHubProxy(routeId)}
        />

        <SubscriptionSettingsCard
          apiAvailable={apiAvailable}
          isSyncing={general.isSyncingSubscription}
          subscriptionUrl={general.subscriptionUrl}
          onChange={general.setSubscriptionUrl}
          onSync={() => void general.syncSubscription()}
        />

        <SourceTableCard
          addText="添加点播源"
          allSelected={vod.allSelected}
          apiAvailable={apiAvailable}
          description="管理应用的点播源。"
          draggedSourceId={vod.draggedSourceId}
          dragOverSourceId={vod.dragOverSourceId}
          emptyText="暂无数据"
          enabledCount={vod.enabledCount}
          heightClassName="h-[460px]"
          isBatchUpdating={vod.isBatchUpdating}
          isClearing={vod.isClearing}
          isReordering={vod.isReordering}
          selectedSourceIds={vod.selectedSourceIds}
          sources={vod.sources}
          title="点播源"
          onAdd={() => setDialog({ mode: 'create' })}
          onBatchToggle={(enabled) => void vod.batchToggle(enabled)}
          onClear={() => setConfirmState({ type: 'clearSources' })}
          onDelete={(source) => setConfirmState({ type: 'deleteSource', source })}
          onDragEnd={vod.resetDrag}
          onDragOver={vod.setDragOverSourceId}
          onDragStart={vod.setDraggedSourceId}
          onDrop={(sourceId) => void vod.drop(sourceId)}
          onEdit={(source) => setDialog({ mode: 'edit', source })}
          onExport={() => void vod.exportItems()}
          onImport={() => void vod.importItems()}
          onToggle={(source, enabled) => void vod.toggle(source, enabled)}
          onToggleAll={vod.toggleAll}
          onToggleSelection={vod.toggleSelection}
        />

        <SourceTableCard
          addText="添加直播源"
          allSelected={live.allSelected}
          apiAvailable={apiAvailable}
          description="管理应用的直播源。"
          draggedSourceId={live.draggedSourceId}
          dragOverSourceId={live.dragOverSourceId}
          emptyText="暂无直播源"
          enabledCount={live.enabledCount}
          heightClassName="h-[360px]"
          isBatchUpdating={live.isBatchUpdating}
          isClearing={live.isClearing}
          isReordering={live.isReordering}
          selectedSourceIds={live.selectedSourceIds}
          sources={live.sources}
          title="直播源"
          onAdd={() => setLiveSourceDialog({ mode: 'create' })}
          onBatchToggle={(enabled) => void live.batchToggle(enabled)}
          onClear={() => setConfirmState({ type: 'clearLiveSources' })}
          onDelete={(source) => setConfirmState({ type: 'deleteLiveSource', source })}
          onDragEnd={live.resetDrag}
          onDragOver={live.setDragOverSourceId}
          onDragStart={live.setDraggedSourceId}
          onDrop={(sourceId) => void live.drop(sourceId)}
          onEdit={(source) => setLiveSourceDialog({ mode: 'edit', source })}
          onExport={() => void live.exportItems()}
          onImport={() => void live.importItems()}
          onToggle={(source, enabled) => void live.toggle(source, enabled)}
          onToggleAll={live.toggleAll}
          onToggleSelection={live.toggleSelection}
        />

        <DataManagementCard
          apiAvailable={apiAvailable}
          isExporting={appData.isExporting}
          isImporting={appData.isImporting}
          isInitializing={appData.isInitializing}
          onExport={() => void appData.exportData()}
          onImport={() => setConfirmState({ type: 'importAppData' })}
          onInitialize={() => setConfirmState({ type: 'initializeAppData' })}
        />
      </div>

      {dialog ? (
        <SourceDialog
          dialog={dialog}
          onClose={() => setDialog(undefined)}
          onSaved={async () => {
            setDialog(undefined)
            await vod.refresh()
          }}
        />
      ) : null}

      {liveSourceDialog ? (
        <LiveSourceDialog
          dialog={liveSourceDialog}
          onClose={() => setLiveSourceDialog(undefined)}
          onSaved={async () => {
            setLiveSourceDialog(undefined)
            await live.refresh()
          }}
        />
      ) : null}

      {confirmState ? (
        <ConfirmDialog
          confirmText={getConfirmText(confirmState)}
          description={getConfirmDescription(confirmState, vod.sources.length, live.sources.length)}
          title={getConfirmTitle(confirmState)}
          onCancel={() => setConfirmState(undefined)}
          onConfirm={() => void confirm()}
        />
      ) : null}
    </div>
  )
}

function getConfirmText(confirmState: ConfirmState): string {
  if (confirmState.type === 'clearSources' || confirmState.type === 'clearLiveSources') return '清空'
  if (confirmState.type === 'initializeAppData') return '初始化'
  if (confirmState.type === 'importAppData') return '导入'
  return '删除'
}
