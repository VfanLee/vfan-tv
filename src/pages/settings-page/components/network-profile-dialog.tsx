import { useState } from 'react'
import { Gauge, RefreshCw } from 'lucide-react'
import type { NetworkProxyProfile, NetworkProxyProtocol, NetworkProxyTestResult } from '@/types'
import { Button } from '@/ui/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { NetworkTestResult } from './network-route-card'

/** 渲染网络配置对话框 */
export function NetworkProfileDialog({
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
