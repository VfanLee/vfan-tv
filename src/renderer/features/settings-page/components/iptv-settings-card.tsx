import { useState } from 'react'
import { CheckCircle2, CircleAlert, Gauge, RadioTower, Save } from 'lucide-react'
import type { IptvEpgMode, IptvEpgSettings } from '@shared/types'
import { SettingsCard } from '@renderer/components'
import { Alert, AlertDescription } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'

const modeOptions: Array<{ value: IptvEpgMode; label: string; description: string }> = [
  { value: 'source', label: '默认（跟随 IPTV 源）', description: '读取 M3U 中声明的节目单地址' },
  { value: 'query', label: '自定义查询接口', description: '支持 {name} 与 {date} 占位符' },
  { value: 'xmltv', label: '自定义 XMLTV/XML.GZ', description: '支持 XML 或 Gzip 压缩文件' },
]

export function IptvEpgSettingsCard({
  apiAvailable,
  value,
  isSaving,
  isTesting,
  onSave,
  onTest,
}: {
  apiAvailable: boolean
  value: IptvEpgSettings
  isSaving: boolean
  isTesting: boolean
  onSave: (value: IptvEpgSettings) => void
  onTest: (value: IptvEpgSettings) => void
}): React.JSX.Element {
  const [form, setForm] = useState(value)
  const requiresUrl = form.mode !== 'source'
  const selected = modeOptions.find((item) => item.value === form.mode)

  return (
    <SettingsCard description="设置应用内所有 IPTV 源使用的节目单服务。" title="节目单设置">
      <div className="flex flex-col gap-5 px-5 py-5">
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

        {form.lastTest.status !== 'idle' ? (
          <Alert>
            {form.lastTest.status === 'success' ? <CheckCircle2 /> : <CircleAlert />}
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <span>{formatTestStatus(form)}</span>
              {form.lastSuccessSource ? <Badge variant="secondary">当前：{form.lastSuccessSource}</Badge> : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <RadioTower className="size-4" />
            全局服务失败时自动回退到 IPTV 源内嵌 EPG。
          </div>
          <div className="flex gap-2">
            <Button
              disabled={!apiAvailable || isTesting || (requiresUrl && !form.url)}
              variant="outline"
              onClick={() => onTest(form)}
            >
              <Gauge className={isTesting ? 'animate-pulse' : undefined} data-icon="inline-start" />
              {isTesting ? '测试中' : '测试 EPG'}
            </Button>
            <Button disabled={!apiAvailable || isSaving || (requiresUrl && !form.url)} onClick={() => onSave(form)}>
              <Save data-icon="inline-start" />
              {isSaving ? '保存中' : '保存'}
            </Button>
          </div>
        </div>
      </div>
    </SettingsCard>
  )
}

function formatTestStatus(value: IptvEpgSettings): string {
  const test = value.lastTest
  if (test.status === 'testing') return '正在测试 EPG 服务…'
  if (test.status === 'success') return `连接可用${test.elapsedMs ? `，${test.elapsedMs} ms` : ''}`
  return test.errorMessage || 'EPG 服务暂时不可用，设置仍可保存。'
}
