import { BrowserWindow, clipboard, dialog, shell } from 'electron'
import { resolveGitHubUrl } from '@shared/constants'
import type { AppSettings } from '@shared/types'

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
