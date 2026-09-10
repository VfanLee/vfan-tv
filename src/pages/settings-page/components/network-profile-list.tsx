import { Network, Pencil, Trash2 } from 'lucide-react'
import type { NetworkProxyProfile, NetworkSettings } from '@/types'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { ROUTES } from './network-routes'
import { formatProfileAddress } from './network-profile-utils'

/** 渲染代理配置列表 */
export function ProxyProfileList({
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
