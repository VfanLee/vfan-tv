import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { MonitorPlay, Video } from 'lucide-react'
import { ConfirmDialog, LayoutPreferencesSettings, ThemeSettings } from '@renderer/components'
import { isApiAvailable } from '@renderer/platform/api'
import { AboutSettingsCard } from './components/about-settings-card'
import { DataManagementCard, SubscriptionSettingsCard } from './components/settings-cards'
import { NetworkSettingsCard } from './components/network-settings-card'
import { DataClearDialog } from './components/data-clear-dialog'
import { DataSelectionDialog } from './components/data-selection-dialog'
import { SettingsSidebar } from './components/settings-sidebar'
import { IptvSourceDialog, SourceDialog } from './components/source-dialogs'
import { IptvEpgSettingsCard } from './components/iptv-settings-card'
import { SourceTableCard } from './components/source-table-card'
import { useAppData } from './hooks/use-app-data'
import { useGeneralSettings } from './hooks/use-general-settings'
import { useIptvSources } from './hooks/use-iptv-sources'
import { useNetworkSettings } from './hooks/use-network-settings'
import { useIptvSettings } from './hooks/use-iptv-settings'
import { useVodSources } from './hooks/use-vod-sources'
import { settingsSections, type SettingsSectionId } from './settings-sections'
import type { ConfirmState, IptvSourceDialogState, SourceDialogState } from './types'
import { getConfirmDescription, getConfirmTitle } from './utils'

