import { useState } from 'react'
import type { ReactNode } from 'react'
import type { VodSourceConfig } from '@shared/types'
import {
  Badge,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  RadioGroup,
  RadioGroupItem,
} from '@/ui'

export function VodSourceBackupSwitcher({
  align = 'start',
  children,
  onSwitchBackup,
  source,
}: {
  align?: 'start' | 'center' | 'end'
  children: ReactNode
  onSwitchBackup: (source: VodSourceConfig, backupUrl: string) => Promise<void>
  source: VodSourceConfig
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [switchingUrl, setSwitchingUrl] = useState<string>()

  const switchTo = async (backupUrl: string): Promise<void> => {
    if (switchingUrl || backupUrl === source.url) return
    setSwitchingUrl(backupUrl)
    try {
      await onSwitchBackup(source, backupUrl)
      setOpen(false)
    } catch {
      // 调用方负责展示具体错误，保留弹层便于用户重试。
    } finally {
      setSwitchingUrl(undefined)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-[min(30rem,calc(100vw-5rem))] gap-0 p-2">
        <PopoverHeader className="px-2 py-2">
          <PopoverTitle className="text-sm font-semibold">切换备用地址</PopoverTitle>
          <PopoverDescription className="mt-0.5 text-xs">选择后立即设为当前地址。</PopoverDescription>
        </PopoverHeader>
        <RadioGroup
          className="border-border border-y py-1"
          disabled={Boolean(switchingUrl)}
          value={source.url}
          onValueChange={(url) => void switchTo(url)}
        >
          <AddressRadioItem current url={source.url} itemId={`${source.id}-current`} />
          {source.backups.map((backup, index) => (
            <AddressRadioItem
              url={backup}
              itemId={`${source.id}-backup-${index}`}
              key={backup}
              loading={switchingUrl === backup}
            />
          ))}
        </RadioGroup>
      </PopoverContent>
    </Popover>
  )
}

function AddressRadioItem({
  current = false,
  url,
  itemId,
  loading = false,
}: {
  current?: boolean
  url: string
  itemId: string
  loading?: boolean
}): React.JSX.Element {
  return (
    <label
      className="hover:bg-muted has-[[data-slot=radio-group-item]:focus-visible]:ring-ring flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 has-[[data-slot=radio-group-item]:disabled]:cursor-not-allowed has-[[data-slot=radio-group-item]:disabled]:opacity-60 has-[[data-slot=radio-group-item]:focus-visible]:ring-2"
      htmlFor={itemId}
    >
      <RadioGroupItem id={itemId} value={url} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-xs">{url}</span>
      </span>
      {current ? (
        <Badge variant="secondary">正在使用</Badge>
      ) : loading ? (
        <span className="text-muted-foreground text-xs">切换中</span>
      ) : null}
    </label>
  )
}
