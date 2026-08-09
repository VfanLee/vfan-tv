import { Download, RefreshCw, Rss, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import type { SubscriptionConfig } from '@shared/types'
import { EmptyState, SettingsCard } from '@renderer/components'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { RadioGroup, RadioGroupItem } from '@/ui/radio-group'
import { cn } from '@/utils'

export function SubscriptionSettingsCard({
  apiAvailable,
  isSyncing,
  subscriptions,
  activeSubscriptionId,
  onAdd,
  onSelect,
  onDelete,
  onSync,
}: {
  apiAvailable: boolean
  isSyncing: boolean
  subscriptions: SubscriptionConfig[]
  activeSubscriptionId?: string
  onAdd: (url: string) => void
  onSelect: (id: string) => void
  onDelete: (subscription: SubscriptionConfig) => void
  onSync: () => void
}): React.JSX.Element {
  const [url, setUrl] = useState('')
  const submit = (): void => {
    if (!url.trim()) return
    onAdd(url)
    setUrl('')
  }
  return (
    <SettingsCard description="选择一个订阅源后更新；手动源不会被覆盖。" title="订阅源管理">
      <div className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-center">
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
      <div className="border-border border-t">
        <div className="text-muted-foreground grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b px-5 py-3 text-xs font-medium">
          <span>订阅地址</span>
          <span className="pr-1">操作</span>
        </div>
        {subscriptions.length === 0 ? (
          <div className="px-5 py-6">
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
                    'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b px-5 py-4 last:border-b-0',
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
                      <Button
                        disabled={!apiAvailable || isSyncing}
                        size="sm"
                        variant="outline"
                        onClick={(event) => {
                          event.stopPropagation()
                          onSync()
                        }}
                      >
                        <RefreshCw className={cn(isSyncing && 'animate-spin')} data-icon="inline-start" />
                        更新
                      </Button>
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
    </SettingsCard>
  )
}
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
    <SettingsCard description="备份、恢复、选择性清除或恢复全部应用数据。" title="数据管理">
      <div className="flex items-center gap-4 px-5 py-5">
        <Button disabled={!apiAvailable || isBusy} variant="outline" onClick={onExport}>
          <Download data-icon="inline-start" />
          {isExporting ? '导出中' : '导出数据'}
        </Button>
        <Button disabled={!apiAvailable || isBusy} variant="outline" onClick={onImport}>
          <Upload data-icon="inline-start" />
          {isImporting ? '导入中' : '导入数据'}
        </Button>
        <Button disabled={!apiAvailable || isBusy} variant="outline" onClick={onClearData}>
          <Trash2 data-icon="inline-start" />
          {isClearingData ? '清除中' : '清除数据'}
        </Button>
        <Button className="ml-auto" disabled={!apiAvailable || isBusy} variant="destructive" onClick={onRestoreFactory}>
          <RefreshCw className={isRestoringFactory ? 'animate-spin' : undefined} data-icon="inline-start" />
          {isRestoringFactory ? '恢复中' : '恢复出厂设置'}
        </Button>
      </div>
    </SettingsCard>
  )
}
