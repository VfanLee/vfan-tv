import { requireRuntimeApi } from '@renderer/services/api/client'

export async function openExternalUrl(url: string): Promise<void> {
  await requireRuntimeApi().shell.openExternal(url)
}
