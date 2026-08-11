import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { omit } from 'es-toolkit/object'
import type { IptvSourceInput, SourceHeaders, VodSourceInput } from '@shared/types'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Switch } from '@/ui/switch'
import { createIptvSource, createSource, isApiAvailable, updateIptvSource, updateSource } from '@renderer/platform/api'
import type { IptvSourceDialogState, SourceDialogState } from '../types'

/** 新建点播源时使用的空白表单值 */
const emptySourceInput: VodSourceInput = { name: '', url: '', disabled: false, headers: {}, backups: [] }
/** 新建 IPTV 源时使用的空白表单值 */
const emptyIptvSourceInput: IptvSourceInput = { name: '', url: '', disabled: false, headers: {} }

/** 渲染源对话框 */
export function SourceDialog({
  dialog,
  onClose,
  onSaved,
}: {
  dialog: SourceDialogState
  onClose: () => void
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const [form, setForm] = useState<VodSourceInput>(() =>
    dialog.mode === 'edit'
      ? {
          name: dialog.source.name,
          url: dialog.source.url,
          headers: dialog.source.headers,
          disabled: dialog.source.disabled,
          backups: dialog.source.backups,
        }
      : emptySourceInput,
  )
  const [isSaving, setIsSaving] = useState(false)
  const title = dialog.mode === 'create' ? '添加点播源' : '编辑点播源'

  /** 校验并保存点播源表单 */
  const save = async (): Promise<void> => {
    if (!isApiAvailable()) return
    setIsSaving(true)
    try {
      if (dialog.mode === 'create') await createSource(form)
      else await updateSource(dialog.source.id, form)
      toast.success(dialog.mode === 'create' ? '点播源已添加' : '点播源已更新')
      await onSaved()
    } catch (error) {
      toast.error('保存失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <DialogSurface title={title} isSaving={isSaving} onClose={onClose} onSave={() => void save()}>
      <label className="block">
        <span className="text-foreground text-sm font-medium">名称</span>
        <Input
          className="mt-2"
          value={form.name}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
        />
      </label>
      <label className="block">
        <span className="text-foreground text-sm font-medium">当前地址 URL</span>
        <Input
          className="mt-2 font-mono text-xs"
          value={form.url}
          onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
        />
      </label>
      <HeaderEditor
        description="用于点播 API、搜索、测速和海报请求，不会发送给影片播放地址。"
        headers={form.headers ?? {}}
        onChange={(headers) => setForm((current) => ({ ...current, headers }))}
      />
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-foreground text-sm font-medium">备用地址</div>
            <div className="text-muted-foreground text-xs">切换后会自动与当前地址交换。</div>
          </div>
          <Button
            size="sm"
            type="button"
            variant="outline"
            onClick={() =>
              setForm((current) => ({
                ...current,
                backups: [...(current.backups ?? []), ''],
              }))
            }
          >
            <Plus data-icon="inline-start" />
            添加备用地址
          </Button>
        </div>
        {(form.backups ?? []).map((backup, index) => (
          <div
            className="border-border bg-muted/40 grid grid-cols-[1fr_auto] gap-2 rounded-xl border p-3"
            key={`${backup}-${index}`}
          >
            <Input
              aria-label={`备用地址 ${index + 1} URL`}
              className="font-mono text-xs"
              placeholder="https://example.com/api.php/provide/vod"
              value={backup}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  backups: (current.backups ?? []).map((item, itemIndex) =>
                    itemIndex === index ? event.target.value : item,
                  ),
                }))
              }
            />
            <Button
              aria-label={`删除备用地址 ${index + 1}`}
              size="icon"
              type="button"
              variant="destructive"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  backups: (current.backups ?? []).filter((_item, itemIndex) => itemIndex !== index),
                }))
              }
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>
      <label className="block">
        <span className="text-foreground text-sm font-medium">是否开启</span>
        <span className="mt-1 flex items-center justify-between gap-4">
          <span className="text-muted-foreground text-xs">关闭后不会参与聚合搜索。</span>
          <Switch
            checked={!(form.disabled ?? false)}
            onCheckedChange={(checked) => setForm((current) => ({ ...current, disabled: !checked }))}
          />
        </span>
      </label>
    </DialogSurface>
  )
}

