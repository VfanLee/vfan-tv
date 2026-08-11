import { clipboard, shell } from 'electron'

// 集中处理应用外部导航与系统浏览器打开。
export function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!isAllowedExternalUrl(url)) {
    throw new Error('仅支持打开 http 或 https 链接')
  }

  await shell.openExternal(url)
  clipboard.writeText(url)
}
