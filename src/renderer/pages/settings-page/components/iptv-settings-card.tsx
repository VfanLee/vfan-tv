import { useState } from 'react'
import { Save } from 'lucide-react'
import type { IptvEpgMode, IptvEpgSettings } from '@shared/types'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'

/** 节目单时间偏移模式选项 */
const modeOptions: Array<{ value: IptvEpgMode; label: string; description: string }> = [
  { value: 'source', label: '默认（跟随 IPTV 源）', description: '读取 M3U 中声明的节目单地址' },
  { value: 'query', label: '自定义查询接口', description: '支持 {name} 与 {date} 占位符' },
  { value: 'xmltv', label: '自定义 XMLTV/XML.GZ', description: '支持 XML 或 Gzip 压缩文件' },
]

/** 渲染 IPTV 节目单设置卡片 */
export function IptvEpgSettingsCard({
  apiAvailable,
  value,
  isSaving,
  onSave,
}: {
  apiAvailable: boolean
  value: IptvEpgSettings
  isSaving: boolean
  onSave: (value: IptvEpgSettings) => void
}): React.JSX.Element {
  const [form, setForm] = useState(value)
  const requiresUrl = form.mode !== 'source'
  const selected = modeOptions.find((item) => item.value === form.mode)

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-2">
        <label className="text-foreground text-sm font-medium" htmlFor="iptv-epg-mode">
          EPG 服务
        </label>
        <Select
          value={form.mode}
          onValueChange={(mode) => setForm((current) => ({ ...current, mode: mode as IptvEpgMode }))}
        >
          <SelectTrigger id="iptv-epg-mode" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {modeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">{selected?.description}</p>
      </div>

      {requiresUrl ? (
        <label className="grid gap-2">
          <span className="text-foreground text-sm font-medium">服务地址</span>
          <Input
            className="font-mono text-xs"
            placeholder={
              form.mode === 'query' ? 'https://example.com/?ch={name}&date={date}' : 'https://example.com/epg.xml.gz'
            }
            type="url"
            value={form.url ?? ''}
            onChange={(event) => setForm((current) => ({ ...current, url: event.target.value || undefined }))}
          />
        </label>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex"></div>
        <Button disabled={!apiAvailable || isSaving || (requiresUrl && !form.url)} onClick={() => onSave(form)}>
          <Save data-icon="inline-start" />
          {isSaving ? '保存中' : '保存'}
        </Button>
      </div>
    </div>
  )
}
