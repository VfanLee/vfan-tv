import { useEffect, useState } from 'react'
import { Check, Download, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import type { VodSourceConfig, VodSourceInput } from '@shared/types'
import { Badge, Button, Card, Input, Switch } from '@renderer/components'
import {
  createSource,
  deleteSource,
  exportSourcesToFile,
  importSourcesFromFile,
  isApiAvailable,
  listSources,
  updateSource,
} from '@renderer/services/api'

type SourceDialogMode = 'create' | 'edit'

interface SourceDialogState {
  mode: SourceDialogMode
  source?: VodSourceConfig
}

const emptySourceInput: VodSourceInput = {
  name: '',
  baseUrl: '',
  enabled: false,
}

export function SettingsPage(): React.JSX.Element {
  const [sources, setSources] = useState<VodSourceConfig[]>([])
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(() => new Set())
  const [isBatchUpdating, setIsBatchUpdating] = useState(false)
  const [dialog, setDialog] = useState<SourceDialogState>()
  const apiAvailable = isApiAvailable()
  const enabledCount = sources.filter((source) => source.enabled).length
  const allSelected = sources.length > 0 && selectedSourceIds.size === sources.length

  const applySources = (nextSources: VodSourceConfig[]): void => {
    const sourceIds = new Set(nextSources.map((source) => source.id))
    setSources(nextSources)
    setSelectedSourceIds((current) => new Set([...current].filter((id) => sourceIds.has(id))))
  }

  const refreshSources = async (): Promise<void> => {
    applySources(await listSources())
  }

  useEffect(() => {
    let active = true

    void listSources().then((nextSources) => {
      if (active) {
        setSources(nextSources)
      }
    })

    return () => {
      active = false
    }
  }, [])

  const importSources = async (): Promise<void> => {
    if (!apiAvailable) {
      toast.error('当前环境不可用', {
        description: '请在桌面应用中管理播放源。',
      })
      return
    }

    try {
      const result = await importSourcesFromFile()

      if (result.cancelled) {
        return
      }

      toast.success('导入完成', {
        description: `新增 ${result.created.length}，覆盖 ${result.overwritten.length}，跳过 ${result.skipped.length}`,
      })
      await refreshSources()
    } catch (error) {
      toast.error('导入失败', {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const exportSources = async (): Promise<void> => {
    if (!apiAvailable) {
      toast.error('当前环境不可用', {
        description: '请在桌面应用中导出播放源。',
      })
      return
    }

    try {
      const result = await exportSourcesToFile()

      if (result.cancelled) {
        return
      }

      toast.success('导出完成', {
        description: `已导出 ${result.count} 个播放源`,
      })
    } catch (error) {
      toast.error('导出失败', {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const deleteSourceItem = async (source: VodSourceConfig): Promise<void> => {
    if (!apiAvailable) {
      toast.error('当前环境不可用', {
        description: '请在桌面应用中删除播放源。',
      })
      return
    }

    if (!window.confirm(`确定删除播放源「${source.name}」吗？`)) {
      return
    }

    try {
      await deleteSource(source.id)
      toast.success('已删除播放源')
      await refreshSources()
    } catch (error) {
      toast.error('删除失败', {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const toggleSource = async (source: VodSourceConfig, enabled: boolean): Promise<void> => {
    if (!apiAvailable) {
      toast.error('当前环境不可用', {
        description: '请在桌面应用中调整播放源状态。',
      })
      return
    }

    const previousSources = sources
    setSources((current) => current.map((item) => (item.id === source.id ? { ...item, enabled } : item)))

    try {
      await updateSource(source.id, {
        name: source.name,
        baseUrl: source.baseUrl,
        enabled,
      })
    } catch (error) {
      setSources(previousSources)
      toast.error('状态更新失败', {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const toggleSourceSelection = (sourceId: string): void => {
    setSelectedSourceIds((current) => {
      const next = new Set(current)
      if (next.has(sourceId)) next.delete(sourceId)
      else next.add(sourceId)
      return next
    })
  }

  const toggleAllSources = (): void => {
    setSelectedSourceIds(allSelected ? new Set() : new Set(sources.map((source) => source.id)))
  }

  const batchToggleSources = async (enabled: boolean): Promise<void> => {
    const selectedSources = sources.filter((source) => selectedSourceIds.has(source.id))
    if (!apiAvailable || selectedSources.length === 0) return

    setIsBatchUpdating(true)
    setSources((current) =>
      current.map((source) => (selectedSourceIds.has(source.id) ? { ...source, enabled } : source)),
    )

    const results = await Promise.allSettled(
      selectedSources.map((source) => updateSource(source.id, { name: source.name, baseUrl: source.baseUrl, enabled })),
    )
    const failedCount = results.filter((result) => result.status === 'rejected').length

    await refreshSources()
    setIsBatchUpdating(false)

    if (failedCount > 0) {
      toast.error('部分状态更新失败', { description: `${failedCount} 个播放源未能更新，请稍后重试。` })
    } else {
      toast.success(`已${enabled ? '开启' : '关闭'} ${selectedSources.length} 个播放源`)
    }
  }

  return (
    <div className="min-h-full px-8 py-8">
      <header className="mb-7 pr-16">
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-foreground text-3xl font-semibold tracking-tight">设置</h1>
          </div>
        </div>
      </header>

      <div className="grid gap-5">
        <Card className="overflow-hidden">
          <div className="border-border border-b px-5 py-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex gap-3">
                <h2 className="text-foreground text-lg font-semibold">数据源管理</h2>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge>{sources.length} 个源</Badge>
                <Badge className="border-primary bg-accent text-primary">{enabledCount} 个启用</Badge>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Button disabled={!apiAvailable} variant="primary" onClick={() => setDialog({ mode: 'create' })}>
                <Plus size={16} />
                添加播放源
              </Button>
              <Button disabled={!apiAvailable} onClick={importSources}>
                <Upload size={16} />
                批量导入
              </Button>
              <Button disabled={!apiAvailable} onClick={exportSources}>
                <Download size={16} />
                批量导出
              </Button>
              <Button
                disabled={!apiAvailable || selectedSourceIds.size === 0 || isBatchUpdating}
                onClick={() => void batchToggleSources(true)}
              >
                一键开启{selectedSourceIds.size > 0 ? ` (${selectedSourceIds.size})` : ''}
              </Button>
              <Button
                disabled={!apiAvailable || selectedSourceIds.size === 0 || isBatchUpdating}
                onClick={() => void batchToggleSources(false)}
              >
                一键关闭{selectedSourceIds.size > 0 ? ` (${selectedSourceIds.size})` : ''}
              </Button>
            </div>
          </div>

          {sources.length > 0 ? (
            <div className="h-[460px] overflow-auto">
              <div className="min-w-[820px]">
                <div className="border-border bg-muted text-muted-foreground sticky top-0 z-10 grid grid-cols-[40px_1.1fr_2fr_112px_132px] items-center border-b px-5 py-3 text-xs font-medium">
                  <SelectionCheckbox
                    checked={allSelected}
                    label={allSelected ? '取消全选' : '全选播放源'}
                    onChange={toggleAllSources}
                  />
                  <div>播放源名称</div>
                  <div>源路径</div>
                  <div>状态</div>
                  <div className="text-right">操作</div>
                </div>
                {sources.map((source) => (
                  <div
                    key={source.id}
                    className="border-border hover:bg-muted grid grid-cols-[40px_1.1fr_2fr_112px_132px] items-center border-b px-5 py-4 last:border-b-0"
                  >
                    <SelectionCheckbox
                      checked={selectedSourceIds.has(source.id)}
                      label={`选择 ${source.name}`}
                      onChange={() => toggleSourceSelection(source.id)}
                    />
                    <div className="min-w-0">
                      <div className="text-foreground truncate text-sm font-medium">{source.name}</div>
                    </div>
                    <div className="text-muted-foreground min-w-0 truncate font-mono text-xs">{source.baseUrl}</div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={source.enabled}
                        onCheckedChange={(checked) => void toggleSource(source, checked)}
                      />
                      <span className="text-muted-foreground text-xs">{source.enabled ? '开启' : '关闭'}</span>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        className="h-8 px-2"
                        variant="ghost"
                        title="编辑"
                        onClick={() => setDialog({ mode: 'edit', source })}
                      >
                        <Pencil size={15} />
                      </Button>
                      <Button
                        className="h-8 px-2"
                        variant="danger"
                        title="删除"
                        onClick={() => void deleteSourceItem(source)}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="px-5 py-6">
              <div className="border-input bg-muted rounded-xl border border-dashed p-10 text-center">
                <div className="text-foreground text-sm font-semibold">暂无播放源</div>
                <p className="text-muted-foreground mt-2 text-sm">添加一个播放源，或导入 JSON 文件。</p>
              </div>
            </div>
          )}
        </Card>
      </div>

      {dialog ? (
        <SourceDialog
          dialog={dialog}
          onClose={() => setDialog(undefined)}
          onSaved={async () => {
            setDialog(undefined)
            await refreshSources()
          }}
        />
      ) : null}
    </div>
  )
}

function SelectionCheckbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: () => void
}): React.JSX.Element {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="border-input bg-background text-primary focus-visible:ring-ring flex size-5 items-center justify-center rounded-xl border outline-none focus-visible:ring-2"
      role="checkbox"
      type="button"
      onClick={onChange}
    >
      {checked ? <Check size={14} strokeWidth={3} /> : null}
    </button>
  )
}

function SourceDialog({
  dialog,
  onClose,
  onSaved,
}: {
  dialog: SourceDialogState
  onClose: () => void
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const [form, setForm] = useState<VodSourceInput>(() =>
    dialog.source
      ? {
          name: dialog.source.name,
          baseUrl: dialog.source.baseUrl,
          enabled: dialog.source.enabled,
        }
      : emptySourceInput,
  )
  const [isSaving, setIsSaving] = useState(false)
  const title = dialog.mode === 'create' ? '添加播放源' : '编辑播放源'

  const save = async (): Promise<void> => {
    if (!isApiAvailable()) {
      toast.error('当前环境不可用', {
        description: '请在桌面应用中保存播放源。',
      })
      return
    }

    setIsSaving(true)

    try {
      if (dialog.mode === 'create') {
        await createSource(form)
      } else if (dialog.source) {
        await updateSource(dialog.source.id, form)
      }

      toast.success(dialog.mode === 'create' ? '播放源已添加' : '播放源已更新')
      await onSaved()
    } catch (error) {
      toast.error('保存失败', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="bg-background/45 fixed inset-0 z-50 flex items-center justify-center px-4 backdrop-blur-sm">
      <div className="border-border bg-card w-full max-w-lg rounded-xl border p-5 shadow-sm">
        <div className="mb-5">
          <h2 className="text-foreground text-lg font-semibold">{title}</h2>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="text-foreground text-sm font-medium">播放源名称</span>
            <Input
              className="mt-2"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </label>

          <label className="block">
            <span className="text-foreground text-sm font-medium">源路径</span>
            <Input
              className="mt-2 font-mono text-xs"
              value={form.baseUrl}
              onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))}
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
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button disabled={isSaving} variant="primary" onClick={save}>
            {isSaving ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>
    </div>
  )
}
