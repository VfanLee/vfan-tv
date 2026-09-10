import { useState } from 'react'
import { Network, Plus } from 'lucide-react'
import type {
  NetworkProxyProfile,
  NetworkProxyTestResult,
  NetworkRouteKey,
  NetworkRouteMode,
  NetworkSettings,
  NetworkStatus,
} from '@/types'
import { Button } from '@/ui/button'
import { NetworkProfileDialog } from './network-profile-dialog'
import { NetworkRouteCard } from './network-route-card'
import { ProxyProfileList } from './network-profile-list'
import { SectionHeading } from './network-section-heading'
import { ROUTES } from './network-routes'

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
        <section className="py-6">
          <div className="divide-border max-w-4xl divide-y">
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
              description="供 IPTV 访问使用，支持 HTTP、HTTPS 和 SOCKS5，不支持认证。"
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
