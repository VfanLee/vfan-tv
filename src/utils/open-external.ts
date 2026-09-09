import { openExternal } from '@/platform/api'
import { toast } from 'sonner'

/** 在默认浏览器打开外链并报告失败 */
export async function openExternalUrl(url: string): Promise<void> {
  try {
    await openExternal(url)
  } catch (error) {
    toast.error('无法打开浏览器', {
      description: error instanceof Error ? error.message : String(error),
    })
  }
}
