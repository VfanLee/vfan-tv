import { useState } from 'react'
import { Gauge, Network, Pencil, Plus, RefreshCw, Router, Trash2, Wifi, WifiOff } from 'lucide-react'
import type {
  NetworkProxyProfile,
  NetworkProxyProtocol,
  NetworkProxyTestResult,
  NetworkRouteKey,
  NetworkRouteMode,
  NetworkSettings,
  NetworkStatus,
} from '@shared/types'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Input } from '@/ui/input'
import { RadioGroup, RadioGroupItem } from '@/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { cn } from '@/utils'

interface NetworkSettingsCardProps {
  apiAvailable: boolean
  network: {
    settings: NetworkSettings
    status?: NetworkStatus
    testResults: Partial<Record<NetworkRouteKey, NetworkProxyTestResult>>
    isLoading: boolean
    isSaving: boolean
    testingRoute?: NetworkRouteKey
    onRefreshStatus: () => void
    onSave: (settings: NetworkSettings) => void
    onTest: (route: NetworkRouteKey, settings?: NetworkSettings) => void
  }
}

/** 支持单独配置网络访问策略的业务路由 */
const ROUTES: Array<{
  key: NetworkRouteKey
  title: string
  description: string
}> = [
  {
    key: 'iptv',
    title: 'IPTV 直播网络',
    description: 'IPTV 目录、台标、线路探测、直播墙预览、直播清单和媒体分片。',
  },
  {
    key: 'epg',
    title: 'EPG 节目单网络',
    description: '节目单查询接口、XMLTV 和 XMLTV.GZ 数据源。',
  },
]

/** 渲染网络设置卡片 */
export function NetworkSettingsCard({ apiAvailable, network }: NetworkSettingsCardProps): React.JSX.Element {
  const [profileDialog, setProfileDialog] = useState<NetworkProxyProfile | null | undefined>(undefined)
  const disabled = !apiAvailable || network.isLoading || network.isSaving

  /** 更新路由 */
  const updateRoute = (route: NetworkRouteKey, mode: NetworkRouteMode, activeProfileId?: string): void => {
    if (mode === 'custom' && network.settings.profiles.length === 0) {
      setProfileDialog(null)
      return
    }
    network.onSave({
      ...network.settings,
      [route]: {
        mode,
        activeProfileId:
          mode === 'custom'
            ? (activeProfileId ?? network.settings[route].activeProfileId ?? network.settings.profiles[0]?.id)
            : network.settings[route].activeProfileId,
      },
    })
  }

  /** 合并当前路由设置并保存完整网络配置 */
  const saveProfile = (profile: NetworkProxyProfile): void => {
    const exists = network.settings.profiles.some((item) => item.id === profile.id)
    const profiles = exists
      ? network.settings.profiles.map((item) => (item.id === profile.id ? profile : item))
      : [...network.settings.profiles, profile]
    network.onSave({ ...network.settings, profiles })
    setProfileDialog(undefined)
  }

  /** 测试当前业务路由的网络配置 */
  const testProfile = (profile: NetworkProxyProfile): void => {
    const profiles = network.settings.profiles.some((item) => item.id === profile.id)
      ? network.settings.profiles.map((item) => (item.id === profile.id ? profile : item))
      : [...network.settings.profiles, profile]
    network.onTest('iptv', {
      ...network.settings,
      profiles,
      iptv: { mode: 'custom', activeProfileId: profile.id },
    })
  }

  return (
    <>
      <div className="divide-border divide-y">
        <NetworkStatusSection
          disabled={!apiAvailable}
          settings={network.settings}
          status={network.status}
          onRefresh={network.onRefreshStatus}
        />
        <section className="space-y-4 py-6">
          <SectionHeading
            description="IPTV 与 EPG 使用相互隔离的网络 Session；VOD（含播放）、豆瓣和蜻蜓固定直连。"
            icon={Router}
            title="请求路由"
          />
          <div className="grid gap-4">
            {ROUTES.map((route) => (
              <NetworkRouteCard
                disabled={disabled}
                isTesting={network.testingRoute === route.key}
                key={route.key}
                profiles={network.settings.profiles}
                result={network.testResults[route.key]}
                route={route}
                settings={network.settings}
                systemProxyStatus={network.status?.systemProxyStatus ?? 'unknown'}
                onChange={(mode, activeProfileId) => updateRoute(route.key, mode, activeProfileId)}
                onTest={() => network.onTest(route.key)}
              />
            ))}
          </div>
        </section>
        <section className="space-y-4 py-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <SectionHeading
              description="可供 IPTV 与 EPG 独立选用，支持 HTTP、HTTPS 和 SOCKS5，不支持认证。"
              icon={Network}
              title="代理配置"
            />
            <Button disabled={disabled} size="sm" variant="outline" onClick={() => setProfileDialog(null)}>
              <Plus data-icon="inline-start" />
              添加代理
            </Button>
          </div>
          <ProxyProfileList
            disabled={disabled}
            profiles={network.settings.profiles}
            settings={network.settings}
            onDelete={(profileId) =>
              network.onSave({
                ...network.settings,
                profiles: network.settings.profiles.filter((item) => item.id !== profileId),
              })
            }
            onEdit={setProfileDialog}
          />
        </section>
      </div>
      {profileDialog !== undefined ? (
        <NetworkProfileDialog
          isTesting={network.testingRoute === 'iptv'}
          profile={profileDialog ?? undefined}
          testResult={network.testResults.iptv}
          onClose={() => setProfileDialog(undefined)}
          onSave={saveProfile}
          onTest={testProfile}
        />
      ) : null}
    </>
  )
}

