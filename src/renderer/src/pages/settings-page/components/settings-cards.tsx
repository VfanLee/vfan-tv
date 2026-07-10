import { Download, Gauge, RefreshCw, Rss, Trash2, Upload } from 'lucide-react'
import { DEFAULT_GITHUB_PROXY_ROUTE_ID, GITHUB_PROXY_ROUTES } from '@shared/constants'
import type { GitHubProxyRouteId } from '@shared/types'
import { SettingsCard } from '@renderer/components'
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
import { cn } from '@renderer/utils/cn'
import type { GitHubProxySpeedState } from '../types'
import { formatSpeedResult, getGitHubProxyRouteLabel, getSpeedResultTagClassName } from '../utils'

export function NetworkSettingsCard({
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
              {isTestingAll ? (
                <RefreshCw className="animate-spin" data-icon="inline-start" />
              ) : (
                <Gauge data-icon="inline-start" />
              )}
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

export function SubscriptionSettingsCard({
  apiAvailable,
  isSyncing,
  subscriptionUrl,
  onChange,
  onSync,
}: {
  apiAvailable: boolean
  isSyncing: boolean
  subscriptionUrl: string
  onChange: (url: string) => void
  onSync: () => void
}): React.JSX.Element {
  return (
    <SettingsCard description="同步订阅源后会更新点播源、直播源。" title="订阅源管理">
      <div className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1">
          <span className="text-foreground mb-2 block text-sm font-medium">订阅地址</span>
          <Input
            disabled={!apiAvailable || isSyncing}
            placeholder="https://example.com/subscription"
            type="url"
            value={subscriptionUrl}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSync()
            }}
          />
        </label>
        <Button
          className="sm:min-w-24"
          disabled={!apiAvailable || !subscriptionUrl.trim() || isSyncing}
          onClick={onSync}
        >
          {isSyncing ? (
            <RefreshCw className="animate-spin" data-icon="inline-start" />
          ) : (
            <Rss data-icon="inline-start" />
          )}
          {isSyncing ? '同步中' : '同步'}
        </Button>
      </div>
    </SettingsCard>
  )
}

export function DataManagementCard({
  apiAvailable,
  isExporting,
  isImporting,
  isInitializing,
  onExport,
  onImport,
  onInitialize,
}: {
  apiAvailable: boolean
  isExporting: boolean
  isImporting: boolean
  isInitializing: boolean
  onExport: () => void
  onImport: () => void
  onInitialize: () => void
}): React.JSX.Element {
  return (
    <SettingsCard description="备份、恢复数据。" title="数据管理">
      <div className="flex items-center gap-4 px-5 py-5">
        <Button disabled={!apiAvailable || isExporting} variant="outline" onClick={onExport}>
          <Download data-icon="inline-start" />
          {isExporting ? '导出中' : '导出数据'}
        </Button>
        <Button disabled={!apiAvailable || isImporting} variant="outline" onClick={onImport}>
          <Upload data-icon="inline-start" />
          {isImporting ? '导入中' : '导入数据'}
        </Button>
        <Button
          className="ml-auto"
          disabled={!apiAvailable || isInitializing}
          variant="destructive"
          onClick={onInitialize}
        >
          <Trash2 data-icon="inline-start" />
          {isInitializing ? '初始化中' : '初始化'}
        </Button>
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
    <div className={cn('flex shrink-0 items-center justify-end gap-2 self-center', className)}>
      <Badge className={getSpeedResultTagClassName(result)} variant="secondary">
        {formatSpeedResult(result)}
      </Badge>
      <Button disabled={disabled || testing} variant="outline" onClick={onTest}>
        {testing ? <RefreshCw className="animate-spin" data-icon="inline-start" /> : <Gauge data-icon="inline-start" />}
        测速
      </Button>
    </div>
  )
}