/** 渲染 IPTV 源对话框 */
export function IptvSourceDialog({
  dialog,
  onClose,
  onSaved,
}: {
  dialog: IptvSourceDialogState
  onClose: () => void
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const [form, setForm] = useState<IptvSourceInput>(() =>
    dialog.mode === 'edit'
      ? {
          name: dialog.source.name,
          url: dialog.source.url,
          disabled: dialog.source.disabled,
          headers: dialog.source.headers,
        }
      : emptyIptvSourceInput,
  )
  const [isSaving, setIsSaving] = useState(false)
  const title = dialog.mode === 'create' ? '添加 IPTV 源' : '编辑 IPTV 源'

  /** 校验并保存 IPTV 源表单 */
  const save = async (): Promise<void> => {
    if (!isApiAvailable()) return
    setIsSaving(true)
    try {
      if (dialog.mode === 'create') await createIptvSource(form)
      else await updateIptvSource(dialog.source.id, form)
      toast.success(dialog.mode === 'create' ? 'IPTV 源已添加' : 'IPTV 源已更新')
      await onSaved()
    } catch (error) {
      toast.error('保存失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <DialogSurface title={title} isSaving={isSaving} onClose={onClose} onSave={() => void save()}>
      <label className="block">
        <span className="text-foreground text-sm font-medium">名称</span>
        <Input
          className="mt-2"
          value={form.name}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
        />
      </label>
      <label className="block">
        <span className="text-foreground text-sm font-medium">URL</span>
        <Input
          className="mt-2 font-mono text-xs"
          placeholder="https://example.com/iptv.m3u"
          type="url"
          value={form.url}
          onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save()
          }}
        />
      </label>
      <label className="border-border bg-muted flex items-center justify-between gap-4 rounded-xl border px-3 py-3">
        <span>
          <span className="text-foreground block text-sm font-medium">是否开启</span>
          <span className="text-muted-foreground text-xs">关闭后不会在 IPTV 页选择。</span>
        </span>
        <Switch
          checked={!(form.disabled ?? false)}
          onCheckedChange={(checked) => setForm((current) => ({ ...current, disabled: !checked }))}
        />
      </label>
      <HeaderEditor
        description="只用于频道预览和播放，不会发送给播放列表或 EPG 服务。"
        headers={form.headers ?? {}}
        onChange={(headers) => setForm((current) => ({ ...current, headers }))}
      />
    </DialogSurface>
  )
}

/** 渲染标题编辑器 */
function HeaderEditor({
  description,
  headers,
  onChange,
}: {
  description: string
  headers: SourceHeaders
  onChange: (headers: SourceHeaders) => void
}): React.JSX.Element {
  /** 添加标题 */
  const addHeader = (): void => {
    const next = { ...headers }
    const existing = new Set(Object.keys(next).map((name) => name.toLowerCase()))
    let name =
      ['User-Agent', 'Referer', 'X-Custom-Header'].find((item) => !existing.has(item.toLowerCase())) ??
      'X-Custom-Header'
    let suffix = 2
    while (existing.has(name.toLowerCase())) name = `X-Custom-Header-${suffix++}`
    next[name] = ''
    onChange(next)
  }

  return (
    <div className="border-border space-y-4 border-t pt-4">
      <div>
        <h3 className="text-foreground text-sm font-semibold">请求 Header</h3>
        <p className="text-muted-foreground mt-1 text-xs">{description}</p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">User-Agent、Referer 与自定义 Header 在同一处配置。</p>
        <Button type="button" size="sm" variant="outline" onClick={addHeader}>
          <Plus data-icon="inline-start" />
          添加
        </Button>
      </div>
      {Object.entries(headers).map(([name, value], index) => (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2" key={`${name}-${index}`}>
          <Input
            aria-label={`Header ${index + 1} 名称`}
            className="font-mono text-xs"
            placeholder="User-Agent"
            value={name}
            onChange={(event) =>
              onChange(
                Object.fromEntries(
                  Object.entries(headers).map(([key, item]) => [key === name ? event.target.value : key, item]),
                ),
              )
            }
          />
          <Input
            aria-label={`Header ${index + 1} 值`}
            className="font-mono text-xs"
            placeholder="value"
            value={value ?? ''}
            onChange={(event) => onChange({ ...headers, [name]: event.target.value })}
          />
          <Button
            aria-label={`删除 Header ${index + 1}`}
            size="icon"
            type="button"
            variant="ghost"
            onClick={() => onChange(omit(headers, [name]))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
    </div>
  )
}

/** 渲染对话框容器 */
function DialogSurface({
  children,
  isSaving,
  title,
  onClose,
  onSave,
}: {
  children: React.ReactNode
  isSaving: boolean
  title: string
  onClose: () => void
  onSave: () => void
}): React.JSX.Element {
  return (
    <div className="bg-background/45 fixed inset-0 z-50 flex items-center justify-center px-4 backdrop-blur-sm">
      <div className="border-border bg-card flex max-h-[88vh] w-full max-w-lg flex-col rounded-xl border p-5 shadow-sm">
        <h2 className="text-foreground mb-5 text-lg font-semibold">{title}</h2>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-4">{children}</div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button disabled={isSaving} onClick={onSave}>
            {isSaving ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>
    </div>
  )
}