/** 渲染网络路由卡片 */
function NetworkRouteCard({
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
    <div className="grid gap-5 py-1 lg:grid-cols-[minmax(220px,0.75fr)_minmax(320px,1fr)] lg:items-start">
      <div className="pt-1">
        <div className="text-foreground text-sm font-semibold">{route.title}</div>
        <div className="text-muted-foreground mt-1 text-xs leading-5">{route.description}</div>
      </div>
      <div className="grid gap-3">
        <RadioGroup
          className="grid gap-2 lg:grid-cols-3"
          disabled={disabled}
          value={value.mode}
          onValueChange={(mode) => onChange(mode as NetworkRouteMode)}
        >
          {options.map((option) => (
            <label
              className={cn(
                'border-border flex min-h-20 cursor-pointer items-start gap-3 rounded-lg border p-3 text-left',
                value.mode === option.mode && 'border-primary bg-primary/5 text-primary ring-primary/15 ring-1',
              )}
              key={option.mode}
            >
              <RadioGroupItem className="mt-0.5" value={option.mode} />
              <span className="grid min-w-0 gap-1">
                <span className="text-sm leading-5 font-medium">{option.title}</span>
                <span className="text-muted-foreground text-xs leading-5">{option.description}</span>
              </span>
            </label>
          ))}
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
            {isTesting ? <RefreshCw className="animate-spin" /> : <Gauge />}
            {isTesting ? '测试中' : '测试网络'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** 渲染代理配置列表 */
function ProxyProfileList({
  disabled,
  profiles,
  settings,
  onDelete,
  onEdit,
}: {
  disabled: boolean
  profiles: NetworkProxyProfile[]
  settings: NetworkSettings
  onDelete: (profileId: string) => void
  onEdit: (profile: NetworkProxyProfile) => void
}): React.JSX.Element {
  if (profiles.length === 0) {
    return (
      <div className="border-border text-muted-foreground border-y px-4 py-6 text-center text-sm">尚未添加代理配置</div>
    )
  }
  return (
    <div className="border-border divide-border divide-y border-y">
      {profiles.map((profile) => {
        const usedBy = ROUTES.filter(
          ({ key }) => settings[key].mode === 'custom' && settings[key].activeProfileId === profile.id,
        )
        return (
          <div className="flex min-w-0 items-center gap-3 px-4 py-3" key={profile.id}>
            <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
              <Network className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-foreground truncate text-sm font-medium">{profile.name}</span>
                {usedBy.map((route) => (
                  <Badge key={route.key} variant="secondary">
                    {route.title.replace('网络', '')}
                  </Badge>
                ))}
              </span>
              <span className="text-muted-foreground mt-0.5 block truncate font-mono text-xs">
                {profile.protocol.toUpperCase()} · {formatProfileAddress(profile)}
              </span>
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={`编辑 ${profile.name}`}
                  disabled={disabled}
                  size="icon"
                  variant="ghost"
                  onClick={() => onEdit(profile)}
                >
                  <Pencil />
                </Button>
              </TooltipTrigger>
              <TooltipContent>编辑代理</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={`删除 ${profile.name}`}
                  disabled={disabled || usedBy.length > 0}
                  size="icon"
                  variant="ghost"
                  onClick={() => onDelete(profile.id)}
                >
                  <Trash2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{usedBy.length > 0 ? '使用中的代理无法删除' : '删除代理'}</TooltipContent>
            </Tooltip>
          </div>
        )
      })}
    </div>
  )
}

/** 渲染网络状态区块 */
function NetworkStatusSection({
  disabled,
  settings,
  status,
  onRefresh,
}: {
  disabled: boolean
  settings: NetworkSettings
  status?: NetworkStatus
  onRefresh: () => void
}): React.JSX.Element {
  const familyLabel = status?.ipFamilies.length ? status.ipFamilies.map((item) => item.toUpperCase()).join(' / ') : '—'
  return (
    <section className="pb-6">
      <div className="bg-muted/35 grid gap-4 rounded-lg px-4 py-3.5 lg:grid-cols-[1fr_repeat(4,auto)] lg:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-xl',
              status?.online ? 'bg-emerald-500/10 text-emerald-600' : 'bg-destructive/10 text-destructive',
            )}
          >
            {status?.online ? <Wifi className="size-5" /> : <WifiOff className="size-5" />}
          </span>
          <div>
            <div className="text-foreground text-sm font-semibold">{status?.online ? '网络已连接' : '网络不可用'}</div>
            <div className="text-muted-foreground mt-0.5 text-xs">检测结果仅供参考，不展示本机地址。</div>
          </div>
        </div>
        <StatusValue label="网络能力" value={familyLabel} />
        {ROUTES.map(({ key, title }) => (
          <StatusValue
            key={key}
            label={title.replace('网络', '')}
            value={getModeLabel(status?.routes[key] ?? settings[key])}
          />
        ))}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button aria-label="刷新网络状态" disabled={disabled} size="icon" variant="ghost" onClick={onRefresh}>
              <RefreshCw />
            </Button>
          </TooltipTrigger>
          <TooltipContent>刷新网络状态</TooltipContent>
        </Tooltip>
      </div>
    </section>
  )
}

/** 渲染状态值 */
function StatusValue({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="min-w-24">
      <div className="text-muted-foreground text-[11px]">{label}</div>
      <div className="text-foreground mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  )
}

/** 渲染区块标题 */
function SectionHeading({
  description,
  icon: Icon,
  title,
}: {
  description: string
  icon: typeof Router
  title: string
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <span className="text-primary flex size-7 shrink-0 items-center justify-center">
        <Icon className="size-4" />
      </span>
      <div>
        <h2 className="text-foreground text-sm font-semibold">{title}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      </div>
    </div>
  )
}

/** 渲染网络测试结果 */
function NetworkTestResult({ result }: { result?: NetworkProxyTestResult }): React.JSX.Element {
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

/** 渲染网络配置对话框 */
function NetworkProfileDialog({
  profile,
  isTesting,
  testResult,
  onClose,
  onSave,
  onTest,
}: {
  profile?: NetworkProxyProfile
  isTesting: boolean
  testResult?: NetworkProxyTestResult
  onClose: () => void
  onSave: (profile: NetworkProxyProfile) => void
  onTest: (profile: NetworkProxyProfile) => void
}): React.JSX.Element {
  const [form, setForm] = useState<NetworkProxyProfile>(
    () => profile ?? { id: crypto.randomUUID(), name: '', protocol: 'http', host: '', port: 7890 },
  )
  const canSubmit = Boolean(form.name.trim() && form.host.trim() && form.port >= 1 && form.port <= 65_535)
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{profile ? '编辑代理' : '添加代理'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <label>
            <span className="text-foreground text-sm font-medium">名称</span>
            <Input
              className="mt-2"
              placeholder="例如：本地代理"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-[140px_minmax(0,1fr)]">
            <label>
              <span className="text-foreground text-sm font-medium">协议</span>
              <Select
                value={form.protocol}
                onValueChange={(value) =>
                  setForm((current) => ({ ...current, protocol: value as NetworkProxyProtocol }))
                }
              >
                <SelectTrigger className="mt-2 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="http">HTTP</SelectItem>
                  <SelectItem value="https">HTTPS</SelectItem>
                  <SelectItem value="socks5">SOCKS5</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label>
              <span className="text-foreground text-sm font-medium">主机</span>
              <Input
                className="mt-2 font-mono text-xs"
                placeholder="127.0.0.1"
                value={form.host}
                onChange={(event) => setForm((current) => ({ ...current, host: event.target.value }))}
              />
            </label>
          </div>
          <label>
            <span className="text-foreground text-sm font-medium">端口</span>
            <Input
              className="mt-2 font-mono text-xs"
              max={65_535}
              min={1}
              type="number"
              value={form.port}
              onChange={(event) => setForm((current) => ({ ...current, port: Number(event.target.value) }))}
            />
          </label>
          <p className="text-muted-foreground text-xs leading-5">Host 不要填写协议、路径、用户名或密码。</p>
          <NetworkTestResult result={testResult} />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">取消</Button>
          </DialogClose>
          <Button disabled={!canSubmit || isTesting} variant="outline" onClick={() => onTest(normalizeProfile(form))}>
            {isTesting ? <RefreshCw className="animate-spin" /> : <Gauge />}
            {isTesting ? '测试中' : '测试'}
          </Button>
          <Button disabled={!canSubmit} onClick={() => onSave(normalizeProfile(form))}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 规范化配置 */
function normalizeProfile(profile: NetworkProxyProfile): NetworkProxyProfile {
  return { ...profile, name: profile.name.trim(), host: profile.host.trim() }
}

/** 格式化配置地址 */
function formatProfileAddress(profile: NetworkProxyProfile): string {
  const host = profile.host.includes(':') && !profile.host.startsWith('[') ? `[${profile.host}]` : profile.host
  return `${host}:${profile.port}`
}

/** 获取模式标签 */
function getModeLabel(route: { mode: NetworkRouteMode; activeProfileName?: string }): string {
  if (route.mode === 'system') return '跟随全局设置'
  if (route.mode === 'custom') return route.activeProfileName ? `自定义 · ${route.activeProfileName}` : '自定义代理'
  return '直连'
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
