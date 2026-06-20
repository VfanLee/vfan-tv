import { requireRuntimeApi } from '@renderer/services/api/client'
import { toast } from 'sonner'

export async function openExternalUrl(url: string): Promise<void> {
  try {
    await requireRuntimeApi().shell.openExternal(url)
  } catch (error) {
    toast.error('无法打开浏览器', {
      description: error instanceof Error ? error.message : String(error),
    })
  }
}
