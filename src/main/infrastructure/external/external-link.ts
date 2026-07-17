import { BrowserWindow, clipboard, dialog, shell } from 'electron'
import { resolveGitHubUrl } from '@shared/constants'
import type { AppSettings } from '@shared/types'

// 所有离开应用的导航都经过这里，避免 renderer 直接获得 shell 权限。
export function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export async function openExternalUrl(url: string, settings: AppSettings): Promise<void> {
  if (!isAllowedExternalUrl(url)) {
    throw new Error('仅支持打开 http 或 https 链接')
  }

  // GitHub 地址可能按用户设置经由镜像代理访问，确认框展示最终实际打开的地址。
  const resolvedUrl = resolveGitHubUrl(url, settings)
  const options = {
    type: 'question' as const,
    title: '访问外部链接',
    message: '是否访问外部链接？',
    detail: resolvedUrl,
    buttons: ['复制链接', '确定'],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
  }
  const parent = BrowserWindow.getFocusedWindow()
  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)

  if (response === 1) {
    await shell.openExternal(resolvedUrl)
    return
  }

  clipboard.writeText(resolvedUrl)
}
