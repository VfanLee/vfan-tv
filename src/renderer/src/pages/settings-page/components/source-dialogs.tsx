import { useState } from 'react'
import { toast } from 'sonner'
import type { LiveSourceInput, VodSourceInput } from '@shared/types'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { createLiveSource, createSource, isApiAvailable, updateLiveSource, updateSource } from '@renderer/services/api'
import type { LiveSourceDialogState, SourceDialogState } from '../types'

const emptySourceInput: VodSourceInput = { name: '', url: '', referer: undefined, enabled: false }
const emptyLiveSourceInput: LiveSourceInput = { name: '', url: '', enabled: true }

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
          referer: dialog.source.referer,
          enabled: dialog.source.enabled,
        }
      : emptySourceInput,
  )
  const [isSaving, setIsSaving] = useState(false)
  const title = dialog.mode === 'create' ? '添加点播源' : '编辑点播源'

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
        <span className="text-foreground text-sm font-medium">URL</span>
        <Input
          className="mt-2 font-mono text-xs"
          value={form.url}
          onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
        />
      </label>
      <label className="block">
        <span className="text-foreground text-sm font-medium">Referer</span>
        <Input
          className="mt-2 font-mono text-xs"
          placeholder="https://example.com"
          value={form.referer ?? ''}
          onChange={(event) => setForm((current) => ({ ...current, referer: event.target.value || undefined }))}
        />
      </label>
      <label className="border-border bg-muted flex items-center justify-between gap-4 rounded-xl border px-3 py-3">
        <span>
          <span className="text-foreground block text-sm font-medium">是否开启</span>
          <span className="text-muted-foreground text-xs">关闭后不会参与聚合搜索。</span>
        </span>
        <Switch
          checked={form.enabled ?? false}
          onCheckedChange={(checked) => setForm((current) => ({ ...current, enabled: checked }))}
        />
      </label>
    </DialogSurface>
  )
}

export function LiveSourceDialog({
  dialog,
  onClose,
  onSaved,
}: {
  dialog: LiveSourceDialogState
  onClose: () => void
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const [form, setForm] = useState<LiveSourceInput>(() =>
    dialog.mode === 'edit'
      ? { name: dialog.source.name, url: dialog.source.url, enabled: dialog.source.enabled }
      : emptyLiveSourceInput,
  )
  const [isSaving, setIsSaving] = useState(false)
  const title = dialog.mode === 'create' ? '添加直播源' : '编辑直播源'

  const save = async (): Promise<void> => {
    if (!isApiAvailable()) return
    setIsSaving(true)
    try {
      if (dialog.mode === 'create') await createLiveSource(form)
      else await updateLiveSource(dialog.source.id, form)
      toast.success(dialog.mode === 'create' ? '直播源已添加' : '直播源已更新')
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
          placeholder="https://example.com/live.m3u"
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
          <span className="text-muted-foreground text-xs">关闭后不会在直播页选择。</span>
        </span>
        <Switch
          checked={form.enabled ?? true}
          onCheckedChange={(checked) => setForm((current) => ({ ...current, enabled: checked }))}
        />
      </label>
    </DialogSurface>
  )
}

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
      <div className="border-border bg-card w-full max-w-lg rounded-xl border p-5 shadow-sm">
        <h2 className="text-foreground mb-5 text-lg font-semibold">{title}</h2>
        <div className="flex flex-col gap-4">{children}</div>
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
