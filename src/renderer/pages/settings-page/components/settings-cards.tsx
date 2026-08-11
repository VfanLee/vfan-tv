import { Download, RefreshCw, Rss, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import type { SubscriptionConfig, SubscriptionNetworkMode } from '@shared/types'
import { EmptyState, SettingsSection } from '@renderer/components'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { RadioGroup, RadioGroupItem } from '@/ui/radio-group'
import { cn } from '@/utils'

/** 渲染订阅设置卡片 */
export function SubscriptionSettingsCard({
  apiAvailable,
  isSyncing,
  syncingMode,
  subscriptions,
  activeSubscriptionId,
  onAdd,
  onSelect,
  onDelete,
  onSync,
}: {
  apiAvailable: boolean
  isSyncing: boolean
  syncingMode?: SubscriptionNetworkMode
  subscriptions: SubscriptionConfig[]
  activeSubscriptionId?: string
  onAdd: (url: string) => void
  onSelect: (id: string) => void
  onDelete: (subscription: SubscriptionConfig) => void
  onSync: (mode: SubscriptionNetworkMode) => void
}): React.JSX.Element {
  const [url, setUrl] = useState('')
  /** 提交订阅地址并清空输入框 */
  const submit = (): void => {
    if (!url.trim()) return
    onAdd(url)
    setUrl('')
  }
  return (
    <SettingsSection
      description="选择直连或系统代理更新；添加和切换订阅固定使用直连，手动源不会被覆盖。"
      title="订阅源管理"
    >
      <div className="flex flex-col gap-3 pb-5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <Input
            aria-label="订阅地址"
            disabled={!apiAvailable || isSyncing}
            placeholder="https://example.com/subscription"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
            }}
          />
        </div>
        <Button className="sm:min-w-24" disabled={!apiAvailable || !url.trim() || isSyncing} onClick={submit}>
          <Rss data-icon="inline-start" />
          添加订阅
        </Button>
      </div>
      <div className="border-border border-y">
        <div className="text-muted-foreground bg-muted/35 grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b px-3 py-3 text-xs font-medium sm:px-4">
          <span>订阅地址</span>
          <span className="pr-1">操作</span>
        </div>
        {subscriptions.length === 0 ? (
          <div className="px-4 py-6">
            <EmptyState density="compact" description="请先添加订阅地址。" icon={Rss} title="还没有订阅源" />
          </div>
        ) : (
          <RadioGroup
            className="gap-0"
            disabled={!apiAvailable || isSyncing}
            value={activeSubscriptionId ?? ''}
            onValueChange={onSelect}
          >
            {subscriptions.map((subscription) => {
              const selected = subscription.id === activeSubscriptionId
              return (
                <div
                  key={subscription.id}
                  className={cn(
                    'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b px-3 py-4 last:border-b-0 sm:px-4',
                    !selected && 'cursor-pointer',
                    selected && 'border-l-primary bg-primary/5 border-l-2 pl-[18px]',
                  )}
                  onClick={() => {
                    if (!selected) onSelect(subscription.id)
                  }}
                >
                  <label className={cn('flex min-w-0 items-center gap-3 text-left', !selected && 'cursor-pointer')}>
                    <RadioGroupItem value={subscription.id} onClick={(event) => event.stopPropagation()} />
                    <span className="text-foreground truncate text-sm">{subscription.url}</span>
                  </label>
                  <div className="flex items-center gap-2">
                    {selected ? (
                      <>
                        <Button
                          disabled={!apiAvailable || isSyncing}
                          size="sm"
                          variant="outline"
                          onClick={(event) => {
                            event.stopPropagation()
                            onSync('direct')
                          }}
                        >
                          <RefreshCw
                            className={cn(syncingMode === 'direct' && 'animate-spin')}
                            data-icon="inline-start"
                          />
                          直连更新
                        </Button>
                        <Button
                          disabled={!apiAvailable || isSyncing}
                          size="sm"
                          variant="outline"
                          onClick={(event) => {
                            event.stopPropagation()
                            onSync('system')
                          }}
                        >
                          <RefreshCw
                            className={cn(syncingMode === 'system' && 'animate-spin')}
                            data-icon="inline-start"
                          />
                          系统代理更新
                        </Button>
                      </>
                    ) : null}
                    <Button
                      disabled={!apiAvailable || isSyncing}
                      size="sm"
                      variant="destructive"
                      onClick={(event) => {
                        event.stopPropagation()
                        onDelete(subscription)
                      }}
                    >
                      <Trash2 data-icon="inline-start" />
                      删除
                    </Button>
                  </div>
                </div>
              )
            })}
          </RadioGroup>
        )}
      </div>
    </SettingsSection>
  )
}
/** 渲染数据管理卡片 */
export function DataManagementCard({
  apiAvailable,
  isExporting,
  isClearingData,
  isImporting,
  isRestoringFactory,
  onExport,
  onClearData,
  onImport,
  onRestoreFactory,
}: {
  apiAvailable: boolean
  isExporting: boolean
  isClearingData: boolean
  isImporting: boolean
  isRestoringFactory: boolean
  onExport: () => void
  onClearData: () => void
  onImport: () => void
  onRestoreFactory: () => void
}): React.JSX.Element {
  const isBusy = isExporting || isClearingData || isImporting || isRestoringFactory

  return (
    <SettingsSection description="备份、恢复、选择性清除或恢复全部应用数据。" title="备份与恢复">
      <div className="border-border divide-border divide-y border-y">
        <div className="flex flex-wrap items-center gap-4 py-5">
          <div className="min-w-52 flex-1">
            <h3 className="text-sm font-semibold">迁移应用数据</h3>
            <p className="text-muted-foreground mt-1 text-sm">导出备份文件，或从已有备份恢复所选数据。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!apiAvailable || isBusy} variant="outline" onClick={onExport}>
              <Download data-icon="inline-start" />
              {isExporting ? '导出中' : '导出数据'}
            </Button>
            <Button disabled={!apiAvailable || isBusy} variant="outline" onClick={onImport}>
              <Upload data-icon="inline-start" />
              {isImporting ? '导入中' : '导入数据'}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 py-5">
          <div className="min-w-52 flex-1">
            <h3 className="text-sm font-semibold">选择性清除</h3>
            <p className="text-muted-foreground mt-1 text-sm">按数据类型清除内容，同时保留其他应用设置。</p>
          </div>
          <Button disabled={!apiAvailable || isBusy} variant="outline" onClick={onClearData}>
            <Trash2 data-icon="inline-start" />
            {isClearingData ? '清除中' : '清除数据'}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-4 py-5">
          <div className="min-w-52 flex-1">
            <h3 className="text-sm font-semibold">恢复出厂设置</h3>
            <p className="text-muted-foreground mt-1 text-sm">清除全部本地数据，并将应用恢复到初始状态。</p>
          </div>
          <Button disabled={!apiAvailable || isBusy} variant="destructive" onClick={onRestoreFactory}>
            <RefreshCw className={isRestoringFactory ? 'animate-spin' : undefined} data-icon="inline-start" />
            {isRestoringFactory ? '恢复中' : '恢复出厂设置'}
          </Button>
        </div>
      </div>
    </SettingsSection>
  )
}
