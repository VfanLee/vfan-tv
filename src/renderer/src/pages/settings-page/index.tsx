import { useEffect, useRef, useState } from 'react'
import { ConfirmDialog, ThemeSettings } from '@renderer/components'
import { isApiAvailable } from '@renderer/services/api'
import { DataManagementCard, NetworkSettingsCard, SubscriptionSettingsCard } from './components/settings-cards'
import { DataSelectionDialog } from './components/data-selection-dialog'
import { SettingsSidebar } from './components/settings-sidebar'
import { LiveSourceDialog, SourceDialog } from './components/source-dialogs'
import { SourceTableCard } from './components/source-table-card'
import { useAppData } from './hooks/use-app-data'
import { useGeneralSettings } from './hooks/use-general-settings'
import { useLiveSources } from './hooks/use-live-sources'
import { useVodSources } from './hooks/use-vod-sources'
import { settingsSections, type SettingsSectionId } from './settings-sections'
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
  const [dataSelectionMode, setDataSelectionMode] = useState<'export' | 'initialize'>()
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('appearance')
  const isNavigatingRef = useRef(false)
  const navigationCleanupRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    const elements = settingsSections
      .map((section) => document.getElementById(section.id))
      .filter((element): element is HTMLElement => Boolean(element))
    const observer = new IntersectionObserver(
      (entries) => {
        if (isNavigatingRef.current) return
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0]
        if (visibleEntry) setActiveSection(visibleEntry.target.id as SettingsSectionId)
      },
      { rootMargin: '-32px 0px -65% 0px', threshold: 0 },
    )
    elements.forEach((element) => observer.observe(element))
    return () => {
      observer.disconnect()
      navigationCleanupRef.current()
    }
  }, [])

  const selectSection = (sectionId: SettingsSectionId): void => {
    navigationCleanupRef.current()
    isNavigatingRef.current = false
    setActiveSection(sectionId)
    const target = document.getElementById(sectionId)
    if (!target) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      target.scrollIntoView({ behavior: 'auto', block: 'start' })
      return
    }

    isNavigatingRef.current = true
    const scrollContainer = target.closest('main')
    const finishNavigation = (): void => {
      isNavigatingRef.current = false
      setActiveSection(sectionId)
      cleanup()
    }
    const cleanup = (): void => {
      scrollContainer?.removeEventListener('scrollend', finishNavigation)
      clearTimeout(fallbackTimer)
    }

    scrollContainer?.addEventListener('scrollend', finishNavigation, { once: true })
    const fallbackTimer = setTimeout(finishNavigation, 2_000)
    navigationCleanupRef.current = cleanup
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const confirm = async (): Promise<void> => {
    if (!confirmState) return
    if (confirmState.type === 'clearSources') await vod.clearAll()
    else if (confirmState.type === 'clearLiveSources') await live.clearAll()
    else if (confirmState.type === 'clearAppCache') await appData.clearCache()
    else if (confirmState.type === 'importAppData') await appData.importData()
    else if (confirmState.type === 'deleteSource') await vod.deleteItem(confirmState.source)
    else if (confirmState.type === 'deleteLiveSource') await live.deleteItem(confirmState.source)
    else if (confirmState.type === 'deleteSubscription') await general.deleteSubscription(confirmState.subscription.id)
    else await general.selectSubscription(confirmState.subscriptionId)
    setConfirmState(undefined)
  }

  return (
    <div className="min-h-full px-8 py-8">
      <div className="grid min-w-0 grid-cols-[176px_minmax(0,1fr)] gap-8">
        <SettingsSidebar activeSection={activeSection} onSelect={selectSection} />

        <div className="grid min-w-0 gap-5">
          <section id="appearance" className="scroll-mt-8">
            <ThemeSettings />
          </section>

          <section id="network" className="scroll-mt-8">
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
          </section>

          <section id="subscriptions" className="scroll-mt-8">
            <SubscriptionSettingsCard
              apiAvailable={apiAvailable}
              isSyncing={general.isSyncingSubscription}
              subscriptions={general.subscriptions}
              activeSubscriptionId={general.activeSubscriptionId}
              onAdd={(url) => void general.addSubscription(url)}
              onDelete={(subscription) => setConfirmState({ type: 'deleteSubscription', subscription })}
              onSelect={(subscriptionId) => setConfirmState({ type: 'selectSubscription', subscriptionId })}
              onSync={() => void general.syncSubscription()}
            />
          </section>

          <section id="vod-sources" className="scroll-mt-8">
            <SourceTableCard
              addText="添加点播源"
              allSelected={vod.allSelected}
              apiAvailable={apiAvailable}
              description="管理应用的点播源。"
              emptyText="暂无数据"
              enabledCount={vod.enabledCount}
              heightClassName="h-[460px]"
              isBatchUpdating={vod.isBatchUpdating}
              isClearing={vod.isClearing}
              isReordering={vod.isReordering}
              isTestingAll={vod.isTestingAll}
              selectedSourceIds={vod.selectedSourceIds}
              sources={vod.sources}
              speedResults={vod.speedResults}
              title="点播源"
              onAdd={() => setDialog({ mode: 'create' })}
              onBatchToggle={(enabled) => void vod.batchToggle(enabled)}
              onClear={() => setConfirmState({ type: 'clearSources' })}
              onDelete={(source) => setConfirmState({ type: 'deleteSource', source })}
              onEdit={(source) => setDialog({ mode: 'edit', source })}
              onExport={() => void vod.exportItems()}
              onImport={() => void vod.importItems()}
              onMoveToEdge={(sourceId, edge) => void vod.moveToEdge(sourceId, edge)}
              onSwitchBackup={(source, backupUrl) => vod.switchBackup(source, backupUrl)}
              onTestAll={() => void vod.testAll()}
              onTestSingle={(sourceId) => void vod.testSingle(sourceId)}
              onToggle={(source, enabled) => void vod.toggle(source, enabled)}
              onToggleAll={vod.toggleAll}
              onToggleSelection={vod.toggleSelection}
            />
          </section>

          <section id="live-sources" className="scroll-mt-8">
            <SourceTableCard
              addText="添加直播源"
              allSelected={live.allSelected}
              apiAvailable={apiAvailable}
              description="管理应用的直播源。"
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
              onEdit={(source) => setLiveSourceDialog({ mode: 'edit', source })}
              onExport={() => void live.exportItems()}
              onImport={() => void live.importItems()}
              onMoveToEdge={(sourceId, edge) => void live.moveToEdge(sourceId, edge)}
              onToggle={(source, enabled) => void live.toggle(source, enabled)}
              onToggleAll={live.toggleAll}
              onToggleSelection={live.toggleSelection}
            />
          </section>

          <section id="data-management" className="scroll-mt-8">
            <DataManagementCard
              apiAvailable={apiAvailable}
              isExporting={appData.isExporting}
              isClearingCache={appData.isClearingCache}
              isImporting={appData.isImporting}
              isInitializing={appData.isInitializing}
              onExport={() => setDataSelectionMode('export')}
              onClearCache={() => setConfirmState({ type: 'clearAppCache' })}
              onImport={() => setConfirmState({ type: 'importAppData' })}
              onInitialize={() => setDataSelectionMode('initialize')}
            />
          </section>
        </div>
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
          destructive={confirmState.type !== 'selectSubscription' && confirmState.type !== 'clearAppCache'}
          description={getConfirmDescription(confirmState, vod.sources.length, live.sources.length)}
          title={getConfirmTitle(confirmState)}
          onCancel={() => setConfirmState(undefined)}
          onConfirm={() => void confirm()}
        />
      ) : null}

      {dataSelectionMode ? (
        <DataSelectionDialog
          isPending={dataSelectionMode === 'export' ? appData.isExporting : appData.isInitializing}
          mode={dataSelectionMode}
          onCancel={() => setDataSelectionMode(undefined)}
          onConfirm={async (selection) => {
            if (dataSelectionMode === 'export') await appData.exportData(selection)
            else await appData.initializeData(selection)
            setDataSelectionMode(undefined)
          }}
        />
      ) : null}
    </div>
  )
}
