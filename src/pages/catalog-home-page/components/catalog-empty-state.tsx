import { Settings2, Video } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { EmptyState } from '@/components'

/** 渲染资源目录消息 */
export function CatalogMessage({
  action,
  description,
  icon,
  onAction,
  title,
}: {
  action?: string
  description: string
  icon: LucideIcon
  onAction?: () => void
  title: string
}): React.JSX.Element {
  return (
    <EmptyState
      action={action && onAction ? { label: action, onClick: onAction } : undefined}
      description={description}
      icon={icon}
      title={title}
    />
  )
}

/** 渲染未配置可用源时的空状态 */
export function NoSourceState({
  errorMessage,
  onOpenSettings,
}: {
  errorMessage: string
  onOpenSettings: () => void
}): React.JSX.Element {
  return (
    <EmptyState
      action={{ icon: Settings2, label: '打开设置', onClick: onOpenSettings }}
      density="page"
      description={errorMessage || '请先在设置中添加点播源，或启用一个已有的点播源后再回来。'}
      icon={Video}
      title="还没有可用的点播源"
    />
  )
}