// 设置页负责协调各设置领域 hook；具体数据读写仍由对应 hook 和 main IPC 完成。
export function SettingsPage(): React.JSX.Element {
  const location = useLocation()
  const apiAvailable = isApiAvailable()
  const vod = useVodSources(apiAvailable)
  const iptv = useIptvSources(apiAvailable)
  const iptvSettings = useIptvSettings(apiAvailable)
  const general = useGeneralSettings({
    apiAvailable,
    refreshIptvSources: iptv.refresh,
    refreshVodSources: vod.refresh,
  })
  const network = useNetworkSettings(apiAvailable)
  const appData = useAppData({
    apiAvailable,
    resetIptvSources: () => iptv.applySources([]),
    resetSubscription: general.resetSubscription,
    resetVodSources: () => vod.applySources([]),
  })
  const [dialog, setDialog] = useState<SourceDialogState>()
  const [iptvSourceDialog, setIptvSourceDialog] = useState<IptvSourceDialogState>()
  const [confirmState, setConfirmState] = useState<ConfirmState>()
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false)
  const [isClearDataDialogOpen, setIsClearDataDialogOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('appearance')
  const isNavigatingRef = useRef(false)
  const navigationCleanupRef = useRef<() => void>(() => undefined)
  const selectSectionRef = useRef<(sectionId: SettingsSectionId) => void>(() => undefined)

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

  const selectSection = useCallback((sectionId: SettingsSectionId): void => {
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
  }, [])

  useEffect(() => {
    selectSectionRef.current = selectSection
  }, [selectSection])

  useEffect(() => {
    const section = (location.state as { section?: SettingsSectionId } | null)?.section
    if (!section || !settingsSections.some((item) => item.id === section)) return
    const frame = window.requestAnimationFrame(() => selectSectionRef.current(section))
    return () => window.cancelAnimationFrame(frame)
  }, [location.state])

  const confirm = async (): Promise<void> => {
    if (!confirmState) return
    if (confirmState.type === 'clearSources') await vod.clearAll()
    else if (confirmState.type === 'clearIptvSources') await iptv.clearAll()
    else if (confirmState.type === 'restoreFactorySettings') await appData.restoreFactorySettings()
    else if (confirmState.type === 'importAppData') await appData.importData()
    else if (confirmState.type === 'deleteSource') await vod.deleteItem(confirmState.source)
    else if (confirmState.type === 'deleteIptvSource') await iptv.deleteItem(confirmState.source)
    else if (confirmState.type === 'deleteSubscription') await general.deleteSubscription(confirmState.subscription.id)
    else await general.selectSubscription(confirmState.subscriptionId)
    setConfirmState(undefined)
  }

  return (
    <div className="min-h-full px-4 py-5 sm:px-6 sm:py-6 xl:px-8 xl:py-8">
      <div className="grid min-w-0 grid-cols-[132px_minmax(0,1fr)] gap-4 sm:grid-cols-[144px_minmax(0,1fr)] sm:gap-5">
        <SettingsSidebar activeSection={activeSection} onSelect={selectSection} />

        <div className="grid min-w-0 gap-5 [&>section]:min-w-0">
          <section id="appearance" className="scroll-mt-8">
            <div className="grid gap-5">
              <LayoutPreferencesSettings />
              <ThemeSettings />
            </div>
          </section>

          <section id="network" className="scroll-mt-8">
            <NetworkSettingsCard
              apiAvailable={apiAvailable}
              network={{
                settings: network.settings,
                status: network.status,
                testResults: network.testResults,
                isLoading: network.isLoading,
                isSaving: network.isSaving,
                testingRoute: network.testingRoute,
                onRefreshStatus: () => void network.refreshStatus(),
                onSave: (settings) => void network.save(settings),
                onTest: (route, settings) => void network.test(route, settings),
              }}
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
              emptyIcon={Video}
              emptyText="还没有点播源"
              enabledCount={vod.enabledCount}
              heightClassName="max-h-[min(60vh,460px)]"
              isBatchUpdating={vod.isBatchUpdating}
              isClearing={vod.isClearing}
              isReordering={vod.isReordering}
              isTestingAll={vod.isTestingAll}
              selectedSourceIds={vod.selectedSourceIds}
              sources={vod.sources}
              speedResults={vod.speedResults}
              title="点播源"
              onAdd={() => setDialog({ mode: 'create' })}
              onBatchSetDisabled={(disabled) => void vod.batchSetDisabled(disabled)}
              onClear={() => setConfirmState({ type: 'clearSources' })}
              onDelete={(source) => setConfirmState({ type: 'deleteSource', source })}
              onEdit={(source) => setDialog({ mode: 'edit', source })}
              onExport={() => void vod.exportItems()}
              onImport={() => void vod.importItems()}
              onMoveToEdge={(sourceId, edge) => void vod.moveToEdge(sourceId, edge)}
              onSwitchBackup={(source, backupUrl) => vod.switchBackup(source, backupUrl)}
              onTestAll={() => void vod.testAll()}
              onTestSingle={(sourceId) => void vod.testSingle(sourceId)}
              onSetDisabled={(source, disabled) => void vod.setDisabled(source, disabled)}
              onToggleAll={vod.toggleAll}
              onToggleSelection={vod.toggleSelection}
            />
          </section>

          <section id="iptv" className="scroll-mt-8">
            <div className="grid gap-5">
              <IptvEpgSettingsCard
                key={`${iptvSettings.epg.mode}:${iptvSettings.epg.url ?? ''}:${iptvSettings.epg.lastTest.testedAt ?? 0}`}
                apiAvailable={apiAvailable}
                isSaving={iptvSettings.isSavingEpg}
                isTesting={iptvSettings.isTesting}
                value={iptvSettings.epg}
                onSave={(value) => void iptvSettings.saveEpg(value)}
                onTest={(value) => void iptvSettings.test(value)}
              />
              <SourceTableCard
                addText="添加 IPTV 源"
                allSelected={iptv.allSelected}
                apiAvailable={apiAvailable}
                description="管理频道列表和每个源的媒体请求配置。"
                emptyIcon={MonitorPlay}
                emptyText="还没有 IPTV 源"
                enabledCount={iptv.enabledCount}
                heightClassName="max-h-[min(55vh,360px)]"
                isBatchUpdating={iptv.isBatchUpdating}
                isClearing={iptv.isClearing}
                isReordering={iptv.isReordering}
                selectedSourceIds={iptv.selectedSourceIds}
                sources={iptv.sources}
                title="IPTV 源"
                onAdd={() => setIptvSourceDialog({ mode: 'create' })}
                onBatchSetDisabled={(disabled) => void iptv.batchSetDisabled(disabled)}
                onClear={() => setConfirmState({ type: 'clearIptvSources' })}
                onDelete={(source) => setConfirmState({ type: 'deleteIptvSource', source })}
                onEdit={(source) => setIptvSourceDialog({ mode: 'edit', source })}
                onExport={() => void iptv.exportItems()}
                onImport={() => void iptv.importItems()}
                onMoveToEdge={(sourceId, edge) => void iptv.moveToEdge(sourceId, edge)}
                onSetDisabled={(source, disabled) => void iptv.setDisabled(source, disabled)}
                onToggleAll={iptv.toggleAll}
                onToggleSelection={iptv.toggleSelection}
              />
            </div>
          </section>

          <section id="data-management" className="scroll-mt-8">
            <DataManagementCard
              apiAvailable={apiAvailable}
              isExporting={appData.isExporting}
              isClearingData={appData.isClearingData}
              isImporting={appData.isImporting}
              isRestoringFactory={appData.isRestoringFactory}
              onExport={() => setIsExportDialogOpen(true)}
              onClearData={() => setIsClearDataDialogOpen(true)}
              onImport={() => setConfirmState({ type: 'importAppData' })}
              onRestoreFactory={() => setConfirmState({ type: 'restoreFactorySettings' })}
            />
          </section>

          <section id="about" className="scroll-mt-8">
            <AboutSettingsCard />
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

      {iptvSourceDialog ? (
        <IptvSourceDialog
          dialog={iptvSourceDialog}
          onClose={() => setIptvSourceDialog(undefined)}
          onSaved={async () => {
            setIptvSourceDialog(undefined)
            await iptv.refresh()
          }}
        />
      ) : null}

      {confirmState ? (
        <ConfirmDialog
          destructive={confirmState.type !== 'selectSubscription'}
          description={getConfirmDescription(confirmState, vod.sources.length, iptv.sources.length)}
          title={getConfirmTitle(confirmState)}
          onCancel={() => setConfirmState(undefined)}
          onConfirm={() => void confirm()}
        />
      ) : null}

      {isExportDialogOpen ? (
        <DataSelectionDialog
          isPending={appData.isExporting}
          onCancel={() => setIsExportDialogOpen(false)}
          onConfirm={async (selection) => {
            await appData.exportData(selection)
            setIsExportDialogOpen(false)
          }}
        />
      ) : null}

      {isClearDataDialogOpen ? (
        <DataClearDialog
          isPending={appData.isClearingData}
          onCancel={() => setIsClearDataDialogOpen(false)}
          onConfirm={async (selection) => {
            await appData.clearData(selection)
            setIsClearDataDialogOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}
