import { Gauge, RefreshCw } from 'lucide-react'
import type {
  NetworkProxyProfile,
  NetworkProxyTestResult,
  NetworkRouteMode,
  NetworkSettings,
  NetworkStatus,
} from '@/types'
import { Button } from '@/ui/button'
import { Label } from '@/ui/label'
import { RadioGroup, RadioGroupItem } from '@/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { cn } from '@/utils'
import { ROUTES } from './network-routes'

/** 渲染网络路由卡片 */
export function NetworkRouteCard({
  disabled,
  isTesting,
  profiles,
  result,
  route,
  settings,
  systemProxyStatus,
  onChange,
  onTest,
}: {
  disabled: boolean
  isTesting: boolean
  profiles: NetworkProxyProfile[]
  result?: NetworkProxyTestResult
  route: (typeof ROUTES)[number]
  settings: NetworkSettings
  systemProxyStatus: NetworkStatus['systemProxyStatus']
  onChange: (mode: NetworkRouteMode, activeProfileId?: string) => void
  onTest: () => void
}): React.JSX.Element {
  const value = settings[route.key]
  const activeProfile = profiles.find((profile) => profile.id === value.activeProfileId)
  const options: Array<{ mode: NetworkRouteMode; title: string; description: string }> = [
    {
      mode: 'direct',
      title: '直连（不使用代理）',
      description: '即使开启全局代理，该配置也不走代理',
    },
    {
      mode: 'system',
      title: '跟随全局设置',
      description: getSystemProxyStatusDescription(systemProxyStatus),
    },
    {
      mode: 'custom',
      title: '自定义代理',
      description: '使用下方选择的自定义代理配置',
    },
  ]
  return (
    <div className="flex flex-col gap-5 py-8 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-1">
        <h3 className="text-foreground text-base font-semibold">{route.title}</h3>
        <p className="text-muted-foreground text-sm leading-6">{route.description}</p>
      </div>
      <div className="flex flex-col gap-4">
        <RadioGroup
          className="flex flex-col gap-5"
          disabled={disabled}
          value={value.mode}
          onValueChange={(mode) => onChange(mode as NetworkRouteMode)}
        >
          {options.map((option) => {
            const optionId = `${route.key}-${option.mode}`
            return (
              <div className="flex items-start gap-3" key={option.mode}>
                <RadioGroupItem className="mt-1" id={optionId} value={option.mode} />
                <Label
                  className="min-w-0 flex-1 cursor-pointer flex-col items-start gap-1 leading-normal"
                  htmlFor={optionId}
                >
                  <span className="text-sm font-medium">{option.title}</span>
                  <span className="text-muted-foreground text-sm leading-5 font-normal">{option.description}</span>
                </Label>
              </div>
            )
          })}
        </RadioGroup>
        {value.mode === 'custom' ? (
          <Select
            disabled={disabled || profiles.length === 0}
            value={value.activeProfileId}
            onValueChange={(profileId) => onChange('custom', profileId)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择代理配置" />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <NetworkTestResult result={result} />
        <div>
          <Button
            disabled={disabled || isTesting || (value.mode === 'custom' && !activeProfile)}
            variant="outline"
            onClick={onTest}
          >
            {isTesting ? (
              <RefreshCw className="animate-spin" data-icon="inline-start" />
            ) : (
              <Gauge data-icon="inline-start" />
            )}
            {isTesting ? '测试中' : '测试网络'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** 渲染网络测试结果 */
export function NetworkTestResult({ result }: { result?: NetworkProxyTestResult }): React.JSX.Element {
  if (!result) return <span className="text-muted-foreground block min-h-4 text-xs">测试不会保存或切换当前配置。</span>
  return (
    <span
      className={cn(
        'block min-h-4 text-xs font-medium',
        result.status === 'success' ? 'text-emerald-600' : 'text-destructive',
      )}
    >
      {result.status === 'success'
        ? `连接成功 · ${result.elapsedMs ?? '—'} ms · ${formatResolvedRoute(result.route)}`
        : (result.errorMessage ?? '连接失败')}
    </span>
  )
}

/** 获取操作系统代理状态说明 */
function getSystemProxyStatusDescription(status: NetworkStatus['systemProxyStatus']): string {
  if (status === 'enabled') return '全局代理当前已开启'
  if (status === 'disabled') return '全局代理当前未开启'
  return '全局代理状态暂不可用'
}

/** 格式化已解析的路由 */
function formatResolvedRoute(route?: string): string {
  if (!route || route === 'DIRECT') return '直连'
  return route.replace(/^(PROXY|HTTPS|SOCKS5?)\s+/i, (value) => `${value.trim().toUpperCase()} `)
}
