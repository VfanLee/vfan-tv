import { spawn } from 'child_process'
import { shell } from 'electron'

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

  if (process.platform === 'win32') {
    await openWithWindowsExplorer(url)
    return
  }

  await shell.openExternal(url)
}

function openWithWindowsExplorer(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('explorer.exe', [url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })

    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
