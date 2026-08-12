import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { MonitorPlay, Video } from 'lucide-react'
import { ConfirmDialog, LayoutPreferencesSettings, SettingsPageLayout } from '@renderer/components'
import { isApiAvailable, onSettingsSectionChange } from '@renderer/platform/api'
import { AboutSettingsCard } from './components/about-settings-card'
import { DataManagementCard, SubscriptionSettingsCard } from './components/settings-cards'
import { DiagnosticsSettingsCard } from './components/diagnostics-settings-card'
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
import { resolveSettingsSection, type SettingsSectionId } from './settings-sections'
import type { ConfirmState, IptvSourceDialogState, SourceDialogState } from './types'
import { getConfirmDescription, getConfirmTitle } from './utils'
import { cn } from '@/utils'

type IptvPageSectionId = 'iptv-sources' | 'iptv-epg' | 'iptv-network'

/** 映射到 IPTV 设置页签的设置分区 */
const iptvPageSections: Array<{ id: IptvPageSectionId; label: string }> = [
  { id: 'iptv-sources', label: '源' },
  { id: 'iptv-epg', label: 'EPG' },
  { id: 'iptv-network', label: '网络' },
]

/** 渲染设置页面 */
export function SettingsPage(): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams()
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
  const [activeIptvPageSection, setActiveIptvPageSection] = useState<IptvPageSectionId>('iptv-sources')
  const pageRef = useRef<HTMLDivElement>(null)
  const rawSection = searchParams.get('section')
  const activeSection = resolveSettingsSection(rawSection) ?? 'appearance'

  /** 更新设置分区参数并滚动到页面顶部 */
  const selectSection = useCallback(
    (sectionId: SettingsSectionId): void => {
      const nextParams = new URLSearchParams(searchParams)
      nextParams.set('section', sectionId)
      setSearchParams(nextParams, { replace: true })
      pageRef.current?.closest('main')?.scrollTo({ top: 0, behavior: 'auto' })
    },
    [searchParams, setSearchParams],
  )

  /** 将无效设置分区参数替换为默认分区 */
  useEffect(() => {
    if (rawSection !== activeSection) selectSection(activeSection)
  }, [activeSection, rawSection, selectSection])

  /** 监听主进程发送的设置分区切换事件 */
  useEffect(
    () =>
      onSettingsSectionChange((section) => {
        const resolvedSection = resolveSettingsSection(section)
        if (resolvedSection) selectSection(resolvedSection)
      }),
    [selectSection],
  )

  /** 确认当前对话框操作 */
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

  /** 选择 IPTV 页面区块 */
  const selectIptvPageSection = (sectionId: IptvPageSectionId): void => {
    setActiveIptvPageSection(sectionId)
  }

  return (
    <div className="min-h-full px-4 py-5 sm:px-6 sm:py-6 xl:px-8 xl:py-8" ref={pageRef}>
      <div className="grid min-w-0 grid-cols-[132px_minmax(0,1fr)] gap-4 sm:grid-cols-[144px_minmax(0,1fr)] sm:gap-5">
        <SettingsSidebar activeSection={activeSection} onSelect={selectSection} />

        <div className="min-w-0 pb-8">
          {activeSection === 'appearance' ? (
            <SettingsPageLayout description="调整首页内容风格与主导航显示。" title="外观">
              <LayoutPreferencesSettings />
            </SettingsPageLayout>
          ) : null}

          {activeSection === 'subscriptions' ? (
            <SettingsPageLayout description="添加、切换并通过指定网络更新远程订阅。" title="订阅源">
              <SubscriptionSettingsCard
                apiAvailable={apiAvailable}
                isSyncing={general.isSyncingSubscription}
                syncingMode={general.syncingSubscriptionMode}
                subscriptions={general.subscriptions}
                activeSubscriptionId={general.activeSubscriptionId}
                onAdd={(url) => void general.addSubscription(url)}
                onDelete={(subscription) => setConfirmState({ type: 'deleteSubscription', subscription })}
                onSelect={(subscriptionId) => setConfirmState({ type: 'selectSubscription', subscriptionId })}
                onSync={(mode) => void general.syncSubscription(mode)}
              />
            </SettingsPageLayout>
          ) : null}

          {activeSection === 'vod-sources' ? (
            <SettingsPageLayout description="管理点播接口、备用地址与可用性。" title="点播源">
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
                title="点播源列表"
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
            </SettingsPageLayout>
          ) : null}

          {activeSection === 'iptv' ? (
            <SettingsPageLayout description="配置和管理 IPTV 源、EPG 与网络设置。" title="IPTV">
              <div
                aria-label="IPTV 设置模块"
                className="border-border mb-8 flex h-11 items-end gap-2 border-b"
                role="tablist"
              >
                {iptvPageSections.map((section) => (
                  <button
                    aria-controls={`${section.id}-panel`}
                    aria-selected={activeIptvPageSection === section.id}
                    className={cn(
                      'focus-visible:ring-ring relative h-11 px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2',
                      activeIptvPageSection === section.id
                        ? 'text-primary after:bg-primary after:absolute after:right-2 after:bottom-0 after:left-2 after:h-0.5 after:rounded-full'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    id={`${section.id}-tab`}
                    key={section.id}
                    role="tab"
                    type="button"
                    onClick={() => selectIptvPageSection(section.id)}
                  >
                    {section.label}
                  </button>
                ))}
              </div>
              <div
                aria-labelledby="iptv-sources-tab"
                hidden={activeIptvPageSection !== 'iptv-sources'}
                id="iptv-sources-panel"
                role="tabpanel"
              >
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
                  sectionId="iptv-sources"
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
              <div
                aria-labelledby="iptv-epg-tab"
                hidden={activeIptvPageSection !== 'iptv-epg'}
                id="iptv-epg-panel"
                role="tabpanel"
              >
                <IptvEpgSettingsCard
                  key={`${iptvSettings.epg.mode}:${iptvSettings.epg.url ?? ''}:${iptvSettings.epg.lastTest.testedAt ?? 0}`}
                  apiAvailable={apiAvailable}
                  isSaving={iptvSettings.isSavingEpg}
                  isTesting={iptvSettings.isTesting}
                  value={iptvSettings.epg}
                  onSave={(value) => void iptvSettings.saveEpg(value)}
                  onTest={(value) => void iptvSettings.test(value)}
                />
              </div>
              <div
                aria-labelledby="iptv-network-tab"
                hidden={activeIptvPageSection !== 'iptv-network'}
                id="iptv-network-panel"
                role="tabpanel"
              >
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
              </div>
            </SettingsPageLayout>
          ) : null}

          {activeSection === 'data-management' ? (
            <SettingsPageLayout description="备份、恢复或清理应用中的本地数据。" title="数据管理">
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
              <DiagnosticsSettingsCard apiAvailable={apiAvailable} />
            </SettingsPageLayout>
          ) : null}

          {activeSection === 'about' ? (
            <SettingsPageLayout description="查看应用版本、开源信息与项目入口。" title="关于">
              <AboutSettingsCard />
            </SettingsPageLayout>
          ) : null}
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
