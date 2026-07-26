import { clipboard, shell } from 'electron'

// 所有离开应用的导航都经过这里，避免 renderer 直接获得 shell 权限。
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
